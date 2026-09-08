'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { jsonFetcher } from '@/lib/api';
import type { ApiEnvelope, Apod, DataSource } from '@/lib/types';

export type ApodState = {
  apod: Apod | null;
  source: DataSource | null;
  stale: boolean;
  isLoading: boolean;
  error: string | null;
};

/**
 * The picture of the day is the one decorative feed on the dashboard, so it is
 * also the one that must never cost the first viewport anything: `enabled`
 * comes from an IntersectionObserver in the panel, and until it has been true
 * the SWR key stays null and no request is made.
 *
 * Unlike useLaunches and useAstros this never retries and never refreshes. The
 * upstream is NASA's APOD behind DEMO_KEY, which is rate limited per IP by the
 * hour; a retry storm from an optional card would spend the budget the route's
 * daily revalidation depends on. One attempt per page load, and the panel says
 * OFFLINE if it fails.
 */
export function useApod(enabled: boolean): ApodState {
  // Latches on first enable, like useStarlink: once the visitor has scrolled
  // the card into view it stays loaded, so scrolling away and back is served
  // from the SWR cache rather than dropping the key and refetching.
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (enabled) setRequested(true);
  }, [enabled]);

  const result = useSWR<ApiEnvelope<Apod>>(requested ? '/api/apod' : null, jsonFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    // A picture that changes once a day never needs a second request within
    // one session.
    dedupingInterval: 3_600_000,
  });

  return {
    apod: result.data?.ok ? result.data.data : null,
    source: result.data?.ok ? result.data.source : null,
    stale: result.data?.ok ? Boolean(result.data.stale) : false,
    isLoading: result.isLoading,
    error: result.error instanceof Error ? result.error.message : null,
  };
}
