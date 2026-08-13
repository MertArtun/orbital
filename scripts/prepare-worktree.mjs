#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
let commonGitDir;
try {
  commonGitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
} catch {
  console.log('Not inside a Git worktree; nothing to prepare.');
  process.exit(0);
}

const mainRoot = path.dirname(commonGitDir);
const sourceModules = path.join(mainRoot, 'node_modules');
const targetModules = path.join(cwd, 'node_modules');

if (path.resolve(mainRoot) === path.resolve(cwd)) {
  console.log('Main worktree detected; no symlink required.');
} else if (!fs.existsSync(sourceModules)) {
  console.log('Main worktree has no node_modules. Run npm install there first.');
} else if (fs.existsSync(targetModules)) {
  console.log('Worktree node_modules already exists.');
} else {
  fs.symlinkSync(sourceModules, targetModules, 'dir');
  console.log(`Linked node_modules from ${sourceModules}.`);
}

fs.mkdirSync(path.join(cwd, '.artifacts'), { recursive: true });
