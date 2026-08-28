import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Apod, ApiEnvelope } from '@/lib/types';

const LIVE_APOD = {
  date: '2026-08-27',
  title: 'Pillars of Creation',
  explanation: 'A tall tower of gas and dust.',
  media_type: 'image',
  url: 'https://apod.nasa.gov/apod/image/pillars.jpg',
  hdurl: 'https://apod.nasa.gov/apod/image/pillars_hd.jpg',
  copyright: 'NASA, ESA',
};

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/apod/route');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/apod', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a typed live envelope instead of raw upstream JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(LIVE_APOD));
    const { GET } = await loadRoute();

    const response = await GET();
    const payload = (await response.json()) as ApiEnvelope<Apod>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.source).toBe('live');
    expect(typeof payload.fetchedAt).toBe('string');
    expect(payload.data).toEqual({
      date: '2026-08-27',
      title: 'Pillars of Creation',
      explanation: 'A tall tower of gas and dust.',
      mediaType: 'image',
      url: 'https://apod.nasa.gov/apod/image/pillars.jpg',
      hdUrl: 'https://apod.nasa.gov/apod/image/pillars_hd.jpg',
      copyright: 'NASA, ESA',
    });
  });

  it('rejects the payload when the primary asset URL is not https', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...LIVE_APOD, url: 'javascript:alert(1)' }));
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<Apod>;

    expect(payload.ok).toBe(false);
  });

  it('drops an insecure hdurl but still serves the otherwise valid payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...LIVE_APOD, hdurl: 'http://apod.nasa.gov/apod/image/a_hd.jpg' }),
    );
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<Apod>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.data.hdUrl).toBeNull();
    expect(payload.data.url).toBe(LIVE_APOD.url);
  });

  it('accepts a video day, which upstream sends without an hdurl', async () => {
    const { hdurl: _hdurl, ...videoDay } = LIVE_APOD;
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...videoDay, media_type: 'video', url: 'https://www.youtube.com/embed/abc' }),
    );
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<Apod>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.data.mediaType).toBe('video');
    expect(payload.data.hdUrl).toBeNull();
  });

  it('strips credentials and stray whitespace instead of forwarding the raw string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...LIVE_APOD, url: ' https://apod.nasa.gov/apod/image/p.jpg', hdurl: 'https://user:pass@evil.example/a.jpg' }),
    );
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<Apod>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.data.url).toBe('https://apod.nasa.gov/apod/image/p.jpg');
    expect(payload.data.hdUrl).toBeNull();
  });

  it('serves the last good payload when upstream later fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(LIVE_APOD));
    const { GET } = await loadRoute();
    await GET();

    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    const response = await GET();
    const payload = (await response.json()) as ApiEnvelope<Apod>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected stale envelope');
    expect(payload.source).toBe('stale-memory');
    expect(payload.stale).toBe(true);
    expect(payload.data.title).toBe('Pillars of Creation');
  });

  it('returns an error envelope with 503 when upstream fails and nothing is cached', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'over rate limit' }, 429));
    const { GET } = await loadRoute();

    const response = await GET();
    const payload = (await response.json()) as ApiEnvelope<Apod>;

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
    if (payload.ok) throw new Error('expected failure envelope');
    expect(payload.error).toContain('429');
    expect(typeof payload.fetchedAt).toBe('string');
  });

  it('treats a malformed upstream body as a failure instead of crashing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ title: 42, url: null }));
    const { GET } = await loadRoute();

    const response = await GET();
    const payload = (await response.json()) as ApiEnvelope<Apod>;

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
  });

  it('never sends a configured API key to the client, on success or failure', async () => {
    const sentinel = 'sk_live_sentinel_do_not_leak';
    vi.stubEnv('NASA_API_KEY', sentinel);

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(LIVE_APOD));
    const { GET } = await loadRoute();
    const successBody = await (await GET()).text();

    vi.resetModules();
    const cold = await import('@/app/api/apod/route');
    vi.mocked(fetch).mockRejectedValueOnce(new Error(`connect ECONNREFUSED api.nasa.gov?api_key=${sentinel}`));
    const failureBody = await (await cold.GET()).text();

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain(sentinel);
    expect(successBody).not.toContain(sentinel);
    expect(failureBody).not.toContain(sentinel);
  });

  it('aborts a hung upstream instead of hanging the route', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(LIVE_APOD));
    const { GET } = await loadRoute();
    await GET();

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces an upstream timeout as an error envelope', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    vi.mocked(fetch).mockRejectedValueOnce(timeout);
    const { GET } = await loadRoute();

    const response = await GET();
    const payload = (await response.json()) as ApiEnvelope<Apod>;

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
    if (payload.ok) throw new Error('expected failure envelope');
    expect(payload.error).toBe('NASA APOD timed out.');
  });
});
