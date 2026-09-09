'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';

import { StarlinkToggle } from '@/components/Globe/StarlinkToggle';
import { useElementSize } from '@/hooks/useElementSize';
import { useStarlink } from '@/hooks/useStarlink';
import type { Terminator } from '@/hooks/useTerminator';
import type { GroundTrackSegment, OrbitalPosition, TrackPoint } from '@/lib/propagation';
import { STARLINK_STRIDE } from '@/lib/starlink';
import type { Launch, ObserverLocation } from '@/lib/types';

type GlobeSceneProps = {
  position: OrbitalPosition | null;
  track: GroundTrackSegment[];
  launches: Launch[];
  observer: ObserverLocation;
  terminator: Terminator | null;
  onIssClick: () => void;
  at: number | null;
  /** Where the one-time intro should settle: a shared link's observer, or null for the ISS. */
  introFocus: { lat: number; lng: number } | null;
};

/**
 * The terminator rides the paths layer as one more polyline so it inherits the
 * ground track's great-circle interpolation and altitude accessors; carrying
 * TrackPoint-shaped points means those accessors need no branch of their own.
 */
type TerminatorPath = { id: string; kind: 'terminator'; points: TrackPoint[] };

type ScenePath = GroundTrackSegment | TerminatorPath;

/** One point marks the observer, the other the place the Sun is overhead. */
type ScenePoint = { kind: 'observer' | 'sun'; lat: number; lng: number };

/** One datum for the whole constellation; see starlinkDatumRef. */
type StarlinkDatum = { positions: Float32Array | null; count: number };

/** What the particles layer iterates: an offset into the batch buffer. */
type ParticleItem = { index: number };

const NO_PARTICLES: object[] = [];

/**
 * The one-time approach: where the camera opens, where it settles, and how
 * long it takes. Altitudes are in globe radii above the surface, so 3.1 to
 * 1.75 grows the globe by about half again -- far enough that the scene reads
 * as approached rather than nudged.
 *
 * The whole thing must be over within 2.4 s of the first fix. A moving camera
 * re-projects everything on the globe every frame, so e2e/globe.spec.ts ("ISS
 * marker interpolates between 1Hz propagation updates") and e2e/a11y.spec.ts
 * wait exactly 2.6 s for it to finish before they sample; an intro that ran
 * longer would answer their questions with camera motion. Hold plus flight is
 * 2.2 s, which leaves the ceiling some room and still fills the first viewport.
 */
const INTRO_START_ALTITUDE = 3.1;
const INTRO_SETTLE_ALTITUDE = 1.75;
const INTRO_HOLD_MS = 200;
const INTRO_FLIGHT_MS = 2_000;

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

