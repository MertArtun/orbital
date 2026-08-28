import { NextResponse } from 'next/server';

import type { ApiEnvelope, Apod } from '@/lib/types';

export const runtime = 'nodejs';

const REVALIDATE_SECONDS = 86_400;
let lastGood: Apod | null = null;

/** Upstream strings are untrusted: only absolute https URLs may reach the client. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function normalizeApod(input: unknown): Apod | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  const date = nonEmptyString(raw.date);
  const title = nonEmptyString(raw.title);
  const url = httpsUrl(raw.url);
  const mediaType = raw.media_type === 'image' || raw.media_type === 'video' ? raw.media_type : null;
  if (!date || !title || !url || !mediaType) return null;

  // hdurl is optional upstream, but a present-and-insecure value is a rejection,
  // not something to silently downgrade to null.
  if (raw.hdurl !== undefined && raw.hdurl !== null && httpsUrl(raw.hdurl) === null) return null;

  return {
    date,
    title,
    explanation: nonEmptyString(raw.explanation) ?? '',
    mediaType,
    url,
    hdUrl: httpsUrl(raw.hdurl),
    copyright: nonEmptyString(raw.copyright),
  };
}

export async function GET() {
  const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
  const fetchedAt = () => new Date().toISOString();

  try {
    const response = await fetch(`https://api.nasa.gov/planetary/apod?api_key=${apiKey}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`NASA APOD returned ${response.status}.`);

    const data = normalizeApod(await response.json());
    if (!data) throw new Error('NASA APOD returned an unusable payload.');
    lastGood = data;

    return NextResponse.json(
      { ok: true, data, source: 'live', fetchedAt: fetchedAt() } satisfies ApiEnvelope<Apod>,
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=604800`,
        },
      },
    );
  } catch (error) {
    if (lastGood) {
      return NextResponse.json({
        ok: true,
        data: lastGood,
        source: 'stale-memory',
        stale: true,
        fetchedAt: fetchedAt(),
      } satisfies ApiEnvelope<Apod>);
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'APOD is unavailable.',
        fetchedAt: fetchedAt(),
      } satisfies ApiEnvelope<Apod>,
      { status: 503 },
    );
  }
}
