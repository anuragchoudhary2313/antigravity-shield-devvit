// ─────────────────────────────────────────────────────────────
// Flagging Pipeline — Composite scoring & reporting
// ─────────────────────────────────────────────────────────────
// Orchestrates: Spam Engine → (conditional) Toxicity Engine
//             → User Risk → weighted Final Score.
//
// If the final score exceeds the configured threshold, the
// content is reported to the Mod Queue via context.reddit.report().
// Full analytics are persisted in the KV store for the dashboard.
//
// ACTION MODEL: "Suggest & Report" only — no automated removals
// or bans (per Reddit Developer Terms / Tech Rule §5).
// ─────────────────────────────────────────────────────────────

import { Devvit } from '@devvit/public-api';
import type { Comment, Post } from '@devvit/public-api';

import { calculateSpamScore } from './spamEngine.js';
import type { SpamResult } from './spamEngine.js';
import { getToxicityWithGate } from './toxicityService.js';
import type { ToxicityResult } from './toxicityService.js';
import { assessUserRisk } from './userRiskService.js';
import type { UserProfile, UserRisk } from './userRiskService.js';

import {
  DEFAULT_SPAM_THRESHOLD,
  DEFAULT_TOXICITY_THRESHOLD,
  SCORE_WEIGHTS,
} from '../utils/constants.js';
import { clamp } from '../utils/scoringHelpers.js';
import {
  dailyFlagsKey,
  dailyScannedKey,
  dailyApiCallsKey,
  settingsKey,
  todayUTC,
} from '../utils/kvSchema.js';
import {
  incrementCounter,
  addToxicitySample,
  recordOffender,
  recordKeywords,
  pushAlert,
  setCachedUserRisk,
} from '../utils/analyticsHelpers.js';
import { checkAndConsumeRateLimit } from '../utils/guards.js';

// ── Public types ───────────────────────────────────────────

export interface PipelineResult {
  /** Composite final score, 0 – 100. */
  finalScore: number;
  /** Whether the content was flagged and reported. */
  flagged: boolean;
  /** Breakdown of each engine's output. */
  spam: SpamResult;
  toxicity: ToxicityResult;
  userRisk: UserRisk;
  /** Human-readable summary reason string. */
  reasonSummary: string;
}

/** Mod-configurable settings stored in the KV store. */
export interface ShieldSettings {
  spamThreshold: number;
  toxicityThreshold: number;
  autoReport: boolean;
  customBlocklist: string[];
}

const DEFAULT_SETTINGS: ShieldSettings = {
  spamThreshold: DEFAULT_SPAM_THRESHOLD,
  toxicityThreshold: DEFAULT_TOXICITY_THRESHOLD,
  autoReport: true,
  customBlocklist: [],
};

// ── Helpers ────────────────────────────────────────────────

/** Load mod settings from KV store, falling back to defaults. */
async function loadSettings(
  kvStore: Devvit.Context['kvStore'],
  subredditId: string,
): Promise<ShieldSettings> {
  try {
    const raw = await kvStore.get(settingsKey(subredditId));
    if (raw && typeof raw === 'object') {
      return { ...DEFAULT_SETTINGS, ...(raw as Partial<ShieldSettings>) };
    }
  } catch {
    // KV read failure — fall back to defaults silently
  }
  return DEFAULT_SETTINGS;
}

// ── Main pipeline ──────────────────────────────────────────

/**
 * Run the full AntiGravity Shield pipeline on a piece of content.
 *
 * @param text               The body text of the comment or post.
 * @param userProfile        Minimal user metadata (createdAt, karma).
 * @param recentCommentCount How many comments this user posted in 24 h.
 * @param thing              The Devvit Comment or Post object (for reporting).
 * @param context            The Devvit context (reddit, kvStore, etc.).
 * @param apiKey             Google Perspective API key.
 * @param authorName         Username string for analytics tracking.
 * @param authorId           User ID for risk cache writes.
 * @returns                  A PipelineResult describing what happened.
 */
