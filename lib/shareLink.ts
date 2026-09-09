import { normalizeLongitude } from '@/lib/propagation';
import type { ObserverLocation } from '@/lib/types';

/** Query keys a shared link carries. Short, because people paste these by hand. */
export const SHARE_PARAMS = { lat: 'lat', lng: 'lng', place: 'place' } as const;

/** The id a restored location gets: never a city id, whose coordinates differ. */
export const SHARED_LOCATION_ID = 'shared-location';

/** What a link without a usable name is called, in the UI and in the parser. */
export const SHARED_LOCATION_NAME = 'Shared location';

/** Longest place name a link may carry into the interface, in characters. */
const MAX_NAME_LENGTH = 48;

/**
 * The name the panel gives a browser-supplied position. Shared here because
 * `shareSearchParams` must not publish it — it tells a recipient nothing —
 * and a string duplicated across two files would silently start leaking the
 * day somebody renamed one of them.
 */
export const BROWSER_LOCATION_NAME = 'Current location';

/**
 * Everything invisible or reordering that a name has no business carrying:
 * the C0 and C1 control ranges, zero-width characters and joiners, the
 * bidirectional overrides and isolates. A right-to-left override makes the
 * rest of a name render backwards, and a zero-width space makes a name that
 * is technically non-empty and visibly blank.
 */
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff<>]/g;

/** Truncates by character, so an astral character is never cut in half. */
function limit(value: string): string {
  return [...value].slice(0, MAX_NAME_LENGTH).join('');
}

/**
 * About 11 m at the equator. Enough to point at a park, not enough to publish
 * the GPS fix the browser handed us.
 */
const SHARE_PRECISION = 4;

/**
 * `Number()` is far too generous for a URL: it accepts "0x1F", "Infinity",
 * "1e5", " 41 " and "" (as zero). A decimal degree is a sign, digits and at
 * most one point, and anything else is somebody's idea of a joke.
 */
const DECIMAL = /^[+-]?(?:\d+|\d*\.\d+)$/;

function decimalDegrees(raw: string | null): number | null {
  if (raw === null || !DECIMAL.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Upstream text by any other name: a link is written by whoever sends it. The
 * name only ever reaches a React text node, which escapes it, but it is
 * stripped of angle brackets and control characters anyway so that a name can
 * never read as markup wherever it is later shown, and bounded so it cannot
 * push the panel apart.
 */
function sanitizeName(raw: string | null): string {
  if (!raw) return SHARED_LOCATION_NAME;
  const cleaned = limit(raw.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim()).trim();
  return cleaned === '' ? SHARED_LOCATION_NAME : cleaned;
}

function searchParamsOf(search: string | URLSearchParams): URLSearchParams {
  return typeof search === 'string' ? new URLSearchParams(search) : search;
}

/**
 * The observer a link asks for, or null if it does not ask for one this app is
 * willing to render. Both coordinates are required: half a position is not a
 * position, and silently completing it from the default would put the visitor
 * somewhere nobody chose.
 */
export function parseSharedObserver(search: string | URLSearchParams): ObserverLocation | null {
  const params = searchParamsOf(search);
  const lat = decimalDegrees(params.get(SHARE_PARAMS.lat));
  const lng = decimalDegrees(params.get(SHARE_PARAMS.lng));

  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;

  return {
    id: SHARED_LOCATION_ID,
    name: sanitizeName(params.get(SHARE_PARAMS.place)),
    country: 'Shared link',
    lat,
    // 180 and -180 are the same meridian; the rest of the codebase spells it
    // -180, so a link cannot introduce the other spelling downstream.
    lng: normalizeLongitude(lng),
  };
}

function round(value: number): string {
  return String(Number(value.toFixed(SHARE_PRECISION)));
}

/** Names that tell a recipient nothing, and so are not worth the query string. */
const GENERIC_NAMES = new Set<string>([SHARED_LOCATION_NAME, BROWSER_LOCATION_NAME]);

/** The parameters that describe this observer to somebody else. */
export function shareSearchParams(location: ObserverLocation): URLSearchParams {
  const params = new URLSearchParams();
  params.set(SHARE_PARAMS.lat, round(location.lat));
  params.set(SHARE_PARAMS.lng, round(location.lng));
  const name = location.name.trim();
  if (name !== '' && !GENERIC_NAMES.has(name)) {
    params.set(SHARE_PARAMS.place, limit(name));
  }
  return params;
}

/**
 * An absolute link to this page for this observer. Any other query and the
 * fragment are dropped: what is shared is the location, not the sender's
 * campaign parameters or scroll position.
 */
export function buildShareUrl(href: string, location: ObserverLocation): string {
  const url = new URL(href);
  url.search = shareSearchParams(location).toString();
  url.hash = '';
  return url.toString();
}
