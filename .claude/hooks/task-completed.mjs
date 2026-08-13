#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const input = await new Promise((resolve) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => resolve(data));
});
let payload = {};
try { payload = JSON.parse(input || '{}'); } catch {}
const subject = String(payload.task_subject ?? payload.task?.subject ?? '');
const description = String(payload.task_description ?? payload.task?.description ?? '');
const docsOnly = /\[docs\]|documentation-only|docs only/i.test(`${subject} ${description}`);

if (!fs.existsSync('package.json')) process.exit(0);
const command = docsOnly ? ['git', ['diff', '--check']] : ['node', ['scripts/verify.mjs', '--mode=task', '--quiet']];
const result = spawnSync(command[0], command[1], { stdio: 'inherit' });
if (result.status !== 0) {
  console.error(`Task cannot complete: ${command[0]} ${command[1].join(' ')} failed. Fix the failure and provide red/green evidence.`);
  process.exit(2);
}
