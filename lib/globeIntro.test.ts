import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A source-level fitness test, in the same spirit as the canonical-clock one
 * in lib/simulatedTime.test.ts, and written for the same reason: the rule it
 * enforces is about *how* the code is written, and the behaviour it protects
 * is one no end-to-end assertion can watch honestly.
 *
 * Under reduced motion the intro's single camera placement has to happen in
 * the same task as the first ISS fix, because that is what lands it inside
 * three-globe's 1.2 s build-in spin -- which is the only window in which
 * e2e/globe.spec.ts's build-in test can observe the P2-00 marker-attachment
 * defect. Defer that call behind a timer and the end-to-end test goes green
 * while guarding nothing. That is not hypothetical: it happened once, and the
 * suite stayed green through it.
 *
 * Two other guards were tried against a browser first and both were measured
 * and rejected, which is why this one is structural. Reading
 * `data-intro-focus` once the marker attaches cannot tell the two apart,
 * because the marker can take longer to attach than the hold being detected
 * (measured: 10 of 10 runs passed with the defect reintroduced). Timing the
 * gap between the fix and the attribute cannot either, because the attribute
 * is written by a later React commit whose own latency is 175-613 ms under
 * load, which swamps the 200 ms being detected.
 */
const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'components/Globe/GlobeScene.tsx'),
  'utf8',
);

/** The `if (reducedMotion) { ... }` block, found by brace matching. */
function reducedMotionBranch(text: string): string {
  const opener = 'if (reducedMotion) {';
  const start = text.indexOf(opener);
  if (start === -1) throw new Error('GlobeScene has no reduced-motion branch to check');
  let depth = 0;
  for (let index = start + opener.length - 1; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error('The reduced-motion branch is not brace-balanced');
}

/** Comments explain the rule; they must not be able to break it. */
const withoutComments = (text: string) => text.replace(/\/\/.*$/gm, '');

describe('reduced-motion camera placement', () => {
  const branch = reducedMotionBranch(source);

  it('places the camera synchronously with the first fix', () => {
    const at = branch.indexOf('globe.pointOfView(');
    expect(at, 'The reduced-motion branch no longer places the camera directly').toBeGreaterThan(-1);

    const before = withoutComments(branch.slice(0, at));
    for (const deferral of ['setTimeout', 'requestAnimationFrame', 'queueMicrotask', '.then(', 'await ']) {
      expect(
        before,
        `The reduced-motion camera placement is deferred by ${deferral} — e2e/globe.spec.ts's build-in test stops guarding P2-00 when it is`,
      ).not.toContain(deferral);
    }
  });

  it('lets a late-resolving link take the camera without a tween', () => {
    // The second placement is allowed to be deferred; what it may not do is
    // become a transition, which reduced motion forbids.
    const late = branch.slice(branch.indexOf('globe.pointOfView(') + 1);
    expect(late).toContain('pointOfView(settle(late), 0)');
  });
});
