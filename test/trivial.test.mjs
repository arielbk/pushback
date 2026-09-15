import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScratchRepo } from './harness.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a one-line typo fix pushes with no receipt', (t) => {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  repo.writeFile('README.md', '# scratch repo\n');
  const sha = repo.commit('docs: fix title');

  const push = repo.push();

  assert.equal(push.status, 0, `expected git push to succeed:\n${push.stderr}`);
  assert.equal(repo.remoteSha(), sha, 'expected the remote to have the new commit');
  assert.equal(repo.exists('.pushback/verified'), false, 'no receipt should be needed');
});

test('a 20-line source change is still blocked', (t) => {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  const lines = Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`);
  repo.writeFile('src/app.js', lines.join('\n') + '\n');
  repo.commit('feat: add constants');

  const push = repo.push();

  assert.notEqual(push.status, 0, 'expected git push to be blocked');
  assert.match(push.stderr, /Pushback: verification required/);
});

test('a lockfile-only change pushes with no receipt, however large', (t) => {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  const entries = Array.from({ length: 40 }, (_, i) => `  pkg-${i}: 1.0.${i}`);
  repo.writeFile('pnpm-lock.yaml', entries.join('\n') + '\n');
  const sha = repo.commit('chore: refresh lockfile');

  const push = repo.push();

  assert.equal(push.status, 0, `expected git push to succeed:\n${push.stderr}`);
  assert.equal(repo.remoteSha(), sha, 'expected the remote to have the new commit');
  assert.equal(repo.exists('.pushback/verified'), false, 'no receipt should be needed');
});

test('a whitespace-only reindent pushes with no receipt', (t) => {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  const body = Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`);
  repo.writeFile('src/app.js', body.join('\n') + '\n');
  repo.commit('feat: add constants');
  repo.writeReceipt();
  const seeded = repo.push();
  assert.equal(seeded.status, 0, `expected the seed push to succeed:\n${seeded.stderr}`);

  repo.writeFile('src/app.js', body.map((line) => `  ${line}`).join('\n') + '\n');
  const sha = repo.commit('style: reindent');

  const push = repo.push();

  assert.equal(push.status, 0, `expected git push to succeed:\n${push.stderr}`);
  assert.equal(repo.remoteSha(), sha, 'expected the remote to have the new commit');
});

test('the threshold comes from config, not from the CLI', (t) => {
  const repo = createScratchRepo({
    config: {
      trivial_threshold: { max_lines: 50, ignore_patterns: [] },
      override_env_var: 'PUSHBACK_OVERRIDE',
    },
  });
  t.after(() => repo.cleanup());

  const lines = Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`);
  repo.writeFile('src/app.js', lines.join('\n') + '\n');
  const sha = repo.commit('feat: add constants');

  const push = repo.push();

  assert.equal(push.status, 0, `expected git push to succeed:\n${push.stderr}`);
  assert.equal(repo.remoteSha(), sha, 'expected the remote to have the new commit');
});

/** What a hand-edited config that has gone wrong must not do: break the gate. */
function assertGateStillWorks(t, configText) {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());
  repo.writeFile('.pushback/config.json', configText);

  const lines = Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`);
  repo.writeFile('src/app.js', lines.join('\n') + '\n');
  repo.commit('feat: add constants');

  const blocked = repo.push();
  assert.notEqual(blocked.status, 0, 'expected the 20-line change to be blocked');
  assert.match(blocked.stderr, /Pushback: verification required/);

  repo.writeFile('src/app.js', lines.join('\n') + '\n// note\n');
  const sha = repo.commit('docs: add note');
  repo.writeReceipt();

  const passed = repo.push();
  assert.equal(passed.status, 0, `expected the verified push to succeed:\n${passed.stderr}`);
  assert.equal(repo.remoteSha(), sha, 'expected the remote to have the new commits');
}

test('a config file that is not valid JSON falls back to the defaults', (t) => {
  assertGateStillWorks(t, '{ "trivial_threshold": oops\n');
});

test('a config file with the wrong shape falls back to the defaults', (t) => {
  assertGateStillWorks(
    t,
    JSON.stringify({ trivial_threshold: 'aggressive', override_env_var: 42 })
  );
});

test('the dead `triggers` config field is gone from the code, example and README', () => {
  const targets = ['src', 'skill', 'README.md'].map((rel) => path.join(projectRoot, rel));
  // Only the config key, not the English word — `triggers` reads naturally in prose.
  const grep = spawnSync('grep', ['-rnE', '["`\\x27]triggers["`\\x27]', '--', ...targets], {
    encoding: 'utf8',
  });

  assert.equal(
    grep.stdout.trim(),
    '',
    'the `triggers` config field was never read by anything:\n' + grep.stdout
  );
});