export function GlobeScene({
  position,
  track,
  launches,
  observer,
  terminator,
  onIssClick,
  at,
  introFocus,
}: GlobeSceneProps) {
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
  const lastPropagatedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!position) {
      setIssData([]);
      return;
    }
    // The tween is for consecutive 1Hz fixes, where it is what makes the
    // marker glide. Any other spacing is the simulated clock being scrubbed,
    // and tweening a 90-minute jump would drag the marker across the globe
    // for a second per step -- the long way round across the antimeridian.
    // Setting the transition to 0 for that digest is not enough: the tween
    // started by the previous fix is still running and keeps writing its own
    // interpolated position over the snapped one until it completes. A fresh
    // datum instead makes the digest an exit and an enter, so the marker is
    // placed immediately and the old tween runs out on an object that has
    // left the scene.
    const propagatedAt = Date.parse(position.timestamp);
    const last = lastPropagatedAtRef.current;
    lastPropagatedAtRef.current = propagatedAt;
    const contiguous = last !== null && propagatedAt - last > 0 && propagatedAt - last <= 1_500;
    // Between fixes, mutate the one datum, then hand over a fresh array: the
    // new array makes react-globe.gl re-digest, while the unchanged datum
    // identity makes that digest an update (tween) instead of a teardown.
    const datum = contiguous ? issDatumRef.current : { lat: 0, lng: 0 };
    issDatumRef.current = datum;
    datum.lat = position.lat;
    datum.lng = position.lng;
    setIssData([datum]);
  }, [position]);

  const [starlinkEnabled, setStarlinkEnabled] = useState(false);
  const starlink = useStarlink(starlinkEnabled, at);

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

  /**
   * The night hemisphere as a single filled cap. Its identity may only change
   * when the terminator does: react-kapsule re-digests the polygons layer on
   * every forwarded prop, and at 1Hz a fresh array would rebuild the cap's
   * geometry every second.
   */
  const nightData = useMemo(
    () => (terminator ? [{ id: 'night', geometry: terminator.night }] : []),
    [terminator],
  );
  const nightCapColor = useCallback(() => 'rgba(3, 0, 20, 0.55)', []);
  // An empty string, not a transparent colour: three-globe builds the side
  // walls whenever the accessor returns anything truthy, and a transparent
  // torso from the surface to altitude is still a third more vertices.
  const nightSideColor = useCallback(() => '', []);
  const nightStrokeColor = useCallback(() => false, []);

  const paths = useMemo<ScenePath[]>(() => {
    if (!terminator) return track;
    return [
      ...track,
      {
        id: 'terminator',
        kind: 'terminator',
        points: terminator.curve.map(([lng, lat]) => ({
          lat,
          lng,
          altitudeKm: 0,
          timestamp: '',
        })),
      },
    ];
  }, [track, terminator]);

  const pathColor = useCallback((path: object) => {
    const kind = (path as ScenePath).kind;
    if (kind === 'terminator') return 'rgba(253, 224, 71, 0.42)';
    return kind === 'past' ? 'rgba(82, 225, 255, 0.34)' : 'rgba(176, 111, 255, 0.82)';
  }, []);
  const pathDashLength = useCallback((path: object) => {
    const kind = (path as ScenePath).kind;
    if (kind === 'terminator') return 0.03;
    return kind === 'future' ? 0.18 : 1;
  }, []);
  const pathDashGap = useCallback((path: object) => {
    const kind = (path as ScenePath).kind;
    if (kind === 'terminator') return 0.02;
    return kind === 'future' ? 0.1 : 0;
  }, []);
  // The terminator is a boundary, not a trajectory: animating its dashes would
  // read as travel along a line nothing travels along.
  const pathDashAnimateTime = useCallback(
    (path: object) => ((path as ScenePath).kind === 'future' ? 3_200 : 0),
    [],
  );

  // Rebuilt on every render otherwise, which re-digests the points layer at 1Hz.
  const pointsData = useMemo<ScenePoint[]>(
    () => [
      { ...observer, kind: 'observer' },
      ...(terminator
        ? [{ kind: 'sun' as const, lat: terminator.subsolar.lat, lng: terminator.subsolar.lng }]
        : []),
    ],
    [observer, terminator],
  );
  const pointColor = useCallback(
    (point: object) => ((point as ScenePoint).kind === 'sun' ? '#fde68a' : '#f8fafc'),
    [],
  );
  const pointRadius = useCallback(
    (point: object) => ((point as ScenePoint).kind === 'sun' ? 0.36 : 0.28),
    [],
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

  /**
   * <Globe> only renders once the container has a size, so on this component's
   * first commit the ref is still empty. Keyed on the mount as well as on the
   * position, the effect runs when there is a globe to configure — before this
   * it ran once against nothing and once after the first fix had already
   * switched the rotation off, so the idle rotation was never shown.
   *
   * Continuous OrbitControls change events rebuild three-globe's
   * behind-the-globe checker every frame, which would mask the P2-00 marker
   * defect: the build-in regression test in e2e/globe.spec.ts ("attaches the
   * marker when the TLE lands during the globe build-in") runs under reduced
   * motion, where this rotation must never start, and it must keep failing
   * against animateIn set to true. Re-verified as part of P2-04.
   */
  const globeMounted = width > 0 && height > 0;
  const [autoRotate, setAutoRotate] = useState(false);

  useEffect(() => {
    // The instance is bound by <Globe>'s own layout effect, which has run by
    // the time this passive effect fires for the render that mounted it.
    const globe = globeRef.current;
    if (!globeMounted || !globe) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const controls = globe.controls();
    controls.autoRotate = !hasPosition && !reducedMotion;
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
    setAutoRotate(controls.autoRotate);
  }, [globeMounted, hasPosition]);

  useEffect(() => {
    const handleFocusLaunch = (event: Event) => {
      const detail = (event as CustomEvent<{ lat: number; lng: number }>).detail;
      if (!detail || !globeRef.current) return;
      globeRef.current.pointOfView({ lat: detail.lat, lng: detail.lng, altitude: 1.55 }, 1_100);
    };
    window.addEventListener('orbital:focus-launch', handleFocusLaunch);
    return () => window.removeEventListener('orbital:focus-launch', handleFocusLaunch);
  }, []);

  /**
   * Read by the intro's timer rather than captured when it is scheduled: a
   * shared link's observer is resolved in a mount effect and can land a render
   * or two after the first fix, so the destination is only decided when the
   * flight starts. See the intro effect below.
   */
  const introFocusRef = useRef(introFocus);
  useEffect(() => {
    introFocusRef.current = introFocus;
  }, [introFocus]);

  /** Which branch the intro took, once it has taken it. For the e2e gate. */
  const [introTarget, setIntroTarget] = useState<'observer' | 'iss' | null>(null);

  /**
   * Cleared on unmount only. The 1 Hz clock is not aligned to the first fix, so
   * the second position can land a few tens of milliseconds after the first; a
   * cleanup keyed on `position` would then cancel the intro's own timer between
   * the opening frame and the flight, and the one-time guard means nothing
   * would restart it -- the camera would simply stay parked out at
   * INTRO_START_ALTITUDE.
   */
  const introTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(introTimerRef.current), []);

  useEffect(() => {
    if (!position || !globeRef.current || didCinematicIntro.current) return;
    didCinematicIntro.current = true;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Open on the station, far out. Doing this before the focus resolves is
    // safe because the opening shot is the same either way, and it is what
    // makes the hold below a beat rather than a stall.
    if (!reducedMotion) {
      globeRef.current.pointOfView(
        { lat: position.lat, lng: position.lng, altitude: INTRO_START_ALTITUDE },
        0,
      );
    }

    introTimerRef.current = window.setTimeout(() => {
      // One wait, two jobs: the beat the camera holds at its opening altitude
      // is also the grace `introFocus` gets to arrive. A focus that is still
      // null here is indistinguishable from no shared link at all, which is
      // the answer this branch wants anyway.
      const focus = introFocusRef.current;
      setIntroTarget(focus ? 'observer' : 'iss');
      // Somebody who opened a shared link is shown their own sky, centred.
      // Otherwise the station is the subject, held off-centre so the track
      // ahead of it has room.
      const destination = focus
        ? { lat: focus.lat, lng: focus.lng, altitude: INTRO_SETTLE_ALTITUDE }
        : { lat: position.lat - 8, lng: position.lng - 18, altitude: INTRO_SETTLE_ALTITUDE };
      globeRef.current?.pointOfView(destination, reducedMotion ? 0 : INTRO_FLIGHT_MS);
    }, INTRO_HOLD_MS);
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
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden rounded-[inherit]"
      // What the idle-rotation effect decided, for the e2e gate: an app-set
      // boolean, never upstream text.
      data-auto-rotate={autoRotate}
      // Which destination the one-time intro settled on, absent until it has
      // run. An app-set enum, never upstream text.
      data-intro-focus={introTarget ?? undefined}
    >
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
          polygonsData={nightData}
          polygonGeoJsonGeometry="geometry"
          polygonCapColor={nightCapColor}
          polygonSideColor={nightSideColor}
          polygonStrokeColor={nightStrokeColor}
          // Under the ISS ring (0.004) and the ground track's 0.006 floor, so
          // neither z-fights with the cap, and above the sag of a 6° cap facet
          // (about 0.0014 of the radius), so the cap never dips into the globe.
          polygonAltitude={0.003}
          // 6°: the cap is rebuilt once a minute and per paused scrub, and its
          // cost is quadratic in this resolution — 4° measured ~35 ms per
          // rebuild in isolation, 6° ~12 ms.
          polygonCapCurvatureResolution={6}
          polygonsTransitionDuration={0}
          pathsData={paths}
          pathPoints="points"
          pathPointLat={(point: object) => (point as TrackPoint).lat}
          pathPointLng={(point: object) => (point as TrackPoint).lng}
          pathPointAlt={(point: object) => Math.max(0.006, (point as TrackPoint).altitudeKm / 25_000)}
          pathColor={pathColor}
          pathStroke={1.1}
          pathDashLength={pathDashLength}
          pathDashGap={pathDashGap}
          pathDashAnimateTime={pathDashAnimateTime}
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
          pointsData={pointsData}
          pointLat="lat"
          pointLng="lng"
          pointAltitude={0.012}
          pointRadius={pointRadius}
          pointColor={pointColor}
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
