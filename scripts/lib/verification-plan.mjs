export const FAST_VERIFICATION_COMMANDS = [
  'npm run lint',
  'npm run typecheck',
  'npm run test',
];

export const FULL_VERIFICATION_COMMANDS = [
  'npm run lint',
  'npm run typecheck',
  'npm run test:coverage',
  'npm run build',
  // Reads the build above, so it has to follow it. Measures the gzipped JS and
  // CSS a first visit to `/` downloads, and fails if three.js is reachable from
  // the prerendered HTML. See docs/adr/0009: byte counts are the half of this
  // objective's measurement that is exact and machine-independent, which is
  // what earns them a place in a gate. Costs about 20 ms.
  'node scripts/check-bundle-budget.mjs',
];

function unique(commands) {
  return [...new Set(commands)];
}

export function genericVerificationPlan({ mode = 'full', runAllE2e = false } = {}) {
  const base = mode === 'fast' || mode === 'task'
    ? FAST_VERIFICATION_COMMANDS
    : FULL_VERIFICATION_COMMANDS;
  return unique([...base, ...(runAllE2e ? ['npm run test:e2e'] : [])]);
}

export function objectiveVerificationPlan(objective, { runAllE2e = false } = {}) {
  const objectiveCommands = objective.verify.flatMap((command) =>
    command === 'npm run verify' ? FULL_VERIFICATION_COMMANDS : [command],
  );
  return unique([
    ...objectiveCommands,
    ...FULL_VERIFICATION_COMMANDS,
    ...(runAllE2e ? ['npm run test:e2e'] : []),
  ]);
}
