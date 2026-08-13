'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { jsonFetcher } from '@/lib/api';
import {
  buildSatrec,
  calculateGroundTrack,
  propagateSatrec,
  type GroundTrackSegment,
  type OrbitalPosition,
} from '@/lib/propagation';
import { isSatelliteSunlit } from '@/lib/sun';
import type { ApiEnvelope, TleRecord } from '@/lib/types';

export type TelemetryPoint = {
  at: number;
  altitudeKm: number;
  speedKmS: number;
};

export function useIssTracking() {
  const { data, error, isLoading } = useSWR<ApiEnvelope<TleRecord[]>>(
    '/api/tle/iss',
    jsonFetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: true,
      errorRetryCount: 3,
      dedupingInterval: 60_000,
    },
  );
  const tle = data?.ok ? data.data[0] : undefined;
  const satrecState = useMemo(() => {
    if (!tle) return { satrec: null, error: null };
    try {
      return { satrec: buildSatrec(tle), error: null };
    } catch (caught) {
      return {
        satrec: null,
        error: caught instanceof Error ? caught.message : 'The ISS TLE could not be parsed.',
      };
    }
  }, [tle]);
  const satrec = satrecState.satrec;
  const [position, setPosition] = useState<OrbitalPosition | null>(null);
  const [track, setTrack] = useState<GroundTrackSegment[]>([]);
  const [history, setHistory] = useState<TelemetryPoint[]>([]);
  const [propagationError, setPropagationError] = useState<string | null>(null);

  useEffect(() => {
    if (!satrec) return;

    const update = () => {
      try {
        const next = propagateSatrec(satrec, new Date());
        setPosition(next);
        setHistory((current) => [
          ...current.slice(-59),
          { at: Date.now(), altitudeKm: next.altitudeKm, speedKmS: next.speedKmS },
        ]);
        setPropagationError(null);
      } catch (caught) {
        setPropagationError(caught instanceof Error ? caught.message : 'Propagation failed.');
      }
    };

    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [satrec]);

  useEffect(() => {
    if (!tle) return;

    const updateTrack = () => {
      try {
        setTrack(calculateGroundTrack(tle, new Date()));
      } catch (caught) {
        setPropagationError(caught instanceof Error ? caught.message : 'Ground track failed.');
      }
    };

    updateTrack();
    const timer = window.setInterval(updateTrack, 60_000);
    return () => window.clearInterval(timer);
  }, [tle]);

  return {
    tle,
    position,
    track,
    history,
    sunlit: position ? isSatelliteSunlit(position.eci, new Date(position.timestamp)) : null,
    source: data?.ok ? data.source : null,
    stale: data?.ok ? Boolean(data.stale) : false,
    isLoading,
    error: error instanceof Error ? error.message : satrecState.error ?? propagationError,
  };
}
