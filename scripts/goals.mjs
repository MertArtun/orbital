#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  ROOT,
  activeObjective,
  addEvidence,
  dependenciesComplete,
  flattenObjectives,
  loadRoadmap,
  loadState,
  mutateObjective,
  nextReady,
  nowIso,
  objectiveById,
  phaseSummary,
  stateFor,
  statusOf,
  writeState,
} from './lib/goal-store.mjs';
import { objectiveVerificationPlan } from './lib/verification-plan.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const [rawKey, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) {
      flags[rawKey] = inline;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      flags[rawKey] = argv[index + 1];
      index += 1;
    } else {
      flags[rawKey] = true;
    }
  }
  return { positional, flags };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function commandStatus(flags) {
  const roadmap = loadRoadmap();
  const state = loadState();
  const objectives = flattenObjectives(roadmap);
  if (flags.json) {
    printJson({ activeObjective: state.activeObjective, objectives: objectives.map((objective) => ({
      id: objective.id,
      phase: objective.phaseId,
      title: objective.title,
      status: statusOf(objective.id, state),
      dependenciesReady: dependenciesComplete(objective, state),
      branch: objective.branch,
      execution: state.objectives[objective.id] ?? null,
    })) });
    return;
  }

  console.log(`\nORBITAL goal ledger${state.activeObjective ? ` — active ${state.activeObjective}` : ''}\n`);
  for (const phase of roadmap.phases) {
    const summary = phaseSummary(phase.id, roadmap, state);
    const complete = summary.counts.complete ?? 0;
    console.log(`${phase.id.padEnd(8)} ${phase.name} (${complete}/${summary.total} complete)`);
    for (const objective of phase.objectives) {
      const status = statusOf(objective.id, state);
      const ready = dependenciesComplete(objective, state);
      const marker = status === 'complete' ? '✓' : status === 'blocked' ? '!' : status === 'in_progress' ? '→' : ready ? '○' : '·';
      console.log(`  ${marker} ${objective.id.padEnd(6)} ${status.padEnd(12)} ${objective.title}`);
    }
    console.log('');
  }
}

function commandNext(flags) {
  const state = loadState();
  const active = activeObjective(loadRoadmap(), state);
  const objective = active ?? nextReady({ phaseId: flags.phase, state });
  if (!objective) {
    if (flags.json) printJson(null);
    else console.log('No dependency-ready objective found.');
    return;
  }
  if (flags.json) printJson(objective);
  else console.log(`${objective.id}\t${objective.title}\t${objective.branch}`);
}

function commandClaim(id, flags) {
  const roadmap = loadRoadmap();
  const objective = objectiveById(id, roadmap);
  const state = loadState();
  if (state.activeObjective && state.activeObjective !== id && !flags.force) {
    throw new Error(`Objective ${state.activeObjective} is already active. Complete, block, or release it first.`);
  }
  if (!dependenciesComplete(objective, state) && !flags.force) {
    throw new Error(`Dependencies are incomplete: ${objective.dependencies.filter((dep) => statusOf(dep, state) !== 'complete').join(', ')}`);
  }
  const current = stateFor(id, state);
  if (current.status === 'complete') throw new Error(`${id} is already complete.`);
  state.activeObjective = id;
  state.objectives[id] = {
    ...current,
    status: 'in_progress',
    branch: objective.branch,
    startedAt: current.startedAt ?? nowIso(),
    updatedAt: nowIso(),
    evidence: current.evidence ?? [],
    blocker: null,
  };
  state.history.push({ at: nowIso(), objectiveId: id, type: 'claimed' });
  writeState(state);
  console.log(`Claimed ${id}: ${objective.title}`);
}

function commandRelease(id) {
  const state = loadState();
  if (state.activeObjective !== id) throw new Error(`${id} is not active.`);
  state.activeObjective = null;
  state.history.push({ at: nowIso(), objectiveId: id, type: 'released' });
  writeState(state);
  console.log(`Released ${id}; execution state is preserved.`);
}

function currentHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('A Git commit is required before recording verification or review evidence.');
  }
}

