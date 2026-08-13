import { describe, expect, it } from 'vitest';

import { normalizeLaunch, normalizeLaunches } from '@/lib/launches';

describe('launch normalization', () => {
  it('maps Launch Library fields and preserves valid zero coordinates', () => {
    const launch = normalizeLaunch({
      id: 'launch-1',
      name: 'Demo Mission',
      net: '2026-09-01T12:30:00Z',
      status: { name: 'Go' },
      image: { image_url: 'https://example.test/launch.jpg' },
      webcast_urls: ['https://example.test/live'],
      launch_service_provider: { name: 'Orbital Labs' },
      rocket: { configuration: { full_name: 'Test Rocket 9' } },
      mission: { name: 'Payload Alpha' },
      pad: {
        name: 'LC-1',
        latitude: '0',
        longitude: 0,
        location: { name: 'Equator Range' },
      },
    });

    expect(launch).toMatchObject({
      id: 'launch-1',
      provider: 'Orbital Labs',
      rocket: 'Test Rocket 9',
      latitude: 0,
      longitude: 0,
      webcastUrl: 'https://example.test/live',
    });
  });

  it('keeps null or out-of-range coordinates off the globe', () => {
    const launch = normalizeLaunch({
      id: 'launch-2',
      name: 'No Pad',
      net: '2026-09-02T12:30:00Z',
      pad: { latitude: null, longitude: '999' },
    });

    expect(launch?.latitude).toBeNull();
    expect(launch?.longitude).toBeNull();
  });

  it('rejects missing identity and invalid launch timestamps', () => {
    expect(normalizeLaunch({ name: 'Missing ID', net: '2026-09-01T00:00:00Z' })).toBeNull();
    expect(normalizeLaunch({ id: 'bad-date', name: 'Bad Date', net: 'not-a-date' })).toBeNull();
  });

  it('filters malformed records and supplies stable fallback labels', () => {
    const launches = normalizeLaunches({
      results: [
        { id: 'ok', name: 'Minimal', net: '2026-09-03T00:00:00Z' },
        { id: 'bad', name: 'Bad', net: 'invalid' },
      ],
    });

    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      mission: 'Mission details pending',
      provider: 'Agency pending',
      rocket: 'Rocket TBD',
    });
    expect(normalizeLaunches(null)).toEqual([]);
    expect(normalizeLaunches({ results: 'not-an-array' })).toEqual([]);
  });
});
