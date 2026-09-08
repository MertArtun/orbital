'use client';

import { useCallback, useRef, useState } from 'react';

import { OrbitalGlobe } from '@/components/Globe/OrbitalGlobe';
import { TimeControl } from '@/components/dashboard/TimeControl';
import { TopBar } from '@/components/dashboard/TopBar';
import { ApodPanel } from '@/components/panels/ApodPanel';
import { IssTelemetryPanel } from '@/components/panels/IssTelemetryPanel';
import { LaunchPanel } from '@/components/panels/LaunchPanel';
import { PassPanel } from '@/components/panels/PassPanel';
import { DataState } from '@/components/ui/DataState';
import { StatusChip } from '@/components/ui/StatusChip';
import { useAstros } from '@/hooks/useAstros';
import { useIssTracking } from '@/hooks/useIssTracking';
import { useLaunches } from '@/hooks/useLaunches';
import { useSimulatedClock } from '@/hooks/useSimulatedClock';
import { useTerminator } from '@/hooks/useTerminator';
import { DEFAULT_LOCATION } from '@/lib/cities';
import type { Launch, ObserverLocation } from '@/lib/types';

export function OrbitalDashboard() {
  // The one clock everything orbital reads (ADR 0006): the ISS marker, its
  // ground track and the Starlink worker all receive this instant, so they can
  // never disagree about "when". Launch countdowns and the top bar stay on
  // real time on purpose — a countdown to a real launch has no simulated
  // reading.
  const clock = useSimulatedClock();
  const iss = useIssTracking(clock.at);
  const terminator = useTerminator(clock.at);
  const launchFeed = useLaunches();
  const crewFeed = useAstros();
  const [observer, setObserver] = useState<ObserverLocation>(DEFAULT_LOCATION);
  const telemetryRef = useRef<HTMLDivElement>(null);

  const focusTelemetry = useCallback(() => {
    telemetryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const focusLaunch = useCallback((launch: Launch) => {
    if (launch.latitude === null || launch.longitude === null) return;
    window.dispatchEvent(
      new CustomEvent('orbital:focus-launch', {
        detail: { lat: launch.latitude, lng: launch.longitude },
      }),
    );
  }, []);

  return (
    <main className="app-shell min-h-screen">
      <div className="noise-layer" aria-hidden="true" />
      <TopBar astros={crewFeed.astros} source={crewFeed.source} />

      <div className="dashboard-grid">
        <div className="min-w-0 space-y-4">
          {/* data-simulated-at and data-propagated-at expose the canonical
              instant and the instant the marker was last propagated for. They
              are numbers and ISO strings this app generates — never upstream
              text — and are what the e2e gate compares against the worker's
              requests to prove every consumer shares one clock. */}
          <section
            className="globe-frame"
            aria-label="Interactive globe showing the live ISS position"
            data-simulated-at={clock.at ?? undefined}
          >
            <div className="globe-hud globe-hud--top">
              <div>
                <p className="eyebrow">ORBITAL VIEW / LEO</p>
                <p className="mt-1 text-xs text-slate-400" data-propagated-at={iss.position?.timestamp}>
                  {iss.position
                    ? `${iss.position.lat.toFixed(2)}°, ${iss.position.lng.toFixed(2)}° · ${iss.position.altitudeKm.toFixed(0)} km`
                    : 'Acquiring ISS ephemeris…'}
                </p>
              </div>
              <StatusChip
                tone={iss.error || !clock.live ? 'amber' : 'cyan'}
                pulse={!iss.error && clock.live}
              >
                {iss.error ? 'DEGRADED' : clock.live ? '1 HZ LIVE' : 'SIMULATED'}
              </StatusChip>
            </div>

            <OrbitalGlobe
              position={iss.position}
              track={iss.track}
              launches={launchFeed.launches}
              observer={observer}
              terminator={terminator}
              at={clock.at}
              onIssClick={focusTelemetry}
            />

            <div className="globe-hud globe-hud--bottom pointer-events-none">
              <div className="orbit-legend">
                <span><i className="legend-line legend-line--past" />−45 MIN</span>
                <span><i className="legend-line legend-line--future" />+45 MIN</span>
              </div>
              <p>DRAG TO ROTATE · SCROLL TO ZOOM</p>
            </div>

            {iss.error && !iss.position ? (
              <div className="absolute inset-x-5 top-24 z-20">
                <DataState title="Orbital propagation unavailable" message={iss.error} />
              </div>
            ) : null}
          </section>

          <TimeControl
            at={clock.at}
            offsetMs={clock.offsetMs}
            live={clock.live}
            onOffsetChange={clock.setOffsetMs}
            onReset={clock.reset}
          />

          <div ref={telemetryRef}>
            <IssTelemetryPanel
              position={iss.position}
              history={iss.history}
              sunState={iss.sunState}
              subsolar={terminator?.subsolar ?? null}
              source={iss.source}
              live={clock.live}
            />
          </div>
        </div>

        <aside className="min-w-0 space-y-4" aria-label="Mission control panels">
          <PassPanel tle={iss.tle} onLocationChange={setObserver} />
          <LaunchPanel
            launches={launchFeed.launches}
            isLoading={launchFeed.isLoading}
            error={launchFeed.error}
            stale={launchFeed.stale}
            onLaunchClick={focusLaunch}
          />
          <footer className="px-2 pb-2 text-center text-[10px] leading-5 tracking-[0.12em] text-slate-700">
            POSITIONS PROPAGATED LOCALLY FROM TLE · NO LIVE LOCATION API POLLING
          </footer>
        </aside>
      </div>

      {/* Below the core dashboard on purpose: the card is decorative, fetches
          nothing until it is scrolled near, and its failure changes only its
          own copy (ADR 0007). */}
      <section
        className="mx-auto w-[min(1800px,100%)] px-4 pb-4 sm:pb-6"
        aria-label="Astronomy picture of the day"
      >
        <ApodPanel />
      </section>
    </main>
  );
}
