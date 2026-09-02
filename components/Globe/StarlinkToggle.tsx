'use client';

type StarlinkToggleProps = {
  enabled: boolean;
  count: number;
  ready: boolean;
  isLoading: boolean;
  error: string | null;
  onToggle: () => void;
};

/**
 * "off", "N satellites" and "no satellites" are the states the layer settles
 * in; "loading" and "unavailable" are the states it passes through.
 */
function status({ enabled, count, ready, isLoading, error }: Omit<StarlinkToggleProps, 'onToggle'>) {
  if (!enabled) return 'off';
  if (error) return 'unavailable';
  if (isLoading || !ready) return 'loading';
  // The worker has answered and nothing came back: a feed of element sets
  // satellite.js rejects is an empty layer, not a request still running.
  return count > 0 ? `${count} satellites` : 'no satellites';
}

export function StarlinkToggle({
  enabled,
  count,
  ready,
  isLoading,
  error,
  onToggle,
}: StarlinkToggleProps) {
  const live = enabled && count > 0 && !error;

  return (
    <button
      type="button"
      aria-pressed={enabled}
      onClick={onToggle}
      className="absolute right-4 bottom-14 z-20 inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-400/15 bg-[rgba(8,7,29,0.72)] px-4 text-[10px] font-semibold tracking-[0.14em] text-slate-400 uppercase backdrop-blur-lg transition-colors hover:border-cyan-300/35 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 aria-pressed:border-cyan-300/30 aria-pressed:text-cyan-100"
    >
      <span
        aria-hidden="true"
        className={
          live
            ? 'h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_9px_#67e8f9]'
            : 'h-1.5 w-1.5 rounded-full bg-slate-600'
        }
      />
      {/* One text node, so the visible label is exactly the accessible name.
          It is a live region because the count arrives a second or more after
          the press, long after a screen reader has finished with the click. */}
      <span aria-live="polite">
        {`Starlink · ${status({ enabled, count, ready, isLoading, error })}`}
      </span>
    </button>
  );
}
