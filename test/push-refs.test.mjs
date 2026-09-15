import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScratchRepo, localBuildShim } from './harness.mjs';

const OVERRIDE = { PUSHBACK_OVERRIDE: '1' };

/**
 * Seed a repo where the branch being pushed to and the current upstream sit at
 * different commits, so a hash taken from `@{upstream}` is distinguishable from
 * one taken from the ref git is actually updating.
 *
 * remote: main -> C1, other-branch -> S    local: HEAD -> C2
 */
function repoWithDivergedRemoteBranch(t) {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  const seed = repo.git(['rev-parse', 'HEAD']);
  repo.push(['origin', 'main:other-branch'], { env: OVERRIDE });

  repo.writeFile('src/a.js', 'export const a = 1;\n');
  repo.commit('feat: a');
  repo.push(['origin', 'main'], { env: OVERRIDE });

  repo.writeFile('src/b.js', 'export const b = 2;\n');
  const head = repo.commit('feat: b');

  return { repo, seed, head };
}

test('a push to another branch hashes the diff against that branch, not the upstream', (t) => {
  const { repo, seed, head } = repoWithDivergedRemoteBranch(t);

  repo.writeReceipt(`${seed}..HEAD`);
  const push = repo.push(['origin', 'HEAD:other-branch']);

  assert.equal(push.status, 0, `expected git push to succeed:\n${push.stderr}`);
  assert.equal(repo.remoteSha('refs/heads/other-branch'), head);
});

test('a receipt for the upstream diff does not unblock a push to another branch', (t) => {
  const { repo } = repoWithDivergedRemoteBranch(t);

  repo.writeReceipt('@{upstream}..HEAD');
  const push = repo.push(['origin', 'HEAD:other-branch']);

  assert.notEqual(push.status, 0, 'expected git push to be blocked');
  assert.match(push.stderr, /Pushback: verification required/);
});

/**
 * Seed a repo pushing a brand-new branch, where the local default branch has
 * drifted from the remote one — so a hash taken from local `main` is
 * distinguishable from one taken from `refs/remotes/origin/HEAD`.
 *
 * remote: main -> C1    local: main -> C3, feature (HEAD) -> C2
 */
function repoWithStaleLocalMain(t) {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  repo.writeFile('src/a.js', 'export const a = 1;\n');
  repo.commit('feat: a');
  repo.push(['origin', 'main'], { env: OVERRIDE });

  repo.git(['checkout', '-b', 'feature']);
  repo.writeFile('src/b.js', 'export const b = 2;\n');
  const head = repo.commit('feat: b');

  repo.git(['checkout', 'main']);
  repo.writeFile('src/unpushed.js', 'export const unpushed = 3;\n');
  repo.commit('feat: unpushed work on main');
  repo.git(['checkout', 'feature']);

  return { repo, head };
}

test('a new remote branch hashes the diff against refs/remotes/origin/HEAD', (t) => {
  const { repo, head } = repoWithStaleLocalMain(t);

  repo.writeReceipt('refs/remotes/origin/HEAD..HEAD');
  const push = repo.push(['origin', 'feature']);

  assert.equal(push.status, 0, `expected git push to succeed:\n${push.stderr}`);
  assert.equal(repo.remoteSha('refs/heads/feature'), head);
});

test('a stale local default branch does not change the hash', (t) => {
  const { repo } = repoWithStaleLocalMain(t);

  repo.writeReceipt('main..HEAD');
  const push = repo.push(['origin', 'feature']);

  assert.notEqual(push.status, 0, 'expected git push to be blocked');
  assert.match(push.stderr, /Pushback: verification required/);
});

test('the check does not consult the remote, so an unroutable remote cannot stall it', (t) => {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  repo.git(['checkout', '-b', 'feature']);
  repo.writeFile('src/b.js', 'export const b = 2;\n');
  const head = repo.commit('feat: b');
  repo.git(['remote', 'set-url', 'origin', 'https://192.0.2.1/unroutable.git']);

  const git = repo.installGitShim();
  const refLines = `refs/heads/feature ${head} refs/heads/feature ${'0'.repeat(40)}\n`;

  const started = Date.now();
  const check = repo.runCli(['check', 'origin', 'https://192.0.2.1/unroutable.git'], {
    env: { PATH: git.path },
    input: refLines,
  });
  const elapsed = Date.now() - started;

  assert.equal(check.status, 1, 'expected the new branch to need verification');
  assert.match(check.stderr, /Pushback: verification required/);
  const networkCalls = git.calls().filter((argv) => argv[0] === 'remote' || argv[0] === 'ls-remote');
  assert.deepEqual(networkCalls, [], 'the check must not open a connection to the remote');
  assert.ok(elapsed < 1000, `expected the check to finish under a second, took ${elapsed}ms`);
});

const RECORDING_HOOK = `#!/usr/bin/env sh
# Records what a chained pre-push hook was handed.
REC="$(git rev-parse --absolute-git-dir)/pre-push-record"
echo "args: $*" > "$REC"
cat >> "$REC"
exit 0
`;

test('a chained previous hook is handed the same ref lines and arguments', (t) => {
  const repo = createScratchRepo({ hook: RECORDING_HOOK });
  t.after(() => repo.cleanup());

  // Installing moves the pre-existing hook aside to pre-push.previous; point the
  // hook itself back at this working tree's build so no npx is involved.
  const install = repo.runCli(['install']);
  assert.equal(install.status, 0, `expected install to succeed:\n${install.stderr}`);
  repo.installHook(localBuildShim());

  const before = repo.remoteSha();
  repo.writeFile('src/app.js', 'export const answer = 42;\n');
  const head = repo.commit('feat: add answer');
  repo.writeReceipt(`${before}..HEAD`);

  const push = repo.push();
  assert.equal(push.status, 0, `expected git push to succeed:\n${push.stderr}`);

  const record = repo.readFile('.git/pre-push-record');
  assert.equal(record.split('\n')[0], `args: origin ${repo.remote}`);
  assert.match(record, new RegExp(`refs/heads/main ${head} refs/heads/main ${before}`));
});
