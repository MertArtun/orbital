import type { Launch } from '@/lib/types';

type RawLaunch = {
  id?: string;
  name?: string;
  net?: string;
  status?: { name?: string };
  image?: { image_url?: string } | string | null;
  webcast_live?: boolean;
  vidURLs?: string[];
  webcast_urls?: string[];
  launch_service_provider?: { name?: string };
  rocket?: { configuration?: { full_name?: string; name?: string } };
  mission?: { name?: string; description?: string } | null;
  pad?: {
    name?: string;
    latitude?: string | number | null;
    longitude?: string | number | null;
    location?: { name?: string };
  } | null;
};

function finiteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinate(value: string | number | null | undefined, limit: number): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Math.abs(parsed) <= limit ? parsed : null;
}

export function normalizeLaunch(raw: RawLaunch): Launch | null {
  if (!raw.id || !raw.name || !raw.net || !Number.isFinite(Date.parse(raw.net))) return null;
  const image = typeof raw.image === 'string' ? raw.image : raw.image?.image_url ?? null;
  const webcastUrl = raw.webcast_urls?.[0] ?? raw.vidURLs?.[0] ?? null;

  return {
    id: raw.id,
    name: raw.name,
    mission: raw.mission?.name ?? raw.mission?.description ?? 'Mission details pending',
    provider: raw.launch_service_provider?.name ?? 'Agency pending',
    rocket: raw.rocket?.configuration?.full_name ?? raw.rocket?.configuration?.name ?? 'Rocket TBD',
    padName: raw.pad?.name ?? 'Launch pad TBD',
    locationName: raw.pad?.location?.name ?? 'Location TBD',
    net: raw.net,
    status: raw.status?.name ?? 'Scheduled',
    webcastUrl,
    imageUrl: image,
    latitude: coordinate(raw.pad?.latitude, 90),
    longitude: coordinate(raw.pad?.longitude, 180),
  };
}

export function normalizeLaunches(input: unknown): Launch[] {
  if (!input || typeof input !== 'object' || !('results' in input)) return [];
  const results = (input as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.map((item) => normalizeLaunch(item as RawLaunch)).filter((item): item is Launch => Boolean(item));
}
