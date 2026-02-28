// ─────────────────────────────────────────────────────────────
// Guards — Deduplication, rate limiting, and KV retry
// ─────────────────────────────────────────────────────────────
// Protective utilities that wrap the core pipeline to prevent
// abuse, reduce API costs, and survive KV failures.
//
// All guards degrade open — if the guard itself fails, the
// pipeline is allowed to proceed rather than blocking content.
// ─────────────────────────────────────────────────────────────

import type { Devvit } from '@devvit/public-api';
import type { JSONValue } from '@devvit/public-api';

type KV = Devvit.Context['kvStore'];

// ── 1. Deduplication cache ─────────────────────────────────
// Prevents re-scanning the same content within a short window.
// Uses a simple KV key with a TTL-style timestamp check.

const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** KV key for dedup record. */
function dedupKey(thingId: string): string {
  return `dedup:${thingId}`;
}

/**
 * Check if this content was recently processed.
 * Returns true if it's a duplicate (should skip), false if fresh.
 */
export async function isDuplicate(kv: KV, thingId: string): Promise<boolean> {
  try {
    const raw = await kv.get(dedupKey(thingId));
    if (raw && typeof raw === 'number') {
      const elapsed = Date.now() - raw;
      if (elapsed < DEDUP_TTL_MS) {
        console.log(`[AntiGravity] DEDUP: Skipping ${thingId} (processed ${elapsed}ms ago)`);
        return true;
      }
    }
  } catch {
    // Guard fails open — allow processing
  }
  return false;
}

/**
 * Mark this content as recently processed.
 */
export async function markProcessed(kv: KV, thingId: string): Promise<void> {
  try {
    await kv.put(dedupKey(thingId), Date.now());
  } catch {
    // Silent failure — dedup is optional
  }
}

// ── 2. Rate limiter (Perspective API) ──────────────────────
// Sliding-window counter per subreddit. Hard cap at N calls
// per minute. If exceeded, the pipeline falls back to
// spam-only scoring (no API call).

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_API_CALLS_PER_WINDOW = 100;

/** KV key for rate limit counter. */
function rateLimitKey(subredditId: string): string {
  return `ratelimit:${subredditId}`;
}

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

/**
 * Check whether we're under the rate limit for API calls.
 * Returns true if the call is allowed, false if rate-limited.
 * Automatically increments the counter when allowed.
 */
export async function checkAndConsumeRateLimit(
  kv: KV,
  subredditId: string,
): Promise<boolean> {
  const key = rateLimitKey(subredditId);
  try {
    const raw = await kv.get(key);
    const now = Date.now();

    let bucket: RateLimitBucket;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const r = raw as Record<string, number>;
      bucket = {
        count: typeof r.count === 'number' ? r.count : 0,
        windowStart: typeof r.windowStart === 'number' ? r.windowStart : now,
      };
    } else {
      bucket = { count: 0, windowStart: now };
    }

    // Reset if the window has elapsed
    if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
      bucket = { count: 0, windowStart: now };
    }

    if (bucket.count >= MAX_API_CALLS_PER_WINDOW) {
      console.warn(
        `[AntiGravity] RATE LIMIT: ${bucket.count}/${MAX_API_CALLS_PER_WINDOW} API calls in window for sub=${subredditId}`,
      );
      return false;
    }

    // Increment and persist
    bucket.count += 1;
    await kv.put(key, JSON.parse(JSON.stringify(bucket)) as JSONValue);
    return true;
  } catch {
    // Guard fails open — allow the call
    return true;
  }
}

// ── 3. KV write with retry ─────────────────────────────────
// Wraps a KV put operation with a single retry on failure.

/**
 * Attempt a KV put with one retry on failure.
 * Returns true if the write succeeded, false if both attempts failed.
 */
export async function kvPutWithRetry(
  kv: KV,
  key: string,
  value: JSONValue,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await kv.put(key, value);
      return true;
    } catch (err) {
      if (attempt === 0) {
        console.warn(`[AntiGravity] KV write failed (attempt 1), retrying: ${key}`);
      } else {
        console.error(`[AntiGravity] KV write failed after retry: ${key}`, err);
      }
    }
  }
  return false;
}

// ── 4. Safe text pre-processing ────────────────────────────

/** Maximum text length we'll process through the pipeline. */
const MAX_PIPELINE_TEXT_LENGTH = 10_000;

/**
 * Sanitise and truncate text before entering the pipeline.
 * Handles null/undefined, normalises whitespace, and caps length.
 */
export function sanitiseText(text: string | null | undefined): string {
  if (!text) return '';
  const cleaned = text
    .replace(/\r\n/g, '\n')       // normalise line endings
    .replace(/[\x00-\x08]/g, '')  // strip control characters
    .trim();
  return cleaned.length > MAX_PIPELINE_TEXT_LENGTH
    ? cleaned.slice(0, MAX_PIPELINE_TEXT_LENGTH)
    : cleaned;
}
