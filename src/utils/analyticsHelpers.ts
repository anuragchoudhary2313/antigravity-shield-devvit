// ─────────────────────────────────────────────────────────────
// Analytics Helpers — KV Store operations for dashboard data
// ─────────────────────────────────────────────────────────────
// Provides counter incrementing, cache read/write, and summary
// fetching for the Mod Dashboard (Phase 8).
//
// All operations degrade silently on failure — analytics are
// never allowed to break the core scanning pipeline.
// ─────────────────────────────────────────────────────────────

import type { Devvit } from '@devvit/public-api';
import type { JSONValue } from '@devvit/public-api';
import {
  dailyScannedKey,
  dailyFlagsKey,
  dailyApiCallsKey,
  dailyToxicityKey,
  topOffendersKey,
  topKeywordsKey,
  recentAlertsKey,
  userRiskCacheKey,
  todayUTC,
} from './kvSchema.js';

// ── Types ──────────────────────────────────────────────────

export interface DailySummary {
  date: string;
  scanned: number;
  flagged: number;
  apiCalls: number;
  avgToxicity: number;
}

export interface ToxicityAccumulator {
  sum: number;
  count: number;
}

export interface OffenderEntry {
  username: string;
  flagCount: number;
}

export interface AlertEntry {
  thingId: string;
  authorName: string;
  score: number;
  reason: string;
  timestamp: number;
}

export interface CachedUserRisk {
  score: number;
  tier: string;
  cachedAt: number;
}

interface KeywordEntry {
  keyword: string;
  count: number;
}

// ── Helpers ────────────────────────────────────────────────

type KV = Devvit.Context['kvStore'];

/**
 * Safely cast any serialisable value into JSONValue.
 * Uses JSON round-trip to guarantee type compatibility.
 */
function toJSON(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

// ── Counter operations ─────────────────────────────────────

/** Increment a numeric counter by 1. */
export async function incrementCounter(kv: KV, key: string): Promise<void> {
  try {
    const current = (await kv.get(key) as number | undefined) ?? 0;
    await kv.put(key, current + 1);
  } catch {
    // Degrade silently
  }
}

/** Read a numeric counter, defaulting to 0. */
export async function readCounter(kv: KV, key: string): Promise<number> {
  try {
    return (await kv.get(key) as number | undefined) ?? 0;
  } catch {
    return 0;
  }
}

// ── Toxicity average ───────────────────────────────────────

/** Add a toxicity sample to the daily running average. */
export async function addToxicitySample(
  kv: KV,
  subredditId: string,
  toxicity: number,
): Promise<void> {
  const key = dailyToxicityKey(subredditId, todayUTC());
  try {
    const raw = await kv.get(key);
    const acc: ToxicityAccumulator =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? { sum: (raw as Record<string, number>).sum ?? 0, count: (raw as Record<string, number>).count ?? 0 }
        : { sum: 0, count: 0 };
    acc.sum += toxicity;
    acc.count += 1;
    await kv.put(key, toJSON(acc));
  } catch {
    // Degrade silently
  }
}

// ── Daily summary (for dashboard) ──────────────────────────

/** Fetch the analytics summary for a given date. */
export async function getDailySummary(
  kv: KV,
  subredditId: string,
  date?: string,
): Promise<DailySummary> {
  const d = date ?? todayUTC();
  const [scanned, flagged, apiCalls] = await Promise.all([
    readCounter(kv, dailyScannedKey(subredditId, d)),
    readCounter(kv, dailyFlagsKey(subredditId, d)),
    readCounter(kv, dailyApiCallsKey(subredditId, d)),
  ]);

  let avgToxicity = 0;
  try {
    const raw = await kv.get(dailyToxicityKey(subredditId, d));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const r = raw as Record<string, number>;
      const sum = r.sum ?? 0;
      const count = r.count ?? 0;
      avgToxicity = count > 0 ? sum / count : 0;
    }
  } catch {
    // Ignore
  }

  return { date: d, scanned, flagged, apiCalls, avgToxicity };
}

// ── Top offenders list ─────────────────────────────────────

const MAX_OFFENDERS = 10;

/** Record or increment a user in the top offenders list. */
export async function recordOffender(
  kv: KV,
  subredditId: string,
  username: string,
): Promise<void> {
  const key = topOffendersKey(subredditId);
  try {
    const raw = await kv.get(key);
    const list: OffenderEntry[] =
      Array.isArray(raw) ? (raw as unknown as OffenderEntry[]) : [];

    const existing = list.find((e) => e.username === username);
    if (existing) {
      existing.flagCount += 1;
    } else {
      list.push({ username, flagCount: 1 });
    }

    // Sort descending, keep top N
    list.sort((a, b) => b.flagCount - a.flagCount);
    await kv.put(key, toJSON(list.slice(0, MAX_OFFENDERS)));
  } catch {
    // Degrade silently
  }
}

/** Fetch the top offenders list. */
export async function getTopOffenders(
  kv: KV,
  subredditId: string,
): Promise<OffenderEntry[]> {
  try {
    const raw = await kv.get(topOffendersKey(subredditId));
    return Array.isArray(raw) ? (raw as unknown as OffenderEntry[]) : [];
  } catch {
    return [];
  }
}

