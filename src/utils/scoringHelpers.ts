// ─────────────────────────────────────────────────────────────
// Scoring Helpers — Normalisation & weighting utilities
// ─────────────────────────────────────────────────────────────

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalise a raw score to the 0–100 range.
 */
export function normalise(value: number, maxRaw: number): number {
  if (maxRaw <= 0) return 0;
  return clamp(Math.round((value / maxRaw) * 100), 0, 100);
}
