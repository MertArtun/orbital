import { NextResponse } from 'next/server';

import type { ApiEnvelope, Astronaut, AstrosPayload } from '@/lib/types';

export const runtime = 'nodejs';

const REVALIDATE_SECONDS = 60;
let lastGood: AstrosPayload | null = null;

export function normalizeAstros(input: unknown): AstrosPayload {
  if (!input || typeof input !== 'object') {
    throw new Error('Open Notify returned an unusable payload.');
  }
  const raw = input as { number?: unknown; people?: unknown };
  if (!Array.isArray(raw.people)) {
    throw new Error('Open Notify returned an unusable payload.');
  }

  const people: Astronaut[] = raw.people
    .filter(
      (person): person is { name: string; craft: string } =>
        Boolean(person) &&
        typeof person === 'object' &&
        typeof (person as Astronaut).name === 'string' &&
        typeof (person as Astronaut).craft === 'string',
    )
    .map((person) => ({ name: person.name, craft: person.craft }));

  // Derived from what we actually return: reporting upstream's own count while
  // dropping malformed entries would make the panel contradict its own list.
  return { count: people.length, people };
}

export async function GET() {
  const fetchedAt = () => new Date().toISOString();

  try {
    const response = await fetch('http://api.open-notify.org/astros.json', {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Open Notify returned ${response.status}.`);

    const data = normalizeAstros(await response.json());
    lastGood = data;

    return NextResponse.json(
      { ok: true, data, source: 'live', fetchedAt: fetchedAt() } satisfies ApiEnvelope<AstrosPayload>,
    );
  } catch (error) {
    if (lastGood) {
      return NextResponse.json({
        ok: true,
        data: lastGood,
        source: 'stale-memory',
        stale: true,
        fetchedAt: fetchedAt(),
      } satisfies ApiEnvelope<AstrosPayload>);
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Astronaut data is unavailable.',
        fetchedAt: fetchedAt(),
      } satisfies ApiEnvelope<AstrosPayload>,
      { status: 503 },
    );
  }
}
