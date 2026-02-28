// ─────────────────────────────────────────────────────────────
// User Risk Service — Account profiling & risk assessment
// ─────────────────────────────────────────────────────────────
// Evaluates the poster's account age, total karma, and recent
// comment frequency to produce a risk tier (GREEN/YELLOW/RED).
//
// Designed to run alongside the Spam & Toxicity engines and
// feed into the composite scoring pipeline (Phase 4).
// ─────────────────────────────────────────────────────────────

import { USER_RISK } from '../utils/constants.js';
import { clamp } from '../utils/scoringHelpers.js';

// ── Public types ───────────────────────────────────────────

export enum RiskTier {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  RED = 'RED',
}

export interface UserRisk {
  /** Overall risk tier. */
  tier: RiskTier;
  /** Numeric risk score, 0 – 100. */
  score: number;
  /** Human-readable reasons that contributed to the score. */
  reasons: string[];
}

/**
 * Minimal subset of the Devvit `User` object that we need.
 * Using an interface instead of importing the class directly
 * keeps this service testable without a Devvit runtime.
 */
export interface UserProfile {
  createdAt: Date;
  linkKarma: number;
  commentKarma: number;
}

// ── Signal weights (must sum to 1.0) ───────────────────────

const SIGNAL_WEIGHTS = {
  accountAge: 0.40,
  karma: 0.35,
  commentFrequency: 0.25,
} as const;

// ── Individual risk signals ────────────────────────────────

/**
 * Account age scoring.
 * Newer accounts are riskier — a very common spam indicator.
 */
function scoreAccountAge(createdAt: Date): { score: number; reason: string | null } {
  const now = Date.now();
  const ageDays = (now - createdAt.getTime()) / (1000 * 60 * 60 * 24);

  if (ageDays < 1) {
    // Brand new account (< 24 h)
    return { score: 100, reason: `Account is less than 1 day old` };
  }
  if (ageDays < USER_RISK.NEW_ACCOUNT_DAYS) {
    // Young account (< 7 days)
    const raw = clamp(Math.round(100 - (ageDays / USER_RISK.NEW_ACCOUNT_DAYS) * 60), 40, 100);
    return { score: raw, reason: `Account is only ${Math.floor(ageDays)} day(s) old` };
  }
  if (ageDays < 30) {
    // Under a month — slightly suspicious
    return { score: 30, reason: `Account is ${Math.floor(ageDays)} days old (< 30 days)` };
  }
  if (ageDays < 90) {
    return { score: 15, reason: null };
  }
  return { score: 0, reason: null };
}

/**
 * Karma scoring.
 * Low karma accounts are more likely to be throwaways or spam bots.
 */
function scoreKarma(linkKarma: number, commentKarma: number): { score: number; reason: string | null } {
  const totalKarma = linkKarma + commentKarma;

  if (totalKarma < 1) {
    return { score: 100, reason: `Total karma is ${totalKarma} (no activity)` };
  }
  if (totalKarma < USER_RISK.LOW_KARMA) {
    const raw = clamp(Math.round(100 - (totalKarma / USER_RISK.LOW_KARMA) * 70), 30, 100);
    return { score: raw, reason: `Total karma is only ${totalKarma}` };
  }
  if (totalKarma < 200) {
    return { score: 15, reason: null };
  }
  return { score: 0, reason: null };
}

/**
 * Comment frequency scoring.
 * A high recent-comment count can indicate bot-like or spammy behaviour.
 *
 * @param recentCommentCount  Number of comments in the last 24 h (caller provides).
 */
function scoreCommentFrequency(recentCommentCount: number): { score: number; reason: string | null } {
  if (recentCommentCount > 50) {
    return { score: 100, reason: `${recentCommentCount} comments in the last 24 h (extremely high)` };
  }
  if (recentCommentCount > 25) {
    return { score: 60, reason: `${recentCommentCount} comments in the last 24 h (high frequency)` };
  }
  if (recentCommentCount > 15) {
    return { score: 30, reason: `${recentCommentCount} comments in the last 24 h (elevated)` };
  }
  return { score: 0, reason: null };
}

// ── Tier mapping ───────────────────────────────────────────

function tierFromScore(score: number): RiskTier {
  if (score >= 60) return RiskTier.RED;
  if (score >= 30) return RiskTier.YELLOW;
  return RiskTier.GREEN;
}

// ── Main export ────────────────────────────────────────────

/**
 * Assess the risk level of a user based on their profile metadata.
 *
 * @param profile              Subset of the Devvit `User` object.
 * @param recentCommentCount   How many comments the user has posted in the last 24 h.
 *                             The caller is responsible for fetching this (it may
 *                             come from the KV cache or the Reddit API).
 */
export function assessUserRisk(
  profile: UserProfile,
  recentCommentCount: number = 0,
): UserRisk {
  const age = scoreAccountAge(profile.createdAt);
  const karma = scoreKarma(profile.linkKarma, profile.commentKarma);
  const freq = scoreCommentFrequency(recentCommentCount);

  const composite =
    age.score * SIGNAL_WEIGHTS.accountAge +
    karma.score * SIGNAL_WEIGHTS.karma +
    freq.score * SIGNAL_WEIGHTS.commentFrequency;

  const score = clamp(Math.round(composite), 0, 100);
  const tier = tierFromScore(score);

  const reasons: string[] = [];
  if (age.reason) reasons.push(age.reason);
  if (karma.reason) reasons.push(karma.reason);
  if (freq.reason) reasons.push(freq.reason);

  return { tier, score, reasons };
}
