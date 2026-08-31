'use client';

import { useClock } from '@/hooks/useClock';
import { formatCountdown } from '@/lib/format';
import type { Launch } from '@/lib/types';
import { DataState } from '@/components/ui/DataState';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';

export function LaunchPanel({
  launches,
  isLoading,
  error,
  stale,
  onLaunchClick,
}: {
  launches: Launch[];
  isLoading: boolean;
  error: string | null;
  stale: boolean;
  onLaunchClick?: (launch: Launch) => void;
}) {
  const now = useClock();
  // The upstream request asks for ordering=net and hide_recent_previous=true,
  // but the cached and fallback paths keep their original order while time
  // moves on — so a stale feed can lead with a launch that has already flown.
  // Sort defensively and, once the clock exists, headline only what is still
  // ahead of us. Without the clock we cannot know what "past" means, and
  // inventing one during render would desynchronise server and client markup.
  //
  // The envelope's fetchedAt is deliberately not used as the cutoff: because
  // hide_recent_previous already ran upstream, fetchedAt is exactly the moment
  // the list was known correct, so filtering by it just repeats a filter that
  // has already happened. The bug is entirely about time passing afterwards.
  const upcoming = [...launches].sort((a, b) => Date.parse(a.net) - Date.parse(b.net));
  const scheduled = now ? upcoming.filter((launch) => Date.parse(launch.net) >= now.getTime()) : upcoming;
  const next = scheduled[0];

  return (
    <Panel className="p-5" labelledBy="launches-title">
      <PanelHeader
        id="launches-title"
        eyebrow="LAUNCH MANIFEST"
        title="Upcoming missions"
        action={<StatusChip tone={stale ? 'amber' : 'violet'}>{stale ? 'CACHED' : 'NEXT 5'}</StatusChip>}
      />

      {isLoading ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : null}

      {!isLoading && error && scheduled.length === 0 ? (
        <div className="mt-5">
          <DataState title="Launch feed unavailable" message="The globe remains operational. Cached launch data will reappear automatically." />
        </div>
      ) : null}

      {!isLoading && !error && scheduled.length === 0 ? (
        <div className="mt-5">
          <DataState
            title="No scheduled launches"
            message="The launch manifest is currently empty. It will refresh automatically."
          />
        </div>
      ) : null}

      {!isLoading && next ? (
        <div className="mt-5">
          <button
            className="next-launch-card w-full text-left"
            type="button"
            onClick={() => onLaunchClick?.(next)}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-semibold tracking-[0.18em] text-fuchsia-200/75">
                NEXT WINDOW
              </span>
              <span className="text-[10px] text-slate-400">{next.status}</span>
            </div>
            <p className="countdown mt-5">{now ? formatCountdown(next.net, now.getTime()) : 'T−--:--:--:--'}</p>
            <h3 className="mt-4 line-clamp-2 text-lg font-semibold leading-snug text-white">{next.name}</h3>
            <p className="mt-2 line-clamp-1 text-xs text-slate-400">
              {next.provider} · {next.padName} · {next.locationName}
            </p>
            <div className="mt-5 flex items-center justify-between text-[10px] font-medium tracking-[0.12em] text-slate-500">
              <span>{new Date(next.net).toLocaleString()}</span>
              {next.latitude !== null ? <span className="text-cyan-200/70">FOCUS PAD ↗</span> : null}
            </div>
          </button>

          <div className="mt-3 divide-y divide-white/[0.06]">
            {scheduled.slice(1, 5).map((launch) => (
              <button
                type="button"
                className="launch-row w-full text-left"
                key={launch.id}
                onClick={() => onLaunchClick?.(launch)}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-200">{launch.name}</p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">
                    {launch.provider} · {launch.padName}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs text-cyan-100/80">
                    {now ? formatCountdown(launch.net, now.getTime()).slice(0, -3) : '—'}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-slate-600">
                    {new Date(launch.net).toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