// ── Top keywords list ──────────────────────────────────────

const MAX_KEYWORDS = 15;

/** Record matched keywords in the top keywords list. */
export async function recordKeywords(
  kv: KV,
  subredditId: string,
  keywords: string[],
): Promise<void> {
  if (keywords.length === 0) return;
  const key = topKeywordsKey(subredditId);
  try {
    const raw = await kv.get(key);
    const list: KeywordEntry[] =
      Array.isArray(raw) ? (raw as unknown as KeywordEntry[]) : [];

    for (const kw of keywords) {
      const existing = list.find((e) => e.keyword === kw);
      if (existing) {
        existing.count += 1;
      } else {
        list.push({ keyword: kw, count: 1 });
      }
    }

    list.sort((a, b) => b.count - a.count);
    await kv.put(key, toJSON(list.slice(0, MAX_KEYWORDS)));
  } catch {
    // Degrade silently
  }
}

/** Fetch the top keywords list. */
export async function getTopKeywords(
  kv: KV,
  subredditId: string,
): Promise<KeywordEntry[]> {
  try {
    const raw = await kv.get(topKeywordsKey(subredditId));
    return Array.isArray(raw) ? (raw as unknown as KeywordEntry[]) : [];
  } catch {
    return [];
  }
}

// ── Recent alerts (last N high-risk items) ─────────────────

const MAX_ALERTS = 20;

/** Push a new alert to the recent alerts list. */
export async function pushAlert(
  kv: KV,
  subredditId: string,
  alert: AlertEntry,
): Promise<void> {
  const key = recentAlertsKey(subredditId);
  try {
    const raw = await kv.get(key);
    const list: AlertEntry[] =
      Array.isArray(raw) ? (raw as unknown as AlertEntry[]) : [];

    list.unshift(alert); // newest first
    await kv.put(key, toJSON(list.slice(0, MAX_ALERTS)));
  } catch {
    // Degrade silently
  }
}

/** Fetch recent alerts. */
export async function getRecentAlerts(
  kv: KV,
  subredditId: string,
): Promise<AlertEntry[]> {
  try {
    const raw = await kv.get(recentAlertsKey(subredditId));
    return Array.isArray(raw) ? (raw as unknown as AlertEntry[]) : [];
  } catch {
    return [];
  }
}

// ── User risk cache (ephemeral, TTL-checked) ───────────────

/** Default TTL for user risk cache: 1 hour. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Get cached user risk, returns null if expired or missing. */
export async function getCachedUserRisk(
  kv: KV,
  userId: string,
): Promise<CachedUserRisk | null> {
  try {
    const raw = await kv.get(userRiskCacheKey(userId));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const cachedAt = typeof r.cachedAt === 'number' ? r.cachedAt : 0;
    if (Date.now() - cachedAt > CACHE_TTL_MS) {
      kv.delete(userRiskCacheKey(userId)).catch(() => { });
      return null;
    }
    return {
      score: typeof r.score === 'number' ? r.score : 0,
      tier: typeof r.tier === 'string' ? r.tier : 'GREEN',
      cachedAt,
    };
  } catch {
    return null;
  }
}

/** Cache a user risk assessment. */
export async function setCachedUserRisk(
  kv: KV,
  userId: string,
  score: number,
  tier: string,
): Promise<void> {
  try {
    const entry: CachedUserRisk = { score, tier, cachedAt: Date.now() };
    await kv.put(userRiskCacheKey(userId), toJSON(entry));
  } catch {
    // Degrade silently
  }
}

// ── User Activity Rate Tracking ────────────────────────────

const RATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ACTIVITY_HISTORY = 50; // Cap array growth

export function userActivityKey(subredditId: string, userId: string): string {
  return `activity:${subredditId}:${userId}`;
}

/** Record a new activity (post/comment) timestamp for a user. */
export async function recordUserActivity(
  kv: KV,
  subredditId: string,
  userId: string,
): Promise<void> {
  const key = userActivityKey(subredditId, userId);
  const now = Date.now();
  try {
    const raw = await kv.get(key);
    let timestamps: number[] = Array.isArray(raw) ? (raw as number[]) : [];

    // Cull timestamps older than 24h
    timestamps = timestamps.filter(t => now - t < RATE_WINDOW_MS);

    // Add current activity
    timestamps.push(now);

    // Cap memory footprint
    if (timestamps.length > MAX_ACTIVITY_HISTORY) {
      timestamps = timestamps.slice(-MAX_ACTIVITY_HISTORY);
    }

    await kv.put(key, toJSON(timestamps));
  } catch {
    // Degrade silently
  }
}

/** Get count of user's activities in the last 24h. */
export async function getRecentActivityCount(
  kv: KV,
  subredditId: string,
  userId: string,
): Promise<number> {
  const key = userActivityKey(subredditId, userId);
  const now = Date.now();
  try {
    const raw = await kv.get(key);
    const timestamps: number[] = Array.isArray(raw) ? (raw as number[]) : [];

    // Return count of valid timestamps within the window
    return timestamps.filter(t => now - t < RATE_WINDOW_MS).length;
  } catch {
    return 0;
  }
}
