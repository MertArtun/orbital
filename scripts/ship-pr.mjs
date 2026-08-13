#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, loadRoadmap, loadState, objectiveById, stateFor } from './lib/goal-store.mjs';
import { areaLabels, phaseLabel, roadmapIssueTitle } from './lib/github-roadmap.mjs';

function parseArgs(argv) {
  const flags = { merge: true };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--objective') flags.objective = argv[++index];
    else if (value.startsWith('--objective=')) flags.objective = value.split('=')[1];
    else if (value === '--no-merge') flags.merge = false;
    else if (value === '--draft') flags.draft = true;
  }
  return flags;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  });
  if (result.status !== 0) {
    const stderr = options.capture ? String(result.stderr ?? '').trim() : '';
    throw new Error(
      `${command} ${args.join(' ')} failed with exit ${result.status ?? 1}${stderr ? `: ${stderr}` : ''}.`,
    );
  }
  return options.capture ? String(result.stdout).trim() : '';
}

function commandAvailable(command) {
  return spawnSync(command, ['--version'], { cwd: ROOT, stdio: 'ignore' }).status === 0;
}

function globToRegExp(pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];
    if (character === '*' && next === '*') {
      if (pattern[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += '^$+?.()|{}[]\\'.includes(character) ? `\\${character}` : character;
    }
  }
  return new RegExp(`${expression}$`);
}

function assertAllowedPaths(objective) {
  const mergeBase = run('git', ['merge-base', 'main', 'HEAD'], { capture: true });
  const changed = run('git', ['diff', '--name-only', '--no-renames', `${mergeBase}..HEAD`], {
    capture: true,
  })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
  if (changed.length === 0) throw new Error('The objective branch contains no committed file changes.');
  const patterns = objective.allowedPaths.map((pattern) => ({ pattern, regex: globToRegExp(pattern) }));
  const outside = changed.filter((file) => !patterns.some(({ regex }) => regex.test(file)));
  if (outside.length > 0) {
    throw new Error(
      `Objective ${objective.id} changed files outside its tracked ownership boundary:\n${outside.map((file) => `- ${file}`).join('\n')}\n` +
        `Allowed paths: ${objective.allowedPaths.join(', ')}`,
    );
  }
  return { changed, mergeBase };
}

function assertConventionalCommits(mergeBase) {
  const subjects = run('git', ['log', '--format=%s', `${mergeBase}..HEAD`], { capture: true })
    .split(/\r?\n/)
    .map((subject) => subject.trim())
    .filter(Boolean);
  const conventional = /^(?:feat|fix|test|refactor|docs|ci|chore|perf|build|revert)(?:\([^)]+\))?!?: .+/;
  const invalid = subjects.filter((subject) => !conventional.test(subject) && !subject.startsWith('Merge '));
  if (subjects.length === 0) throw new Error('The objective branch contains no commits.');
  if (invalid.length > 0) {
    throw new Error(
      `Non-conventional commit subjects found:\n${invalid.map((subject) => `- ${subject}`).join('\n')}`,
    );
  }
  return subjects;
}

function requiredTddEvidence(objective, execution) {
  if (objective.tddRequired === false) return { red: [], green: [] };
  const evidence = execution.evidence ?? [];
  const red = evidence.filter((item) => item.kind === 'red-test');
  const green = evidence.filter((item) => item.kind === 'green-test');
  if (red.length === 0 || green.length === 0) {
    throw new Error(
      `${objective.id} requires recorded red-test and green-test evidence before review. ` +
        `Use npm run goals -- evidence ${objective.id} --kind red-test --value "<command and observed failure>" and the corresponding green-test command.`,
    );
  }
  const firstRed = Math.min(...red.map((item) => Date.parse(item.at)).filter(Number.isFinite));
  const lastGreen = Math.max(...green.map((item) => Date.parse(item.at)).filter(Number.isFinite));
  if (!Number.isFinite(firstRed) || !Number.isFinite(lastGreen) || firstRed > lastGreen) {
    throw new Error('TDD evidence is malformed or records green before red.');
  }
  return { red, green };
}

function findRoadmapIssue(objective) {
  try {
    const issues = JSON.parse(
      run('gh', ['issue', 'list', '--state', 'all', '--limit', '200', '--json', 'number,title,state,url'], {
        capture: true,
      }),
    );
    return Array.isArray(issues)
      ? issues.find((issue) => issue.title === roadmapIssueTitle(objective)) ?? null
      : null;
  } catch {
    return null;
  }
}

function markReviewReady(id, reason) {
  run('node', ['scripts/goals.mjs', 'review-ready', id, '--reason', reason]);
  console.error(`${reason}\nLocal gates passed. Continue with: npm run ship:pr -- --objective ${id}`);
  process.exit(2);
}

const flags = parseArgs(process.argv.slice(2));
const roadmap = loadRoadmap();
const state = loadState();
const id = flags.objective ?? state.activeObjective;
if (!id) throw new Error('No objective supplied and no active objective exists.');
const objective = objectiveById(id, roadmap);
const execution = stateFor(id, state);

const branch = run('git', ['branch', '--show-current'], { capture: true });
if (!branch || ['main', 'master'].includes(branch)) {
  throw new Error('PR shipping must run from an objective branch, never main/master.');
}
if (branch !== objective.branch) throw new Error(`Expected branch ${objective.branch}, found ${branch}.`);
const head = run('git', ['rev-parse', 'HEAD'], { capture: true });
const { changed: changedFiles, mergeBase } = assertAllowedPaths(objective);
const commitSubjects = assertConventionalCommits(mergeBase);
const tddEvidence = requiredTddEvidence(objective, execution);

