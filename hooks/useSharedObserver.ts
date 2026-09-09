'use client';

import { useEffect, useState } from 'react';

import { parseSharedObserver } from '@/lib/shareLink';
import type { ObserverLocation } from '@/lib/types';

/**
 * The observer a shared link asks for, or null.
 *
 * Null on the server and on the first client render so the two markups agree,
 * then resolved once in a mount effect from `window.location.search`. Read
 * once on purpose: a link is the opening position of a visit, not a
 * subscription to the address bar, so a later query change does not yank the
 * observer out from under whoever has since chosen a city.
 */
export function useSharedObserver(): ObserverLocation | null {
  const [observer, setObserver] = useState<ObserverLocation | null>(null);

  useEffect(() => {
    setObserver(parseSharedObserver(window.location.search));
  }, []);

  return observer;
}
