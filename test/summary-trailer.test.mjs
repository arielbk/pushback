/**
 * The understanding artifact: the developer's own answers, carried on the
 * commit as `Pushback-Summary` lines and rendered on the PR by the action.
 *
 * These scenarios drive `action/verify-pr.sh` the way the composite action
 * does — a real commit range in a real repo, `$GITHUB_STEP_SUMMARY` pointed at
 * a file — so what a reviewer would actually see is what gets asserted.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createScratchRepo, nonTrivialSource } from './harness.mjs';

const INTENT = 'Intent: cache the user lookup so the profile page stops hammering the DB.';
const TOUCHES = 'Touches: UserService and every caller of getProfile, plus the Redis keyspace.';
const RISK = 'Risk: stale profiles for up to 60s after an edit; no invalidation on write yet.';

/** Amend HEAD with the trailers a passing verification writes. */
function markVerified(repo, { summary = [] } = {}) {
  const args = ['commit', '--amend', '--no-edit', '--trailer', `Pushback-Verified: ${'a'.repeat(64)}`];
  for (const line of summary) args.push('--trailer', `Pushback-Summary: ${line}`);
  repo.git(args);
  return repo.git(['rev-parse', 'HEAD']);
}

test('a commit carrying a summary block renders the developer’s words in the PR summary', () => {
  const repo = createScratchRepo();
  try {
    const base = repo.git(['rev-parse', 'HEAD']);
    repo.writeFile('src/user-service.js', nonTrivialSource('cache'));
    repo.commit('feat: cache user lookups');
    const head = markVerified(repo, { summary: [INTENT, TOUCHES, RISK] });

    const result = repo.runVerifyPr({ base, head });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const line of [INTENT, TOUCHES, RISK]) {
      assert.ok(
        result.summary.includes(line),
        `step summary is missing the developer's line ${JSON.stringify(line)}:\n${result.summary}`,
      );
    }
  } finally {
    repo.cleanup();
  }
});

test('a verified commit with no summary block still passes, with the cell left blank', () => {
  const repo = createScratchRepo();
  try {
    const base = repo.git(['rev-parse', 'HEAD']);
    repo.writeFile('src/user-service.js', nonTrivialSource('cache'));
    repo.commit('feat: cache user lookups');
    const head = markVerified(repo);

    const result = repo.runVerifyPr({ base, head });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.summary, /Passed.*1\/1 commits verified/);
    const row = result.summary.split('\n').find((line) => line.includes('feat: cache user lookups'));
    assert.ok(row, `no table row for the commit:\n${result.summary}`);
    assert.match(row, /\|\s*—\s*\|\s*$/, `expected an empty understanding cell, got: ${row}`);
  } finally {
    repo.cleanup();
  }
});

test('an unverified commit still fails the check, summary block or not', () => {
  const repo = createScratchRepo();
  try {
    const base = repo.git(['rev-parse', 'HEAD']);
    repo.writeFile('src/user-service.js', nonTrivialSource('cache'));
    const head = repo.commit('feat: cache user lookups');

    const result = repo.runVerifyPr({ base, head });

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.summary, /Failed.*1\/1 commits missing verification/);
    assert.match(result.stdout, /Unverified commits:/);
  } finally {
    repo.cleanup();
  }
});

test('a summary line containing a pipe does not break the markdown table', () => {
  const repo = createScratchRepo();
  try {
    const base = repo.git(['rev-parse', 'HEAD']);
    repo.writeFile('src/user-service.js', nonTrivialSource('cache'));
    repo.commit('feat: cache user lookups');
    const head = markVerified(repo, { summary: ['Touches: getProfile | getSettings | the cache'] });

    const result = repo.runVerifyPr({ base, head });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const row = result.summary.split('\n').find((line) => line.includes('getProfile'));
    assert.ok(row, `no table row carrying the summary:\n${result.summary}`);
    assert.ok(
      row.includes('getProfile \\| getSettings \\| the cache'),
      `pipes in the developer's words must be escaped, got: ${row}`,
    );
  } finally {
    repo.cleanup();
  }
});

test('the skill writes the trailer key the action reads, with all three lines', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const script = fs.readFileSync(path.join(root, 'action', 'verify-pr.sh'), 'utf8');
  const key = script.match(/^SUMMARY_KEY="([^"]+)"$/m)?.[1];
  assert.ok(key, 'verify-pr.sh no longer declares SUMMARY_KEY');

  for (const rel of ['skill/verification.md', 'skill/references/verification-guide.md']) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.ok(
      text.includes(`--trailer "${key}: `),
      `${rel} must write the ${key} trailer the action renders`,
    );
    for (const label of ['Intent:', 'Touches:', 'Risk:']) {
      assert.ok(text.includes(`${key}: ${label}`), `${rel} is missing the "${label}" summary line`);
    }
  }
});
