import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnvelope, TleRecord } from '@/lib/types';

const ISS_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
].join('\n');

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/tle/[group]/route');
}

function params(group: string) {
  return { params: Promise.resolve({ group }) };
}

function textResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

describe('/api/tle/:group', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses a live CelesTrak response and never asks the client to reach upstream', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(textResponse(ISS_TLE));
    const { GET } = await loadRoute();

    const response = await GET(new Request('http://localhost/api/tle/iss'), params('iss'));
    const payload = (await response.json()) as ApiEnvelope<TleRecord[]>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.source).toBe('live');
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.noradId).toBe('25544');

    const requestedUrl = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(requestedUrl).toContain('celestrak.org');
    expect(requestedUrl).toContain('CATNR=25544');
  });

  it('revalidates every 6 hours', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(textResponse(ISS_TLE));
    const { GET } = await loadRoute();
    await GET(new Request('http://localhost/api/tle/iss'), params('iss'));

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as { next?: { revalidate?: number } };
    expect(init?.next?.revalidate).toBe(21_600);
  });

  it('rejects an unknown group with 404 before calling upstream', async () => {
    const { GET } = await loadRoute();

    const response = await GET(new Request('http://localhost/api/tle/moon'), params('moon'));

    expect(response.status).toBe(404);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('serves warm memory when upstream fails after a good response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(textResponse(ISS_TLE));
    const { GET } = await loadRoute();
    await GET(new Request('http://localhost/api/tle/visual'), params('visual'));

    vi.mocked(fetch).mockRejectedValueOnce(new Error('upstream unreachable'));
    const payload = (await (
      await GET(new Request('http://localhost/api/tle/visual'), params('visual'))
    ).json()) as ApiEnvelope<TleRecord[]>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected stale envelope');
    expect(payload.source).toBe('stale-memory');
    expect(payload.stale).toBe(true);
  });

  it('falls back to the repository ISS fixture when upstream fails cold', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('upstream unreachable'));
    const { GET } = await loadRoute();

    const payload = (await (
      await GET(new Request('http://localhost/api/tle/iss'), params('iss'))
    ).json()) as ApiEnvelope<TleRecord[]>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected fallback envelope');
    expect(payload.source).toBe('repository-fallback');
    expect(payload.data[0]?.noradId).toBe('25544');
  });

  it('reports 503 for a non-ISS group with no cache and no fixture', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('upstream unreachable'));
    const { GET } = await loadRoute();

    const response = await GET(new Request('http://localhost/api/tle/starlink'), params('starlink'));
    const payload = (await response.json()) as ApiEnvelope<TleRecord[]>;

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
  });

  it('treats a 200 response carrying malformed data as a failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(textResponse('<html>CelesTrak is down</html>'));
    const { GET } = await loadRoute();

    const payload = (await (
      await GET(new Request('http://localhost/api/tle/iss'), params('iss'))
    ).json()) as ApiEnvelope<TleRecord[]>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected fixture fallback');
    expect(payload.source).toBe('repository-fallback');
  });

  it('treats an upstream 500 as a failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(textResponse('boom', 500));
    const { GET } = await loadRoute();

    const response = await GET(new Request('http://localhost/api/tle/starlink'), params('starlink'));

    expect(response.status).toBe(503);
  });
});
