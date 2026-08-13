#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Git repository already exists; no initialization performed."
  exit 0
fi

if ! git config user.name >/dev/null || ! git config user.email >/dev/null; then
  echo "Configure your real Git identity first:"
  echo "  git config --global user.name \"Your Name\""
  echo "  git config --global user.email \"you@example.com\""
  exit 1
fi

git init -b main

git add .editorconfig .env.example .gitignore .nvmrc .prettierignore .prettierrc.json .vscode \
  package.json tsconfig.json next-env.d.ts next.config.ts postcss.config.mjs eslint.config.mjs \
  vitest.config.ts playwright.config.ts requirements-textures.txt app components hooks lib workers public e2e LICENSE
git commit -m "feat: seed live ORBITAL dashboard"

git add CLAUDE.md AGENTS.md .claude goals/roadmap.json goals/SCHEMA.md goals/state.example.json scripts
git commit -m "chore: add autonomous agent delivery system"

git add README.md START_HERE_TR.md docs .github 2>/dev/null || true
if ! git diff --cached --quiet; then
  git commit -m "docs: add portfolio engineering playbook"
fi

echo
echo "Repository initialized on main with a meaningful baseline history."
echo "Next: create a GitHub repository, add origin, push main, then run npm run setup:github."
