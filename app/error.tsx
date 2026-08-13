'use client';

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="app-shell grid min-h-screen place-items-center p-6">
      <section className="glass-panel max-w-lg p-8 text-center">
        <p className="eyebrow">SYSTEM DEGRADED</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">The dashboard lost telemetry.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Cached orbital data remains safe. Retry the client session to re-acquire live feeds.
        </p>
        <button className="primary-button mt-6" onClick={reset} type="button">
          Re-acquire telemetry
        </button>
      </section>
    </main>
  );
}