function commandVerify(id, flags) {
  const report = String(flags.report ?? '.artifacts/verification/last.json');
  const reportPath = path.resolve(ROOT, report);
  if (!fs.existsSync(reportPath)) throw new Error(`Verification report not found: ${report}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    throw new Error(`Verification report is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.passed !== true || !Array.isArray(parsed.commands) || parsed.commands.length === 0) {
    throw new Error('Verification report does not record a passed command matrix.');
  }
  const failed = parsed.commands.find((entry) => Number(entry?.exitCode) !== 0);
  if (failed) throw new Error(`Verification report contains a failed command: ${failed.command ?? 'unknown'}`);
  const sha = currentHead();
  const objective = objectiveById(id, loadRoadmap());
  if (parsed.objectiveId !== id) {
    throw new Error(`Verification report belongs to ${parsed.objectiveId ?? 'no objective'}, not ${id}.`);
  }
  if (parsed.gitHead !== sha || parsed.finishedGitHead !== sha) {
    throw new Error('Verification report is stale: its start/end Git SHA does not match current HEAD.');
  }
  const expectedCommands = objectiveVerificationPlan(objective, { runAllE2e: parsed.e2e === true });
  const reportedCommands = parsed.commands.map((entry) => String(entry?.command ?? ''));
  if (JSON.stringify(reportedCommands) !== JSON.stringify(expectedCommands)) {
    throw new Error('Verification report command matrix does not match the tracked objective plan.');
  }

  mutateObjective(
    id,
    (execution) => {
      execution.status = 'verified';
      execution.verifiedAt = nowIso();
      execution.verifiedCommit = sha;
      execution.evidence.push({ kind: 'verification', value: report, sha, at: nowIso() });
      return execution;
    },
    'verified',
    { report, sha },
  );
  console.log(`Marked ${id} verified at ${sha.slice(0, 12)} with ${report}.`);
}

function commandReview(id, flags) {
  const roadmap = loadRoadmap();
  const reviewer = String(flags.reviewer ?? '');
  const verdict = String(flags.verdict ?? '').toUpperCase();
  const summary = String(flags.summary ?? '').trim();
  const allowedReviewers = roadmap.policy?.requiredReviews ?? [];
  if (!allowedReviewers.includes(reviewer)) {
    throw new Error(`Reviewer must be one of: ${allowedReviewers.join(', ')}.`);
  }
  if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(verdict)) {
    throw new Error('Review verdict must be APPROVE, REQUEST_CHANGES, or COMMENT.');
  }
  if (!summary) throw new Error('Review requires --summary with observed findings.');
  const sha = String(flags.sha ?? currentHead());
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error('Review requires a valid commit SHA.');
  const value = `${reviewer}: ${verdict} @ ${sha.slice(0, 12)} — ${summary}`;
  mutateObjective(
    id,
    (execution) => {
      execution.evidence.push({ kind: 'review', reviewer, verdict, sha, summary, value, at: nowIso() });
      return execution;
    },
    'review_recorded',
    { reviewer, verdict, sha },
  );
  console.log(`Recorded ${reviewer} ${verdict} for ${id} at ${sha.slice(0, 12)}.`);
}

function commandReviewReady(id, flags) {
  mutateObjective(
    id,
    (execution, state) => {
      execution.status = 'review_ready';
      execution.reviewReadyAt = nowIso();
      if (flags.reason) execution.reviewReadyReason = String(flags.reason);
      state.activeObjective = id;
      return execution;
    },
    'review_ready',
  );
  console.log(`${id} is review-ready but not complete; dependencies remain locked until merge.`);
}