export async function runFlaggingPipeline(
  text: string,
  userProfile: UserProfile,
  recentCommentCount: number,
  thing: Comment | Post,
  context: Devvit.Context,
  apiKey: string,
  authorName: string = 'unknown',
  authorId: string = '',
): Promise<PipelineResult> {
  const startTime = Date.now();
  const { reddit, kvStore } = context;
  const subreddit = await reddit.getCurrentSubreddit();
  const subredditId = subreddit.id;
  const today = todayUTC();

  console.log(`[AntiGravity] Pipeline start — thing=${thing.id}, author=u/${authorName}`);

  // ── 1. Load mod-configured settings ──────────────────────
  const settings = await loadSettings(kvStore, subredditId);

  // ── 2. Spam Engine (local, always runs) ──────────────────
  const spam = calculateSpamScore(text, settings.customBlocklist);
  console.log(`[AntiGravity]   Spam score=${spam.score} reasons=[${spam.reasons.join(', ')}]`);

  // ── 3. Toxicity Engine (external, cost-gated + rate-limited) ──
  let toxicity: ToxicityResult;
  const rateLimitOk = await checkAndConsumeRateLimit(kvStore, subredditId);
  if (rateLimitOk) {
    toxicity = await getToxicityWithGate(text, spam.score, apiKey);
  } else {
    console.warn('[AntiGravity]   Toxicity skipped — rate limit exceeded');
    toxicity = { toxicity: 0, insult: 0, profanity: 0, fromApi: false };
  }
  console.log(`[AntiGravity]   Toxicity=${toxicity.toxicity} fromApi=${toxicity.fromApi}`);

  // Track API call counter if the API was actually invoked
  if (toxicity.fromApi) {
    await incrementCounter(kvStore, dailyApiCallsKey(subredditId, today));
  }

  // ── 4. User Risk Assessment ──────────────────────────────
  const userRisk = assessUserRisk(userProfile, recentCommentCount);
  console.log(`[AntiGravity]   UserRisk score=${userRisk.score} tier=${userRisk.tier}`);

  // Cache user risk for 1 hour (reduces repeat lookups)
  if (authorId) {
    await setCachedUserRisk(kvStore, authorId, userRisk.score, userRisk.tier);
  }

  // ── 5. Composite weighted score ──────────────────────────
  // Toxicity arrives as 0–1; convert to 0–100 for weighting.
  const toxScore = toxicity.toxicity * 100;

  const composite =
    spam.score * SCORE_WEIGHTS.spam +
    toxScore * SCORE_WEIGHTS.toxicity +
    userRisk.score * SCORE_WEIGHTS.userRisk;

  const finalScore = clamp(Math.round(composite), 0, 100);

  // ── 6. Threshold check ───────────────────────────────────
  const exceedsSpam = spam.score >= settings.spamThreshold;
  const exceedsToxicity = toxicity.toxicity >= settings.toxicityThreshold;
  const shouldFlag = finalScore >= settings.spamThreshold || exceedsSpam || exceedsToxicity;

  // ── 7. Build reason summary ──────────────────────────────
  const allReasons = [...spam.reasons, ...userRisk.reasons];
  if (toxicity.fromApi && toxicity.toxicity > 0.5) {
    allReasons.push(`Toxicity: ${Math.round(toxicity.toxicity * 100)}%`);
  }
  const reasonSummary = allReasons.length > 0
    ? allReasons.join('; ')
    : 'No specific signals triggered.';

  // ── 8. Analytics: counters & samples ─────────────────────
  // All analytics degrade silently on failure (never break pipeline)
  await Promise.all([
    incrementCounter(kvStore, dailyScannedKey(subredditId, today)),
    addToxicitySample(kvStore, subredditId, toxicity.toxicity),
    // Track which keywords were matched (for top keywords dashboard)
    recordKeywords(kvStore, subredditId, spam.matchedKeywords ?? []),
  ]);

  // ── 9. Report to Mod Queue if flagged ────────────────────
  let flagged = false;
  if (shouldFlag && settings.autoReport) {
    try {
      await reddit.report(thing, {
        reason: `[AntiGravity Shield] Score: ${finalScore}/100 — ${reasonSummary}`,
      });
      flagged = true;

      // Analytics for flagged items
      await Promise.all([
        incrementCounter(kvStore, dailyFlagsKey(subredditId, today)),
        recordOffender(kvStore, subredditId, authorName),
        pushAlert(kvStore, subredditId, {
          thingId: thing.id,
          authorName,
          score: finalScore,
          reason: reasonSummary,
          timestamp: Date.now(),
        }),
      ]);

      console.log(
        `[AntiGravity] ⚠️ FLAGGED (score=${finalScore}): ${reasonSummary}`,
      );
    } catch (err) {
      console.error('[AntiGravity] Failed to report to mod queue:', err);
    }
  } else {
    console.log(
      `[AntiGravity] ✅ PASS (score=${finalScore}) — below threshold`,
    );
  }

  const elapsed = Date.now() - startTime;
  console.log(`[AntiGravity] Pipeline complete in ${elapsed}ms`);

  return {
    finalScore,
    flagged,
    spam,
    toxicity,
    userRisk,
    reasonSummary,
  };
}
