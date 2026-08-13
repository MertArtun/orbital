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
