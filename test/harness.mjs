/**
 * End-to-end harness: a throwaway bare remote plus a clone in a temp dir, with
 * a pre-push shim wired to the locally built `dist/cli.js`.
 *
 * Scenarios drive real `git push` calls against this, so the hook is exercised
 * exactly as it would be on a developer's machine — stdin ref lines, argv,
 * exit codes and all.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(projectRoot, 'dist', 'cli.js');

/** Git that ignores the developer's own global/system config and identity. */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Pushback Test',
  GIT_AUTHOR_EMAIL: 'test@pushback.invalid',
  GIT_COMMITTER_NAME: 'Pushback Test',
  GIT_COMMITTER_EMAIL: 'test@pushback.invalid',
};

const DEFAULT_CONFIG = {
  triggers: ['push'],
  trivial_threshold: {
    max_lines: 5,
    ignore_patterns: [
      '*.lock',
      '*.lockb',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      '*.generated.*',
    ],
  },
  override_env_var: 'PUSHBACK_OVERRIDE',
};

/** The shim a real install writes, but pointed at this working tree's build. */
export function localBuildShim() {
  return `#!/usr/bin/env sh\n# Pushback pre-push hook (local build)\nexec node ${JSON.stringify(cliPath)} check "$@"\n`;
}

function run(cwd, args, { env } = {}) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...GIT_ENV, ...env },
  });
}

/**
 * A stand-in for `npx` that resolves packages from a tiny fixed registry rather
 * than the network: only `pushback-cli` publishes a `pushback` bin, and it runs
 * this working tree's build. Anything else fails exactly the way npm does when
 * a package has no bin of that name.
 *
 * Bare `npx pushback ...` therefore fails here for the same reason it fails for
 * a real installer — the unrelated `pushback` package on npm ships no `pushback`
 * executable — while `npx --package pushback-cli pushback ...` works.
 */
function fakeNpxSource(logPath) {
  return `#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + '\\n');

let pkg = null;
const rest = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--package' || arg === '-p') { pkg = args[++i]; continue; }
  if (arg.startsWith('--package=')) { pkg = arg.slice('--package='.length); continue; }
  if (arg === '--yes' || arg === '-y' || arg === '--no-install') continue;
  rest.push(arg);
}

// With no --package, npm infers the package name from the bin name.
if (pkg === null) pkg = rest[0];

if (pkg !== 'pushback-cli') {
  process.stderr.write('npm error could not determine executable to run\\n');
  process.exit(1);
}

const res = spawnSync(process.execPath, [${JSON.stringify(cliPath)}, ...rest.slice(1)], {
  stdio: 'inherit',
});
process.exit(res.status === null ? 1 : res.status);
`;
}

/**
 * @param {object} [options]
 * @param {object|null} [options.config] `.pushback/config.json` contents; null writes no config.
 * @param {string|null} [options.hook] pre-push hook body; null installs no hook
 *   (for scenarios that install it through the CLI itself).
 */
