'use client';

import { useMemo, useSyncExternalStore } from 'react';

import { parseSharedObserver } from '@/lib/shareLink';
import type { ObserverLocation } from '@/lib/types';

// Read once on purpose: a link is the opening position of a visit, not a
// subscription to the address bar, so a later query change does not yank the
// observer out from under whoever has since chosen a city. Caching the first
// read is what keeps that true now that React may call the snapshot again.
let firstSearch: string | undefined;
const readSearch = () => (firstSearch ??= window.location.search);
const serverSearch = () => null;
const neverChanges = () => () => {};

/**
 * The observer a shared link asks for, or null.
 *
 * Null on the server and while hydrating, so the two markups agree. It used to
 * resolve in a mount effect and reach its consumers through a dashboard state
 * update, but Next.js hydrates inside a transition, which made that update
 * interruptible: on a slow main thread the 1 Hz telemetry kept restarting it
 * until it expired, seconds after the intro had chosen the station. An
 * external store whose client snapshot differs from the server's is instead
 * re-rendered synchronously as soon as hydration commits, before the
 * client-only globe can mount.
 */
export function useSharedObserver(): ObserverLocation | null {
  const search = useSyncExternalStore(neverChanges, readSearch, serverSearch);
  return useMemo(() => (search === null ? null : parseSharedObserver(search)), [search]);
}
