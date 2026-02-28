// ─────────────────────────────────────────────────────────────
// Spam Engine — Rule-based local content scoring
// ─────────────────────────────────────────────────────────────
// Runs BEFORE any external API call.  Each signal produces a
// sub-score; they are combined into a single 0–100 Spam Score.
// ─────────────────────────────────────────────────────────────

import { DEFAULT_BLOCKLIST } from '../utils/constants.js';
import { clamp } from '../utils/scoringHelpers.js';

// ── Public interface ───────────────────────────────────────

export interface SpamSignalBreakdown {
  urlDensity: number;       // 0 – 100
  repeatedWords: number;    // 0 – 100
  capsRatio: number;        // 0 – 100
  keywordHits: number;      // 0 – 100
}

export interface SpamResult {
  /** Composite spam score, 0 – 100. */
  score: number;
  /** Human-readable reasons that contributed to the score. */
  reasons: string[];
  /** Per-signal breakdown (useful for debugging / dashboard). */
  breakdown: SpamSignalBreakdown;
  /** Which blocklist keywords were matched (if any). */
  matchedKeywords: string[];
}

// ── Signal weights (must sum to 1.0) ───────────────────────

const SIGNAL_WEIGHTS = {
  urlDensity: 0.25,
  repeatedWords: 0.20,
  capsRatio: 0.20,
  keywordHits: 0.35,
} as const;

// ── Individual signal detectors ────────────────────────────

/**
 * URL density — how much of the text is composed of links.
 * More links (relative to text length) → higher score.
 */
function scoreUrlDensity(text: string): { score: number; reason: string | null } {
  const urlPattern = /https?:\/\/[^\s]+/gi;
  const urls = text.match(urlPattern) ?? [];
  if (urls.length === 0) return { score: 0, reason: null };

  const urlChars = urls.reduce((sum, u) => sum + u.length, 0);
  const ratio = urlChars / Math.max(text.length, 1);

  // 1 URL in a long post is fine; many URLs in a short post is suspicious.
  // Also factor in raw URL count for short posts that are just links.
  const densityScore = ratio * 100;
  const countBonus = Math.min(urls.length * 10, 40); // max +40 for many links
  const raw = clamp(Math.round(densityScore + countBonus), 0, 100);

  return {
    score: raw,
    reason: raw > 0 ? `Contains ${urls.length} URL(s) (${Math.round(ratio * 100)}% of text)` : null,
  };
}

/**
 * Repeated-word detector — looks for words repeated excessively.
 * Spammers often repeat words/phrases to game visibility.
 */
function scoreRepeatedWords(text: string): { score: number; reason: string | null } {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2); // ignore tiny words like "a", "to"

  if (words.length < 4) return { score: 0, reason: null };

  const freq: Record<string, number> = {};
  for (const w of words) {
    freq[w] = (freq[w] ?? 0) + 1;
  }

  // Find the most repeated word
  let maxRepeat = 0;
  let topWord = '';
  for (const [word, count] of Object.entries(freq)) {
    if (count > maxRepeat) {
      maxRepeat = count;
      topWord = word;
    }
  }

  // If no word repeats more than once, it's not repeated
  if (maxRepeat <= 1) return { score: 0, reason: null };

  const repeatRatio = maxRepeat / words.length;
  // If > 40% of all words are the same word, that's highly suspicious
  // The baseline repeat is ignored, only excessive repeats are scored
  const raw = clamp(Math.round((repeatRatio - 0.2) * 200), 0, 100);

  return {
    score: raw,
    reason: raw > 15 ? `Word "${topWord}" repeated ${maxRepeat}× (${Math.round(repeatRatio * 100)}% of text)` : null,
  };
}

/**
 * ALL-CAPS ratio — spammy / aggressive text often uses heavy capitalisation.
 */
function scoreCapsRatio(text: string): { score: number; reason: string | null } {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 8) return { score: 0, reason: null }; // too short to judge

  const upperCount = (text.match(/[A-Z]/g) ?? []).length;
  const ratio = upperCount / letters.length;

  // Normal text ~5-10% caps.  > 50% is suspicious, > 80% is very spammy.
  const raw = ratio > 0.5 ? clamp(Math.round((ratio - 0.3) * 143), 0, 100) : 0;

  return {
    score: raw,
    reason: raw > 0 ? `${Math.round(ratio * 100)}% uppercase letters` : null,
  };
}

/**
 * Scam-keyword matcher — checks against the blocklist.
 * Each hit adds a chunk of score; more hits → higher score.
 */
function scoreKeywordHits(
  text: string,
  customBlocklist: string[] = [],
): { score: number; reason: string | null; matched: string[] } {
  const lowerText = text.toLowerCase();
  const allKeywords = [...DEFAULT_BLOCKLIST, ...customBlocklist];
  const matched: string[] = [];

  for (const keyword of allKeywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      matched.push(keyword);
    }
  }

  if (matched.length === 0) return { score: 0, reason: null, matched: [] };

  // First keyword = 40 pts, each additional = +20, cap at 100
  const raw = clamp(40 + (matched.length - 1) * 20, 0, 100);

  return {
    score: raw,
    reason: `Matched blocklist keyword(s): ${matched.map((k) => `"${k}"`).join(', ')}`,
    matched,
  };
}

// ── Main export ────────────────────────────────────────────

/**
 * Calculate a composite spam score for the given text.
 *
 * @param text           The comment / post body to scan.
 * @param customBlocklist Optional extra keywords from mod settings.
 * @returns              A SpamResult with score, reasons, and breakdown.
 */
export function calculateSpamScore(
  text: string,
  customBlocklist: string[] = [],
): SpamResult {
  if (!text || text.trim().length === 0) {
    return {
      score: 0,
      reasons: [],
      breakdown: { urlDensity: 0, repeatedWords: 0, capsRatio: 0, keywordHits: 0 },
      matchedKeywords: [],
    };
  }

  const url = scoreUrlDensity(text);
  const repeat = scoreRepeatedWords(text);
  const caps = scoreCapsRatio(text);
  const keywords = scoreKeywordHits(text, customBlocklist);

  const breakdown: SpamSignalBreakdown = {
    urlDensity: url.score,
    repeatedWords: repeat.score,
    capsRatio: caps.score,
    keywordHits: keywords.score,
  };

  // Weighted composite
  const composite =
    url.score * SIGNAL_WEIGHTS.urlDensity +
    repeat.score * SIGNAL_WEIGHTS.repeatedWords +
    caps.score * SIGNAL_WEIGHTS.capsRatio +
    keywords.score * SIGNAL_WEIGHTS.keywordHits;

  const score = clamp(Math.round(composite), 0, 100);

  // Collect non-null reasons
  const reasons: string[] = [];
  if (url.reason) reasons.push(url.reason);
  if (repeat.reason) reasons.push(repeat.reason);
  if (caps.reason) reasons.push(caps.reason);
  if (keywords.reason) reasons.push(keywords.reason);

  return { score, reasons, breakdown, matchedKeywords: keywords.matched };
}
