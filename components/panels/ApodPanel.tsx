'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { DataState } from '@/components/ui/DataState';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { useApod } from '@/hooks/useApod';
import type { ApodState } from '@/hooks/useApod';

type Chip = { tone: 'cyan' | 'amber' | 'muted'; label: string };

function chipFor({ apod, source, stale, error }: ApodState): Chip {
  if (error) return { tone: 'muted', label: 'OFFLINE' };
  if (!apod) return { tone: 'muted', label: 'DEFERRED' };
  // Anything the route did not serve from a fresh upstream read is cached:
  // stale-memory today, repository-fallback if one is ever added.
  return stale || source !== 'live'
    ? { tone: 'amber', label: 'CACHED' }
    : { tone: 'cyan', label: 'LIVE' };
}

/**
 * APOD dates are plain `YYYY-MM-DD` with no zone. Read as UTC and printed as
 * UTC so the label cannot slide to the previous day west of Greenwich, and so
 * an unparseable upstream string falls back to itself rather than to
 * "Invalid Date".
 */
function formatApodDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

export function ApodPanel() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Latched: the card is fetched once, at the moment it first comes
        // within a screenful of the viewport, and the observer's work is over.
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      // A screenful of lead time, so the picture is decoded by the time the
      // card is actually read rather than fading in under the reader.
      { rootMargin: '200px 0px', threshold: 0 },
    );
    observer.observe(root);

    return () => observer.disconnect();
  }, []);

  const state = useApod(visible);
  const { apod, error } = state;
  const chip = chipFor(state);
  const [expanded, setExpanded] = useState(false);

  return (
    <div ref={rootRef}>
      <Panel className="p-5" labelledBy="apod-title">
        <PanelHeader
          id="apod-title"
          eyebrow="NASA · ASTRONOMY PICTURE OF THE DAY"
          title={apod?.title ?? 'Picture of the day'}
          action={<StatusChip tone={chip.tone}>{chip.label}</StatusChip>}
        />

        {/* One box, one size, every state. Deferred, loading, failed, image and
            video all render inside this aspect-locked frame, so the card never
            resizes underneath the page as the request resolves. */}
        <div className="relative mt-5 aspect-[16/10] w-full overflow-hidden rounded-2xl bg-slate-950/40 sm:aspect-[21/9]">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <DataState
                title="Picture of the day unavailable"
                message="NASA APOD did not answer. The rest of the dashboard is unaffected."
              />
            </div>
          ) : !apod ? (
            <Skeleton className="absolute inset-0" />
          ) : apod.mediaType === 'image' ? (
            /* `unoptimized` keeps this out of the image optimizer, which is
               what lets an arbitrary NASA host render without a remotePatterns
               entry. The route has already validated the URL as absolute https
               with no embedded credentials. */
            <Image
              src={apod.url}
              alt={apod.title}
              fill
              unoptimized
              sizes="(min-width: 1024px) 1800px, 100vw"
              className="object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            /* Video days are a link, never an embed: an iframe here would hand
               a third-party origin a frame inside the dashboard, and the URL is
               upstream text. */
            <a
              href={apod.url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute inset-0 flex items-center justify-center text-xs font-semibold tracking-[0.14em] text-cyan-200/80 uppercase transition-colors hover:text-cyan-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-300"
            >
              Watch today&apos;s video ↗
            </a>
          )}
        </div>

        {apod && !error ? (
          <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] font-medium tracking-[0.12em] text-slate-400 uppercase">
              <span>{formatApodDate(apod.date)}</span>
              <span>{apod.copyright ? `© ${apod.copyright}` : 'NASA · public domain'}</span>
            </div>

            {apod.explanation ? (
              <>
                <p
                  className={`mt-3 text-sm leading-6 text-slate-400 ${expanded ? '' : 'line-clamp-3'}`}
                >
                  {apod.explanation}
                </p>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((current) => !current)}
                  className="mt-1 inline-flex min-h-11 items-center text-[10px] font-semibold tracking-[0.14em] text-cyan-200/80 uppercase transition-colors hover:text-cyan-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                >
                  {expanded ? 'Show less' : 'Read more'}
                </button>
              </>
            ) : null}
          </>
        ) : null}
      </Panel>
    </div>
  );
}
