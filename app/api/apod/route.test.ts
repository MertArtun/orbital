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

  it('rejects a non-https upstream asset URL rather than passing it through', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ...LIVE_APOD, url: 'javascript:alert(1)', hdurl: 'http://insecure.example/x.jpg' }),
    );
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<Apod>;

    expect(payload.ok).toBe(false);
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

  it('never sends the API key to the client', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(LIVE_APOD));
    const { GET } = await loadRoute();

    const body = await (await GET()).text();

    expect(body).not.toContain('DEMO_KEY');
    expect(body).not.toContain('api_key');
  });
});
