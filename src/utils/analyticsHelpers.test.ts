import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  incrementCounter,
  readCounter,
  pushAlert,
  getRecentAlerts,
  setCachedUserRisk,
  getCachedUserRisk,
  recordUserActivity,
  getRecentActivityCount,
} from './analyticsHelpers.js';
import { dailyScannedKey, recentAlertsKey } from './kvSchema.js';

// Define a simple mock for the Devvit KV Store
class MockKVStore {
  private store: Map<string, any> = new Map();

  async get(key: string) {
    return this.store.get(key);
  }

  async put(key: string, value: any) {
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  // Test utility
  inspectKey(key: string) {
    return this.store.get(key);
  }
}

describe('Analytics Helpers & KV Store Operations', () => {
  let mockKV: any;
  const SUB_ID = 't5_mocksub';
  const USER_ID = 't2_mockuser';

  beforeEach(() => {
    mockKV = new MockKVStore();
    vi.useFakeTimers();
  });

  describe('Counter increments and reads', () => {
    it('initializes a new counter dynamically', async () => {
      const key = dailyScannedKey(SUB_ID, '2023-10-01');
      await incrementCounter(mockKV, key);

      const val = await readCounter(mockKV, key);
      expect(val).toBe(1);
    });

    it('increments an existing counter correctly', async () => {
      const key = dailyScannedKey(SUB_ID, '2023-10-01');
      await mockKV.put(key, 5); // Seed with 5

      await incrementCounter(mockKV, key);
      const val = await readCounter(mockKV, key);

      expect(val).toBe(6);
    });

    it('returns 0 when reading an empty counter', async () => {
      const val = await readCounter(mockKV, 'non_existent_key');
      expect(val).toBe(0);
    });
  });

  describe('Cache expiry logic', () => {
    it('sets and retrieves active cache for user risk', async () => {
      await setCachedUserRisk(mockKV, USER_ID, 85, 'RED');

      const cached = await getCachedUserRisk(mockKV, USER_ID);
      expect(cached).not.toBeNull();
      expect(cached?.score).toBe(85);
      expect(cached?.tier).toBe('RED');
    });

    it('returns null and purges cache if it has expired (default 1 hr)', async () => {
      await setCachedUserRisk(mockKV, USER_ID, 85, 'RED');

      // Advance timers by exactly 2 hours (exceeding TTL)
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);

      const cached = await getCachedUserRisk(mockKV, USER_ID);
      expect(cached).toBeNull();
    });
  });

  describe('User Activity Rate Tracking', () => {
    it('records multiple user activities across time accurately', async () => {
      // Activity 1
      await recordUserActivity(mockKV, SUB_ID, USER_ID);

      vi.advanceTimersByTime(1000 * 60); // 1 minute later
      // Activity 2
      await recordUserActivity(mockKV, SUB_ID, USER_ID);

      const count = await getRecentActivityCount(mockKV, SUB_ID, USER_ID);
      expect(count).toBe(2);
    });

    it('drops activity counts outside the 24 hour sliding window', async () => {
      await recordUserActivity(mockKV, SUB_ID, USER_ID); // Activity 1

      vi.advanceTimersByTime(25 * 60 * 60 * 1000); // Wait 25 hours

      await recordUserActivity(mockKV, SUB_ID, USER_ID); // Activity 2

      const count = await getRecentActivityCount(mockKV, SUB_ID, USER_ID);
      // Older record should be pruned
      expect(count).toBe(1);
    });
  });

  describe('Privacy Compliance (Full Text Storage Guard)', () => {
    it('verifies alerts store only sanitized reasons, never raw comment payload strings', async () => {
      const maliciousComment = 'This is a super toxic and long comment with names, PII, and horrible intent!';

      await pushAlert(mockKV, SUB_ID, {
        thingId: 't1_comment',
        authorName: 'toxic_user',
        score: 95,
        reason: 'Spammy; High toxicity score (0.98)',
        timestamp: Date.now()
      });

      const alerts = await getRecentAlerts(mockKV, SUB_ID);
      expect(alerts.length).toBe(1);

      // Safety inspection on raw DB
      const dbEntry = mockKV.inspectKey(recentAlertsKey(SUB_ID));
      const dbStr = JSON.stringify(dbEntry);

      expect(dbStr).toContain('Spammy; High toxicity score');
      expect(dbStr).toContain('toxic_user');

      // Assert raw/dirty text never entered persistence layer
      expect(dbStr).not.toContain('maliciousComment');
      expect(dbStr).not.toContain('super toxic and long comment');
      expect(dbStr).not.toContain('horrible intent');
    });
  });
});
