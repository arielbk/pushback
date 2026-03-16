#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Helpers ──────────────────────────────────────────────────────────────

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

function log(msg) {
  console.log(`  ${msg}`);
}

// ── Paths ────────────────────────────────────────────────────────────────

const repoRoot = git('rev-parse --show-toplevel');
const skillDir = path.resolve(__dirname, '..');
const hookSrc = path.join(skillDir, 'scripts', 'pre-push.cjs');
const installSrc = path.join(skillDir, 'scripts', 'install.cjs');
const pushbackDir = path.join(repoRoot, '.pushback');
const hooksDestDir = path.join(pushbackDir, 'hooks');
const configFile = path.join(pushbackDir, 'config.json');
const gitignorePath = path.join(repoRoot, '.gitignore');

console.log('Pushback: running setup...');

// ── Create .pushback/ structure ──────────────────────────────────────────

fs.mkdirSync(hooksDestDir, { recursive: true });

// Copy hook logic to .pushback/hooks/pre-push.cjs (version-controlled)
fs.copyFileSync(hookSrc, path.join(hooksDestDir, 'pre-push.cjs'));
log('\u2713 Hook script installed at .pushback/hooks/pre-push.cjs');

// Copy install script to .pushback/hooks/install.cjs
fs.copyFileSync(installSrc, path.join(hooksDestDir, 'install.cjs'));
log('\u2713 Install script at .pushback/hooks/install.cjs');

// Write default config if not present
if (!fs.existsSync(configFile)) {
  const defaultConfig = {
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
  fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2) + '\n');
  log('\u2713 Created .pushback/config.json with defaults');
} else {
  log('\u00b7 .pushback/config.json already exists, skipping');
}

// ── Add receipt to .gitignore ────────────────────────────────────────────

const ignoreEntry = '.pushback/verified';
if (fs.existsSync(gitignorePath)) {
  const content = fs.readFileSync(gitignorePath, 'utf8');
  if (!content.includes(ignoreEntry)) {
    fs.appendFileSync(
      gitignorePath,
      `\n# Pushback \u2014 local verification receipt\n${ignoreEntry}\n`
    );
    log('\u2713 Added .pushback/verified to .gitignore');
  } else {
    log('\u00b7 .pushback/verified already in .gitignore, skipping');
  }
} else {
  fs.writeFileSync(
    gitignorePath,
    `# Pushback \u2014 local verification receipt\n${ignoreEntry}\n`
  );
  log('\u2713 Created .gitignore with .pushback/verified entry');
}

// ── Install the git hook shim ────────────────────────────────────────────
// Installs a shell shim at .git/hooks/pre-push that calls the hook logic.
// If a hook manager (Husky, lefthook, etc.) is in use, the agent handles
// integration after setup — see SKILL.md for details.

const gitHooksDir = path.join(repoRoot, '.git', 'hooks');
const prePushHook = path.join(gitHooksDir, 'pre-push');

const shimContent = `#!/usr/bin/env sh
# Pushback pre-push hook
exec node "$(git rev-parse --show-toplevel)/.pushback/hooks/pre-push.cjs" "$@"
`;

if (fs.existsSync(prePushHook)) {
  const existing = fs.readFileSync(prePushHook, 'utf8');
  if (existing.includes('Pushback') || existing.includes('.pushback')) {
    fs.writeFileSync(prePushHook, shimContent);
    try { fs.chmodSync(prePushHook, 0o755); } catch {}
    log('\u2713 Updated existing Pushback pre-push hook');
  } else {
    // Someone else's hook — back it up and chain
    const previousPath = prePushHook + '.previous';
    if (!fs.existsSync(previousPath)) {
      fs.renameSync(prePushHook, previousPath);
      log('\u2713 Existing pre-push hook backed up to pre-push.previous');
    }
    fs.writeFileSync(prePushHook, shimContent);
    try { fs.chmodSync(prePushHook, 0o755); } catch {}
    log('\u2713 Installed Pushback pre-push hook (chains to previous hook)');
  }
} else {
  fs.mkdirSync(gitHooksDir, { recursive: true });
  fs.writeFileSync(prePushHook, shimContent);
  try { fs.chmodSync(prePushHook, 0o755); } catch {}
  log('\u2713 Installed pre-push hook at .git/hooks/pre-push');
}

// ── GitHub Action ────────────────────────────────────────────────────────

const workflowDir = path.join(repoRoot, '.github', 'workflows');
const workflowFile = path.join(workflowDir, 'pushback.yml');
const workflowTemplate = path.join(skillDir, 'references', 'pushback-workflow.yml');

if (fs.existsSync(workflowFile)) {
  log('\u00b7 .github/workflows/pushback.yml already exists, skipping');
} else if (fs.existsSync(workflowTemplate)) {
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.copyFileSync(workflowTemplate, workflowFile);
  log('\u2713 Installed GitHub Action workflow at .github/workflows/pushback.yml');
} else {
  log('\u00b7 Workflow template not found, skipping GitHub Action setup');
}

// ── Done ─────────────────────────────────────────────────────────────────

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
