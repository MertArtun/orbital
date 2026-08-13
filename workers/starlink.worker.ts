/// <reference lib="webworker" />

import { buildSatrec, propagateSatrec } from '@/lib/propagation';
import type { TleRecord } from '@/lib/types';

type WorkerRequest = {
  type: 'propagate';
  at: string;
  records: TleRecord[];
};

type WorkerPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  altitudeKm: number;
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== 'propagate') return;
  const at = new Date(event.data.at);
  const points: WorkerPoint[] = [];

  for (const record of event.data.records.slice(0, 800)) {
    try {
      const position = propagateSatrec(buildSatrec(record), at);
      points.push({
        id: record.noradId,
        name: record.name,
        lat: position.lat,
        lng: position.lng,
        altitudeKm: position.altitudeKm,
      });
    } catch {
      // One malformed record must never fail the full batch.
    }
  }

  self.postMessage({ type: 'positions', at: event.data.at, points });
};

export {};
