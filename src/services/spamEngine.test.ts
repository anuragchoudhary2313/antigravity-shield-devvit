import { describe, it, expect } from 'vitest';
import { calculateSpamScore } from './spamEngine.js';

describe('Spam Engine', () => {
  // ── 1. Isolated Signals ──────────────────────────────────────

  describe('Isolated Signals', () => {
    it('detects high URL density', () => {
      // 2 URLs in a very short message gives high density
      const text = 'Check out https://scam.link/1 and https://scam.link/2';
      const result = calculateSpamScore(text);
      expect(result.breakdown.urlDensity).toBeGreaterThan(50);
      expect(result.score).toBeGreaterThan(0);
      expect(result.reasons.some((r) => r.includes('URL(s)'))).toBe(true);
    });

    it('detects highly repeated words', () => {
      // "coin" repeated multiple times (~50% of text)
      const text = 'buy this coin coin coin coin is the best coin ever coin coin';
      const result = calculateSpamScore(text);
      expect(result.breakdown.repeatedWords).toBeGreaterThan(50);
      expect(result.score).toBeGreaterThan(0);
      expect(result.reasons.some((r) => r.includes('repeated'))).toBe(true);
    });

    it('detects high ALL-CAPS ratio', () => {
      // > 80% uppercase text
      const text = 'FREE CRYPTO CLICK HERE NOW AMAZING RETURNS';
      const result = calculateSpamScore(text);
      expect(result.breakdown.capsRatio).toBeGreaterThan(70);
      expect(result.score).toBeGreaterThan(0);
      expect(result.reasons.some((r) => r.includes('uppercase letters'))).toBe(true);
    });

    it('detects known blocklist keywords', () => {
      const text = 'Join our discord.gg/ server for a guaranteed profit airdrop!';
      const result = calculateSpamScore(text);
      // first hit is 40, next two are +20 each = 80
      expect(result.breakdown.keywordHits).toBe(80);
      expect(result.matchedKeywords).toContain('discord.gg/');
      expect(result.matchedKeywords).toContain('guaranteed profit');
      expect(result.matchedKeywords).toContain('airdrop');
      expect(result.score).toBeGreaterThan(0);
      expect(result.reasons.some((r) => r.includes('keyword(s)'))).toBe(true);
    });

    it('accepts custom blocklist keywords', () => {
      const text = 'Welcome to my new project about moonshots!';
      const customBlocklist = ['moonshot'];
      const result = calculateSpamScore(text, customBlocklist);
      expect(result.breakdown.keywordHits).toBe(40);
      expect(result.matchedKeywords).toContain('moonshot');
      expect(result.score).toBeGreaterThan(0);
    });
  });

  // ── 2. Integration / Combined ────────────────────────────────

  describe('Integration (Combined Signals)', () => {
    it('combines multiple signals for a high final score', () => {
      const text =
        'GUARANTEED PROFIT AIRDROP!!! JOIN DISCORD.GG AND MOON MOON MOON MOON MOON https://scam.link';
      const result = calculateSpamScore(text);

      expect(result.breakdown.keywordHits).toBeGreaterThan(0);
      expect(result.breakdown.capsRatio).toBeGreaterThan(0);
      expect(result.breakdown.repeatedWords).toBeGreaterThan(0);
      expect(result.breakdown.urlDensity).toBeGreaterThan(0);

      expect(result.score).toBeGreaterThan(0);
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('scores perfectly legitimate content as 0', () => {
      const text =
        'Hello everyone, I just wanted to ask a quick question about this API. Is there some way to paginate results effectively? Thanks bridging gaps!';
      const result = calculateSpamScore(text);
      console.log('LEGIT TEST RESULT:', JSON.stringify(result));

      expect(result.score).toBe(0);
      expect(result.breakdown.urlDensity).toBe(0);
      expect(result.breakdown.repeatedWords).toBe(0);
      expect(result.breakdown.capsRatio).toBe(0);
      expect(result.breakdown.keywordHits).toBe(0);
      expect(result.matchedKeywords.length).toBe(0);
      expect(result.reasons.length).toBe(0);
    });
  });

  // ── 3. Edge Cases ────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles empty strings gracefully', () => {
      const result1 = calculateSpamScore('');
      expect(result1.score).toBe(0);

      const result2 = calculateSpamScore('   \n  \t  ');
      expect(result2.score).toBe(0);
    });

    it('handles emoji-only strings without crashing', () => {
      const text = '🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀';
      const result = calculateSpamScore(text);
      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
      // Mostly 0, though repetition might catch it if length > 0
    });

    it('handles unicode spam without crashing', () => {
      const text = 'ƓǕÅRÄÑTĘĘÐ ƤRÖFÏT ∀ℕⅅ 𝕄𝕆𝕆ℕ !! !!';
      const result = calculateSpamScore(text);
      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
    });
  });
});
