import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runFlaggingPipeline, ShieldSettings } from './flaggingPipeline.js';
import type { Devvit } from '@devvit/public-api';
import type { UserProfile } from './userRiskService.js';

// ── Mock the Dependencies ────────────────────────────────────

// Mock external engines so we can dictate their results
vi.mock('./spamEngine.js', () => ({
  calculateSpamScore: vi.fn(),
}));

vi.mock('./toxicityService.js', () => ({
  getToxicityWithGate: vi.fn(),
}));

vi.mock('./userRiskService.js', () => ({
  assessUserRisk: vi.fn(),
  RiskTier: { GREEN: 'GREEN', YELLOW: 'YELLOW', RED: 'RED' },
}));

// Mock the guards and analytics to prevent infinite loops / crashes
vi.mock('../utils/guards.js', () => ({
  checkAndConsumeRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock('../utils/analyticsHelpers.js', () => ({
  incrementCounter: vi.fn().mockResolvedValue(undefined),
  addToxicitySample: vi.fn().mockResolvedValue(undefined),
  recordOffender: vi.fn().mockResolvedValue(undefined),
  recordKeywords: vi.fn().mockResolvedValue(undefined),
  pushAlert: vi.fn().mockResolvedValue(undefined),
  setCachedUserRisk: vi.fn().mockResolvedValue(undefined),
}));

// Re-import mocked modules to configure them inside tests
import { calculateSpamScore } from './spamEngine.js';
import { getToxicityWithGate } from './toxicityService.js';
import { assessUserRisk } from './userRiskService.js';
import { checkAndConsumeRateLimit } from '../utils/guards.js';
import {
  incrementCounter,
  addToxicitySample,
  recordOffender,
  recordKeywords,
  pushAlert,
  setCachedUserRisk
} from '../utils/analyticsHelpers.js';

describe('Flagging Pipeline', () => {
  const MOCK_API_KEY = 'mock-key';

  // Create a mock Devvit Context
  let mockContext: any;
  let mockReport: ReturnType<typeof vi.fn>;
  let mockKvGet: ReturnType<typeof vi.fn>;

  const defaultProfile: UserProfile = {
    createdAt: new Date(),
    linkKarma: 100,
    commentKarma: 100,
  };

  const mockComment = { id: 't1_mock', authorId: 't2_user' };

  beforeEach(() => {
    vi.resetAllMocks();

    mockReport = vi.fn().mockResolvedValue(undefined);
    mockKvGet = vi.fn().mockResolvedValue(undefined); // Return undefined -> triggers default settings

    mockContext = {
      reddit: {
        getCurrentSubreddit: vi.fn().mockResolvedValue({ id: 't5_test' }),
        report: mockReport,
      },
      kvStore: {
        get: mockKvGet,
        put: vi.fn().mockResolvedValue(undefined),
      },
    };

    // Keep analytics helpers from crashing
    vi.mocked(incrementCounter).mockResolvedValue(undefined);
    vi.mocked(addToxicitySample).mockResolvedValue(undefined);
    vi.mocked(recordOffender).mockResolvedValue(undefined);
    vi.mocked(recordKeywords).mockResolvedValue(undefined);
    vi.mocked(pushAlert).mockResolvedValue(undefined);
    vi.mocked(setCachedUserRisk).mockResolvedValue(undefined);
    vi.mocked(checkAndConsumeRateLimit).mockResolvedValue(true);
  });

  describe('Threshold & Reporting Behaviours', () => {
    it('flags and reports a comment when the score > threshold', async () => {
      // Force engines to return high scores
      vi.mocked(calculateSpamScore).mockReturnValue({
        score: 80,
        reasons: ['Spammy'],
        breakdown: { urlDensity: 80, capsRatio: 0, repeatedWords: 0, keywordHits: 0 },
        matchedKeywords: [],
      });
      vi.mocked(getToxicityWithGate).mockResolvedValue({
        toxicity: 0.9,
        insult: 0.5,
        profanity: 0.1,
        fromApi: true,
      });
      vi.mocked(assessUserRisk).mockReturnValue({
        score: 90,
        tier: 'RED' as any,
        reasons: ['New account'],
      });

      const result = await runFlaggingPipeline(
        'Some test comment',
        defaultProfile,
        0,
        mockComment as any,
        mockContext,
        MOCK_API_KEY,
        'test_author'
      );
      console.log('TEST 1 RESULT:', JSON.stringify(result));

      // (Spam 80 * 0.4) + (Tox 90 * 0.4) + (User 90 * 0.2) = 32 + 36 + 18 = 86 final score
      expect(result.finalScore).toBeGreaterThanOrEqual(80);
      expect(result.flagged).toBe(true);
      expect(mockReport).toHaveBeenCalledTimes(1);

      const reportCallArgs = mockReport.mock.calls[0]; // [thing, {reason}]
      expect(reportCallArgs[0].id).toBe(mockComment.id);
      expect(reportCallArgs[1].reason).toContain('AntiGravity');
    });

    it('passes silently when the score < threshold', async () => {
      // Force engines to return safe zeros
      vi.mocked(calculateSpamScore).mockReturnValue({
        score: 0,
        reasons: [],
        breakdown: { urlDensity: 0, capsRatio: 0, repeatedWords: 0, keywordHits: 0 },
        matchedKeywords: [],
      });
      vi.mocked(getToxicityWithGate).mockResolvedValue({
        toxicity: 0.0, // Fixed: set to 0 to yield finalScore 0
        insult: 0.0,
        profanity: 0.0,
        fromApi: false, // Simulated skip
      });
      vi.mocked(assessUserRisk).mockReturnValue({
        score: 0,
        tier: 'GREEN' as any,
        reasons: [],
      });

      const result = await runFlaggingPipeline(
        'Safe comment',
        defaultProfile,
        0,
        mockComment as any,
        mockContext,
        MOCK_API_KEY,
        'test_author'
      );

      console.log('mockReport calls:', mockReport.mock.calls.length);

      expect(result.finalScore).toBe(0);
      expect(result.flagged).toBe(false);
      expect(mockReport).not.toHaveBeenCalled();
    });

    it('supports custom thresholds via KV store settings', async () => {
      // Make KV return a very strict threshold (10)
      const customSettings: Partial<ShieldSettings> = { spamThreshold: 10 };
      mockKvGet.mockResolvedValue(customSettings);

      // Force engines to return borderline low scores (15)
      vi.mocked(calculateSpamScore).mockReturnValue({
        score: 15,
        reasons: [],
        breakdown: { urlDensity: 15, capsRatio: 0, repeatedWords: 0, keywordHits: 0 },
        matchedKeywords: [],
      });
      vi.mocked(getToxicityWithGate).mockResolvedValue({
        toxicity: 0.0, insult: 0.0, profanity: 0.0, fromApi: false,
      });
      vi.mocked(assessUserRisk).mockReturnValue({
        score: 0, tier: 'GREEN' as any, reasons: [],
      });

      const result = await runFlaggingPipeline(
        'Borderline comment',
        defaultProfile,
        0,
        mockComment as any,
        mockContext,
        MOCK_API_KEY,
        'test_author'
      );

      // Score 15 * 0.4 = 6.
      // Final composite score is 6, which is lower than threshold 10, BUT the independent spamScore (15) > 10
      // The threshold check in flaggingPipeline checks if ANY of these are true:
      // finalScore >= settings.spamThreshold || exceedsSpam || exceedsToxicity
      expect(result.flagged).toBe(true);
      expect(mockReport).toHaveBeenCalled();
    });

    it('bypasses reporting if autoReport is turned off by mods', async () => {
      // Mod settings turn off auto-reporting
      const customSettings: Partial<ShieldSettings> = { autoReport: false };
      mockKvGet.mockResolvedValue(customSettings);

      // Heavily spammy, should normally flag
      vi.mocked(calculateSpamScore).mockReturnValue({
        score: 100,
        reasons: ['Spammy'],
        breakdown: { urlDensity: 100, capsRatio: 0, repeatedWords: 0, keywordHits: 0 },
        matchedKeywords: [],
      });
      vi.mocked(getToxicityWithGate).mockResolvedValue({
        toxicity: 0.99, insult: 0.99, profanity: 0.99, fromApi: true,
      });
      vi.mocked(assessUserRisk).mockReturnValue({
        score: 100, tier: 'RED' as any, reasons: [],
      });

      const result = await runFlaggingPipeline(
        'Super spam',
        defaultProfile,
        0,
        mockComment as any,
        mockContext,
        MOCK_API_KEY,
        'test_author'
      );

      // It hits 100 final score, but DO NOT report because autoReport is false.
      expect(result.finalScore).toBe(100);
      expect(result.flagged).toBe(false);
      expect(mockReport).not.toHaveBeenCalled();
    });
  });
});
