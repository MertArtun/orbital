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
  // what earns them a place in a gate. Costs about 40 ms.
  'node scripts/check-bundle-budget.mjs',
];

function unique(commands) {
  return [...new Set(commands)];
}

const BUILD = 'npm run build';
const BUDGET = 'node scripts/check-bundle-budget.mjs';

/**
 * Keeps the budget check after the build that produces what it measures.
 *
 * `unique()` keeps the first occurrence, so an objective whose own `verify`
 * array names the budget command would get it at position one and measure
 * whatever `.next` happened to be lying around from the previous objective --
 * a green gate over a stale build, which is worse than no gate. Naming the
 * check you care about is the natural thing for a future author to do, so the
 * ordering is enforced here rather than left as a convention.
 */
function budgetAfterBuild(commands) {
  if (!commands.includes(BUDGET) || !commands.includes(BUILD)) return commands;
  const withoutBudget = commands.filter((command) => command !== BUDGET);
  const buildAt = withoutBudget.indexOf(BUILD);
  return [...withoutBudget.slice(0, buildAt + 1), BUDGET, ...withoutBudget.slice(buildAt + 1)];
}

export function genericVerificationPlan({ mode = 'full', runAllE2e = false } = {}) {
  const base = mode === 'fast' || mode === 'task'
    ? FAST_VERIFICATION_COMMANDS
    : FULL_VERIFICATION_COMMANDS;
  return budgetAfterBuild(unique([...base, ...(runAllE2e ? ['npm run test:e2e'] : [])]));
}

export function objectiveVerificationPlan(objective, { runAllE2e = false } = {}) {
  const objectiveCommands = objective.verify.flatMap((command) =>
    command === 'npm run verify' ? FULL_VERIFICATION_COMMANDS : [command],
  );
  return budgetAfterBuild(
    unique([
      ...objectiveCommands,
      ...FULL_VERIFICATION_COMMANDS,
      ...(runAllE2e ? ['npm run test:e2e'] : []),
    ]),
  );
}
