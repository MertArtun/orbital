'use client';

import useSWR from 'swr';

import { jsonFetcher } from '@/lib/api';
import type { ApiEnvelope, AstrosPayload } from '@/lib/types';

export function useAstros() {
  const result = useSWR<ApiEnvelope<AstrosPayload>>('/api/astros', jsonFetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: true,
    errorRetryCount: 2,
  });

  return {
    astros: result.data?.ok ? result.data.data : null,
    source: result.data?.ok ? result.data.source : null,
    isLoading: result.isLoading,
    error: result.error instanceof Error ? result.error.message : null,
  };
}
