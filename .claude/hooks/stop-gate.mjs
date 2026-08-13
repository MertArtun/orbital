#!/usr/bin/env node
import { loadRoadmap, loadState, objectiveById, stateFor } from '../../scripts/lib/goal-store.mjs';

const input = await new Promise((resolve) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => resolve(data));
});
let payload = {};
try { payload = JSON.parse(input || '{}'); } catch {}
if (payload.stop_hook_active) process.exit(0);

const state = loadState();
if (!state.activeObjective) process.exit(0);
const objective = objectiveById(state.activeObjective, loadRoadmap());
const execution = stateFor(objective.id, state);
if (['blocked', 'review_ready', 'pr_open', 'complete'].includes(execution.status)) process.exit(0);

process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: `Continue ${objective.id}. It is still ${execution.status}. Complete remaining tasks, verification, independent reviews, and normal PR merge; or record a hard external blocker before stopping.`,
}));
