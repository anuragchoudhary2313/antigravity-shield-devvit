import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stripPII, shouldCallApi, getToxicityScore, getToxicityWithGate } from './toxicityService.js';
import { PERSPECTIVE_API_GATE_THRESHOLD } from '../utils/constants.js';

describe('Toxicity Service - PII Stripping', () => {
  it('strips u/ usernames', () => {
    expect(stripPII('hello u/user123 how are you?')).toBe('hello [user] how are you?');
    expect(stripPII('hello /u/user123')).toBe('hello [user]');
  });

  it('strips r/ subreddits', () => {
    expect(stripPII('go to r/CryptoCurrency now')).toBe('go to [subreddit] now');
    expect(stripPII('visit /r/test')).toBe('visit [subreddit]');
  });

  it('strips @ mentions', () => {
    expect(stripPII('hey @admin please help')).toBe('hey [mention] please help');
  });

  it('handles multiple instances of PII', () => {
    expect(stripPII('u/mod told u/user to read r/rules @everyone')).toBe(
      '[user] told [user] to read [subreddit] [mention]'
    );
  });
});

describe('Toxicity Service - Cost Gate', () => {
  it('prevents API calls for low local spam scores', () => {
    expect(shouldCallApi(PERSPECTIVE_API_GATE_THRESHOLD - 5)).toBe(false);
    expect(shouldCallApi(0)).toBe(false);
  });

  it('allows API calls for high local spam scores', () => {
    expect(shouldCallApi(PERSPECTIVE_API_GATE_THRESHOLD + 5)).toBe(true);
    expect(shouldCallApi(100)).toBe(true);
  });
});

describe('Toxicity Service - API Wrapper', () => {
  const MOCK_API_KEY = 'mock-api-key';

  const fetchMock = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses valid Perspective API responses correctly', async () => {
    // Mock a successful API response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        attributeScores: {
          TOXICITY: { summaryScore: { value: 0.95 } },
          INSULT: { summaryScore: { value: 0.88 } },
          PROFANITY: { summaryScore: { value: 0.72 } },
        },
      }),
    });

    const result = await getToxicityScore('some toxic text', MOCK_API_KEY);

    expect(result.fromApi).toBe(true);
    expect(result.toxicity).toBe(0.95);
    expect(result.insult).toBe(0.88);
    expect(result.profanity).toBe(0.72);

    // Verify fetch was called correctly
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchArgs = fetchMock.mock.calls[0];
    expect(fetchArgs[0]).toContain(MOCK_API_KEY);

    const requestBody = JSON.parse(fetchArgs[1].body);
    expect(requestBody.comment.text).toBe('some toxic text');
  });

  it('returns neutral fallback on API error (e.g. 500)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await getToxicityScore('some text', MOCK_API_KEY);

    expect(result.fromApi).toBe(false);
    expect(result.toxicity).toBe(0);
  });

  it('returns neutral fallback on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network offline'));

    const result = await getToxicityScore('some text', MOCK_API_KEY);

    expect(result.fromApi).toBe(false);
    expect(result.toxicity).toBe(0);
  });

  it('returns neutral fallback if API key is missing', async () => {
    const result = await getToxicityScore('some text', '');

    expect(result.fromApi).toBe(false);
    expect(result.toxicity).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns neutral fallback if text is empty', async () => {
    const result = await getToxicityScore('   ', MOCK_API_KEY);

    expect(result.fromApi).toBe(false);
    expect(result.toxicity).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('truncates extremely long text before sending to API', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    // Create string longer than MAX_TEXT_LENGTH (3000)
    const longText = 'A'.repeat(4000);
    await getToxicityScore(longText, MOCK_API_KEY);

    const fetchArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(fetchArgs[1].body);
    expect(requestBody.comment.text.length).toBe(3000); // Should be truncated
  });

  it('strips PII from text before sending to API', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await getToxicityScore('hi u/mod please ban @spammer from r/my_sub', MOCK_API_KEY);

    const fetchArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(fetchArgs[1].body);
    expect(requestBody.comment.text).toBe('hi [user] please ban [mention] from [subreddit]');
  });
});

describe('Toxicity Service - getToxicityWithGate', () => {
  const MOCK_API_KEY = 'mock-api-key';

  const fetchMock = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('bypasses API completely if local spam score is too low', async () => {
    const result = await getToxicityWithGate('toxic text', 0, MOCK_API_KEY);

    expect(result.fromApi).toBe(false);
    expect(result.toxicity).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls API if local spam score exceeds threshold', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        attributeScores: { TOXICITY: { summaryScore: { value: 0.99 } } },
      }),
    });

    const result = await getToxicityWithGate('toxic text', 100, MOCK_API_KEY);

    expect(result.fromApi).toBe(true);
    expect(result.toxicity).toBe(0.99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
