/// <reference lib="webworker" />

import {
  STARLINK_STRIDE,
  buildStarlinkFleet,
  propagateFleet,
  sampleStarlink,
  type StarlinkFleet,
  type StarlinkWorkerRequest,
  type StarlinkWorkerResponse,
} from '@/lib/starlink';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Built once on init and reused for every tick; satrecs are the expensive part. */
let fleet: StarlinkFleet | null = null;

function reply(response: StarlinkWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(response, transfer);
}

scope.onmessage = (event: MessageEvent<StarlinkWorkerRequest>) => {
  const request = event.data;

  if (request.type === 'init') {
    fleet = buildStarlinkFleet(sampleStarlink(request.records));
    reply({ type: 'ready', accepted: fleet.satrecs.length, invalid: fleet.invalid });
    return;
  }

  if (request.type !== 'propagate') return;

  const active = fleet;
  if (!active) {
    reply({
      type: 'error',
      message: 'Received a propagate request before the fleet was initialised.',
      seq: request.seq,
    });
    return;
  }

  try {
    // Allocated per tick rather than reused: the buffer is transferred, not
    // copied, so it is detached here the moment it is posted. At 800 satellites
    // that is a 9.6 KB allocation per second, which the nursery absorbs.
    const positions = new Float32Array(active.satrecs.length * STARLINK_STRIDE);
    const batch = propagateFleet(active, request.at, positions);

    reply(
      {
        type: 'batch',
        at: request.at,
        seq: request.seq,
        count: batch.count,
        skipped: batch.skipped,
        positions,
      },
      [positions.buffer],
    );
  } catch (error) {
    reply({
      type: 'error',
      message: error instanceof Error ? error.message : 'Starlink propagation failed.',
      seq: request.seq,
    });
  }
};

export {};
