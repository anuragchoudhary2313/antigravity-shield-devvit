// ─────────────────────────────────────────────────────────────
// onCommentSubmit Trigger
// ─────────────────────────────────────────────────────────────
// Fires on every new comment. Applies guards (dedup, sanitise)
// then delegates to the flagging pipeline.
// ─────────────────────────────────────────────────────────────

import { Devvit, TriggerContext } from '@devvit/public-api';
import { runFlaggingPipeline } from '../services/flaggingPipeline.js';
import type { UserProfile } from '../services/userRiskService.js';
import { isDuplicate, markProcessed, sanitiseText } from '../utils/guards.js';

export function registerCommentTrigger(): void {
  Devvit.addTrigger({
    event: 'CommentSubmit',
    onEvent: async (event, context: TriggerContext) => {
      try {
        const commentData = event.comment;
        const authorData = event.author;

        // Guard: skip if essential data is missing
        if (!commentData?.id || !commentData.body || !authorData?.id) {
          return;
        }

        // Guard: deduplication — skip if recently processed
        if (await isDuplicate(context.kvStore, commentData.id)) {
          return;
        }

        // Guard: sanitise and truncate text
        const cleanText = sanitiseText(commentData.body);
        if (!cleanText) return;

        // Fetch full Devvit objects (Comment for report(), User for profile)
        const comment = await context.reddit.getCommentById(commentData.id);
        const user = await context.reddit.getUserById(authorData.id);

        const userProfile: UserProfile = {
          createdAt: user?.createdAt ?? new Date(),
          linkKarma: user?.linkKarma ?? 0,
          commentKarma: user?.commentKarma ?? 0,
        };

        const apiKey = (await context.settings.get('perspective-api-key') as string) ?? '';

        await runFlaggingPipeline(
          cleanText,
          userProfile,
          0,
          comment,
          context as unknown as Devvit.Context,
          apiKey,
          authorData.name ?? 'unknown',
          authorData.id,
        );

        // Mark as processed for dedup
        await markProcessed(context.kvStore, commentData.id);
      } catch (err) {
        console.error('[AntiGravity] onCommentSubmit error:', err);
      }
    },
  });
}
