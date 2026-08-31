'use client';

import { useEffect, useMemo, useState } from 'react';

import { DataState } from '@/components/ui/DataState';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { CITIES, DEFAULT_LOCATION } from '@/lib/cities';
import { formatLocalTime } from '@/lib/format';
import { predictPasses, type PassPrediction } from '@/lib/passes';
import type { ObserverLocation, TleRecord } from '@/lib/types';

export function PassPanel({
  tle,
  onLocationChange,
}: {
  tle: TleRecord | undefined;
  onLocationChange: (location: ObserverLocation) => void;
}) {
  const [location, setLocation] = useState<ObserverLocation>(DEFAULT_LOCATION);
  const [query, setQuery] = useState(`${DEFAULT_LOCATION.name}, ${DEFAULT_LOCATION.country}`);
  const [permission, setPermission] = useState<'checking' | 'granted' | 'fallback'>('checking');
  const [passes, setPasses] = useState<PassPrediction[]>([]);
  const [computing, setComputing] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);

  useEffect(() => {
    onLocationChange(location);
  }, [location, onLocationChange]);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setPermission('fallback');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const browserLocation: ObserverLocation = {
          id: 'browser-location',
          name: 'Current location',
          country: 'Browser GPS',
          lat: coords.latitude,
          lng: coords.longitude,
          altitudeKm: Math.max(0, (coords.altitude ?? 0) / 1_000),
        };
        setLocation(browserLocation);
        setQuery('Current location');
        setPermission('granted');
      },
      () => setPermission('fallback'),
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 15 * 60_000 },
    );
  }, []);

  useEffect(() => {
    if (!tle) return;
    setComputing(true);
    const timer = window.setTimeout(() => {
      try {
        setPasses(predictPasses(tle, location, { hours: 72, stepSeconds: 15 }));
        setPredictionError(null);
      } catch (caught) {
        setPasses([]);
        setPredictionError(
          caught instanceof Error ? caught.message : 'Pass prediction is temporarily unavailable.',
        );
      } finally {
        setComputing(false);
      }
    }, 30);
    return () => window.clearTimeout(timer);
  }, [location, tle]);

  const visiblePasses = useMemo(() => passes.filter((pass) => pass.visible), [passes]);
  const suggestions = useMemo(() => CITIES.map((city) => `${city.name}, ${city.country}`), []);

  const selectCity = (value: string) => {
    setQuery(value);
    const match = CITIES.find(
      (city) => `${city.name}, ${city.country}`.toLocaleLowerCase() === value.toLocaleLowerCase(),
    );
    if (match) {
      setLocation(match);
      setPermission('fallback');
    }
  };

  return (
    <Panel className="p-5" labelledBy="passes-title">
      <PanelHeader
        id="passes-title"
        eyebrow="VISIBILITY WINDOW"
        title="Can you see the ISS?"
        action={
          <StatusChip tone={permission === 'granted' ? 'cyan' : 'muted'}>
            {permission === 'checking' ? 'LOCATING' : permission === 'granted' ? 'GPS' : 'CITY'}
          </StatusChip>
        }
      />

      <label className="mt-5 block">
        <span className="sr-only">Search for an observing city</span>
        <div className="location-input-wrap">
          <span aria-hidden="true">⌖</span>
          <input
            className="location-input"
            list="orbital-city-list"
            value={query}
            onChange={(event) => selectCity(event.target.value)}
            placeholder="Search city"
          />
        </div>
        <datalist id="orbital-city-list">
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </label>

      <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500">
        <span>{location.lat.toFixed(3)}°, {location.lng.toFixed(3)}°</span>
        <span>72 HOUR FORECAST · CIVIL TWILIGHT</span>
      </div>

      {computing || !tle ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-20" />
        </div>
      ) : null}

      {!computing && predictionError ? (
        <div className="mt-5">
          <DataState
            title="Pass prediction unavailable"
            message={predictionError}
          />
        </div>
      ) : null}

      {!computing && tle && !predictionError && visiblePasses.length === 0 ? (
        <div className="mt-5">
          <DataState
            title="No visible pass in the next 72 hours"
            message="The station may pass below 10° elevation, be in Earth’s shadow, or cross before civil twilight."
          />
        </div>
      ) : null}

      {!computing && !predictionError && visiblePasses.length > 0 ? (
        <div className="mt-5 space-y-3">
          {visiblePasses.slice(0, 3).map((pass, index) => (
            <PassCard key={pass.id} pass={pass} featured={index === 0} />
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function PassCard({ pass, featured }: { pass: PassPrediction; featured: boolean }) {
  const start = pass.visibleStart ?? pass.start;
  const minutes = Math.max(1, Math.round(pass.visibleDurationSeconds / 60));
  // The elevation the observer actually gets, not the geometric peak — those
  // diverge whenever the pass peaks in daylight or inside Earth's shadow, and
  // the card is a promise about what you will see.
  const elevationDeg = pass.visibleMaxElevationDeg ?? pass.maxElevationDeg;
  const quality = elevationDeg >= 50 ? 'Excellent' : elevationDeg >= 25 ? 'Good' : 'Low';

  return (
    <article className={featured ? 'pass-card pass-card--featured' : 'pass-card'}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/65">
            {featured ? 'NEXT VISIBLE PASS' : 'VISIBLE PASS'}
          </p>
          <p className="mt-2 text-xl font-semibold text-white">{formatLocalTime(start)}</p>
        </div>
        <span className="pass-elevation">{Math.round(elevationDeg)}°</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
        <PassFact label="Duration" value={`${minutes} min`} />
        <PassFact label="Approach" value={pass.approachDirection} />
        <PassFact label="Brightness" value={quality} />
      </div>
    </article>
  );
}

function PassFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-600">{label}</p>
      <p className="mt-1 font-medium text-slate-300">{value}</p>
    </div>
  );
}
