'use client';

import { useMemo, useSyncExternalStore } from 'react';

import { parseSharedObserver } from '@/lib/shareLink';
import type { ObserverLocation } from '@/lib/types';

// Read once on purpose: a link is the opening position of a visit, not a
// subscription to the address bar, so a later query change does not yank the
// observer out from under whoever has since chosen a city. Caching the first
// read is what keeps that true now that React may call the snapshot again.
// The cache lives as long as the module, so a unit test that renders this hook
// more than once needs vi.resetModules() between renders.
let firstSearch: string | undefined;
const readSearch = () => (firstSearch ??= window.location.search);
// The server has no address bar. '' is also what a visit without a link reads
// on the client, so only a visit that carries a link pays for the re-render.
const serverSearch = () => '';
const neverChanges = () => () => {};

/**
 * The observer a shared link asks for, or null.
 *
 * Null on the server and while hydrating, so the two markups agree. It used to
 * resolve in a mount effect and reach its consumers through a dashboard state
 * update scheduled from that effect. On a throttled CPU that update could land
 * seconds after the intro's 200 ms hold had already chosen the station (most
 * likely at low priority, since the dashboard hydrates inside app/loading.tsx's
 * Suspense boundary). An external store whose client snapshot differs from the
 * server's is instead re-rendered on the Sync lane, scheduled from the
 * hydration commit's effects, which is before the client-only globe can mount.
 */
export function useSharedObserver(): ObserverLocation | null {
  const search = useSyncExternalStore(neverChanges, readSearch, serverSearch);
  return useMemo(() => parseSharedObserver(search), [search]);
}
