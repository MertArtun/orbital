#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { activeObjective, flattenObjectives, loadRoadmap, loadState, nextReady, stateFor, statusOf } from './lib/goal-store.mjs';

function parseArgs(argv) {
  const result = { phase: 'phase-1', allPhases: false, once: false, dryRun: false, maxObjectives: Infinity, maxBudget: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--once') result.once = true;
    else if (value === '--dry-run') result.dryRun = true;
    else if (value === '--all-phases') result.allPhases = true;
    else if (value === '--phase') result.phase = argv[++index];
    else if (value.startsWith('--phase=')) result.phase = value.split('=')[1];
    else if (value === '--max-objectives') result.maxObjectives = Number(argv[++index]);
    else if (value.startsWith('--max-objectives=')) result.maxObjectives = Number(value.split('=')[1]);
    else if (value === '--max-budget-usd') result.maxBudget = argv[++index];
    else if (value.startsWith('--max-budget-usd=')) result.maxBudget = value.split('=')[1];
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
const configuredRoadmap = loadRoadmap();
if (!configuredRoadmap.phases.some((phase) => phase.id === options.phase)) {
  console.error(`Unknown phase: ${options.phase}`);
  process.exit(1);
}
const hasClaude = spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0;
if (!hasClaude && !options.dryRun) {
  console.error('Claude Code is not available on PATH. Install/authenticate it, then rerun this command.');
  process.exit(1);
}

let processed = 0;
let phaseId = options.phase;
while (processed < options.maxObjectives) {
  const roadmap = loadRoadmap();
  const state = loadState();
  const active = activeObjective(roadmap, state);
  let objective = active ?? nextReady({ phaseId, roadmap, state });

  if (!objective && options.allPhases) {
    const phaseIndex = roadmap.phases.findIndex((phase) => phase.id === phaseId);
    if (phaseIndex < 0) {
      console.error(`Unknown phase: ${phaseId}`);
      process.exit(1);
    }
    const phaseObjectives = flattenObjectives(roadmap).filter((item) => item.phaseId === phaseId);
    const phaseComplete = phaseObjectives.every((item) => statusOf(item.id, state) === 'complete');
    const nextPhase = phaseComplete ? roadmap.phases[phaseIndex + 1] : null;
    if (nextPhase) {
      console.log(`\n✓ ${phaseId} complete. Advancing to ${nextPhase.id}.`);
      phaseId = nextPhase.id;
      objective = nextReady({ phaseId, roadmap, state });
    } else if (phaseComplete) {
      console.log(`\n✓ ${options.allPhases ? 'All roadmap phases' : phaseId} complete.`);
      break;
    }
  }

  if (!objective) {
    console.log(`No dependency-ready objective remains in ${phaseId}. Run npm run goals -- status for details.`);
    break;
  }

  if (!active && !options.dryRun) {
    const claim = spawnSync('node', ['scripts/goals.mjs', 'claim', objective.id], { stdio: 'inherit' });
    if (claim.status !== 0) process.exit(claim.status ?? 1);
  }

  const condition = [
    `Objective ${objective.id} (${objective.title}) is complete only when:`,
    ...objective.acceptance.map((item) => `- ${item}`),
    `- every verification command exits 0: ${objective.verify.join(' && ')}`,
    '- independent QA and PR reviews have no blocking findings',
    '- the objective branch is merged through a GitHub PR and local goal state is synchronized',
  ].join('\n');
  const prompt = `\nRun /orbital-autopilot for exactly this active objective.\n\n${condition}\n\nImplementation brief: ${objective.prompt}\n\nAllowed paths: ${objective.allowedPaths.join(', ')}. Do not ask product-choice questions. Continue until merged or record a hard external blocker. Use TDD, meaningful conventional commits, independent reviewers, and normal branch protection; never bypass checks.`;

  console.log(`\n=== ${objective.id}: ${objective.title} ===\n`);
  if (options.dryRun) {
    console.log(prompt);
    break;
  }

  const claudeArgs = [
    '-p',
    '--agent', 'orbital-lead',
    '--permission-mode', 'auto',
    '--teammate-mode', 'in-process',
    '--max-turns', '320',
    '--output-format', 'text',
  ];
  if (options.maxBudget) claudeArgs.push('--max-budget-usd', String(options.maxBudget));
  claudeArgs.push(prompt);

  const run = spawnSync('claude', claudeArgs, {
    stdio: 'inherit',
    env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' },
  });
  if (run.status !== 0) {
    console.error(`Claude Code exited with ${run.status ?? 'an unknown status'} while executing ${objective.id}.`);
    process.exit(run.status ?? 1);
  }

  const after = loadState();
  const execution = stateFor(objective.id, after);
  if (execution.status === 'pr_open') {
    spawnSync('node', ['scripts/goals.mjs', 'sync', objective.id], { stdio: 'inherit' });
  }
  const finalExecution = stateFor(objective.id, loadState());
  if (finalExecution.status !== 'complete') {
    console.log(`${objective.id} ended in ${finalExecution.status}. Autopilot will not stack work on an unmerged base.`);
    break;
  }

  processed += 1;
  if (options.once) break;
}