const requiredReviewers = roadmap.policy?.requiredReviews ?? ['qa-gatekeeper', 'pr-reviewer'];
const reviews = (execution.evidence ?? []).filter((item) => item.kind === 'review');
const approvedReviews = requiredReviewers.map((reviewer) =>
  [...reviews]
    .reverse()
    .find(
      (item) =>
        item.reviewer === reviewer &&
        item.verdict === 'APPROVE' &&
        item.sha === head,
    ),
);
const missingReviewers = requiredReviewers.filter((_, index) => !approvedReviews[index]);
if (missingReviewers.length > 0) {
  throw new Error(
    `Current commit ${head.slice(0, 12)} needs APPROVE evidence from: ${missingReviewers.join(', ')}. ` +
      `Record each with npm run goals -- review ${id} --reviewer <name> --verdict APPROVE --sha ${head} --summary "...".`,
  );
}

run('node', ['scripts/verify.mjs', `--objective=${id}`]);
run('node', ['scripts/goals.mjs', 'verify', id, '--report', '.artifacts/verification/last.json']);

const dirty = run('git', ['status', '--porcelain'], { capture: true });
if (dirty) throw new Error(`Tracked worktree is not clean. Commit meaningful changes before shipping:\n${dirty}`);

let remote;
try {
  remote = run('git', ['remote', 'get-url', 'origin'], { capture: true });
} catch {
  markReviewReady(id, 'Git remote origin is unavailable.');
}
if (!remote) markReviewReady(id, 'Git remote origin is unavailable.');
if (!commandAvailable('gh')) markReviewReady(id, 'GitHub CLI is unavailable.');
if (spawnSync('gh', ['auth', 'status'], { cwd: ROOT, stdio: 'ignore' }).status !== 0) {
  markReviewReady(id, 'GitHub CLI is not authenticated for this repository.');
}

run('git', ['fetch', 'origin', 'main']);
if (spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { cwd: ROOT, stdio: 'ignore' }).status !== 0) {
  throw new Error('The objective branch is not based on current origin/main. Integrate main, rerun reviews, and ship again.');
}
run('git', ['push', '-u', 'origin', branch]);
const roadmapIssue = findRoadmapIssue(objective);

const reportPath = path.join(ROOT, '.artifacts/verification/last.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
const body = [
  '## Objective',
  `**${objective.id} — ${objective.title}**`,
  '',
  objective.prompt,
  '',
  '## Acceptance mapping',
  ...objective.acceptance.map((item) => `- [x] ${item}`),
  '',
  '## Commits',
  ...commitSubjects.map((subject) => `- ${subject}`),
  '',
  '## Changed files',
  ...changedFiles.map((file) => `- \`${file}\``),
  '',
  '## TDD evidence',
  ...(objective.tddRequired === false
    ? ['- TDD evidence is not required for this toolchain/documentation objective.']
    : [
        ...tddEvidence.red.map((item) => `- RED — ${item.value}`),
        ...tddEvidence.green.map((item) => `- GREEN — ${item.value}`),
      ]),
  '',
  '## Verification',
  ...(report?.commands?.map(
    (item) => `- \`${item.command}\` — exit ${item.exitCode} (${item.durationMs} ms)`,
  ) ?? objective.verify.map((item) => `- \`${item}\``)),
  '',
  '## Independent review',
  ...approvedReviews.map((item) => `- ${item.value}`),
  '',
  '## Resilience and risk',
  '- Upstream failures retain intentional loading/stale/error states.',
  '- No branch protection, tests, or type checks were bypassed.',
  '',
  '## Visual evidence',
  '- Current desktop/mobile artifacts are attached for UI objectives when produced by Playwright.',
  '',
  roadmapIssue?.state === 'OPEN'
    ? `Closes #${roadmapIssue.number}`
    : `Roadmap objective: ${objective.id}`,
].join('\n');
const bodyFile = path.join(os.tmpdir(), `orbital-${id}-pr.md`);
fs.writeFileSync(bodyFile, body);

let prUrl = execution.prUrl;
if (!prUrl) {
  const createArgs = [
    'pr',
    'create',
    '--base',
    'main',
    '--head',
    branch,
    '--title',
    objective.prTitle,
    '--body-file',
    bodyFile,
  ];
  if (flags.draft) createArgs.push('--draft');
  prUrl = run('gh', createArgs, { capture: true }).split(/\r?\n/).at(-1);
  if (!prUrl) throw new Error('GitHub did not return a PR URL.');
  const number = run('gh', ['pr', 'view', prUrl, '--json', 'number', '--jq', '.number'], {
    capture: true,
  });
  run('node', ['scripts/goals.mjs', 'record-pr', id, '--url', prUrl, '--number', number]);
  for (const label of [phaseLabel(objective), ...areaLabels(objective)]) {
    try {
      run('gh', ['pr', 'edit', prUrl, '--add-label', label]);
    } catch {
      console.warn(`PR created, but label ${label} could not be attached automatically.`);
    }
  }
}

console.log(`PR: ${prUrl}`);
if (!flags.merge || flags.draft) process.exit(0);

run('gh', ['pr', 'checks', prUrl, '--watch', '--interval', '10']);
run('gh', ['pr', 'merge', prUrl, '--squash', '--delete-branch']);

const merged = JSON.parse(
  run('gh', ['pr', 'view', prUrl, '--json', 'state,mergeCommit,url'], { capture: true }),
);
if (merged.state !== 'MERGED' || !merged.mergeCommit?.oid) {
  throw new Error('PR merge was not confirmed by GitHub.');
}
run('node', ['scripts/goals.mjs', 'complete', id, '--pr', merged.url, '--sha', merged.mergeCommit.oid]);
run('git', ['checkout', 'main']);
run('git', ['pull', '--ff-only', 'origin', 'main']);
console.log(`✓ ${id} merged and synchronized.`);
