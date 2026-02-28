// ─────────────────────────────────────────────────────────────
// Toxicity Service — Google Perspective API integration
// ─────────────────────────────────────────────────────────────
// Calls the Perspective API to score text for toxicity, insult,
// and profanity.  Includes PII stripping, cost-control gate,
// and graceful error handling.
//
// COMPLIANCE: Only the text payload is sent to the API.
//             No user IDs, usernames, or subreddit names.
// ─────────────────────────────────────────────────────────────

import { PERSPECTIVE_API_GATE_THRESHOLD } from '../utils/constants.js';

// ── Public interfaces ──────────────────────────────────────

export interface ToxicityResult {
  /** Toxicity probability, 0 – 1. */
  toxicity: number;
  /** Insult probability, 0 – 1. */
  insult: number;
  /** Profanity probability, 0 – 1. */
  profanity: number;
  /** True if the result came from the API; false if neutral fallback was used. */
  fromApi: boolean;
}

/** Neutral result returned when the API is not called or fails. */
const NEUTRAL_RESULT: ToxicityResult = {
  toxicity: 0,
  insult: 0,
  profanity: 0,
  fromApi: false,
};

// ── PII stripping ──────────────────────────────────────────

/**
 * Remove usernames (u/...), subreddit names (r/...), and
 * other Reddit-specific PII from text before sending to
 * an external API.
 *
 * This satisfies Tech Rule §3 — "Never transmit user IDs,
 * usernames, or subreddit names to third-party services."
 */
export function stripPII(text: string): string {
  return text
    // Reddit usernames — u/username or /u/username
    .replace(/\/?u\/[\w-]+/gi, '[user]')
    // Subreddit names — r/subreddit or /r/subreddit
    .replace(/\/?r\/[\w-]+/gi, '[subreddit]')
    // @mentions
    .replace(/@[\w-]+/g, '[mention]');
}

// ── Perspective API types ──────────────────────────────────

interface PerspectiveRequest {
  comment: { text: string };
  requestedAttributes: Record<string, object>;
  languages: string[];
}

interface PerspectiveAttributeScore {
  summaryScore: { value: number };
}

interface PerspectiveResponse {
  attributeScores?: {
    TOXICITY?: PerspectiveAttributeScore;
    INSULT?: PerspectiveAttributeScore;
    PROFANITY?: PerspectiveAttributeScore;
  };
}

// ── Cost-control gate ──────────────────────────────────────

/**
 * Determine whether the Perspective API should be called.
 * Per Tech Rule §3, the local spam score must exceed the gate
 * threshold (default 20) before any external API call is made.
 */
export function shouldCallApi(localSpamScore: number): boolean {
  return localSpamScore > PERSPECTIVE_API_GATE_THRESHOLD;
}

// ── Core API call ──────────────────────────────────────────

const PERSPECTIVE_API_URL =
  'https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze';

/** Maximum text length sent to the API (Perspective limit is 20 KB). */
const MAX_TEXT_LENGTH = 3000;

/**
 * Call the Google Perspective API and return toxicity scores.
 *
 * @param text     Raw comment/post text (PII will be stripped internally).
 * @param apiKey   Google Cloud API key for Perspective.
 * @returns        ToxicityResult with scores or a neutral fallback on error.
 */
export async function getToxicityScore(
  text: string,
  apiKey: string,
): Promise<ToxicityResult> {
  if (!text || text.trim().length === 0) {
    return NEUTRAL_RESULT;
  }

  if (!apiKey) {
    console.warn('[AntiGravity] Perspective API key not configured — skipping toxicity check.');
    return NEUTRAL_RESULT;
  }

  // Strip PII before sending anything externally
  let sanitised = stripPII(text);

  // Truncate to stay within API limits
  if (sanitised.length > MAX_TEXT_LENGTH) {
    sanitised = sanitised.slice(0, MAX_TEXT_LENGTH);
  }

  const requestBody: PerspectiveRequest = {
    comment: { text: sanitised },
    requestedAttributes: {
      TOXICITY: {},
      INSULT: {},
      PROFANITY: {},
    },
    languages: ['en'],
  };

  try {
    const response = await fetch(`${PERSPECTIVE_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error(
        `[AntiGravity] Perspective API returned ${response.status}: ${response.statusText}`,
      );
      return NEUTRAL_RESULT;
    }

    const data = (await response.json()) as PerspectiveResponse;
    const scores = data.attributeScores;

    return {
      toxicity: scores?.TOXICITY?.summaryScore?.value ?? 0,
      insult: scores?.INSULT?.summaryScore?.value ?? 0,
      profanity: scores?.PROFANITY?.summaryScore?.value ?? 0,
      fromApi: true,
    };
  } catch (err) {
    // Network error, timeout, JSON parse failure, etc.
    console.error('[AntiGravity] Perspective API call failed:', err);
    return NEUTRAL_RESULT;
  }
}

// ── Convenience wrapper with cost-control gate ─────────────

/**
 * High-level entry point that enforces the cost-control gate.
 * Returns a neutral result if the local spam score is too low
 * to warrant an external API call.
 *
 * @param text           Raw comment/post text.
 * @param localSpamScore Output of the Spam Engine (0–100).
 * @param apiKey         Google Cloud API key for Perspective.
 */
export async function getToxicityWithGate(
  text: string,
  localSpamScore: number,
  apiKey: string,
): Promise<ToxicityResult> {
  if (!shouldCallApi(localSpamScore)) {
    return NEUTRAL_RESULT;
  }
  return getToxicityScore(text, apiKey);
}
