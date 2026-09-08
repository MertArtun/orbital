'use client';

import { useId, useState } from 'react';

import { StatusChip } from '@/components/ui/StatusChip';
import {
  MAX_OFFSET_MINUTES,
  MAX_OFFSET_MS,
  OFFSET_STEP_MS,
  clampOffset,
  describeOffset,
  formatOffset,
} from '@/lib/simulatedTime';

type TimeControlProps = {
  /** Canonical simulated instant, in ms since the epoch; null before mount. */
  at: number | null;
  /** Clamped offset from the live instant, in ms. */
  offsetMs: number;
  /** `offsetMs === 0`. */
  live: boolean;
  /** Receives an offset in ms; the clock hook clamps it. */
  onOffsetChange: (offsetMs: number) => void;
  onReset: () => void;
};

const TRACK = 'rgba(148,163,184,0.16)';
const PAST = 'rgba(103,232,249,0.82)';
const FUTURE = 'rgba(167,139,250,0.82)';

/**
 * A notch through the centre of the track. The fill starts from now, so the
 * live state — the one state with nothing filled — would otherwise be a plain
 * bar with no mark for the point everything else is measured against.
 */
const NOW_NOTCH =
  'linear-gradient(to right, transparent 0 calc(50% - 0.5px),' +
  ' rgba(226,232,240,0.5) calc(50% - 0.5px) calc(50% + 0.5px),' +
  ' transparent calc(50% + 0.5px) 100%) center / 100% 12px no-repeat';

/**
 * The track reads as a hairline while the control keeps a 44px hit area: the
 * gradient is painted as a 6px band centred in a tall input rather than as the
 * input's whole background. It fills from the centre — now — out to the thumb,
 * cyan into the past and violet into the future, so the direction of travel is
 * the thing the eye lands on.
 */
function trackBackground(minutes: number): string {
  const thumb = ((minutes + MAX_OFFSET_MINUTES) / (MAX_OFFSET_MINUTES * 2)) * 100;
  const [from, to] = minutes < 0 ? [thumb, 50] : [50, thumb];
  const fill = minutes < 0 ? PAST : FUTURE;
  return (
    `${NOW_NOTCH}, linear-gradient(to right, ${TRACK} 0 ${from}%,` +
    ` ${fill} ${from}% ${to}%, ${TRACK} ${to}% 100%) center / 100% 6px no-repeat`
  );
}

/** `--:--:-- UTC` until the clock has produced its first instant. */
function utcLabel(at: number | null): string {
  if (at === null) return '--:--:-- UTC';
  return `${new Date(at).toISOString().slice(11, 19)} UTC`;
}

const PILL =
  'inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-[10px] font-semibold tracking-[0.14em] whitespace-nowrap uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300';

const QUIET_PILL = `${PILL} border-slate-400/15 bg-[rgba(8,7,29,0.72)] text-slate-400 hover:border-cyan-300/35 hover:text-slate-200`;

/**
 * Inert at a bound, but never the `disabled` attribute: that removes the
 * button from the tab order the instant it is pressed, and a keyboard user who
 * has just reached +90 or returned to now finds focus dropped to the document.
 * aria-disabled keeps the stop and announces the state; the handlers no-op.
 */
const INERT_PILL = `${PILL} cursor-default border-slate-400/15 bg-[rgba(8,7,29,0.72)] text-slate-400 opacity-35`;

/** The one control that undoes a simulation, so it is the one that glows. */
const RESET_PILL = `${PILL} border-cyan-300/45 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgba(103,232,249,0.16)] hover:border-cyan-300/70 hover:bg-cyan-400/16`;

const THUMB = [
  '[&::-webkit-slider-thumb]:h-4',
  '[&::-webkit-slider-thumb]:w-4',
  '[&::-webkit-slider-thumb]:appearance-none',
  '[&::-webkit-slider-thumb]:rounded-full',
  '[&::-webkit-slider-thumb]:border',
  '[&::-webkit-slider-thumb]:border-white/75',
  '[&::-webkit-slider-thumb]:bg-slate-950',
  '[&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(103,232,249,0.85)]',
  '[&::-moz-range-thumb]:h-4',
  '[&::-moz-range-thumb]:w-4',
  '[&::-moz-range-thumb]:appearance-none',
  '[&::-moz-range-thumb]:rounded-full',
  '[&::-moz-range-thumb]:border',
  '[&::-moz-range-thumb]:border-white/75',
  '[&::-moz-range-thumb]:bg-slate-950',
  '[&::-moz-range-thumb]:shadow-[0_0_12px_rgba(103,232,249,0.85)]',
  '[&::-moz-range-track]:bg-transparent',
].join(' ');

