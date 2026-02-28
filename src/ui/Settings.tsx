// ─────────────────────────────────────────────────────────────
// Settings — Configuration Panel (Design Document View C)
// ─────────────────────────────────────────────────────────────
// Allows mods to configure:
//   • Spam & toxicity thresholds
//   • Auto-report toggle
//   • Custom keyword blocklist
//
// Settings are persisted in the KV store and loaded by the
// flagging pipeline at scan time.
// ─────────────────────────────────────────────────────────────

import { Devvit, useState, useAsync } from '@devvit/public-api';
import { settingsKey } from '../utils/kvSchema.js';
import {
  DEFAULT_SPAM_THRESHOLD,
  DEFAULT_TOXICITY_THRESHOLD,
} from '../utils/constants.js';

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
  inputBg: '#3A3A3C',
} as const;

// ── Settings shape (must match flaggingPipeline) ───────────

interface ShieldSettings {
  spamThreshold: number;
  toxicityThreshold: number;
  autoReport: boolean;
  customBlocklist: string[];
}

const DEFAULTS: ShieldSettings = {
  spamThreshold: DEFAULT_SPAM_THRESHOLD,
  toxicityThreshold: DEFAULT_TOXICITY_THRESHOLD,
  autoReport: true,
  customBlocklist: [],
};

// ── Component ──────────────────────────────────────────────

interface SettingsProps {
  subredditId: string;
  context: Devvit.Context;
  onBack: () => void;
}

