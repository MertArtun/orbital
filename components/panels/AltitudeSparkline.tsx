'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

import type { TelemetryPoint } from '@/hooks/useIssTracking';

/**
 * The altitude sparkline, in its own module so `IssTelemetryPanel` can reach it
 * through next/dynamic: recharts is the single largest chunk in the payload and
 * this chart sits below the fold at every viewport, so it must not be part of
 * the first load. `scripts/check-bundle-budget.mjs` is what holds that.
 *
 * `accessibilityLayer={false}` removes Recharts' default role="application"
 * tabindex="0" from the SVG surface, which otherwise puts an unnamed keyboard
 * stop in the tab order and tells a screen reader to forward keystrokes to a
 * decorative sparkline. The altitude it plots is already rendered as text in the
 * metric above it, and the chart is announced by the labelled wrapper the panel
 * keeps server-rendered.
 */
export function AltitudeSparkline({ history }: { history: TelemetryPoint[] }) {
  return (
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
  );
}
