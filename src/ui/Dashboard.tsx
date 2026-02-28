// ─────────────────────────────────────────────────────────────
// Dashboard — Moderator Dashboard (Design Document View B)
// ─────────────────────────────────────────────────────────────
// Fullscreen custom-post view with:
//   • Header + Settings navigation
//   • 3 KPI metric cards (Scanned, Flagged, Avg Toxicity)
//   • Recent high-risk alerts list
//   • Top offenders leaderboard
//
// Data is fetched from the KV store via analyticsHelpers.
// ─────────────────────────────────────────────────────────────

import { Devvit, useState, useAsync } from '@devvit/public-api';
import {
  getDailySummary,
  getRecentAlerts,
  getTopOffenders,
} from '../utils/analyticsHelpers.js';
import type {
  DailySummary,
  AlertEntry,
  OffenderEntry,
} from '../utils/analyticsHelpers.js';

// ── Design tokens ──────────────────────────────────────────

const COLORS = {
  safe: '#46D160',
  warning: '#FFD166',
  danger: '#EF476F',
  accent: '#FF4500',
  cardBg: '#2D2D2E',
  headerBg: '#1A1A1B',
  textPrimary: '#D7DADC',
  textSecondary: '#818384',
  divider: '#343536',
} as const;

// ── Sub-components ─────────────────────────────────────────

/** A single KPI metric card. */
function KpiCard(props: {
  label: string;
  value: string;
  color?: string;
}): JSX.Element {
  return (
    <vstack
      grow
      padding="medium"
      cornerRadius="medium"
      backgroundColor={COLORS.cardBg}
      alignment="center middle"
      gap="small"
    >
      <text size="small" color={COLORS.textSecondary}>
        {props.label}
      </text>
      <text size="xlarge" weight="bold" color={props.color ?? COLORS.textPrimary}>
        {props.value}
      </text>
    </vstack>
  );
}

/** A single alert row. */
function AlertRow(props: { alert: AlertEntry }): JSX.Element {
  const { alert } = props;
  const scoreColor =
    alert.score >= 60 ? COLORS.danger : alert.score >= 30 ? COLORS.warning : COLORS.safe;

  return (
    <hstack
      width="100%"
      padding="small"
      gap="small"
      alignment="center middle"
      backgroundColor={COLORS.cardBg}
      cornerRadius="small"
    >
      {/* Score badge */}
      <hstack padding="xsmall" cornerRadius="small" backgroundColor={scoreColor}>
        <text size="small" weight="bold" color="white">
          {alert.score}
        </text>
      </hstack>

      {/* Details */}
      <vstack grow gap="none">
        <text size="small" weight="bold" color={COLORS.textPrimary}>
          u/{alert.authorName}
        </text>
        <text size="xsmall" color={COLORS.textSecondary}>
          {alert.reason.length > 60 ? alert.reason.slice(0, 57) + '…' : alert.reason}
        </text>
      </vstack>
    </hstack>
  );
}

/** A single offender row. */
function OffenderRow(props: { entry: OffenderEntry; rank: number }): JSX.Element {
  return (
    <hstack
      width="100%"
      padding="small"
      gap="small"
      alignment="center middle"
    >
      <text size="small" weight="bold" color={COLORS.textSecondary}>
        #{props.rank}
      </text>
      <text size="small" color={COLORS.textPrimary} grow>
        u/{props.entry.username}
      </text>
      <hstack padding="xsmall" cornerRadius="small" backgroundColor={COLORS.danger}>
        <text size="xsmall" weight="bold" color="white">
          {props.entry.flagCount} flags
        </text>
      </hstack>
    </hstack>
  );
}

// ── Main dashboard component ───────────────────────────────

interface DashboardProps {
  subredditId: string;
  context: Devvit.Context;
  onOpenSettings: () => void;
}

export function Dashboard(props: DashboardProps): JSX.Element {
  const { subredditId, context, onOpenSettings } = props;
  const { kvStore } = context;

  // Fetch data from KV store (JSON round-trip to satisfy JSONValue constraint)
  const { data: summaryData } = useAsync(async () => {
    const result = await getDailySummary(kvStore, subredditId);
    return JSON.parse(JSON.stringify(result));
  });

  const { data: alertsData } = useAsync(async () => {
    const result = await getRecentAlerts(kvStore, subredditId);
    return JSON.parse(JSON.stringify(result));
  });

  const { data: offendersData } = useAsync(async () => {
    const result = await getTopOffenders(kvStore, subredditId);
    return JSON.parse(JSON.stringify(result));
  });

  // Cast and default while loading
  const s = (summaryData as DailySummary | null) ?? { scanned: 0, flagged: 0, avgToxicity: 0, date: '', apiCalls: 0 };
  const alertList = (alertsData as AlertEntry[] | null) ?? [];
  const offenderList = (offendersData as OffenderEntry[] | null) ?? [];

  return (
    <vstack width="100%" height="100%" padding="medium" gap="medium" backgroundColor={COLORS.headerBg}>
      {/* ── Header ── */}
      <hstack width="100%" alignment="center middle">
        <text size="xlarge" weight="bold" color={COLORS.accent}>
          🚀 AntiGravity Shield
        </text>
        <spacer />
        <button
          appearance="bordered"
          size="small"
          icon="settings"
          onPress={onOpenSettings}
        >
          Settings
        </button>
      </hstack>

      {/* ── KPI Cards ── */}
      <hstack width="100%" gap="small">
        <KpiCard label="Scanned (24h)" value={s.scanned.toLocaleString()} />
        <KpiCard
          label="Flagged"
          value={s.flagged.toLocaleString()}
          color={s.flagged > 0 ? COLORS.danger : COLORS.safe}
        />
        <KpiCard
          label="Avg Toxicity"
          value={`${Math.round(s.avgToxicity * 100)}%`}
          color={s.avgToxicity > 0.5 ? COLORS.danger : s.avgToxicity > 0.2 ? COLORS.warning : COLORS.safe}
        />
      </hstack>

      {/* ── Recent Alerts ── */}
      <vstack width="100%" gap="small">
        <text size="medium" weight="bold" color={COLORS.textPrimary}>
          Recent Alerts
        </text>
        {alertList.length > 0 ? (
          alertList.slice(0, 8).map((alert) => (
            <AlertRow alert={alert} />
          ))
        ) : (
          <hstack
            width="100%"
            padding="medium"
            alignment="center middle"
            backgroundColor={COLORS.cardBg}
            cornerRadius="medium"
          >
            <text size="small" color={COLORS.textSecondary}>
              No alerts yet — the shield is watching! 🛡️
            </text>
          </hstack>
        )}
      </vstack>

      {/* ── Top Offenders ── */}
      {offenderList.length > 0 && (
        <vstack width="100%" gap="small">
          <text size="medium" weight="bold" color={COLORS.textPrimary}>
            Top Offenders
          </text>
          <vstack
            width="100%"
            backgroundColor={COLORS.cardBg}
            cornerRadius="medium"
            padding="small"
            gap="small"
          >
            {offenderList.slice(0, 5).map((entry, idx) => (
              <OffenderRow entry={entry} rank={idx + 1} />
            ))}
          </vstack>
        </vstack>
      )}
    </vstack>
  );
}