export function createScratchRepo(options = {}) {
  const { config = DEFAULT_CONFIG, hook = localBuildShim() } = options;

  if (!fs.existsSync(cliPath)) {
    throw new Error(`No build at ${cliPath} — run \`pnpm build\` (or \`pnpm test\`) first.`);
  }

  // realpath so `git rev-parse --show-toplevel` matches our paths on macOS,
  // where /var is a symlink to /private/var.
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'pushback-e2e-'));
  const remote = path.join(tmp, 'remote.git');
  const dir = path.join(tmp, 'clone');

  const must = (cwd, args, env) => {
    const res = run(cwd, args, { env });
    if (res.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed (${res.status}):\n${res.stderr}`);
    }
    return res.stdout;
  };

  must(tmp, ['init', '--bare', '--initial-branch=main', remote]);
  must(tmp, ['clone', remote, dir]);
  must(dir, ['config', 'user.name', 'Pushback Test']);
  must(dir, ['config', 'user.email', 'test@pushback.invalid']);
  // Pin hooks to this repo so a global core.hooksPath can't shadow the shim.
  must(dir, ['config', 'core.hooksPath', path.join(dir, '.git', 'hooks')]);

  const repo = {
    dir,
    remote,
    cliPath,

    writeFile(rel, content) {
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      return target;
    },

    readFile(rel) {
      return fs.readFileSync(path.join(dir, rel), 'utf8');
    },

    exists(rel) {
      return fs.existsSync(path.join(dir, rel));
    },

    /** Run git in the clone and return trimmed stdout; throws if git fails. */
    git(args, env) {
      return must(dir, args, env).trim();
    },

    /** Stage everything and commit. */
    commit(message, { allowEmpty = false } = {}) {
      must(dir, ['add', '-A']);
      const args = ['commit', '-m', message];
      if (allowEmpty) args.push('--allow-empty');
      must(dir, args);
      return repo.git(['rev-parse', 'HEAD']);
    },

    /** Raw `git diff` output for a range — the exact bytes the CLI hashes. */
    diff(range = '@{upstream}..HEAD') {
      const res = run(dir, ['diff', range]);
      return res.status === 0 ? res.stdout : '';
    },

    /** Write the receipt the CLI expects for a given diff range. */
    writeReceipt(range = '@{upstream}..HEAD') {
      const hash = createHash('sha256').update(repo.diff(range)).digest('hex');
      repo.writeFile('.pushback/verified', hash + '\n');
      return hash;
    },

    /** Replace the pre-push hook body (later slices install their own shims). */
    installHook(body = hook) {
      const hooksDir = path.join(dir, '.git', 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const hookPath = path.join(hooksDir, 'pre-push');
      fs.writeFileSync(hookPath, body);
      fs.chmodSync(hookPath, 0o755);
      return hookPath;
    },

    /** Run the local CLI build inside the clone, the way a runner would. */
    runCli(args = [], { env } = {}) {
      return spawnSync(process.execPath, [cliPath, ...args], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...GIT_ENV, ...env },
      });
    },

    /** The hook body currently on disk, or null if there is no pre-push hook. */
    readHook() {
      const hookPath = path.join(dir, '.git', 'hooks', 'pre-push');
      return fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : null;
    },

    /**
     * Put a registry-free `npx` ahead of the real one on PATH.
     * @returns {{ path: string, calls: () => string[][] }} PATH value to pass to
     *   `push`, plus the argv of every npx invocation the hook made.
     */
    installFakeNpx() {
      const binDir = path.join(tmp, 'fake-bin');
      const logPath = path.join(tmp, 'npx-calls.log');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(logPath, '');
      const npxPath = path.join(binDir, 'npx');
      fs.writeFileSync(npxPath, fakeNpxSource(logPath));
      fs.chmodSync(npxPath, 0o755);
      return {
        path: `${binDir}${path.delimiter}${process.env.PATH}`,
        calls: () =>
          fs
            .readFileSync(logPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line)),
      };
    },

    /** Push without throwing — scenarios assert on status/stdout/stderr. */
    push(args = ['origin', 'main'], { env } = {}) {
      return run(dir, ['push', ...args], { env });
    },

    /** What the remote has for a ref, or null if it has no such ref. */
    remoteSha(ref = 'refs/heads/main') {
      const res = run(remote, ['rev-parse', ref]);
      return res.status === 0 ? res.stdout.trim() : null;
    },

    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };

  // Seed commit: repo scaffolding, pushed before the hook exists so setup
  // itself is never gated.
  repo.writeFile('README.md', '# scratch\n');
  repo.writeFile('.gitignore', '.pushback/verified\n');
  if (config) repo.writeFile('.pushback/config.json', JSON.stringify(config, null, 2) + '\n');
  repo.commit('chore: seed');
  must(dir, ['push', '-u', 'origin', 'main']);

  if (hook) repo.installHook(hook);

  return repo;
}
