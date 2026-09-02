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
const targetModules = path.join(cwd, 'node_modules');

// This used to symlink the main worktree's node_modules. Turbopack refuses a
// node_modules that resolves outside the project root ("Symlink
// [project]/node_modules is invalid, it points out of the filesystem root"),
// which made `next build`, `next dev`, and therefore every Playwright run fail
// in a worktree while vitest and tsc kept working. A real install is the only
// layout Turbopack accepts; from a warm npm cache it takes a few seconds.
if (path.resolve(mainRoot) === path.resolve(cwd)) {
  console.log('Main worktree detected; no install required.');
} else if (fs.existsSync(targetModules) && !fs.lstatSync(targetModules).isSymbolicLink()) {
  console.log('Worktree node_modules already exists.');
} else {
  if (fs.existsSync(targetModules)) {
    fs.unlinkSync(targetModules);
    console.log('Removed the symlinked node_modules; Turbopack cannot resolve through it.');
  }
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd, stdio: 'inherit' });
  console.log('Installed node_modules from package-lock.json.');
}

fs.mkdirSync(path.join(cwd, '.artifacts'), { recursive: true });
