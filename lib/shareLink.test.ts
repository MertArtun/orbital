import { describe, expect, it } from 'vitest';

import {
  BROWSER_LOCATION_NAME,
  SHARE_PARAMS,
  buildShareUrl,
  parseSharedObserver,
  shareSearchParams,
} from '@/lib/shareLink';
import type { ObserverLocation } from '@/lib/types';

const ISTANBUL: ObserverLocation = {
  id: 'istanbul',
  name: 'İstanbul',
  country: 'Türkiye',
  lat: 41.0053,
  lng: 28.977,
};

describe('shared observer parsing', () => {
  it('restores a location from a well-formed link', () => {
    const observer = parseSharedObserver('?lat=41.0053&lng=28.977&place=%C4%B0stanbul');

    expect(observer).not.toBeNull();
    expect(observer!.lat).toBeCloseTo(41.0053, 6);
    expect(observer!.lng).toBeCloseTo(28.977, 6);
    expect(observer!.name).toBe('İstanbul');
    // A shared link is a place, not a city record: it must not claim a city id
    // that lib/cities.ts would resolve to different coordinates.
    expect(observer!.id).toBe('shared-location');
  });

  it('accepts a link without a name and labels it honestly', () => {
    const observer = parseSharedObserver('?lat=-33.8688&lng=151.2093');

    expect(observer).not.toBeNull();
    expect(observer!.lat).toBeCloseTo(-33.8688, 6);
    expect(observer!.name).toBe('Shared location');
  });

  it.each([
    ['no parameters at all', ''],
    ['a latitude with no longitude', '?lat=41'],
    ['a longitude with no latitude', '?lng=29'],
    ['an empty latitude', '?lat=&lng=29'],
    ['a non-numeric latitude', '?lat=north&lng=29'],
    ['a latitude past the pole', '?lat=91&lng=29'],
    ['a latitude past the south pole', '?lat=-90.1&lng=29'],
    ['a longitude past the antimeridian', '?lat=41&lng=180.5'],
    ['an infinite longitude', '?lat=41&lng=Infinity'],
    ['a NaN latitude', '?lat=NaN&lng=29'],
    ['a hex latitude', '?lat=0x1F&lng=29'],
    ['whitespace only', '?lat=%20%20&lng=29'],
    ['a trailing-garbage latitude', '?lat=41abc&lng=29'],
  ])('falls back to nothing for %s', (_case, search) => {
    expect(parseSharedObserver(search)).toBeNull();
  });

  it('accepts the poles and the antimeridian, normalising longitude into range', () => {
    expect(parseSharedObserver('?lat=90&lng=0')!.lat).toBe(90);
    expect(parseSharedObserver('?lat=-90&lng=0')!.lat).toBe(-90);
    // Longitude is normalised to [-180, 180) everywhere in this codebase, so
    // the antimeridian has one spelling by the time it reaches propagation.
    expect(parseSharedObserver('?lat=0&lng=180')!.lng).toBe(-180);
    expect(parseSharedObserver('?lat=0&lng=-180')!.lng).toBe(-180);
  });

  it('takes a URLSearchParams as readily as a string', () => {
    const params = new URLSearchParams({ lat: '48.8566', lng: '2.3522' });

    expect(parseSharedObserver(params)!.lat).toBeCloseTo(48.8566, 6);
  });

  it('never lets a shared name carry markup, control characters or unbounded length', () => {
    const nasty = parseSharedObserver(
      `?lat=0&lng=0&place=${encodeURIComponent('<img src=x onerror=alert(1)>\u0000\nBoom')}`,
    );

    expect(nasty!.name).not.toMatch(/[<>]/);
    expect(nasty!.name).not.toMatch(/[\u0000-\u001f]/);

    const long = parseSharedObserver(`?lat=0&lng=0&place=${'a'.repeat(200)}`);
    expect(long!.name.length).toBeLessThanOrEqual(48);

    // A name that sanitises away entirely is no name at all.
    expect(parseSharedObserver('?lat=0&lng=0&place=%3C%3E')!.name).toBe('Shared location');
  });

  it('strips the invisible characters that make a name lie about itself', () => {
    // Bidi overrides reorder what follows them, isolates and zero-width
    // characters hide inside a name, and the C1 range is as much a control
    // range as C0. A name made only of them is not a name.
    const invisible = [
      '\u202e',
      '\u2066',
      '\u2069',
      '\u200b',
      '\u200e',
      '\u0085',
      '\u009f',
      // Same family, easy to forget: the Arabic letter mark, the soft hyphen,
      // Hangul filler, and the deprecated formatting characters.
      '\u061c',
      '\u00ad',
      '\u3164',
      '\u206b',
    ];
    const spiked = parseSharedObserver(
      `?lat=0&lng=0&place=${encodeURIComponent(`Ankara${invisible.join('')}gnp.exe`)}`,
    )!.name;

    for (const character of invisible) {
      expect(spiked).not.toContain(character);
    }
    expect(spiked).toBe('Ankara gnp.exe');
    expect(
      parseSharedObserver(`?lat=0&lng=0&place=${encodeURIComponent(invisible.join(''))}`)!.name,
    ).toBe('Shared location');
  });
});

