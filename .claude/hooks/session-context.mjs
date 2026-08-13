#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import { activeObjective, loadRoadmap, loadState, nextReady, stateFor } from '../../scripts/lib/goal-store.mjs';

let branch = '(no git repository)';
let status = '';
try {
  branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || '(detached)';
  status = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim();
} catch {}

const roadmap = loadRoadmap();
const state = loadState();
const objective = activeObjective(roadmap, state) ?? nextReady({ phaseId: 'phase-1', roadmap, state });
const execution = objective ? stateFor(objective.id, state) : null;

console.log('<orbital-context>');
console.log(`Branch: ${branch}`);
console.log(`Working tree: ${status ? 'has changes — preserve and inspect them' : 'clean or not initialized'}`);
if (objective) {
  console.log(`Objective: ${objective.id} — ${objective.title}`);
  console.log(`Execution status: ${execution?.status ?? 'pending'}`);
  console.log(`Expected branch: ${objective.branch}`);
  console.log(`Next action: ${state.activeObjective ? 'resume active tasks' : `claim with npm run goals -- claim ${objective.id}`}`);
} else {
  console.log('No dependency-ready Phase 1 objective remains. Verify phase completion.');
}
console.log('Autonomy: do not ask product-choice questions; use tests, reviewers, and PR gates.');
console.log('</orbital-context>');
