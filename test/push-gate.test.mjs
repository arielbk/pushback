import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScratchRepo, nonTrivialSource } from './harness.mjs';

test('push is blocked when no receipt exists', (t) => {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  repo.writeFile('src/app.js', nonTrivialSource('answer'));
  repo.commit('feat: add answer');

  const push = repo.push();

  assert.notEqual(push.status, 0, 'expected git push to fail');
  assert.match(push.stderr, /Pushback: verification required/);
});

test('push passes when the receipt matches the outgoing diff', (t) => {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  repo.writeFile('src/app.js', nonTrivialSource('answer'));
  const sha = repo.commit('feat: add answer');
  repo.writeReceipt();

  const push = repo.push();

  assert.equal(push.status, 0, `expected git push to succeed:\n${push.stderr}`);
  assert.equal(repo.remoteSha(), sha, 'expected the remote to have the new commit');
});

test('push passes with no receipt when the outgoing diff is empty', (t) => {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  const sha = repo.commit('chore: empty commit', { allowEmpty: true });

  const push = repo.push();

  assert.equal(push.status, 0, `expected git push to succeed:\n${push.stderr}`);
  assert.equal(repo.remoteSha(), sha, 'expected the remote to have the new commit');
  assert.equal(repo.exists('.pushback/verified'), false, 'no receipt should be needed');
});
