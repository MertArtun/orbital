export function roadmapIssueTitle(objective) {
  return `[${objective.id}] ${objective.title}`;
}

export function phaseLabel(objective) {
  return objective.phaseId.replace(/^phase-/, 'phase:');
}

export function areaLabels(objective) {
  const text = `${objective.title} ${objective.allowedPaths.join(' ')}`.toLowerCase();
  const labels = [];
  if (/propagation|pass|orbit|sun|tle/.test(text)) labels.push('area:orbital-math');
  if (/globe|3d|visual|cinematic|sharing/.test(text)) labels.push('area:3d-globe');
  if (/gateway|api|launch|crew|data|fallback/.test(text)) labels.push('area:data');
  if (/quality|accessib|performance|lighthouse|release/.test(text)) labels.push('quality-gate');
  return [...new Set(labels)];
}

export function roadmapIssueBody(objective) {
  return [
    '## Outcome',
    objective.prompt,
    '',
    '## Acceptance criteria',
    ...objective.acceptance.map((item) => `- [ ] ${item}`),
    '',
    '## Verification matrix',
    ...objective.verify.map((command) => `- [ ] \`${command}\``),
    '',
    '## Dependency gate',
    ...(objective.dependencies.length > 0
      ? objective.dependencies.map((dependency) => `- ${dependency} must be merged and complete`)
      : ['- No prior roadmap dependency']),
    '',
    '## Delivery contract',
    `- Branch: \`${objective.branch}\``,
    `- TDD red/green evidence: ${objective.tddRequired === false ? 'not required for this objective' : 'required'}`,
    '- Independent reviewers: `qa-gatekeeper`, `pr-reviewer`',
    '- Merge strategy: squash; no direct push to `main`',
    '',
    '<details>',
    '<summary>Allowed paths</summary>',
    '',
    ...objective.allowedPaths.map((allowedPath) => `- \`${allowedPath}\``),
    '',
    '</details>',
    '',
    `<!-- orbital-roadmap:${objective.id} -->`,
  ].join('\n');
}
