import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnvelope, Launch } from '@/lib/types';

function rawLaunch(id: string, net: string) {
  return {
    id,
    name: `Falcon 9 | Starlink ${id}`,
    net,
    status: { name: 'Go for Launch' },
    launch_service_provider: { name: 'SpaceX' },
    rocket: { configuration: { full_name: 'Falcon 9 Block 5' } },
    mission: { name: `Starlink Group ${id}` },
    pad: { name: 'SLC-40', latitude: '28.56', longitude: '-80.57', location: { name: 'Cape Canaveral' } },
  };
}

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/launches/route');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/launches', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('normalizes a live response and revalidates every 30 minutes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ results: [rawLaunch('a', '2026-09-01T12:00:00Z')] }),
    );
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<Launch[]>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.source).toBe('live');
    expect(payload.data[0]).toMatchObject({
      id: 'a',
      provider: 'SpaceX',
      rocket: 'Falcon 9 Block 5',
      locationName: 'Cape Canaveral',
      latitude: 28.56,
      longitude: -80.57,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain('limit=10');
    expect((init as { next?: { revalidate?: number } })?.next?.revalidate).toBe(1_800);
  });

  it('drops malformed records instead of failing the whole response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        results: [
          rawLaunch('good', '2026-09-01T12:00:00Z'),
          { id: 'no-net', name: 'Missing net' },
          { name: 'Missing id', net: '2026-09-02T12:00:00Z' },
          { id: 'bad-date', name: 'Unparseable', net: 'not-a-date' },
        ],
      }),
    );
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<Launch[]>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.id).toBe('good');
  });

  it('serves warm memory when upstream later fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ results: [rawLaunch('a', '2026-09-01T12:00:00Z')] }),
    );
    const { GET } = await loadRoute();
    await GET();

    vi.mocked(fetch).mockRejectedValueOnce(new Error('upstream unreachable'));
    const payload = (await (await GET()).json()) as ApiEnvelope<Launch[]>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected stale envelope');
    expect(payload.source).toBe('stale-memory');
    expect(payload.stale).toBe(true);
  });

  it('returns 503 when upstream fails with nothing cached', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: 'throttled' }, 429));
    const { GET } = await loadRoute();

    const response = await GET();
    const payload = (await response.json()) as ApiEnvelope<Launch[]>;

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
    if (payload.ok) throw new Error('expected failure envelope');
    expect(payload.error).toContain('429');
  });

  it('treats a well-formed but empty result set as a failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ results: [] }));
    const { GET } = await loadRoute();

    const response = await GET();

    expect(response.status).toBe(503);
  });

  it('passes an abort signal so a hung upstream cannot hang the route', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ results: [rawLaunch('a', '2026-09-01T12:00:00Z')] }),
    );
    const { GET } = await loadRoute();
    await GET();

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not crash when the upstream shape is entirely unexpected', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    const { GET } = await loadRoute();

    const response = await GET();
    const payload = (await response.json()) as ApiEnvelope<Launch[]>;

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
  });
});
