import { execSync } from 'child_process';
import fs from 'fs';
import { configPath, gitHooksDir, prePushHook } from '../lib/paths.js';
import { SHIM_CONTENT } from '../lib/shim.js';

export function install(): void {
  // Only run if we're in a git repo
  let repoRoot: string;
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // Not a git repo (e.g. installing from npm tarball) — skip silently
    process.exit(0);
  }

  // Guard: pushback must be set up in this project
  const cfgPath = configPath();
  if (!fs.existsSync(cfgPath)) {
    // Pushback not set up in this project — skip silently
    process.exit(0);
  }

  const hook = prePushHook();

  // Already installed?
  if (fs.existsSync(hook)) {
    const existing = fs.readFileSync(hook, 'utf8');
    if (existing === SHIM_CONTENT) {
      // The current shim is already in place — done
      process.exit(0);
    }
    if (!existing.includes('pushback')) {
      // Someone else's hook — back it up
      const previousPath = hook + '.previous';
      if (!fs.existsSync(previousPath)) {
        fs.renameSync(hook, previousPath);
      }
    }
    // An older Pushback shim falls through and is overwritten in place, so
    // upgrades reach developers who already ran install once.
  }

  // Write the shim
  const hooksDir = gitHooksDir();
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hook, SHIM_CONTENT);
  try {
    fs.chmodSync(hook, 0o755);
  } catch {
    // chmod may not work on Windows — that's ok, Git Bash uses the shebang
  }

  console.log('Pushback: pre-push hook installed.');
}
