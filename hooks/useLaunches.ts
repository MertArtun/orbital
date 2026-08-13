'use client';

import useSWR from 'swr';

import { jsonFetcher } from '@/lib/api';
import type { ApiEnvelope, Launch } from '@/lib/types';

export function useLaunches() {
  const result = useSWR<ApiEnvelope<Launch[]>>('/api/launches', jsonFetcher, {
    refreshInterval: 5 * 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: true,
    errorRetryCount: 2,
  });

  return {
    launches: result.data?.ok ? result.data.data : [],
    source: result.data?.ok ? result.data.source : null,
    stale: result.data?.ok ? Boolean(result.data.stale) : false,
    isLoading: result.isLoading,
    error: result.error instanceof Error ? result.error.message : null,
  };
}
