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
            {/* Never truncates: the wide tracking relaxes on small screens and
                the redundant LIVE chip (the globe already reads "1 HZ LIVE")
                drops out, so the product name always renders in full. */}
            <h1 className="shrink-0 text-lg font-bold tracking-[0.16em] text-white sm:tracking-[0.24em]">
              ORBITAL
            </h1>
            <span className="hidden sm:inline-flex">
              <StatusChip pulse tone="cyan">LIVE</StatusChip>
            </span>
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