describe('share link building', () => {
  it('round-trips a location through the parameters it writes', () => {
    const restored = parseSharedObserver(shareSearchParams(ISTANBUL));

    expect(restored!.lat).toBeCloseTo(ISTANBUL.lat, 4);
    expect(restored!.lng).toBeCloseTo(ISTANBUL.lng, 4);
    expect(restored!.name).toBe(ISTANBUL.name);
  });

  it('rounds coordinates to about eleven metres rather than publishing a GPS fix', () => {
    const params = shareSearchParams({
      ...ISTANBUL,
      id: 'browser-location',
      name: 'Current location',
      lat: 41.00534729318,
      lng: 28.97701882734,
    });

    expect(params.get(SHARE_PARAMS.lat)).toBe('41.0053');
    expect(params.get(SHARE_PARAMS.lng)).toBe('28.977');
  });

  it('builds an absolute URL on the page it is shared from, dropping any other query', () => {
    const url = buildShareUrl('https://orbital.example/dashboard?utm=x#top', ISTANBUL);

    expect(url).toBe('https://orbital.example/dashboard?lat=41.0053&lng=28.977&place=%C4%B0stanbul');
  });

  it('omits the browser geolocation label, which means nothing to a recipient', () => {
    const params = shareSearchParams({ ...ISTANBUL, id: 'browser-location', name: BROWSER_LOCATION_NAME });

    expect(params.get(SHARE_PARAMS.place)).toBeNull();
  });

  it('cuts a long name by characters, never through one', () => {
    // A name truncated mid-surrogate is a lone half of an astral character:
    // URLSearchParams quietly substitutes U+FFFD, but encodeURIComponent
    // throws URIError on it, so anything that later builds a mailto: or an
    // OG image from the name would break on an emoji nobody typed twice.
    const rocket = `${'a'.repeat(47)}🚀tail`;
    const built = shareSearchParams({ ...ISTANBUL, name: rocket }).get(SHARE_PARAMS.place)!;
    const parsed = parseSharedObserver(`?lat=0&lng=0&place=${encodeURIComponent(rocket)}`)!.name;

    for (const value of [built, parsed]) {
      expect(() => encodeURIComponent(value)).not.toThrow();
      expect([...value].length).toBeLessThanOrEqual(48);
      // The 48th character is the rocket, whole: a lone surrogate would be
      // the failure, not the pair.
      expect(value.endsWith('🚀')).toBe(true);
    }
  });

  it('omits the name when the location has none worth sharing', () => {
    const url = buildShareUrl('https://orbital.example/', {
      ...ISTANBUL,
      id: 'shared-location',
      name: 'Shared location',
    });

    expect(url).toBe('https://orbital.example/?lat=41.0053&lng=28.977');
  });
});
