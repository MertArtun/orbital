'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

import { Panel, PanelHeader } from '@/components/ui/Panel';
import { StatusChip } from '@/components/ui/StatusChip';
import type { TelemetryPoint } from '@/hooks/useIssTracking';
import { formatCoordinate } from '@/lib/format';
import type { OrbitalPosition } from '@/lib/propagation';
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
  sunlit,
  source,
}: {
  position: OrbitalPosition | null;
  history: TelemetryPoint[];
  sunlit: boolean | null;
  source: DataSource | null;
}) {
  const status = tleStatus(source);

  return (
    <Panel className="telemetry-panel p-5" labelledBy="iss-telemetry-title">
      <PanelHeader
        id="iss-telemetry-title"
        eyebrow="LIVE TELEMETRY"
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
          <span className={`sun-indicator ${sunlit ? 'sun-indicator--lit' : ''}`} />
          {sunlit === null ? 'SUN STATE ACQUIRING' : sunlit ? 'IN SUNLIGHT' : 'EARTH SHADOW'}
        </div>
      </div>
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
