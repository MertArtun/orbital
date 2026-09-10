'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { DataState } from '@/components/ui/DataState';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { CITIES, DEFAULT_LOCATION } from '@/lib/cities';
import { formatLocalTime } from '@/lib/format';
import { predictPasses, type PassPrediction } from '@/lib/passes';
import { BROWSER_LOCATION_NAME, buildShareUrl } from '@/lib/shareLink';
import type { ObserverLocation, TleRecord } from '@/lib/types';

/** The pill idiom the time control and the Starlink toggle already use. */
const PILL =
  'inline-flex min-h-11 min-w-[7rem] items-center justify-center rounded-full border px-4 text-[10px] font-semibold tracking-[0.14em] whitespace-nowrap uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300';

const QUIET_PILL = `${PILL} border-slate-400/15 bg-[rgba(8,7,29,0.72)] text-slate-400 hover:border-cyan-300/35 hover:text-slate-200`;

/** Success glows, briefly. The min-width above keeps the two states one size. */
const COPIED_PILL = `${PILL} border-cyan-300/45 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgba(103,232,249,0.16)]`;

/** How long the button wears its success before returning to its invitation. */
const COPIED_MS = 2_500;

export function PassPanel({
  tle,
  sharedObserver,
  onLocationChange,
}: {
  tle: TleRecord | undefined;
  /** From useSharedObserver: a link's observer, or null. */
  sharedObserver: ObserverLocation | null;
  onLocationChange: (location: ObserverLocation) => void;
}) {
  const [location, setLocation] = useState<ObserverLocation>(DEFAULT_LOCATION);
  const [query, setQuery] = useState(`${DEFAULT_LOCATION.name}, ${DEFAULT_LOCATION.country}`);
  const [permission, setPermission] = useState<'checking' | 'granted' | 'fallback' | 'shared'>(
    'checking',
  );
  const [passes, setPasses] = useState<PassPrediction[]>([]);
  const [computing, setComputing] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);

  useEffect(() => {
    onLocationChange(location);
  }, [location, onLocationChange]);

  useEffect(() => {
    if (!sharedObserver) return;
    setLocation(sharedObserver);
    setQuery(sharedObserver.name);
    setPermission('shared');
  }, [sharedObserver]);

  // The page this panel is on, null until mounted: window.location cannot be
  // read while the markup is produced on the server. It also dates the first
  // client commit, and the link resolves from the address bar one commit after
  // mount, so the geolocation request waits that commit rather than racing it:
  // a link is somebody's explicit choice of where to stand, and a fix that
  // arrives eight seconds later must not quietly move them home.
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => setHref(window.location.href), []);

  useEffect(() => {
    if (href === null || sharedObserver) return;

    if (!('geolocation' in navigator)) {
      setPermission('fallback');
      return;
    }

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (cancelled) return;
        const browserLocation: ObserverLocation = {
          id: 'browser-location',
          name: BROWSER_LOCATION_NAME,
          country: 'Browser GPS',
          lat: coords.latitude,
          lng: coords.longitude,
          altitudeKm: Math.max(0, (coords.altitude ?? 0) / 1_000),
        };
        setLocation(browserLocation);
        setQuery(BROWSER_LOCATION_NAME);
        setPermission('granted');
      },
      () => {
        if (!cancelled) setPermission('fallback');
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 15 * 60_000 },
    );
    // A link that lands while the fix is still in flight cancels it here.
    return () => {
      cancelled = true;
    };
  }, [href, sharedObserver]);

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

  // A counter, not a boolean: pressing COPY LINK again while the badge is
  // still up has to restart its two and a half seconds, and setting a
  // boolean that is already true changes nothing and re-runs no effect.
  const [copiedAt, setCopiedAt] = useState(0);
  const copied = copiedAt > 0;
  // Counts refusals rather than storing the URL: the link is rendered live
  // from the current location, so choosing a city after a refusal cannot
  // leave the visitor copying a link to where they used to be, and pressing
  // the button again re-focuses the field instead of bailing out of an
  // identical state update.
  const [reveal, setReveal] = useState(0);
  const manualInput = useRef<HTMLInputElement>(null);
  // Keyed so a second press of the same button is a fresh node, and so still
  // announced, rather than an unchanged string a screen reader passes over.
  const [announcement, setAnnouncement] = useState<{ id: number; text: string } | null>(null);

  useEffect(() => {
    if (copiedAt === 0) return;
    const timer = window.setTimeout(() => setCopiedAt(0), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copiedAt]);

  useEffect(() => {
    if (reveal === 0) return;
    const node = manualInput.current;
    if (!node) return;
    node.focus();
    node.select();
  }, [reveal]);

  const shareUrl = href === null ? undefined : buildShareUrl(href, location);

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setReveal(0);
      setCopiedAt((current) => current + 1);
      setAnnouncement((current) => ({ id: (current?.id ?? 0) + 1, text: 'Link copied' }));
    } catch {
      // An insecure context, a denied permission, or a browser without the
      // API. The link is still the answer, so it is put on screen to be copied
      // by hand instead of disappearing into a rejected promise.
      setReveal((current) => current + 1);
      setAnnouncement((current) => ({
        id: (current?.id ?? 0) + 1,
        text: 'The clipboard refused. The link is below, ready to copy.',
      }));
    }
  };

  return (
    <Panel className="p-5" labelledBy="passes-title">
      <PanelHeader
        id="passes-title"
        eyebrow="VISIBILITY WINDOW"
        title="Can you see the ISS?"
        action={
          <StatusChip tone={permission === 'granted' || permission === 'shared' ? 'cyan' : 'muted'}>
            {permission === 'checking'
              ? 'LOCATING'
              : permission === 'granted'
                ? 'GPS'
                : permission === 'shared'
                  ? 'LINK'
                  : 'CITY'}
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

      <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
        <span className="location-coordinates">
          {location.lat.toFixed(3)}°, {location.lng.toFixed(3)}°
        </span>
        <span>72 HOUR FORECAST · CIVIL TWILIGHT</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* data-share-url is the same link the button copies, exposed so the
            end-to-end gate can follow it without clipboard permissions. It is
            built from validated coordinates and a sanitised name. */}
        <button
          type="button"
          data-share-url={shareUrl}
          aria-label={
            copied
              ? 'COPIED, link copied to the clipboard'
              : 'COPY LINK, copy a link to this location'
          }
          onClick={() => void copyLink()}
          className={copied ? COPIED_PILL : QUIET_PILL}
        >
          {copied ? 'COPIED' : 'COPY LINK'}
        </button>
        <span className="sr-only" aria-live="polite">
          {announcement ? <span key={announcement.id}>{announcement.text}</span> : null}
        </span>
      </div>

      {reveal > 0 && shareUrl ? (
        <label className="mt-2 block">
          {/* Both halves are the input's accessible name, so the visible words
              are a prefix of what is announced (WCAG 2.5.3). */}
          <span className="flex items-center justify-between gap-2 text-[10px] tracking-[0.14em] text-slate-400 uppercase">
            Share link
            <span className="tracking-normal text-slate-400/85 normal-case">Copy this link</span>
          </span>
          <div className="location-input-wrap mt-1">
            <input
              ref={manualInput}
              className="location-input font-mono text-[11px]"
              readOnly
              value={shareUrl}
            />
          </div>
        </label>
      ) : null}

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
      <p className="text-slate-400/85">{label}</p>
      <p className="mt-1 font-medium text-slate-300">{value}</p>
    </div>
  );
}
