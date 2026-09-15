import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScratchRepo } from './harness.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the installed hook reaches Pushback in a clone with no pushback-cli installed', (t) => {
  const repo = createScratchRepo({ hook: null });
  t.after(() => repo.cleanup());

  const install = repo.runCli(['install']);
  assert.equal(install.status, 0, `expected install to succeed:\n${install.stderr}`);

  const npx = repo.installFakeNpx();
  repo.writeFile('src/app.js', 'export const answer = 42;\n');
  repo.commit('feat: add answer');

  const push = repo.push(['origin', 'main'], { env: { PATH: npx.path } });

  assert.doesNotMatch(push.stderr, /could not determine executable to run/);
  assert.match(push.stderr, /Pushback: verification required/);
  assert.notEqual(push.status, 0, 'expected git push to be blocked');
});

test('no documented or generated command invokes a bare `npx pushback`', () => {
  const targets = ['src', 'skill', 'README.md'].map((rel) => path.join(projectRoot, rel));
  const grep = spawnSync('grep', ['-rn', '--', 'npx pushback ', ...targets], {
    encoding: 'utf8',
  });

  assert.equal(
    grep.stdout.trim(),
    '',
    'bare `npx pushback` resolves to the unrelated `pushback` npm package:\n' + grep.stdout
  );
});

test('setup installs the same resolvable hook on a repo with no Pushback yet', (t) => {
  const repo = createScratchRepo({ config: null, hook: null });
  t.after(() => repo.cleanup());

  const setup = repo.runCli(['setup']);
  assert.equal(setup.status, 0, `expected setup to succeed:\n${setup.stderr}`);

  const npx = repo.installFakeNpx();
  repo.writeFile('src/app.js', 'export const answer = 42;\n');
  repo.commit('feat: add answer');

  const push = repo.push(['origin', 'main'], { env: { PATH: npx.path } });

  assert.doesNotMatch(push.stderr, /could not determine executable to run/);
  assert.match(push.stderr, /Pushback: verification required/);
  assert.deepEqual(
    npx.calls(),
    [['--package', 'pushback-cli', 'pushback', 'check', 'origin', repo.remote]],
    'the hook must name the package explicitly, and forward git’s arguments'
  );
});

test('install upgrades an already-installed hook that still uses the bare form', (t) => {
  const repo = createScratchRepo({
    hook: '#!/usr/bin/env sh\n# Pushback pre-push hook\nexec npx pushback check "$@"\n',
  });
  t.after(() => repo.cleanup());

  const install = repo.runCli(['install']);
  assert.equal(install.status, 0, `expected install to succeed:\n${install.stderr}`);

  const npx = repo.installFakeNpx();
  repo.writeFile('src/app.js', 'export const answer = 42;\n');
  repo.commit('feat: add answer');

  const push = repo.push(['origin', 'main'], { env: { PATH: npx.path } });

  assert.doesNotMatch(push.stderr, /could not determine executable to run/);
  assert.match(push.stderr, /Pushback: verification required/);
  assert.equal(
    repo.exists('.git/hooks/pre-push.previous'),
    false,
    'upgrading our own shim must not back it up as a foreign hook'
  );
});
