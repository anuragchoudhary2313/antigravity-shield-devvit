// ─────────────────────────────────────────────────────────────
// KV Schema — Key naming conventions for Devvit KV Store
// ─────────────────────────────────────────────────────────────
// Every KV key in the app is generated through these helpers
// to keep naming consistent and prevent collisions.
//
// COMPLIANCE: No key ever stores full comment text or user PII.
//             Only aggregated counters and ephemeral cache.
// ─────────────────────────────────────────────────────────────

// ── Daily analytics counters ───────────────────────────────

/** Daily counter: comments/posts scanned. */
export function dailyScannedKey(subredditId: string, date: string): string {
  return `sub:${subredditId}:scanned:${date}`;
}

/** Daily counter: items flagged and reported. */
export function dailyFlagsKey(subredditId: string, date: string): string {
  return `sub:${subredditId}:flags:${date}`;
}

/** Daily counter: Perspective API calls made. */
export function dailyApiCallsKey(subredditId: string, date: string): string {
  return `sub:${subredditId}:apiCalls:${date}`;
}

/** Daily running toxicity average (stored as { sum, count }). */
export function dailyToxicityKey(subredditId: string, date: string): string {
  return `sub:${subredditId}:toxicity:${date}`;
}

// ── User risk cache (ephemeral) ────────────────────────────

/** Ephemeral user-risk cache entry. */
export function userRiskCacheKey(userId: string): string {
  return `cache:user:${userId}:risk`;
}

// ── Top offenders & keywords ───────────────────────────────

/** Top flagged users list for a subreddit. */
export function topOffendersKey(subredditId: string): string {
  return `sub:${subredditId}:topOffenders`;
}

/** Top matched keywords list for a subreddit. */
export function topKeywordsKey(subredditId: string): string {
  return `sub:${subredditId}:topKeywords`;
}

// ── Recent alerts ──────────────────────────────────────────

/** Recent high-risk alerts list for dashboard display. */
export function recentAlertsKey(subredditId: string): string {
  return `sub:${subredditId}:recentAlerts`;
}

// ── Settings ───────────────────────────────────────────────

/** Mod-configured settings (thresholds, blocklist, toggles). */
export function settingsKey(subredditId: string): string {
  return `sub:${subredditId}:settings`;
}

// ── Date helper ────────────────────────────────────────────

/** Today's date in YYYY-MM-DD (UTC). */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
