// ─────────────────────────────────────────────────────────────
// Constants — Default thresholds, keyword lists, weights
// ─────────────────────────────────────────────────────────────

/** Spam score threshold (0–100) above which content is flagged. */
export const DEFAULT_SPAM_THRESHOLD = 70;

/** Toxicity score threshold (0–1) above which content is flagged. */
export const DEFAULT_TOXICITY_THRESHOLD = 0.85;

/** Minimum local spam score required before calling the Perspective API (cost control). */
export const PERSPECTIVE_API_GATE_THRESHOLD = 20;

/** Composite score weights (must sum to 1.0). */
export const SCORE_WEIGHTS = {
  spam: 0.4,
  toxicity: 0.4,
  userRisk: 0.2,
} as const;

/** Default scam / spam keyword blocklist. */
export const DEFAULT_BLOCKLIST: string[] = [
  'guaranteed 10x',
  'airdrop',
  'discord.gg/',
  'guaranteed profit',
  'free crypto',
  'dm me for details',
  'send eth to',
  'double your money',
  'join my telegram',
  'whatsapp group',
];

/** User risk factor thresholds. */
export const USER_RISK = {
  /** Account younger than this (in days) is considered high-risk. */
  NEW_ACCOUNT_DAYS: 7,
  /** Karma below this is considered medium-risk. */
  LOW_KARMA: 50,
} as const;
