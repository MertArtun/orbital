#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, loadRoadmap, loadState } from './lib/goal-store.mjs';

const ci = process.argv.includes('--ci');
const checks = [];

function commandVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout || result.stderr}`.trim();
}

function add(name, ok, detail, required = true) {
  checks.push({ name, ok, detail, required });
}

function requiredMajor(range, fallback) {
  const major = Number(String(range ?? '').match(/\d+/)?.[0]);
  return Number.isFinite(major) && major > 0 ? major : fallback;
}

const engines = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines ?? {};
const minNode = requiredMajor(engines.node, 22);
const minNpm = requiredMajor(engines.npm, 10);

const nodeMajor = Number(process.versions.node.split('.')[0]);
add('Node.js', nodeMajor >= minNode, `v${process.versions.node}; engines requires >=${minNode}`);
const npmVersion = commandVersion('npm');
const npmMajor = npmVersion ? Number(npmVersion.split('.')[0]) : Number.NaN;
add(
  'npm',
  Number.isFinite(npmMajor) && npmMajor >= minNpm,
  npmVersion ? `${npmVersion}; engines requires >=${minNpm}` : 'not found',
);
add('git', Boolean(commandVersion('git')), commandVersion('git') ?? 'not found');
add('dependencies', fs.existsSync(path.join(ROOT, 'node_modules')), fs.existsSync(path.join(ROOT, 'node_modules')) ? 'node_modules present' : 'run npm install', ci);
add('npm lockfile', fs.existsSync(path.join(ROOT, 'package-lock.json')), fs.existsSync(path.join(ROOT, 'package-lock.json')) ? 'present' : 'P1-00 will generate it', ci);

const claudeVersion = commandVersion('claude');
add('Claude Code', Boolean(claudeVersion), claudeVersion ?? 'not installed or not on PATH', false);
const ghVersion = commandVersion('gh');
add('GitHub CLI', Boolean(ghVersion), ghVersion ?? 'optional until PR shipping', false);
const vercelVersion = commandVersion('vercel');
add('Vercel CLI', Boolean(vercelVersion), vercelVersion ?? 'optional; Git integration can deploy', false);

let gitRepo = false;
let branch = 'not initialized';
let remote = 'none';
try {
  gitRepo = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
  branch = execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim() || '(detached)';
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { remote = 'none'; }
} catch {}
add('Git repository', gitRepo, gitRepo ? `branch ${branch}; origin ${remote}` : 'run bash scripts/init-repo.sh', false);

try {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8'));
  add('Agent teams flag', settings.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1');
  add('Auto permission mode', settings.permissions?.defaultMode === 'auto', `defaultMode=${settings.permissions?.defaultMode ?? 'unset'}`);
  add('Lead agent', settings.agent === 'orbital-lead', `agent=${settings.agent ?? 'unset'}`);
} catch (error) {
  add('Claude settings', false, error instanceof Error ? error.message : String(error));
}

try {
  const roadmap = loadRoadmap();
  const state = loadState();
  add('Goal ledger', roadmap.phases.length >= 3 && state.schemaVersion === 1, `${roadmap.phases.length} phases; active ${state.activeObjective ?? 'none'}`);
} catch (error) {
  add('Goal ledger', false, error instanceof Error ? error.message : String(error));
}

console.log('\nORBITAL doctor\n');
for (const check of checks) {
  const icon = check.ok ? '✓' : check.required ? '✗' : '!';
  console.log(`${icon} ${check.name.padEnd(20)} ${check.detail}`);
}
console.log('\n✓ ready   ✗ required, blocks execution   ! optional, does not block');

const failed = checks.filter((check) => check.required && !check.ok);
if (failed.length > 0) {
  console.error(`Doctor found ${failed.length} required problem(s).`);
  process.exitCode = 1;
} else {
  console.log('Required checks are ready.');
}
