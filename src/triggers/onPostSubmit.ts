// ─────────────────────────────────────────────────────────────
// onPostSubmit Trigger
// ─────────────────────────────────────────────────────────────
// Fires on every new post. Applies guards (dedup, sanitise)
// then delegates to the flagging pipeline.
// ─────────────────────────────────────────────────────────────

import { Devvit, TriggerContext } from '@devvit/public-api';
import { runFlaggingPipeline } from '../services/flaggingPipeline.js';
import type { UserProfile } from '../services/userRiskService.js';
import { isDuplicate, markProcessed, sanitiseText } from '../utils/guards.js';
import { recordUserActivity, getRecentActivityCount } from '../utils/analyticsHelpers.js';

export function registerPostTrigger(): void {
  Devvit.addTrigger({
    event: 'PostSubmit',
    onEvent: async (event, context: TriggerContext) => {
      try {
        const postData = event.post;
        const authorData = event.author;
        const subredditId = event.subreddit?.id;

        if (!postData?.id || !authorData?.id || !subredditId) {
          return;
        }

        // Guard: deduplication
        if (await isDuplicate(context.kvStore, postData.id)) {
          return;
        }

        const textToScan = sanitiseText(
          [postData.title, postData.selftext].filter(Boolean).join(' '),
        );
        if (!textToScan) return;

        // Track and fetch user's recent activity rate
        await recordUserActivity(context.kvStore, subredditId, authorData.id);
        const recentCommentCount = await getRecentActivityCount(context.kvStore, subredditId, authorData.id);

        const post = await context.reddit.getPostById(postData.id);
        const user = await context.reddit.getUserById(authorData.id);

        const userProfile: UserProfile = {
          createdAt: user?.createdAt ?? new Date(),
          linkKarma: user?.linkKarma ?? 0,
          commentKarma: user?.commentKarma ?? 0,
        };

        const apiKey = (await context.settings.get('perspective-api-key') as string) ?? '';

        await runFlaggingPipeline(
          textToScan,
          userProfile,
          recentCommentCount,
          post,
          context as unknown as Devvit.Context,
          apiKey,
          authorData.name ?? 'unknown',
          authorData.id,
        );

        await markProcessed(context.kvStore, postData.id);
      } catch (err) {
        console.error('[AntiGravity] onPostSubmit error:', err);
      }
    },
  });
}
