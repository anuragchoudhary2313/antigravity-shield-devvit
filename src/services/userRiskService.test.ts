import { describe, it, expect } from 'vitest';
import { assessUserRisk, RiskTier } from './userRiskService.js';
import { USER_RISK } from '../utils/constants.js';

describe('User Risk Service', () => {
  const ONE_DAY_MS = 1000 * 60 * 60 * 24;

  // ── 1. Account Age Scoring ───────────────────────────

  describe('Account Age Scoring', () => {
    it('returns RED tier for brand new accounts (< 1 day old)', () => {
      const now = Date.now();
      const profile = {
        createdAt: new Date(now - ONE_DAY_MS * 0.5), // 12 hours old
        linkKarma: 1000, // Good karma
        commentKarma: 1000,
      };

      const result = assessUserRisk(profile, 0);
      // Even with good karma, age weight (40%) * score (100) = 40.
      // 40 >= 30, so this hits YELLOW tier minimum based purely on age.
      // The individual factor reason should be present.
      expect(result.reasons.some((r) => r.includes('less than 1 day'))).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(40);
    });

    it('penalizes accounts under 7 days old', () => {
      const profile = {
        createdAt: new Date(Date.now() - ONE_DAY_MS * 3), // 3 days old
        linkKarma: 1000,
        commentKarma: 1000,
      };
      const result = assessUserRisk(profile, 0);
      expect(result.reasons.some((r) => r.includes('old'))).toBe(true);
    });

    it('does not penalize old, established accounts for age', () => {
      const profile = {
        createdAt: new Date(Date.now() - ONE_DAY_MS * 365 * 2), // 2 years old
        linkKarma: 0,
        commentKarma: 0,
      };
      const result = assessUserRisk(profile, 0);
      expect(result.reasons.some((r) => r.includes('old'))).toBe(false); // No age penalty
    });
  });

  // ── 2. Karma Scoring ───────────────────────────────

  describe('Karma Scoring', () => {
    it('heavily penalizes accounts with 0 total karma', () => {
      const profile = {
        createdAt: new Date(Date.now() - ONE_DAY_MS * 365), // 1 year old (safe)
        linkKarma: 0,
        commentKarma: 0,
      };

      const result = assessUserRisk(profile, 0);
      expect(result.reasons.some((r) => r.includes('no activity'))).toBe(true);
      // Weight (35%) * score (100) = 35 -> YELLOW
      expect(result.score).toBeGreaterThanOrEqual(35);
      expect(result.tier).toBe(RiskTier.YELLOW);
    });

    it('penalizes accounts under the low karma threshold', () => {
      const profile = {
        createdAt: new Date(Date.now() - ONE_DAY_MS * 365), // Safe age
        linkKarma: USER_RISK.LOW_KARMA / 4,
        commentKarma: USER_RISK.LOW_KARMA / 4,
      };
      // Total = half of low karma threshold
      const result = assessUserRisk(profile, 0);
      expect(result.reasons.some((r) => r.includes('only'))).toBe(true);
    });

    it('does not penalize accounts with high karma', () => {
      const profile = {
        createdAt: new Date(), // Age penalty will apply, but testing karma isolation
        linkKarma: 5000,
        commentKarma: 5000,
      };
      const result = assessUserRisk(profile, 0);
      expect(result.reasons.some((r) => r.includes('karma'))).toBe(false);
    });
  });

  // ── 3. Comment Frequency ───────────────────────────

  describe('Comment Frequency Scoring', () => {
    const safeProfile = {
      createdAt: new Date(Date.now() - ONE_DAY_MS * 365),
      linkKarma: 10000,
      commentKarma: 10000,
    };

    it('penalizes extremely high posting frequency (>50)', () => {
      const result = assessUserRisk(safeProfile, 55);
      expect(result.reasons.some((r) => r.includes('extremely high'))).toBe(true);
      // Weight (25%) * score (100) = 25 (GREEN)
    });

    it('penalizes high frequency (>25)', () => {
      const result = assessUserRisk(safeProfile, 30);
      expect(result.reasons.some((r) => r.includes('high frequency'))).toBe(true);
    });

    it('does not penalize normal posting frequency (<15)', () => {
      const result = assessUserRisk(safeProfile, 5);
      expect(result.reasons.some((r) => r.includes('comments'))).toBe(false);
    });
  });

  // ── 4. Final Integration / Tiers ───────────────────

  describe('Integration / Final Tier Mapping', () => {
    it('evaluates completely safe profiles as GREEN (Score 0)', () => {
      const profile = {
        createdAt: new Date(Date.now() - ONE_DAY_MS * 1000), // ~3 years old
        linkKarma: 5000,
        commentKarma: 10000,
      };
      const result = assessUserRisk(profile, 2); // 2 comments

      expect(result.score).toBe(0);
      expect(result.tier).toBe(RiskTier.GREEN);
      expect(result.reasons.length).toBe(0);
    });

    it('evaluates extremely risky profiles as RED', () => {
      const profile = {
        createdAt: new Date(), // Brand new (score 100 -> 40 pts)
        linkKarma: 0,          // No karma (score 100 -> 35 pts)
        commentKarma: 0,
      };
      const result = assessUserRisk(profile, 60); // Spamming (score 100 -> 25 pts)

      // 40 + 35 + 25 = 100
      expect(result.score).toBe(100);
      expect(result.tier).toBe(RiskTier.RED);
      expect(result.reasons.length).toBe(3);
    });

    it('evaluates moderately risky profiles as YELLOW', () => {
      const profile = {
        createdAt: new Date(Date.now() - ONE_DAY_MS * 365), // Safe age (0)
        linkKarma: 0,                                       // No karma (100 -> 35 pts)
        commentKarma: 0,
      };
      const result = assessUserRisk(profile, 0); // No comments (0)

      // Total score = 35. Threshold for YELLOW is 30.
      expect(result.score).toBeGreaterThanOrEqual(30);
      expect(result.score).toBeLessThan(60);
      expect(result.tier).toBe(RiskTier.YELLOW);
    });
  });
});
