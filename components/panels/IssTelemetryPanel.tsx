'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

import { Panel, PanelHeader } from '@/components/ui/Panel';
import { StatusChip } from '@/components/ui/StatusChip';
import type { TelemetryPoint } from '@/hooks/useIssTracking';
import { formatCoordinate } from '@/lib/format';
import type { OrbitalPosition } from '@/lib/propagation';
import { describeSunState, type SubsolarPoint, type SunState } from '@/lib/sun';
import type { DataSource } from '@/lib/types';

function tleStatus(source: DataSource | null): {
  label: string;
  tone: 'cyan' | 'amber' | 'muted';
  pulse: boolean;
} {
  if (source === 'live') return { label: 'TLE LOCK', tone: 'cyan', pulse: true };
  if (source === 'stale-memory') return { label: 'CACHED TLE', tone: 'amber', pulse: false };
  if (source === 'repository-fallback') return { label: 'REPO TLE', tone: 'amber', pulse: false };
  return { label: 'ACQUIRING', tone: 'muted', pulse: false };
}

export function IssTelemetryPanel({
  position,
  history,
  sunState,
  subsolar,
  source,
  live,
}: {
  position: OrbitalPosition | null;
  history: TelemetryPoint[];
  sunState: SunState | null;
  /** Where the Sun is overhead at the same instant; null until the globe has one. */
  subsolar: SubsolarPoint | null;
  source: DataSource | null;
  /** False while the simulated clock is scrubbed away from now (ADR 0006). */
  live: boolean;
}) {
  const status = tleStatus(source);

  return (
    <Panel className="telemetry-panel p-5" labelledBy="iss-telemetry-title">
      <PanelHeader
        id="iss-telemetry-title"
        eyebrow={live ? 'LIVE TELEMETRY' : 'SIMULATED TELEMETRY'}
        title="International Space Station"
        action={
          <StatusChip tone={status.tone} pulse={status.pulse}>
            {status.label}
          </StatusChip>
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Altitude" value={position ? `${position.altitudeKm.toFixed(1)}` : '—'} unit="km" />
        <Metric label="Velocity" value={position ? `${position.speedKmS.toFixed(3)}` : '—'} unit="km/s" />
        <Metric
          label="Latitude"
          value={position ? formatCoordinate(position.lat, 'N', 'S') : '—'}
        />
        <Metric
          label="Longitude"
          value={position ? formatCoordinate(position.lng, 'E', 'W') : '—'}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        {/* role="img" so the label below is actually announced: an aria-label on
            a bare div is ignored. accessibilityLayer={false} removes Recharts'
            default role="application" tabindex="0" from the SVG surface, which
            otherwise puts an unnamed keyboard stop in the tab order and tells a
            screen reader to forward keystrokes to a decorative sparkline. The
            altitude it plots is already rendered as text in the metric above. */}
        <div
          className="h-20 min-w-0"
          role="img"
          aria-label="ISS altitude over the last minute"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              accessibilityLayer={false}
              data={history}
              margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="altitudeGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#67e8f9" stopOpacity={0.42} />
                  <stop offset="100%" stopColor="#67e8f9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} hide />
              <Tooltip
                contentStyle={{
                  background: 'rgba(3, 0, 20, .92)',
                  border: '1px solid rgba(103, 232, 249, .2)',
                  borderRadius: '12px',
                  fontSize: '11px',
                }}
                formatter={(value: unknown) => [`${Number(value).toFixed(2)} km`, 'Altitude']}
                labelFormatter={() => ''}
              />
              <Area
                type="monotone"
                dataKey="altitudeKm"
                stroke="#67e8f9"
                strokeWidth={1.5}
                fill="url(#altitudeGlow)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] text-slate-400">
          <span className={`sun-indicator ${sunState?.sunlit ? 'sun-indicator--lit' : ''}`} />
          {sunState === null
            ? 'SUN STATE ACQUIRING'
            : sunState.sunlit
              ? 'IN SUNLIGHT'
              : 'EARTH SHADOW'}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <p className="max-w-prose text-[11px] leading-5 text-slate-400">
          {sunState
            ? describeSunState(sunState)
            : 'Sun state resolves with the first orbital fix.'}
        </p>
        {/* The longitude is exposed unrounded so the e2e gate can measure the
            terminator's westward sweep against the simulated clock. */}
        <p
          className="font-mono text-[11px] tracking-[0.1em] text-slate-500"
          data-subsolar-lng={subsolar?.lng}
        >
          {subsolar
            ? `SUBSOLAR ${formatCoordinate(subsolar.lat, 'N', 'S')} · ${formatCoordinate(subsolar.lng, 'E', 'W')}`
            : 'SUBSOLAR —'}
        </p>
      </div>
      {/* lib/sun models the shadow as a cylinder and the ground Sun angle
          geocentrically: good to about a degree, and said so rather than
          dressed up as photometry (.claude/rules/orbital-math.md). */}
      <p className="mt-1 text-[10px] leading-4 text-slate-600">Cylindrical-shadow model</p>
    </Panel>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="metric-card">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 truncate font-mono text-lg font-semibold text-slate-100">
        {value} {unit ? <span className="text-xs text-slate-500">{unit}</span> : null}
      </p>
    </div>
  );
}
