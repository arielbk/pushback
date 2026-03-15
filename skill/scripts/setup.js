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
const hookSrc = path.join(skillDir, 'scripts', 'pre-push.js');
const installSrc = path.join(skillDir, 'scripts', 'install.js');
const pushbackDir = path.join(repoRoot, '.pushback');
const hooksDestDir = path.join(pushbackDir, 'hooks');
const configFile = path.join(pushbackDir, 'config.json');
const gitignorePath = path.join(repoRoot, '.gitignore');
const packageJsonPath = path.join(repoRoot, 'package.json');

console.log('Pushback: running setup...');

// ── Create .pushback/ structure ──────────────────────────────────────────

fs.mkdirSync(hooksDestDir, { recursive: true });

// Copy hook logic to .pushback/hooks/pre-push.js (version-controlled)
fs.copyFileSync(hookSrc, path.join(hooksDestDir, 'pre-push.js'));
log('\u2713 Hook script installed at .pushback/hooks/pre-push.js');

// Copy install script to .pushback/hooks/install.js (for prepare script)
fs.copyFileSync(installSrc, path.join(hooksDestDir, 'install.js'));
log('\u2713 Install script at .pushback/hooks/install.js');

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

// ── Detect hook manager and install persistently ─────────────────────────

const huskyDir = path.join(repoRoot, '.husky');
const lefthookYml = path.join(repoRoot, 'lefthook.yml');
const lefthookDotYml = path.join(repoRoot, '.lefthook.yml');

const PUSHBACK_HOOK_LINE = 'node .pushback/hooks/pre-push.js';
let hookInstalled = false;

// ── Strategy 1: Husky ────────────────────────────────────────────────────
// Husky v9+ uses .husky/<hook-name> files that run as shell scripts.
// These are committed, and Husky installs them for every developer.

if (fs.existsSync(huskyDir)) {
  const huskyPrePush = path.join(huskyDir, 'pre-push');

  if (fs.existsSync(huskyPrePush)) {
    const content = fs.readFileSync(huskyPrePush, 'utf8');
    if (content.includes('.pushback')) {
      log('\u00b7 Pushback already in .husky/pre-push, skipping');
    } else {
      // Append to existing husky pre-push
      fs.appendFileSync(huskyPrePush, `\n${PUSHBACK_HOOK_LINE}\n`);
      log('\u2713 Added Pushback to existing .husky/pre-push');
    }
  } else {
    // Create new husky pre-push file
    fs.writeFileSync(huskyPrePush, `${PUSHBACK_HOOK_LINE}\n`);
    try { fs.chmodSync(huskyPrePush, 0o755); } catch {}
    log('\u2713 Created .husky/pre-push with Pushback hook');
  }

  hookInstalled = true;
}

// ── Strategy 2: lefthook ─────────────────────────────────────────────────
// lefthook uses a YAML config. We add a pre-push command.

const lefthookPath = fs.existsSync(lefthookYml)
  ? lefthookYml
  : fs.existsSync(lefthookDotYml)
    ? lefthookDotYml
    : null;

if (!hookInstalled && lefthookPath) {
  const content = fs.readFileSync(lefthookPath, 'utf8');

  if (content.includes('.pushback')) {
    log('\u00b7 Pushback already in lefthook config, skipping');
  } else {
    // Append a pre-push section
    const entry = `
pre-push:
  commands:
    pushback:
      run: ${PUSHBACK_HOOK_LINE}
`;
    fs.appendFileSync(lefthookPath, entry);
    log('\u2713 Added Pushback pre-push command to lefthook config');
  }

  hookInstalled = true;
}

// ── Strategy 3: package.json prepare script ──────────────────────────────
// If there's a package.json but no hook manager, add a "prepare" script
// that runs install.js. This mirrors what Husky does — every `npm install`
// triggers hook installation.

if (!hookInstalled && fs.existsSync(packageJsonPath)) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const prepareCmd = 'node .pushback/hooks/install.js';

  if (!pkg.scripts) pkg.scripts = {};

  const existing = pkg.scripts.prepare || '';

  if (existing.includes('.pushback')) {
    log('\u00b7 Pushback already in package.json prepare script, skipping');
  } else if (existing) {
    // Append to existing prepare script
    pkg.scripts.prepare = `${existing} && ${prepareCmd}`;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
    log('\u2713 Appended Pushback to existing prepare script in package.json');
  } else {
    pkg.scripts.prepare = prepareCmd;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
    log('\u2713 Added prepare script to package.json');
  }

  hookInstalled = true;
}

// ── Strategy 4: No hook manager, no package.json ─────────────────────────
// Fall back to direct shim installation. Warn that teammates need to run
// setup or add a hook manager.

if (!hookInstalled) {
  log('\u26a0 No hook manager (Husky, lefthook) or package.json detected.');
  log('  Teammates will need to run setup manually after cloning,');
  log('  or add a hook manager to automate hook installation.');
}

// ── Always install the git shim for the current developer ────────────────
// Regardless of hook manager, make sure THIS machine has the hook now.

const gitHooksDir = path.join(repoRoot, '.git', 'hooks');
const prePushHook = path.join(gitHooksDir, 'pre-push');

fs.mkdirSync(gitHooksDir, { recursive: true });

const shimContent = `#!/usr/bin/env node
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
require(path.join(root, '.pushback', 'hooks', 'pre-push.js'));
`;

if (fs.existsSync(prePushHook)) {
  const existing = fs.readFileSync(prePushHook, 'utf8');
  if (existing.includes('Pushback') || existing.includes('.pushback')) {
    // Already our hook — overwrite with latest shim
    fs.writeFileSync(prePushHook, shimContent);
    try { fs.chmodSync(prePushHook, 0o755); } catch {}
    log('\u2713 Updated existing Pushback pre-push hook');
  } else if (!hookInstalled) {
    // Someone else's hook and no hook manager — preserve and chain
    const previousPath = prePushHook + '.previous';
    if (!fs.existsSync(previousPath)) {
      fs.renameSync(prePushHook, previousPath);
      log('\u2713 Existing pre-push hook backed up to pre-push.previous');
    }
    fs.writeFileSync(prePushHook, shimContent);
    try { fs.chmodSync(prePushHook, 0o755); } catch {}
    log('\u2713 Installed Pushback pre-push hook (chains to previous hook)');
  }
  // If a hook manager is handling it AND there's a non-pushback hook,
  // leave it alone — the hook manager owns that file.
} else {
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
console.log('  Gate:     .git/hooks/pre-push (blocks all pushes)');
console.log('  Config:   .pushback/config.json');
console.log('  Receipt:  .pushback/verified (gitignored)');
console.log('  CI:       .github/workflows/pushback.yml');
if (hookInstalled) {
  console.log('');
  console.log('  Hook persistence: teammates will get the hook automatically.');
} else {
  console.log('');
  console.log('  \u26a0 Hook persistence: teammates must run setup manually.');
  console.log('  Consider adding Husky or a package.json to automate this.');
}
console.log('');
console.log('  To override verification for a single push:');
console.log('    PUSHBACK_OVERRIDE=1 git push');
