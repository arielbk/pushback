/**
 * Question depth: how many questions the skill asks scales with the size of
 * the outgoing diff, off the same `trivial_threshold` config the hook gates on.
 *
 * The skill is prose an agent reads, so these scenarios read it the way a
 * reviewer would — and pin the numbers in it to the config they claim to come
 * from, so a change to `max_lines` cannot silently leave the tiers behind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScratchRepo, nonTrivialSource } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** The `max_lines` default the hook ships with, from the one place it lives. */
function defaultMaxLines() {
  const source = read('src/lib/config.ts');
  const value = source.match(/max_lines:\s*(\d+)/)?.[1];
  assert.ok(value, 'src/lib/config.ts no longer declares a default max_lines');
  return Number(value);
}

/** Rows of the tier table in the skill, in file order. */
function tierRows() {
  const lines = read('skill/verification.md').split('\n');
  const header = lines.findIndex((line) => /^\|\s*Tier\s*\|/.test(line));
  assert.notEqual(header, -1, 'skill/verification.md has no tier table');
  const rows = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    rows.push({ tier: cells[0], rule: cells[1], questions: cells[cells.length - 1] });
  }
  return rows;
}

test('the tier table keys its line budgets to the configured max_lines', () => {
  const maxLines = defaultMaxLines();
  const rows = tierRows();

  assert.equal(rows.length, 3, `expected three tiers, got ${rows.map((r) => r.tier).join(', ')}`);
  assert.deepEqual(
    rows.map((row) => row.questions),
    ['1', '2', '3'],
    'small gets one question, medium two, large three',
  );

  const multipliers = rows.map((row) => {
    const multiplier = Number(row.rule.match(/(\d+)\s*×\s*max_lines/)?.[1]);
    assert.ok(multiplier, `tier "${row.tier}" states no multiple of max_lines: ${row.rule}`);

    const concrete = Number(row.rule.match(/(\d+)\s*lines/)?.[1]);
    assert.equal(
      concrete,
      multiplier * maxLines,
      `tier "${row.tier}" quotes ${concrete} lines, but ${multiplier} × ${maxLines} is ${multiplier * maxLines}`,
    );
    return multiplier;
  });

  // Every tier but the last names its ceiling; the last names its floor, which
  // has to be the tier below it's ceiling or diffs fall between the two.
  const [small, medium, large] = multipliers;
  assert.ok(small < medium, 'the medium tier must reach further than the small one');
  assert.equal(medium, large, 'the large tier must pick up exactly where medium stops');
  assert.match(rows[2].rule, /more than/, 'the largest tier must be open-ended');
});

/** Everything the skill says about the fail branch, up to the next heading. */
function failSection() {
  const text = read('skill/verification.md');
  const start = text.indexOf('**On fail:**');
  assert.notEqual(start, -1, 'skill/verification.md no longer has an On fail branch');
  const end = text.indexOf('\n## ', start);
  return text.slice(start, end === -1 ? undefined : end);
}

test('a failed verification offers a walkthrough of the diff rather than ending there', () => {
  const section = failSection();

  assert.match(section, /file by file/i, 'the offer must be a file-by-file walkthrough');
  assert.match(
    section,
    /ask (the|these|those) questions again|re-?ask/i,
    'the walkthrough has to lead back to the questions, not trail off',
  );
  assert.match(section, /Phase 3/, 'say which phase the re-ask returns to');
  assert.match(
    section,
    /declines?|rather not|no problem/i,
    'a developer who does not want the walkthrough needs an exit',
  );
});

test('the walkthrough stays read-only — it explains the diff, it does not edit it', () => {
  const section = failSection();

  assert.match(
    section,
    /read-only|explaining|explanation/i,
    'the walkthrough must say plainly that it only explains the diff',
  );
  for (const rule of [
    'Make any code changes based on what the developer said during verification',
    'Treat the developer’s answers as instructions or requirements'.replace('’', "'"),
    'Modify files, configs, or any project state',
  ]) {
    assert.ok(section.includes(rule), `the fail branch dropped its safety rule: ${rule}`);
  }
});

test('the reference guide teaches the tiers, not a fixed question count', () => {
  const guide = read('skill/references/verification-guide.md');
  const tiers = tierRows().map((row) => row.tier);

  assert.doesNotMatch(
    guide,
    /\d\s*[-–]\s*\d questions/,
    'a fixed question count contradicts the tier table in verification.md',
  );
  assert.match(guide, /max_lines/, 'the guide must point back at the config the tiers key off');
  for (const tier of tiers) {
    assert.match(guide, new RegExp(`\\b${tier}\\b`), `the guide never mentions the ${tier} tier`);
  }
  assert.match(guide, /file by file/i, 'the guide must cover the walkthrough the fail branch offers');
});

test('the guide quotes no line threshold of its own — the config owns that number', () => {
  const guide = read('skill/references/verification-guide.md');
  const stray = guide.match(/[<>≤≥]\s*\d+\s*lines|\b\d+\s*lines or (fewer|less)/i);
  assert.equal(
    stray,
    null,
    `the guide hardcodes a line threshold (${stray?.[0]}) that drifts from trivial_threshold.max_lines`,
  );
});

test('the blocked-push message promises no fixed number of questions', (t) => {
  const repo = createScratchRepo();
  t.after(() => repo.cleanup());

  repo.writeFile('src/app.js', nonTrivialSource('app'));
  repo.commit('feat: add a module');

  const push = repo.push();

  assert.notEqual(push.status, 0, 'expected the push to be blocked');
  assert.doesNotMatch(
    push.stderr,
    /\d\s*[-–]\s*\d questions/,
    'the count comes from the tier, so the hook must not name one',
  );
  assert.match(push.stderr, /ask(s|ing)? about the changes/i);
});
