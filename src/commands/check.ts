import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { gitOrNull, gitDiff } from '../lib/git.js';
import { loadConfig } from '../lib/config.js';
import { receiptPath, gitHooksDir } from '../lib/paths.js';
import { parseRefLines, isNullSha, RefUpdate } from '../lib/refs.js';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * The hook's stdin, read once. Everything downstream — the diff basis and the
 * chained previous hook — works off this buffer, so it must not be consumed
 * twice.
 */
function readStdin(): string {
  // A terminal never sends ref lines, and reading one would block until the
  // developer hits Ctrl-D.
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function chainAndExit(stdin: string): never {
  const hooksDir = gitHooksDir();
  const previous = path.join(hooksDir, 'pre-push.previous');

  if (existsSync(previous)) {
    try {
      execFileSync(previous, process.argv.slice(3), {
        input: stdin,
        stdio: ['pipe', 'inherit', 'inherit'],
      });
    } catch (err: any) {
      process.exit(err.status || 1);
    }
  }

  process.exit(0);
}

/**
 * Git's own empty-tree object: diffing from it yields the whole of a tree.
 * The honest basis when we cannot tell what the remote's default branch is.
 */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Where a brand-new remote branch's diff starts from.
 *
 * `git symbolic-ref` reads the remote-tracking HEAD that `git clone` wrote —
 * a local ref lookup. The obvious alternative, `git remote show <remote>`,
 * opens a connection to the remote: inside a pre-push hook that means a second
 * round trip, and on an unreachable remote it hangs the developer's push.
 */
function defaultRemoteBase(): string {
  // `$1` to a pre-push hook is the remote name (or its URL, if it has no name).
  const remote = process.argv[3] || 'origin';
  for (const name of [remote, 'origin']) {
    const ref = gitOrNull(`symbolic-ref refs/remotes/${name}/HEAD`);
    if (ref) return ref;
    // Some clones carry a non-symbolic remote HEAD; it is still a usable base.
    const direct = gitOrNull(`rev-parse --verify --quiet refs/remotes/${name}/HEAD`);
    if (direct) return direct;
  }
  // No remote HEAD to compare against (an old clone, or one made before the
  // remote had any commits). Treat the whole branch as outgoing rather than
  // guessing a default branch — over-asking beats waving a push through.
  return EMPTY_TREE;
}

/** The diff a single ref update would put on the remote. */
function diffForRef(update: RefUpdate): string {
  if (isNullSha(update.localSha)) return ''; // branch deletion — nothing to read
  const base = isNullSha(update.remoteSha) ? defaultRemoteBase() : update.remoteSha;
  return gitDiff(`diff ${base}..${update.localSha}`);
}

/**
 * What `pushback check` hashes when it was given no ref lines — someone ran it
 * by hand rather than through the hook, so we have to guess at the destination.
 */
function guessedOutgoingDiff(): string {
  const base = gitOrNull('rev-parse @{upstream}') !== null ? '@{upstream}' : defaultRemoteBase();
  return gitDiff(`diff ${base}..HEAD`);
}

/** Everything this push would put on the remote, in the order git listed it. */
function outgoingDiff(stdin: string): string {
  const updates = parseRefLines(stdin);
  if (updates.length === 0) return guessedOutgoingDiff();
  return updates.map(diffForRef).join('');
}

export function check(): void {
  const config = loadConfig();
  const stdin = readStdin();

  // Check override env var
  if (process.env[config.override_env_var]) {
    chainAndExit(stdin);
  }

  const diff = outgoingDiff(stdin);

  // Nothing to push — allow
  if (!diff) {
    chainAndExit(stdin);
  }

  const currentHash = sha256(diff);

  // Compare against receipt
  const receipt = receiptPath();
  if (existsSync(receipt)) {
    const storedHash = readFileSync(receipt, 'utf8').trim();
    if (currentHash === storedHash) {
      chainAndExit(stdin);
    }
  }

  // Block
  process.stderr.write(`
Pushback: verification required before pushing.

This push was blocked because the developer hasn't verified their
understanding of the outgoing changes yet.

To proceed, run the Pushback skill — it will walk through the diff,
ask 2-3 questions about the changes, and write a verification receipt
if the developer demonstrates understanding. The push will succeed
on retry once the receipt is in place.

  If you're the developer: ask your AI agent to run Pushback, or
  invoke it directly in your editor's chat.

  If you're an AI agent: invoke the "pushback" skill now. Do not
  attempt to bypass verification, skip the hook, or write the
  receipt directly — the developer must go through the conversation.

`);

  process.exit(1);
}
