import fs from 'fs';
import path from 'path';
import { repoRoot } from '../lib/git.js';
import { DEFAULT_CONFIG } from '../lib/config.js';
import {
  pushbackDir,
  configPath,
  gitHooksDir,
  prePushHook,
  gitignorePath,
} from '../lib/paths.js';
import { SHIM_CONTENT } from '../lib/shim.js';

const WORKFLOW_YAML = `name: Pushback Verification

on:
  pull_request:
    branches: [main]

jobs:
  verify:
    name: Verify developer understanding
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: arielbk/pushback/action@main
`;

function log(msg: string): void {
  console.log(`  ${msg}`);
}

export function setup(): void {
  const root = repoRoot();

  console.log('Pushback: running setup...');

  // ── Create .pushback/ directory ──────────────────────────────────────
  const pbDir = pushbackDir();
  fs.mkdirSync(pbDir, { recursive: true });

  // Write default config if not present
  const cfgPath = configPath();
  if (!fs.existsSync(cfgPath)) {
    fs.writeFileSync(cfgPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    log('\u2713 Created .pushback/config.json with defaults');
  } else {
    log('\u00b7 .pushback/config.json already exists, skipping');
  }

  // ── Add receipt to .gitignore ────────────────────────────────────────
  const ignoreEntry = '.pushback/verified';
  const giPath = gitignorePath();
  if (fs.existsSync(giPath)) {
    const content = fs.readFileSync(giPath, 'utf8');
    if (!content.includes(ignoreEntry)) {
      fs.appendFileSync(
        giPath,
        `\n# Pushback \u2014 local verification receipt\n${ignoreEntry}\n`
      );
      log('\u2713 Added .pushback/verified to .gitignore');
    } else {
      log('\u00b7 .pushback/verified already in .gitignore, skipping');
    }
  } else {
    fs.writeFileSync(
      giPath,
      `# Pushback \u2014 local verification receipt\n${ignoreEntry}\n`
    );
    log('\u2713 Created .gitignore with .pushback/verified entry');
  }

  // ── Install the git hook shim ────────────────────────────────────────
  const hooksDir = gitHooksDir();
  const hook = prePushHook();

  if (fs.existsSync(hook)) {
    const existing = fs.readFileSync(hook, 'utf8');
    if (existing.includes('Pushback') || existing.includes('.pushback') || existing.includes('pushback')) {
      fs.writeFileSync(hook, SHIM_CONTENT);
      try { fs.chmodSync(hook, 0o755); } catch {}
      log('\u2713 Updated existing Pushback pre-push hook');
    } else {
      // Someone else's hook — back it up and chain
      const previousPath = hook + '.previous';
      if (!fs.existsSync(previousPath)) {
        fs.renameSync(hook, previousPath);
        log('\u2713 Existing pre-push hook backed up to pre-push.previous');
      }
      fs.writeFileSync(hook, SHIM_CONTENT);
      try { fs.chmodSync(hook, 0o755); } catch {}
      log('\u2713 Installed Pushback pre-push hook (chains to previous hook)');
    }
  } else {
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(hook, SHIM_CONTENT);
    try { fs.chmodSync(hook, 0o755); } catch {}
    log('\u2713 Installed pre-push hook at .git/hooks/pre-push');
  }

  // ── GitHub Action ────────────────────────────────────────────────────
  const workflowDir = path.join(root, '.github', 'workflows');
  const workflowFile = path.join(workflowDir, 'pushback.yml');

  if (fs.existsSync(workflowFile)) {
    log('\u00b7 .github/workflows/pushback.yml already exists, skipping');
  } else {
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(workflowFile, WORKFLOW_YAML);
    log('\u2713 Installed GitHub Action workflow at .github/workflows/pushback.yml');
  }

  // ── Done ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('Pushback setup complete.');
  console.log('');
  console.log('  Gate:     .git/hooks/pre-push');
  console.log('  Config:   .pushback/config.json');
  console.log('  Receipt:  .pushback/verified (gitignored)');
  console.log('  CI:       .github/workflows/pushback.yml');
  console.log('');
  console.log('  To override verification for a single push:');
  console.log('    PUSHBACK_OVERRIDE=1 git push');
}
