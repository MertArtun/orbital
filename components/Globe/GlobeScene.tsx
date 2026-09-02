'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';

import { StarlinkToggle } from '@/components/Globe/StarlinkToggle';
import { useElementSize } from '@/hooks/useElementSize';
import { useStarlink } from '@/hooks/useStarlink';
import type { GroundTrackSegment, OrbitalPosition, TrackPoint } from '@/lib/propagation';
import { STARLINK_STRIDE } from '@/lib/starlink';
import type { Launch, ObserverLocation } from '@/lib/types';

type GlobeSceneProps = {
  position: OrbitalPosition | null;
  track: GroundTrackSegment[];
  launches: Launch[];
  observer: ObserverLocation;
  onIssClick: () => void;
};

/** One datum for the whole constellation; see starlinkDatumRef. */
type StarlinkDatum = { positions: Float32Array | null; count: number };

/** What the particles layer iterates: an offset into the batch buffer. */
type ParticleItem = { index: number };

const NO_PARTICLES: object[] = [];

function coordinate(datum: StarlinkDatum, item: object, offset: number) {
  return datum.positions?.[(item as ParticleItem).index * STARLINK_STRIDE + offset] ?? 0;
}

type LaunchSite = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  launch: Launch;
};

export function GlobeScene({ position, track, launches, observer, onIssClick }: GlobeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { width, height } = useElementSize(containerRef);
  const didCinematicIntro = useRef(false);
  const hasPosition = Boolean(position);

  /**
   * three-globe keys its object map on datum identity and only tweens a marker
   * when it digests the same object twice. `position` is a fresh object on every
   * 1Hz propagation tick, so passing it straight through tore the marker's DOM
   * node down and rebuilt it each second: no interpolation, and a click target
   * that detached mid-gesture. One datum, mutated in place, restores both.
   */
  const issDatumRef = useRef({ lat: 0, lng: 0 });
  const [issData, setIssData] = useState<Array<{ lat: number; lng: number }>>([]);

  useEffect(() => {
    if (!position) {
      setIssData([]);
      return;
    }
    // Mutate the one datum, then hand over a fresh array: the new array makes
    // react-globe.gl re-digest, while the unchanged datum identity makes that
    // digest an update (tween) instead of a teardown.
    const datum = issDatumRef.current;
    datum.lat = position.lat;
    datum.lng = position.lng;
    setIssData([datum]);
  }, [position]);

  const [starlinkEnabled, setStarlinkEnabled] = useState(false);
  const starlink = useStarlink(starlinkEnabled);

  /**
   * The same one-datum trick as the ISS marker, for a different reason: the
   * whole constellation is one three.js Points object with one material, so a
   * digest rebuilds a single position attribute from this datum. Nothing is
   * mutated in place — three-globe's particles layer builds a fresh
   * BufferAttribute each time — but 800 satellites cost one attribute per
   * second instead of 800 meshes torn down and rebuilt.
   */
  const starlinkDatumRef = useRef<StarlinkDatum>({ positions: null, count: 0 });
  const particleItemsRef = useRef<ParticleItem[]>([]);
  const [starlinkData, setStarlinkData] = useState<object[]>(NO_PARTICLES);

  useEffect(() => {
    if (!starlink.positions || starlink.count === 0) {
      setStarlinkData(NO_PARTICLES);
      return;
    }
    const datum = starlinkDatumRef.current;
    datum.positions = starlink.positions;
    datum.count = starlink.count;
    setStarlinkData([datum]);
  }, [starlink.positions, starlink.count]);

  // The particle accessors are memoised because react-kapsule forwards a prop
  // whenever its identity changes, and every forward re-digests the layer.
  const particlesList = useCallback((datum: object) => {
    const { count } = datum as StarlinkDatum;
    const items = particleItemsRef.current;
    while (items.length < count) items.push({ index: items.length });
    // Truncating in place keeps the item objects for the next tick; slicing
    // would allocate a fresh array every time the fleet shrank.
    items.length = count;
    return items;
  }, []);
  const particleLat = useCallback((item: object) => coordinate(starlinkDatumRef.current, item, 0), []);
  const particleLng = useCallback((item: object) => coordinate(starlinkDatumRef.current, item, 1), []);
  // Divided by the same figure as the ground track: the compressed altitude
  // scale keeps the shell below the ISS marker instead of swallowing it.
  const particleAltitude = useCallback(
    (item: object) => coordinate(starlinkDatumRef.current, item, 2) / 25_000,
    [],
  );
  const particlesColor = useCallback(() => 'rgba(186, 230, 253, 0.7)', []);

  // Rebuilt on every render otherwise, which re-digests the points layer at 1Hz.
  const observerData = useMemo(
    () => [{ ...observer, kind: 'observer' }],
    [observer],
  );

  const sites = useMemo<LaunchSite[]>(
    () =>
      launches
        .filter(
          (launch): launch is Launch & { latitude: number; longitude: number } =>
            launch.latitude !== null && launch.longitude !== null,
        )
        .slice(0, 5)
        .map((launch) => ({
          id: launch.id,
          lat: launch.latitude,
          lng: launch.longitude,
          label: launch.provider,
          launch,
        })),
    [launches],
  );

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    controls.autoRotate = !hasPosition;
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
  }, [hasPosition]);

  useEffect(() => {
    const handleFocusLaunch = (event: Event) => {
      const detail = (event as CustomEvent<{ lat: number; lng: number }>).detail;
      if (!detail || !globeRef.current) return;
      globeRef.current.pointOfView({ lat: detail.lat, lng: detail.lng, altitude: 1.55 }, 1_100);
    };
    window.addEventListener('orbital:focus-launch', handleFocusLaunch);
    return () => window.removeEventListener('orbital:focus-launch', handleFocusLaunch);
  }, []);

  useEffect(() => {
    if (!position || !globeRef.current || didCinematicIntro.current) return;
    didCinematicIntro.current = true;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const destination = { lat: position.lat - 8, lng: position.lng - 18, altitude: 1.75 };
    if (reducedMotion) {
      globeRef.current.pointOfView(destination, 0);
      return;
    }

    globeRef.current.pointOfView({ lat: position.lat, lng: position.lng, altitude: 2.25 }, 0);
    const timer = window.setTimeout(() => {
      globeRef.current?.pointOfView(destination, 1_800);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [position]);

  const makeIssElement = useCallback(() => {
    const button = document.createElement('button');
    const core = document.createElement('span');
    const halo = document.createElement('span');
    button.className = 'iss-marker';
    button.type = 'button';
    button.setAttribute('aria-label', 'Open ISS telemetry');
    core.className = 'iss-marker__core';
    core.textContent = 'ISS';
    halo.className = 'iss-marker__halo';
    button.append(core, halo);
    button.addEventListener('click', onIssClick);
    return button;
  }, [onIssClick]);

  const focusLaunch = (site: object) => {
    const launchSite = site as LaunchSite;
    globeRef.current?.pointOfView(
      { lat: launchSite.lat, lng: launchSite.lng, altitude: 1.6 },
      1_100,
    );
  };

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden rounded-[inherit]">
      {width > 0 && height > 0 ? (
        <Globe
          ref={globeRef}
          width={width}
          height={height}
          // three-globe's build-in spins the globe group a full turn over 1.2s.
          // Its HTML layer decides "behind the globe" with a checker that, on
          // first use, memoises the camera position in that group's rotating
          // local frame and only rebuilds it when the camera moves. A marker
          // whose first digest lands mid-spin is judged against a camera up to
          // 180° of longitude away, classed as behind, and never attached. The
          // reduced-motion path's only scripted camera move is a single
          // pointOfView call that lands mid-spin, so the checker built then
          // is never replaced. Disabling the build-in removes the only
          // transform ever applied to that group (the spin and the scale-up
          // both live in it), and also stops a full rotation being shown
          // under reduced motion.
          animateIn={false}
          backgroundColor="#030014"
          backgroundImageUrl="/textures/night-sky.png"
          globeImageUrl="/textures/earth-night.jpg"
          bumpImageUrl="/textures/earth-topology.png"
          showAtmosphere
          atmosphereColor="#7cecff"
          atmosphereAltitude={0.16}
          htmlElementsData={issData}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude={0.028}
          htmlElement={makeIssElement}
          htmlTransitionDuration={1_000}
          ringsData={issData}
          ringLat="lat"
          ringLng="lng"
          ringAltitude={0.004}
          ringColor={() => (time: number) => `rgba(103, 232, 249, ${Math.max(0, 1 - time)})`}
          ringMaxRadius={2.2}
          ringPropagationSpeed={2.6}
          ringRepeatPeriod={1_450}
          pathsData={track}
          pathPoints="points"
          pathPointLat={(point: object) => (point as TrackPoint).lat}
          pathPointLng={(point: object) => (point as TrackPoint).lng}
          pathPointAlt={(point: object) => Math.max(0.006, (point as TrackPoint).altitudeKm / 25_000)}
          pathColor={(path: object) =>
            (path as GroundTrackSegment).kind === 'past'
              ? 'rgba(82, 225, 255, 0.34)'
              : 'rgba(176, 111, 255, 0.82)'
          }
          pathStroke={1.1}
          pathDashLength={(path: object) => ((path as GroundTrackSegment).kind === 'future' ? 0.18 : 1)}
          pathDashGap={(path: object) => ((path as GroundTrackSegment).kind === 'future' ? 0.1 : 0)}
          pathDashAnimateTime={(path: object) => ((path as GroundTrackSegment).kind === 'future' ? 3_200 : 0)}
          labelsData={sites}
          labelLat="lat"
          labelLng="lng"
          labelText="label"
          labelColor={() => '#d8b4fe'}
          labelDotRadius={0.22}
          labelSize={0.75}
          labelAltitude={0.012}
          labelResolution={2}
          onLabelClick={focusLaunch}
          particlesData={starlinkData}
          particlesList={particlesList}
          particleLat={particleLat}
          particleLng={particleLng}
          particleAltitude={particleAltitude}
          // Deliberately dust-sized: at a device pixel ratio of 3 anything
          // larger renders as a chunky square and competes with the ISS marker.
          particlesSize={1.5}
          particlesColor={particlesColor}
          pointsData={observerData}
          pointLat="lat"
          pointLng="lng"
          pointAltitude={0.012}
          pointRadius={0.28}
          pointColor={() => '#f8fafc'}
          enablePointerInteraction
        />
      ) : null}
      <div className="globe-vignette pointer-events-none absolute inset-0" />
      <StarlinkToggle
        enabled={starlinkEnabled}
        count={starlink.count}
        ready={starlink.ready}
        isLoading={starlink.isLoading}
        error={starlink.error}
        onToggle={() => setStarlinkEnabled((current) => !current)}
      />
    </div>
  );
}
