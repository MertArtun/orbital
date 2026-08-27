import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // `next dev` otherwise appends a managed block to the tracked AGENTS.md and
  // creates CLAUDE.md. Playwright starts the dev server, and most remaining
  // objectives run `npm run test:e2e`, so leaving this on makes every one of
  // them dirty the tree during its own verification, which ship-pr.mjs rejects.
  agentRules: false,
};

export default nextConfig;
