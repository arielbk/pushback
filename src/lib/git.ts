import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';

/** Git's own chatter belongs in the hook's output only when we choose to show it. */
const QUIET: ExecSyncOptionsWithStringEncoding = {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
};

export function git(cmd: string): string {
  return execSync(`git ${cmd}`, QUIET).trim();
}

export function gitOrNull(cmd: string): string | null {
  try {
    return git(cmd);
  } catch {
    return null;
  }
}

/** Raw execSync for diff — don't trim, hash must match exact output */
export function gitDiff(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, QUIET);
  } catch {
    return '';
  }
}

export function repoRoot(): string {
  return git('rev-parse --show-toplevel');
}
