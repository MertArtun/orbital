#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { flattenObjectives, loadRoadmap } from './lib/goal-store.mjs';
import { areaLabels, phaseLabel, roadmapIssueBody, roadmapIssueTitle } from './lib/github-roadmap.mjs';

const protectMain = process.argv.includes('--protect-main');
const requireHumanReview = process.argv.includes('--require-human-review');
const createRoadmapIssues = !process.argv.includes('--skip-roadmap-issues');
function run(args, allowFailure = false) {
  const result = spawnSync('gh', args, { stdio: 'inherit' });
  if (!allowFailure && result.status !== 0) process.exit(result.status ?? 1);
  return result.status === 0;
}

if (spawnSync('gh', ['auth', 'status'], { stdio: 'inherit' }).status !== 0) {
  console.error('Authenticate GitHub CLI first: gh auth login');
  process.exit(1);
}

const labels = [
  ['phase:1', 'MVP work', '0E8A8A'],
  ['phase:2', 'Differentiator work', '8250DF'],
  ['phase:3', 'Showcase polish', 'C084FC'],
  ['area:orbital-math', 'Propagation and passes', '1D76DB'],
  ['area:3d-globe', 'Globe and rendering', '67E8F9'],
  ['area:data', 'External data gateways', '0052CC'],
  ['quality-gate', 'Testing, a11y, resilience', 'FBCA04'],
  ['agent-ready', 'Safe for autonomous execution', '2DA44E'],
  ['blocked', 'External blocker', 'B60205'],
];
for (const [name, description, color] of labels) {
  run(['label', 'create', name, '--description', description, '--color', color, '--force'], true);
}
run(['repo', 'edit', '--enable-auto-merge', '--delete-branch-on-merge'], true);

if (createRoadmapIssues) {
  let existing = null;
  try {
    existing = JSON.parse(
      execFileSync('gh', ['issue', 'list', '--state', 'all', '--limit', '200', '--json', 'number,title,state,url'], {
        encoding: 'utf8',
      }),
    );
  } catch {
    console.warn('Existing roadmap issues could not be listed; issue publication is skipped.');
  }

  if (existing !== null && Array.isArray(existing)) {
    for (const objective of flattenObjectives(loadRoadmap())) {
      const title = roadmapIssueTitle(objective);
      const match = existing.find((issue) => issue.title === title);
      if (match) {
        console.log(`Roadmap issue exists: #${match.number} ${title}`);
        continue;
      }
      const bodyFile = path.join(os.tmpdir(), `orbital-${objective.id}-issue.md`);
      fs.writeFileSync(bodyFile, roadmapIssueBody(objective));
      const labelsForIssue = [phaseLabel(objective), 'agent-ready', ...areaLabels(objective)];
      const args = ['issue', 'create', '--title', title, '--body-file', bodyFile];
      for (const label of labelsForIssue) args.push('--label', label);
      if (run(args, true)) console.log(`Published roadmap issue: ${title}`);
    }
  }
}

if (protectMain) {
  const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8' }).trim();
  const payload = JSON.stringify({
    // Must match the check names GitHub reports, which for a matrix job are
    // "<job name> (<matrix value>)". Renaming a CI job without updating this
    // list pins every pull request on a check that can never report.
    required_status_checks: {
      strict: true,
      contexts: ['quality', 'build', 'e2e (desktop-chromium)', 'e2e (mobile-375)'],
    },
    enforce_admins: false,
    required_pull_request_reviews: {
      required_approving_review_count: requireHumanReview ? 1 : 0,
      dismiss_stale_reviews: true,
    },
    restrictions: null,
    required_conversation_resolution: true,
    allow_force_pushes: false,
    allow_deletions: false,
  });
  const result = spawnSync(
    'gh',
    ['api', '--method', 'PUT', `repos/${repo}/branches/main/protection`, '--input', '-'],
    { input: payload, stdio: ['pipe', 'inherit', 'inherit'], encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.warn('Main protection could not be applied automatically. Verify repository plan/permissions, then configure Settings → Branches manually.');
  } else {
    console.log(`Main branch protection is enabled${requireHumanReview ? ' with one required human approval' : ' with CI-gated PRs and no mandatory human approval'}.`);
  }
}

console.log(`GitHub labels, merge settings${createRoadmapIssues ? ', and roadmap issues' : ''} are configured.`);