const END_LABEL = 'shrink-0 text-[9px] font-semibold tracking-[0.14em] text-slate-400';

export function TimeControl({ at, offsetMs, live, onOffsetChange, onReset }: TimeControlProps) {
  const minutes = Math.round(offsetMs / 60_000);
  const sliderId = useId();
  const atRewindBound = offsetMs <= -MAX_OFFSET_MS;
  const atAdvanceBound = offsetMs >= MAX_OFFSET_MS;

  // Announced for the buttons only. The slider already speaks its own
  // aria-valuetext on every step, so a live readout would say each value
  // twice across a keyboard drag; a button press moves nothing that speaks,
  // so it gets one polite announcement. Keyed so an identical text -- LIVE,
  // twice in a row -- is still a fresh node and still announced.
  const [announcement, setAnnouncement] = useState<{ id: number; text: string } | null>(null);
  const announce = (text: string) =>
    setAnnouncement((current) => ({ id: (current?.id ?? 0) + 1, text }));

  const nudge = (deltaMs: number) => {
    const next = clampOffset(offsetMs + deltaMs);
    if (next === offsetMs) return;
    onOffsetChange(next);
    announce(formatOffset(next));
  };
  const reset = () => {
    if (live) return;
    onReset();
    announce(formatOffset(0));
  };

  return (
    <div
      role="group"
      aria-label="Simulated time"
      className="glass-panel flex flex-col gap-3 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="eyebrow">TIME CONTROL</p>
        <StatusChip tone={live ? 'cyan' : 'amber'} pulse={live}>
          {live ? 'LIVE' : 'SIMULATED'}
        </StatusChip>

        <div className="ml-auto flex items-center gap-2.5 font-mono text-[11px] tracking-[0.06em]">
          {/* <output> is the result of the slider; its implicit live behaviour
              is switched off because the slider announces itself. */}
          <output
            htmlFor={sliderId}
            aria-live="off"
            className={live ? 'text-cyan-200' : 'text-violet-200'}
          >
            {formatOffset(offsetMs)}
          </output>
          <span className="clock-divider" aria-hidden="true" />
          {/* Never live: it reissues every second, and a screen reader reading
              the clock aloud at 1Hz is unusable. */}
          <span className="text-slate-400">{utcLabel(at)}</span>
        </div>
        <span className="sr-only" aria-live="polite">
          {announcement ? <span key={announcement.id}>{announcement.text}</span> : null}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[200px] flex-1 items-center gap-2.5">
          {/* The slider already carries the value; these are orientation only. */}
          <span aria-hidden="true" className={END_LABEL}>
            −90 MIN
          </span>
          <input
            id={sliderId}
            type="range"
            min={-MAX_OFFSET_MINUTES}
            max={MAX_OFFSET_MINUTES}
            step={1}
            value={minutes}
            aria-label="Simulated time offset"
            aria-valuetext={describeOffset(offsetMs)}
            onChange={(event) => onOffsetChange(Number(event.target.value) * 60_000)}
            style={{ background: trackBackground(minutes) }}
            className={`h-11 w-full min-w-0 cursor-pointer appearance-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${THUMB}`}
          />
          <span aria-hidden="true" className={END_LABEL}>
            +90 MIN
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Rewind 10 minutes"
            aria-disabled={atRewindBound}
            onClick={() => nudge(-OFFSET_STEP_MS)}
            className={atRewindBound ? INERT_PILL : QUIET_PILL}
          >
            −10 MIN
          </button>
          <button
            type="button"
            aria-label="Advance 10 minutes"
            aria-disabled={atAdvanceBound}
            onClick={() => nudge(OFFSET_STEP_MS)}
            className={atAdvanceBound ? INERT_PILL : QUIET_PILL}
          >
            +10 MIN
          </button>
          <button
            type="button"
            aria-label="Return to now"
            aria-disabled={live}
            onClick={reset}
            className={live ? INERT_PILL : RESET_PILL}
          >
            NOW
          </button>
        </div>
      </div>
    </div>
  );
}