function commandRecordPr(id, flags) {
  const url = String(flags.url ?? '');
  if (!/^https:\/\/github\.com\//.test(url)) throw new Error('A GitHub PR URL is required via --url.');
  mutateObjective(
    id,
    (execution, state) => {
      execution.status = 'pr_open';
      execution.prUrl = url;
      execution.prNumber = flags.number ? Number(flags.number) : execution.prNumber;
      execution.prOpenedAt = nowIso();
      execution.evidence.push({ kind: 'pr', value: url, at: nowIso() });
      state.activeObjective = id;
      return execution;
    },
    'pr_opened',
    { url },
  );
  console.log(`Recorded PR for ${id}: ${url}`);
}

function commandComplete(id, flags) {
  const requestedPr = String(flags.pr ?? '');
  const requestedSha = String(flags.sha ?? '');
  if (!/^https:\/\/github\.com\//.test(requestedPr)) {
    throw new Error('Completion requires --pr <GitHub URL>.');
  }
  if (requestedSha && !/^[0-9a-f]{7,40}$/i.test(requestedSha)) {
    throw new Error('--sha must be a valid merge commit SHA when supplied.');
  }

  let result;
  try {
    result = JSON.parse(
      execFileSync('gh', ['pr', 'view', requestedPr, '--json', 'state,mergeCommit,url'], { encoding: 'utf8' }),
    );
  } catch (error) {
    throw new Error(`Unable to verify the merged PR with GitHub: ${error instanceof Error ? error.message : String(error)}`);
  }
  const sha = String(result.mergeCommit?.oid ?? '');
  const pr = String(result.url ?? requestedPr);
  if (result.state !== 'MERGED' || !/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error('GitHub does not report this PR as merged with a merge commit.');
  }
  if (requestedSha && requestedSha !== sha) {
    throw new Error(`Requested merge SHA ${requestedSha} does not match GitHub ${sha}.`);
  }

  mutateObjective(
    id,
    (execution, state) => {
      execution.status = 'complete';
      execution.prUrl = pr;
      execution.mergeCommit = sha;
      execution.completedAt = nowIso();
      execution.blocker = null;
      execution.evidence.push({ kind: 'merge', value: `${pr} @ ${sha}`, at: nowIso() });
      if (state.activeObjective === id) state.activeObjective = null;
      return execution;
    },
    'completed',
    { pr, sha },
  );
  console.log(`Completed ${id} via GitHub-confirmed merge ${pr} @ ${sha}.`);
}

function commandBlock(id, flags) {
  const reason = String(flags.reason ?? '');
  if (!reason) throw new Error('Block requires --reason.');
  mutateObjective(
    id,
    (execution, state) => {
      execution.previousStatus = execution.status;
      execution.status = 'blocked';
      execution.blocker = { reason, at: nowIso() };
      execution.evidence.push({ kind: 'blocker', value: reason, at: nowIso() });
      state.activeObjective = id;
      return execution;
    },
    'blocked',
    { reason },
  );
  console.log(`Blocked ${id}: ${reason}`);
}

function commandUnblock(id) {
  mutateObjective(
    id,
    (execution, state) => {
      execution.status = execution.previousStatus && execution.previousStatus !== 'blocked' ? execution.previousStatus : 'pending';
      execution.blocker = null;
      state.activeObjective = execution.status === 'in_progress' ? id : null;
      return execution;
    },
    'unblocked',
  );
  console.log(`Unblocked ${id}.`);
}

function commandSync(id) {
  const state = loadState();
  const execution = stateFor(id, state);
  if (!execution.prUrl) {
    console.log(`${id} has no PR URL to sync.`);
    return;
  }
  let result;
  try {
    result = JSON.parse(execFileSync('gh', ['pr', 'view', execution.prUrl, '--json', 'state,mergedAt,mergeCommit,url'], { encoding: 'utf8' }));
  } catch (error) {
    throw new Error(`Unable to query GitHub PR: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.state === 'MERGED' && result.mergeCommit?.oid) {
    commandComplete(id, { pr: result.url ?? execution.prUrl, sha: result.mergeCommit.oid });
  } else {
    console.log(`${id} PR state: ${result.state}.`);
  }
}

function commandReset(id, flags) {
  if (flags.confirm !== id) throw new Error(`Reset is destructive to local execution metadata. Pass --confirm ${id}.`);
  const state = loadState();
  delete state.objectives[id];
  if (state.activeObjective === id) state.activeObjective = null;
  state.history.push({ at: nowIso(), objectiveId: id, type: 'reset' });
  writeState(state);
  console.log(`Reset local state for ${id}.`);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command = 'status', id] = positional;

try {
  switch (command) {
    case 'status': commandStatus(flags); break;
    case 'next': commandNext(flags); break;
    case 'claim': if (!id) throw new Error('claim requires an objective ID.'); commandClaim(id, flags); break;
    case 'release': if (!id) throw new Error('release requires an objective ID.'); commandRelease(id); break;
    case 'verify': if (!id) throw new Error('verify requires an objective ID.'); commandVerify(id, flags); break;
    case 'review': if (!id) throw new Error('review requires an objective ID.'); commandReview(id, flags); break;
    case 'review-ready': if (!id) throw new Error('review-ready requires an objective ID.'); commandReviewReady(id, flags); break;
    case 'record-pr': if (!id) throw new Error('record-pr requires an objective ID.'); commandRecordPr(id, flags); break;
    case 'complete': if (!id) throw new Error('complete requires an objective ID.'); commandComplete(id, flags); break;
    case 'block': if (!id) throw new Error('block requires an objective ID.'); commandBlock(id, flags); break;
    case 'unblock': if (!id) throw new Error('unblock requires an objective ID.'); commandUnblock(id); break;
    case 'evidence': {
      if (!id) throw new Error('evidence requires an objective ID.');
      addEvidence(id, String(flags.kind ?? ''), String(flags.value ?? ''));
      console.log(`Recorded ${flags.kind} evidence for ${id}.`);
      break;
    }
    case 'sync': if (!id) throw new Error('sync requires an objective ID.'); commandSync(id); break;
    case 'reset': if (!id) throw new Error('reset requires an objective ID.'); commandReset(id, flags); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`goals: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
