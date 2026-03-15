#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const { createHash } = require('crypto');
const { readFileSync, existsSync, chmodSync } = require('fs');
const path = require('path');

// ── Helpers ──────────────────────────────────────────────────────────────

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

function gitOrNull(cmd) {
  try {
    return git(cmd);
  } catch {
    return null;
  }
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

// Raw execSync for diff — don't trim, hash must match exact output
function gitDiff(cmd) {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

// ── Chain to previous hook on success ────────────────────────────────────

function chainAndExit() {
  const hooksDir = path.resolve(
    gitOrNull('rev-parse --show-toplevel') || process.cwd(),
    '.git', 'hooks'
  );
  const previous = path.join(hooksDir, 'pre-push.previous');

  if (existsSync(previous)) {
    try {
      execSync(previous, {
        stdio: 'inherit',
        argv0: previous,
      });
    } catch (err) {
      process.exit(err.status || 1);
    }
  }

  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────────

const projectRoot = gitOrNull('rev-parse --show-toplevel') || process.cwd();
const configPath = path.join(projectRoot, '.pushback', 'config.json');
const receiptPath = path.join(projectRoot, '.pushback', 'verified');

// Load override var name from config
let overrideVar = 'PUSHBACK_OVERRIDE';
if (existsSync(configPath)) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.override_env_var) {
      overrideVar = config.override_env_var;
    }
  } catch {
    // Bad config — fall back to default
  }
}

// Check override env var
if (process.env[overrideVar]) {
  chainAndExit();
}

// Compute outgoing diff hash
let diff;
if (gitOrNull('rev-parse @{upstream}') !== null) {
  diff = gitDiff('diff @{upstream}..HEAD');
} else {
  // Detect default branch for new branches with no upstream
  let defaultBranch = 'main';
  const remoteInfo = gitOrNull('remote show origin');
  if (remoteInfo) {
    const match = remoteInfo.match(/HEAD branch:\s*(\S+)/);
    if (match) defaultBranch = match[1];
  }
  diff = gitDiff(`diff ${defaultBranch}..HEAD`);
}

// Nothing to push — allow
if (!diff) {
  chainAndExit();
}

const currentHash = sha256(diff);

// Compare against receipt
if (existsSync(receiptPath)) {
  const storedHash = readFileSync(receiptPath, 'utf8').trim();
  if (currentHash === storedHash) {
    chainAndExit();
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
