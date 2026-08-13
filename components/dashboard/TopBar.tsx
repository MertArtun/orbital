'use client';

import { useClock } from '@/hooks/useClock';
import type { AstrosPayload, DataSource } from '@/lib/types';
import { StatusChip } from '@/components/ui/StatusChip';

function clockLabel(date: Date | null, zone: 'utc' | 'local') {
  if (!date) return '--:--:--';
  if (zone === 'utc') return `${date.toISOString().slice(11, 19)} UTC`;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function TopBar({
  astros,
  source,
}: {
  astros: AstrosPayload | null;
  source: DataSource | null;
}) {
  const now = useClock();

  return (
    <header className="topbar">
      <div className="flex min-w-0 items-center gap-4">
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-lg font-bold tracking-[0.24em] text-white">ORBITAL</h1>
            <StatusChip pulse tone="cyan">LIVE</StatusChip>
          </div>
          <p className="mt-0.5 hidden text-[10px] font-medium tracking-[0.18em] text-slate-500 sm:block">
            HUMAN ACTIVITY IN LOW EARTH ORBIT
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="clock-cluster hidden md:flex">
          <span>{clockLabel(now, 'utc')}</span>
          <span className="clock-divider" />
          <span>{clockLabel(now, 'local')} LOCAL</span>
        </div>
        <StatusChip tone={source === 'live' ? 'violet' : 'muted'}>
          {astros ? `${astros.count} HUMANS IN SPACE` : 'CREW DATA OFFLINE'}
        </StatusChip>
      </div>
    </header>
  );
}
