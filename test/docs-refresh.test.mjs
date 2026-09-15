/**
 * Docs refresh: the prose a reader lands on must describe the system that
 * actually ships — the `pushback-cli` architecture, the tiered questions, the
 * summary block — and must not over-claim what the CI check proves.
 *
 * These scenarios read the docs the way a new reader would, and grep for the
 * specific claims earlier slices made false.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Every prose file a reader of this repo is pointed at. */
const DOCS = ['README.md', 'action/README.md', 'docs/technical-spec.md'];

/** `rel: [line, ...]` for every doc line matching `pattern`. */
function docLines(pattern) {
  const hits = {};
  for (const rel of DOCS) {
    const matched = read(rel)
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => pattern.test(line))
      .map(([n, line]) => `${rel}:${n}: ${line.trim()}`);
    if (matched.length) hits[rel] = matched;
  }
  return Object.values(hits).flat();
}

test('no doc calls the verification trailer cryptographic', () => {
  const hits = docLines(/cryptograph/i);

  assert.deepEqual(
    hits,
    [],
    'the trailer is a plain SHA-256 of the diff, not a signature:\n' + hits.join('\n'),
  );
});

/** The body of a `## `-level README section, heading excluded. */
function readmeSection(heading) {
  const lines = read('README.md').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  assert.notEqual(start, -1, `README.md has no "## ${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

test('the README says what the CI check does not prove, not just what it does', () => {
  const section = readmeSection('For teams: CI verification');

  assert.match(
    section,
    /does not prove|doesn't prove/i,
    'the trailer proves a conversation happened, not that the code is correct — say so',
  );
  const overclaim = docLines(/every push represents code the author engaged with/i);
  assert.deepEqual(
    overclaim,
    [],
    'a trailer cannot vouch for the quality of the engagement behind it:\n' + overclaim.join('\n'),
  );
});

test('no doc describes the retired .pushback/hooks/*.cjs layout', () => {
  const hits = docLines(/\.cjs/);

  assert.deepEqual(
    hits,
    [],
    'the hook logic ships as the pushback-cli binary, not as committed .cjs scripts:\n' +
      hits.join('\n'),
  );
});

test('no doc still documents the retired `triggers` config field', () => {
  // Only the config key, not the English word — `triggers` reads naturally in prose.
  const hits = docLines(/["`']triggers["`']/);

  assert.deepEqual(
    hits,
    [],
    'nothing has ever read `triggers`; the config no longer accepts it:\n' + hits.join('\n'),
  );
});

test('the spec quotes the block message the CLI actually prints', () => {
  const source = read('src/commands/check.ts');
  const message = source.match(/process\.stderr\.write\(`([\s\S]*?)`\);/)?.[1];
  assert.ok(message, 'src/commands/check.ts no longer writes a block message');

  assert.ok(
    read('docs/technical-spec.md').includes(message.trim()),
    'the block message in docs/technical-spec.md has drifted from the one in check.ts:\n' +
      message.trim(),
  );
});

test('the action README documents the summary block it renders', () => {
  const script = read('action/verify-pr.sh');
  const key = script.match(/^SUMMARY_KEY="([^"]+)"/m)?.[1];
  assert.ok(key, 'action/verify-pr.sh no longer declares SUMMARY_KEY');
  const column = script.match(/^TABLE="\|.*\|\s*([A-Za-z ]+?)\s*\|"/m)?.[1];
  assert.ok(column, 'action/verify-pr.sh no longer declares a summary table header');

  const doc = read('action/README.md');
  assert.ok(doc.includes(key), `action/README.md never mentions the ${key} trailer`);
  for (const label of ['Intent:', 'Touches:', 'Risk:']) {
    assert.ok(doc.includes(label), `action/README.md does not show the ${label} line`);
  }
  assert.ok(
    doc.includes(column),
    `action/README.md does not name the "${column}" column the action renders`,
  );
});

test('the skill checks for a string the installed hook actually contains', () => {
  const source = read('src/lib/shim.ts');
  const npx = source.match(/PUSHBACK_NPX = '([^']+)'/)?.[1];
  const template = source.match(/SHIM_CONTENT = `([\s\S]*?)`;/)?.[1];
  assert.ok(npx && template, 'src/lib/shim.ts no longer declares the shim body');
  const shim = template.replaceAll('${PUSHBACK_NPX}', npx);

  const pattern = read('skill/SKILL.md').match(/grep -q '([^']+)' \.git\/hooks\/pre-push/)?.[1];
  assert.ok(pattern, 'skill/SKILL.md no longer greps .git/hooks/pre-push to detect the install');

  assert.ok(
    shim.includes(pattern),
    `SKILL.md looks for "${pattern}", which the installed shim does not contain:\n${shim}`,
  );
  assert.equal(
    pattern,
    'pushback check',
    'match the command the shim runs, not the .pushback directory it no longer names',
  );
});

test('no doc promises a fixed 2-3 questions — the count scales with the diff', () => {
  const hits = docLines(/\b2\s*[-–]\s*3\s+(probing\s+)?questions\b/i);

  assert.deepEqual(
    hits,
    [],
    'question count comes from the tiers in skill/verification.md, not a fixed range:\n' +
      hits.join('\n'),
  );
});

test('the README explains what verification leaves on the commit', () => {
  const section = readmeSection('How it works');

  for (const trailer of ['Pushback-Verified', 'Pushback-Summary']) {
    assert.ok(
      section.includes(trailer),
      `"How it works" never mentions the ${trailer} trailer a pass writes`,
    );
  }
});

test('the spec\'s repo layout names files that exist', () => {
  const spec = read('docs/technical-spec.md');
  const tree = spec.match(/```\npushback\/\n([\s\S]*?)```/)?.[1];
  assert.ok(tree, 'docs/technical-spec.md no longer draws the repo layout');

  const missing = [];
  for (const line of tree.split('\n')) {
    // Strip the box-drawing gutter and the trailing `# comment`.
    const entry = line.replace(/^[│├└─\s]+/, '').split('#')[0].trim();
    if (!entry || entry.endsWith('/')) continue;
    if (!fs.existsSync(path.join(root, entry)) && findByName(entry).length === 0) {
      missing.push(entry);
    }
  }

  assert.deepEqual(missing, [], 'the layout diagram lists files this repo does not have');
});

/** Every path in the repo whose basename is `name`, ignoring build output. */
function findByName(name, dir = root, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findByName(name, full, found);
    else if (entry.name === name) found.push(full);
  }
  return found;
}
