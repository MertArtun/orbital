import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // `next dev` otherwise appends a managed block to the tracked AGENTS.md and
  // creates CLAUDE.md. Playwright starts the dev server, and most remaining
  // objectives run `npm run test:e2e`, so leaving this on makes every one of
  // them dirty the tree during its own verification, which ship-pr.mjs rejects.
  agentRules: false,
  // Playwright drives the dev server over 127.0.0.1; without this, next dev
  // treats it as cross-origin and blocks /_next/static and /_next/hmr, so the
  // mobile gate would assert against a page whose client bundle never loaded.
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
