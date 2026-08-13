'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';

import { useElementSize } from '@/hooks/useElementSize';
import type { GroundTrackSegment, OrbitalPosition, TrackPoint } from '@/lib/propagation';
import type { Launch, ObserverLocation } from '@/lib/types';

type GlobeSceneProps = {
  position: OrbitalPosition | null;
  track: GroundTrackSegment[];
  launches: Launch[];
  observer: ObserverLocation;
  onIssClick: () => void;
};

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
          backgroundColor="#030014"
          backgroundImageUrl="/textures/night-sky.png"
          globeImageUrl="/textures/earth-night.jpg"
          bumpImageUrl="/textures/earth-topology.png"
          showAtmosphere
          atmosphereColor="#7cecff"
          atmosphereAltitude={0.16}
          htmlElementsData={position ? [position] : []}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude={0.028}
          htmlElement={makeIssElement}
          htmlTransitionDuration={850}
          ringsData={position ? [position] : []}
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
          pointsData={[{ ...observer, kind: 'observer' }]}
          pointLat="lat"
          pointLng="lng"
          pointAltitude={0.012}
          pointRadius={0.28}
          pointColor={() => '#f8fafc'}
          enablePointerInteraction
        />
      ) : null}
      <div className="globe-vignette pointer-events-none absolute inset-0" />
    </div>
  );
}
