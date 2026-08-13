#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, loadRoadmap, nowIso, objectiveById } from './lib/goal-store.mjs';
import { genericVerificationPlan, objectiveVerificationPlan } from './lib/verification-plan.mjs';

function flagValue(name) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.split('=').slice(1).join('=');
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function currentHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const args = new Set(process.argv.slice(2));
const mode = flagValue('mode') ?? (args.has('--fast') ? 'fast' : 'full');
const objectiveId = flagValue('objective');
const runAllE2e = args.has('--e2e') || process.env.ORBITAL_RUN_E2E === '1';
const quiet = args.has('--quiet');
const objective = objectiveId ? objectiveById(objectiveId, loadRoadmap()) : null;
const commands = objective
  ? objectiveVerificationPlan(objective, { runAllE2e })
  : genericVerificationPlan({ mode, runAllE2e });

if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  console.error('Verification requires installed dependencies. Run npm install first.');
  process.exit(1);
}

const report = {
  startedAt: nowIso(),
  mode: objective ? `objective:${objective.id}` : mode,
  objectiveId: objective?.id ?? null,
  e2e: runAllE2e,
  gitHead: currentHead(),
  commands: [],
  passed: false,
};
const reportPath = path.join(ROOT, '.artifacts/verification/last.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

function writeReport() {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

for (const command of commands) {
  if (!quiet) console.log(`\n▶ ${command}\n`);
  const started = Date.now();
  const result = spawnSync(command, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, CI: process.env.CI ?? '1' },
  });
  const entry = {
    command,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
  };
  report.commands.push(entry);
  if (entry.exitCode !== 0) {
    report.finishedAt = nowIso();
    report.finishedGitHead = currentHead();
    report.failedCommand = command;
    writeReport();
    console.error(`\nVerification failed: ${command}`);
    process.exit(entry.exitCode);
  }
}

report.finishedGitHead = currentHead();
if (report.gitHead && report.finishedGitHead !== report.gitHead) {
  report.finishedAt = nowIso();
  report.failedCommand = 'git HEAD changed during verification';
  writeReport();
  console.error('\nVerification invalidated: Git HEAD changed while checks were running.');
  process.exit(1);
}

report.passed = true;
report.finishedAt = nowIso();
writeReport();
console.log(
  `\n✓ ORBITAL verification passed (${objective ? objective.id : mode}${runAllE2e ? ' + all e2e' : ''}).`,
);
