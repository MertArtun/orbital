#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const input = await new Promise((resolve) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => resolve(data));
});
let payload = {};
try { payload = JSON.parse(input || '{}'); } catch {}
const command = String(payload.tool_input?.command ?? '');

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

const destructive = [
  [/\bgit\s+push\b[^\n]*(--force|-f)\b/i, 'Force push is forbidden.'],
  [/\bgit\s+reset\s+--hard\b/i, 'Hard reset is forbidden; preserve unknown work.'],
  [/\bgit\s+clean\s+-[^\n]*f/i, 'Destructive git clean is forbidden.'],
  [/\brm\s+-[^\n]*r[^\n]*f|\brm\s+-[^\n]*f[^\n]*r/i, 'Recursive forced deletion is forbidden.'],
  [/\b(?:curl|wget)\b[^\n]*\|\s*(?:ba)?sh\b/i, 'Remote script piping is forbidden.'],
  [/\bnpm\s+publish\b/i, 'Package publishing is outside project scope.'],
  [/\bgh\s+pr\s+merge\b[^\n]*--admin\b/i, 'Branch-protection bypass is forbidden.'],
  [/\bgit\s+checkout\s+--(?:\s|$)/i, 'Discarding tracked work with git checkout -- is forbidden.'],
  [/\bgit\s+restore\b/i, 'Discarding tracked or staged work with git restore is forbidden.'],
  [/\bgit\s+branch\s+-D\b/i, 'Force-deleting Git branches is forbidden.'],
  [/\bgit\s+stash\s+(?:drop|clear)\b/i, 'Deleting stash history is forbidden.'],
  [/\bgh\s+repo\s+delete\b/i, 'Repository deletion is forbidden.'],
  [/\bgh\s+api\b[^\n]*(?:--method|-X)\s+DELETE\b/i, 'Destructive GitHub API calls are forbidden.'],
  [/\bvercel\s+(?:remove|rm)\b/i, 'Vercel project/deployment deletion is forbidden.'],
  [/\bfind\b[^\n]*\s-delete\b/i, 'Bulk find -delete is forbidden.'],
];
for (const [pattern, reason] of destructive) if (pattern.test(command)) deny(reason);

if (/\bgit\s+push\b[^\n]*(?:origin\s+)?(?:main|master)(?:\s|$)/i.test(command)) {
  deny('Direct pushes to main/master are forbidden; ship through a PR.');
}

if (/\bgit\s+commit\b/i.test(command)) {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (branch === 'main' || branch === 'master') deny('Commits on main/master are forbidden; create the objective branch first.');
  } catch {}
}

if (/\bgit\s+add\b[^\n]*(?:\.env|\.ssh|credentials|hosts\.yml)/i.test(command)) {
  deny('Potential secret material must not be staged.');
}
