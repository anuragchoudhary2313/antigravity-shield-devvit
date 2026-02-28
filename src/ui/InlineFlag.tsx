// ─────────────────────────────────────────────────────────────
// Inline Flag — Mod-only risk indicator below flagged content
// ─────────────────────────────────────────────────────────────
// Renders a tinted card below a comment/post that shows:
//   • A severity-coloured header (🟢 / 🟡 / 🔴)
//   • Score badges for Spam, Toxicity, and User Risk
//   • Reason summary text
//   • Quick-action buttons (Approve / Dismiss)
//
// Built with Devvit Blocks (hstack / vstack / text / button).
// Visible ONLY to moderators via the dashboard custom post.
// ─────────────────────────────────────────────────────────────

import { Devvit } from '@devvit/public-api';
import type { PipelineResult } from '../services/flaggingPipeline.js';

// ── Design tokens (from Design Document) ───────────────────

const COLORS = {
  safe: '#46D160',
  warning: '#FFD166',
  danger: '#EF476F',
  neutralBg: '#1A1A1B',
  cardBg: '#2D2D2E',
  textPrimary: '#D7DADC',
  textSecondary: '#818384',
} as const;

// ── Helpers ────────────────────────────────────────────────

function riskColor(score: number): string {
  if (score >= 60) return COLORS.danger;
  if (score >= 30) return COLORS.warning;
  return COLORS.safe;
}

function riskLabel(score: number): string {
  if (score >= 60) return '🔴 High Risk Detected';
  if (score >= 30) return '🟡 Medium Risk Detected';
  return '🟢 Low Risk';
}

function tierColor(tier: string): string {
  switch (tier) {
    case 'RED':
      return COLORS.danger;
    case 'YELLOW':
      return COLORS.warning;
    default:
      return COLORS.safe;
  }
}

function formatPct(value: number): string {
  return `${Math.round(value)}%`;
}

// ── Component ──────────────────────────────────────────────

interface InlineFlagProps {
  result: PipelineResult;
  thingId: string;
  onApprove: () => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
}

/**
 * Render an inline moderation flag card.
 *
 * Usage (inside a Devvit custom post render):
 * ```tsx
 * <InlineFlag
 *   result={pipelineResult}
 *   thingId={comment.id}
 *   onApprove={() => handleApprove(comment.id)}
 *   onDismiss={() => handleDismiss(comment.id)}
 * />
 * ```
 */
export function InlineFlag(props: InlineFlagProps): JSX.Element {
  const { result, onApprove, onDismiss } = props;
  const { finalScore, spam, toxicity, userRisk, reasonSummary } = result;
  const headerColor = riskColor(finalScore);

  return (
    <vstack
      width="100%"
      padding="medium"
      gap="small"
      backgroundColor={COLORS.cardBg}
      cornerRadius="medium"
      border="thin"
      borderColor={headerColor}
    >
      {/* ── Header ── */}
      <hstack width="100%" alignment="center middle" gap="small">
        <text size="medium" weight="bold" color={headerColor}>
          {riskLabel(finalScore)}
        </text>
        <spacer />
        <text size="small" color={COLORS.textSecondary}>
          Score: {finalScore}/100
        </text>
      </hstack>

      {/* ── Score badges ── */}
      <hstack width="100%" gap="small" alignment="center middle">
        {/* Spam badge */}
        <hstack
          padding="xsmall"
          cornerRadius="small"
          backgroundColor={riskColor(spam.score)}
        >
          <text size="small" weight="bold" color="white">
            Spam: {formatPct(spam.score)}
          </text>
        </hstack>

        {/* Toxicity badge */}
        <hstack
          padding="xsmall"
          cornerRadius="small"
          backgroundColor={riskColor(toxicity.toxicity * 100)}
        >
          <text size="small" weight="bold" color="white">
            Toxicity: {formatPct(toxicity.toxicity * 100)}
          </text>
        </hstack>

        {/* User Risk badge */}
        <hstack
          padding="xsmall"
          cornerRadius="small"
          backgroundColor={tierColor(userRisk.tier)}
        >
          <text size="small" weight="bold" color="white">
            User Risk: {userRisk.tier}
          </text>
        </hstack>
      </hstack>

      {/* ── Reason summary ── */}
      <hstack width="100%" padding="xsmall">
        <text size="small" color={COLORS.textSecondary} wrap>
          Reason: {reasonSummary}
        </text>
      </hstack>

      {/* ── Action buttons ── */}
      <hstack width="100%" alignment="center middle" gap="medium">
        <button
          appearance="bordered"
          size="small"
          icon="checkmark"
          onPress={onApprove}
        >
          Approve
        </button>
        <button
          appearance="destructive"
          size="small"
          icon="delete"
          onPress={onDismiss}
        >
          Dismiss
        </button>
      </hstack>
    </vstack>
  );
}
