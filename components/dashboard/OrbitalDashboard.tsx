'use client';

import { useCallback, useRef, useState } from 'react';

import { OrbitalGlobe } from '@/components/Globe/OrbitalGlobe';
import { TopBar } from '@/components/dashboard/TopBar';
import { IssTelemetryPanel } from '@/components/panels/IssTelemetryPanel';
import { LaunchPanel } from '@/components/panels/LaunchPanel';
import { PassPanel } from '@/components/panels/PassPanel';
import { DataState } from '@/components/ui/DataState';
import { StatusChip } from '@/components/ui/StatusChip';
import { useAstros } from '@/hooks/useAstros';
import { useIssTracking } from '@/hooks/useIssTracking';
import { useLaunches } from '@/hooks/useLaunches';
import { DEFAULT_LOCATION } from '@/lib/cities';
import type { Launch, ObserverLocation } from '@/lib/types';

export function OrbitalDashboard() {
  const iss = useIssTracking();
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
          <section className="globe-frame" aria-label="Interactive globe showing the live ISS position">
            <div className="globe-hud globe-hud--top">
              <div>
                <p className="eyebrow">ORBITAL VIEW / LEO</p>
                <p className="mt-1 text-xs text-slate-400">
                  {iss.position
                    ? `${iss.position.lat.toFixed(2)}°, ${iss.position.lng.toFixed(2)}° · ${iss.position.altitudeKm.toFixed(0)} km`
                    : 'Acquiring ISS ephemeris…'}
                </p>
              </div>
              <StatusChip tone={iss.error ? 'amber' : 'cyan'} pulse={!iss.error}>
                {iss.error ? 'DEGRADED' : '1 HZ LIVE'}
              </StatusChip>
            </div>

            <OrbitalGlobe
              position={iss.position}
              track={iss.track}
              launches={launchFeed.launches}
              observer={observer}
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

          <div ref={telemetryRef}>
            <IssTelemetryPanel
              position={iss.position}
              history={iss.history}
              sunlit={iss.sunlit}
              source={iss.source}
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
    </main>
  );
}
