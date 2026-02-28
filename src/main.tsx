// ─────────────────────────────────────────────────────────────
// AntiGravity Shield — Main Entry Point
// ─────────────────────────────────────────────────────────────
// Wires together Devvit configuration, event triggers,
// custom post types, and menu actions.  Keep this file thin —
// all heavy logic lives in src/services/ and src/ui/.
// ─────────────────────────────────────────────────────────────

import { Devvit, useState } from '@devvit/public-api';

// ── UI components ──────────────────────────────────────────
import { Dashboard } from './ui/Dashboard.js';
import { Settings } from './ui/Settings.js';

// ── Trigger registrations ──────────────────────────────────
import { registerCommentTrigger } from './triggers/onCommentSubmit.js';
import { registerPostTrigger } from './triggers/onPostSubmit.js';

// ── Devvit Permissions ─────────────────────────────────────
Devvit.configure({
  redditAPI: true,  // Read user/comment/post metadata & report()
  http: true,       // Outbound fetch to Perspective API
  kvStore: true,    // Persistent key-value storage
});

// ── App Settings (visible to mods in the install dialog) ───
Devvit.addSettings([
  {
    name: 'perspective-api-key',
    label: 'Google Perspective API Key',
    helpText: 'Required for toxicity scoring. Get one at https://developers.perspectiveapi.com/',
    type: 'string',
    isSecret: true,
    scope: 'installation',
  },
]);

// ── Register event triggers ────────────────────────────────
registerCommentTrigger();
registerPostTrigger();

// ── Menu Actions ───────────────────────────────────────────
Devvit.addMenuItem({
  label: '🚀 AntiGravity Shield Dashboard',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    ui.showToast('Opening AntiGravity Shield Dashboard…');

    const subreddit = await reddit.getCurrentSubreddit();
    const post = await reddit.submitPost({
      title: '🚀 AntiGravity Shield — Mod Dashboard',
      subredditName: subreddit.name,
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading AntiGravity Shield…</text>
        </vstack>
      ),
    });

    ui.navigateTo(post);
  },
});

// ── Custom Post Type — Dashboard with Settings view ────────

type AppView = 'dashboard' | 'settings';

Devvit.addCustomPostType({
  name: 'AntiGravity Shield',
  height: 'tall',
  render: (context) => {
    const [view, setView] = useState<AppView>('dashboard');
    const [subredditId, setSubredditId] = useState<string>('');

    // Resolve subreddit ID on first render
    if (!subredditId) {
      context.reddit.getCurrentSubreddit().then((sub) => {
        setSubredditId(sub.id);
      });
    }

    // Show a loading state until we have the subreddit ID
    if (!subredditId) {
      return (
        <vstack height="100%" width="100%" alignment="center middle">
          <text size="large">Loading AntiGravity Shield…</text>
        </vstack>
      );
    }

    if (view === 'settings') {
      return (
        <Settings
          subredditId={subredditId}
          context={context}
          onBack={() => setView('dashboard')}
        />
      );
    }

    return (
      <Dashboard
        subredditId={subredditId}
        context={context}
        onOpenSettings={() => setView('settings')}
      />
    );
  },
});

export default Devvit;
