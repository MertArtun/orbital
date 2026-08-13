import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const ROADMAP_PATH = path.join(ROOT, 'goals/roadmap.json');
export const STATE_PATH = path.join(ROOT, 'goals/state.json');
export const STATE_EXAMPLE_PATH = path.join(ROOT, 'goals/state.example.json');

export function nowIso() {
  return new Date().toISOString();
}

export function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadRoadmap() {
  return loadJson(ROADMAP_PATH);
}

export function initialState() {
  return {
    schemaVersion: 1,
    activeObjective: null,
    objectives: {},
    history: [],
    lastUpdated: nowIso(),
  };
}

export function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    const seed = fs.existsSync(STATE_EXAMPLE_PATH) ? loadJson(STATE_EXAMPLE_PATH) : initialState();
    writeState(seed);
    return seed;
  }
  return loadJson(STATE_PATH);
}

export function writeState(state) {
  state.lastUpdated = nowIso();
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const temp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, STATE_PATH);
}

export function flattenObjectives(roadmap = loadRoadmap()) {
  return roadmap.phases.flatMap((phase) =>
    phase.objectives.map((objective, index) => ({
      ...objective,
      phaseId: phase.id,
      phaseName: phase.name,
      order: index,
    })),
  );
}

export function objectiveById(id, roadmap = loadRoadmap()) {
  const objective = flattenObjectives(roadmap).find((item) => item.id === id);
  if (!objective) throw new Error(`Unknown objective: ${id}`);
  return objective;
}

export function stateFor(id, state = loadState()) {
  return state.objectives[id] ?? { status: 'pending', evidence: [] };
}

export function statusOf(id, state = loadState()) {
  return stateFor(id, state).status ?? 'pending';
}

export function dependenciesComplete(objective, state = loadState()) {
  return objective.dependencies.every((id) => statusOf(id, state) === 'complete');
}

export function nextReady({ phaseId, roadmap = loadRoadmap(), state = loadState() } = {}) {
  const objectives = flattenObjectives(roadmap).filter((objective) => !phaseId || objective.phaseId === phaseId);
  return objectives.find((objective) => {
    const status = statusOf(objective.id, state);
    return ['pending', 'verified'].includes(status) && dependenciesComplete(objective, state);
  }) ?? null;
}

export function activeObjective(roadmap = loadRoadmap(), state = loadState()) {
  return state.activeObjective ? objectiveById(state.activeObjective, roadmap) : null;
}

export function mutateObjective(id, mutate, eventType, eventDetails = {}) {
  const roadmap = loadRoadmap();
  objectiveById(id, roadmap);
  const state = loadState();
  const previous = stateFor(id, state);
  const next = mutate({ ...previous, evidence: [...(previous.evidence ?? [])] }, state);
  next.updatedAt = nowIso();
  state.objectives[id] = next;
  state.history.push({ at: nowIso(), objectiveId: id, type: eventType, ...eventDetails });
  writeState(state);
  return { state, objective: objectiveById(id, roadmap), execution: next };
}

export function addEvidence(id, kind, value) {
  if (!kind || !value) throw new Error('Evidence requires both kind and value.');
  return mutateObjective(
    id,
    (execution) => {
      execution.evidence.push({ kind, value, at: nowIso() });
      return execution;
    },
    'evidence',
    { kind },
  );
}

export function phaseSummary(phaseId, roadmap = loadRoadmap(), state = loadState()) {
  const objectives = flattenObjectives(roadmap).filter((item) => item.phaseId === phaseId);
  const counts = {};
  for (const objective of objectives) {
    const status = statusOf(objective.id, state);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return { total: objectives.length, counts };
}