export function Settings(props: SettingsProps): JSX.Element {
  const { subredditId, context, onBack } = props;
  const { kvStore } = context;

  // ── Load saved settings from KV ──────────────────────────
  const { data: savedRaw } = useAsync(async () => {
    const raw = await kvStore.get(settingsKey(subredditId));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return JSON.parse(JSON.stringify(raw));
    }
    return JSON.parse(JSON.stringify(DEFAULTS));
  });

  const saved = (savedRaw as ShieldSettings | null) ?? DEFAULTS;

  // ── Local state ──────────────────────────────────────────
  const [spamThreshold, setSpamThreshold] = useState<number>(saved.spamThreshold);
  const [toxThreshold, setToxThreshold] = useState<number>(saved.toxicityThreshold);
  const [autoReport, setAutoReport] = useState<boolean>(saved.autoReport);
  const [blocklistText, setBlocklistText] = useState<string>(
    saved.customBlocklist.join(', '),
  );
  const [statusMsg, setStatusMsg] = useState<string>('');

  // ── Handlers ─────────────────────────────────────────────

  const handleSave = async () => {
    const settings: ShieldSettings = {
      spamThreshold,
      toxicityThreshold: toxThreshold,
      autoReport,
      customBlocklist: blocklistText
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
    };

    try {
      await kvStore.put(
        settingsKey(subredditId),
        JSON.parse(JSON.stringify(settings)),
      );
      setStatusMsg('✅ Settings saved!');
    } catch {
      setStatusMsg('❌ Failed to save settings.');
    }
  };

  const handleReset = () => {
    setSpamThreshold(DEFAULTS.spamThreshold);
    setToxThreshold(DEFAULTS.toxicityThreshold);
    setAutoReport(DEFAULTS.autoReport);
    setBlocklistText('');
    setStatusMsg('Defaults restored — press Save to apply.');
  };

  // ── Threshold helpers ────────────────────────────────────

  const adjustThreshold = (
    current: number,
    delta: number,
    setter: (v: number) => void,
  ) => {
    const next = Math.max(0, Math.min(100, current + delta));
    setter(next);
    setStatusMsg('');
  };

  // ── Render ───────────────────────────────────────────────

  return (
    <vstack width="100%" height="100%" padding="medium" gap="medium" backgroundColor={COLORS.headerBg}>
      {/* ── Header ── */}
      <hstack width="100%" alignment="center middle">
        <button appearance="bordered" size="small" icon="back" onPress={onBack}>
          Back
        </button>
        <spacer />
        <text size="xlarge" weight="bold" color={COLORS.accent}>
          ⚙️ Configuration
        </text>
        <spacer />
      </hstack>

      {/* ── Sensitivity Controls ── */}
      <vstack width="100%" gap="small" backgroundColor={COLORS.cardBg} cornerRadius="medium" padding="medium">
        <text size="medium" weight="bold" color={COLORS.textPrimary}>
          Sensitivity Controls
        </text>

        {/* Spam Threshold */}
        <hstack width="100%" alignment="center middle" gap="small">
          <text size="small" color={COLORS.textSecondary} grow>
            Spam Threshold
          </text>
          <button
            size="small"
            appearance="bordered"
            onPress={() => adjustThreshold(spamThreshold, -5, setSpamThreshold)}
          >
            −5
          </button>
          <hstack padding="small" cornerRadius="small" backgroundColor={COLORS.inputBg}>
            <text size="medium" weight="bold" color={COLORS.textPrimary}>
              {spamThreshold}
            </text>
          </hstack>
          <button
            size="small"
            appearance="bordered"
            onPress={() => adjustThreshold(spamThreshold, 5, setSpamThreshold)}
          >
            +5
          </button>
        </hstack>

        {/* Toxicity Threshold */}
        <hstack width="100%" alignment="center middle" gap="small">
          <text size="small" color={COLORS.textSecondary} grow>
            Toxicity Threshold (%)
          </text>
          <button
            size="small"
            appearance="bordered"
            onPress={() => adjustThreshold(toxThreshold, -5, setToxThreshold)}
          >
            −5
          </button>
          <hstack padding="small" cornerRadius="small" backgroundColor={COLORS.inputBg}>
            <text size="medium" weight="bold" color={COLORS.textPrimary}>
              {toxThreshold}
            </text>
          </hstack>
          <button
            size="small"
            appearance="bordered"
            onPress={() => adjustThreshold(toxThreshold, 5, setToxThreshold)}
          >
            +5
          </button>
        </hstack>
      </vstack>

      {/* ── Automation ── */}
      <vstack width="100%" gap="small" backgroundColor={COLORS.cardBg} cornerRadius="medium" padding="medium">
        <text size="medium" weight="bold" color={COLORS.textPrimary}>
          Automation
        </text>
        <hstack width="100%" alignment="center middle" gap="small">
          <text size="small" color={COLORS.textSecondary} grow>
            Auto-Report to Mod Queue
          </text>
          <button
            size="small"
            appearance={autoReport ? 'primary' : 'bordered'}
            onPress={() => { setAutoReport(!autoReport); setStatusMsg(''); }}
          >
            {autoReport ? '✅ ON' : '⬜ OFF'}
          </button>
        </hstack>
      </vstack>

      {/* ── Custom Blocklist ── */}
      <vstack width="100%" gap="small" backgroundColor={COLORS.cardBg} cornerRadius="medium" padding="medium">
        <text size="medium" weight="bold" color={COLORS.textPrimary}>
          Custom Blocklist
        </text>
        <text size="xsmall" color={COLORS.textSecondary}>
          Comma-separated keywords. These are added to the default blocklist.
        </text>
        <hstack width="100%" padding="small" cornerRadius="small" backgroundColor={COLORS.inputBg}>
          <text size="small" color={COLORS.textPrimary} wrap>
            {blocklistText || '(none — using defaults only)'}
          </text>
        </hstack>
      </vstack>

      {/* ── Status message ── */}
      {statusMsg ? (
        <text size="small" color={COLORS.warning} alignment="center middle">
          {statusMsg}
        </text>
      ) : null}

      {/* ── Action buttons ── */}
      <hstack width="100%" alignment="end middle" gap="medium">
        <button appearance="bordered" size="small" onPress={handleReset}>
          Reset Defaults
        </button>
        <button appearance="primary" size="small" icon="save" onPress={handleSave}>
          Save Changes
        </button>
      </hstack>
    </vstack>
  );
}
