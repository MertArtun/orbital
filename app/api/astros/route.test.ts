import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnvelope, AstrosPayload } from '@/lib/types';

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/astros/route');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/astros', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('proxies the plain-HTTP Open Notify endpoint from the server', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ number: 2, people: [{ name: 'Jasmin Moghbeli', craft: 'ISS' }, { name: 'Oleg Kononenko', craft: 'ISS' }] }),
    );
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<AstrosPayload>;

    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe('http://api.open-notify.org/astros.json');
    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.source).toBe('live');
    expect(payload.data.count).toBe(2);
    expect(payload.data.people).toHaveLength(2);
  });

  it('skips people missing a name or craft and recounts from what survived', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ people: [{ name: 'Valid', craft: 'ISS' }, { name: 'No craft' }, { craft: 'Tiangong' }] }),
    );
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<AstrosPayload>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.data.people).toEqual([{ name: 'Valid', craft: 'ISS' }]);
    expect(payload.data.count).toBe(1);
  });

  it('serves warm memory when upstream later fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ number: 1, people: [{ name: 'Valid', craft: 'ISS' }] }),
    );
    const { GET } = await loadRoute();
    await GET();

    vi.mocked(fetch).mockRejectedValueOnce(new Error('upstream unreachable'));
    const payload = (await (await GET()).json()) as ApiEnvelope<AstrosPayload>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected stale envelope');
    expect(payload.source).toBe('stale-memory');
    expect(payload.stale).toBe(true);
  });

  it('returns 503 when upstream fails with nothing cached', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 502));
    const { GET } = await loadRoute();

    const response = await GET();
    const payload = (await response.json()) as ApiEnvelope<AstrosPayload>;

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
  });

  it('passes an abort signal so a hung upstream cannot hang the route', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ number: 1, people: [{ name: 'Valid', craft: 'ISS' }] }),
    );
    const { GET } = await loadRoute();
    await GET();

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('skips a null crew entry instead of crashing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ people: [null, { name: 'Valid', craft: 'ISS' }] }),
    );
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<AstrosPayload>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.data.people).toEqual([{ name: 'Valid', craft: 'ISS' }]);
  });

  it('treats a genuinely empty crew as live data, not an error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ number: 0, people: [] }));
    const { GET } = await loadRoute();

    const response = await GET();
    const payload = (await response.json()) as ApiEnvelope<AstrosPayload>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.data.count).toBe(0);
  });

  it('reports an unexpected upstream shape as an error rather than inventing an empty crew', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ people: 'not an array' }));
    const { GET } = await loadRoute();

    const response = await GET();
    const payload = (await response.json()) as ApiEnvelope<AstrosPayload>;

    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
    if (payload.ok) throw new Error('expected failure envelope');
    expect(payload.error).toContain('unusable payload');
  });

  it('reports the count it can actually justify when upstream disagrees', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ number: 7, people: [{ name: 'Valid', craft: 'ISS' }] }),
    );
    const { GET } = await loadRoute();

    const payload = (await (await GET()).json()) as ApiEnvelope<AstrosPayload>;

    expect(payload.ok).toBe(true);
    if (!payload.ok) throw new Error('expected success envelope');
    expect(payload.data.count).toBe(1);
  });
});
