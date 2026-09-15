import { gitDiff } from './git.js';
import { TrivialThreshold } from './config.js';

interface FileChange {
  path: string;
  /** Lines added plus lines removed, or null for a binary file. */
  lines: number | null;
}

/**
 * `git diff --numstat` gives one `<added> TAB <removed> TAB <path>` line per
 * file, with `-` in place of the counts for a binary file.
 *
 * `-w` is what makes a reindent free: git drops the file from the list when
 * every one of its changed lines differs only in whitespace, so whitespace-only
 * work costs nothing against the line budget.
 */
function fileChanges(ranges: string[]): FileChange[] {
  const changes: FileChange[] = [];
  for (const range of ranges) {
    const out = gitDiff(`diff --numstat -w ${range}`);
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [added, removed, ...rest] = line.split('\t');
      const filePath = rest.join('\t');
      if (!filePath) continue;
      const binary = added === '-' || removed === '-';
      changes.push({
        path: filePath,
        lines: binary ? null : Number(added) + Number(removed),
      });
    }
  }
  return changes;
}

/**
 * Glob match in the shape developers already expect from `.gitignore`: `*` and
 * `?` stand in for path segments' contents, and a pattern with no `/` in it
 * matches the file's name anywhere in the tree (`*.lock` catches `a/b/c.lock`).
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  const subject = pattern.includes('/') ? filePath : filePath.split('/').pop() || filePath;
  const source = pattern
    .split('')
    .map((ch) => {
      if (ch === '*') return '[^/]*';
      if (ch === '?') return '[^/]';
      return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`).test(subject);
}

/** Files nobody reads in review: lockfiles, generated output, and the like. */
function isIgnored(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

/** Is this push small enough that asking about it would only be friction? */
export function isTrivial(ranges: string[], threshold: TrivialThreshold): boolean {
  // Callers only reach here with a non-empty diff, so an empty list means every
  // changed line was whitespace.
  const changes = fileChanges(ranges);
  if (changes.length === 0) return true;

  // Ignored files carry no reviewable content, so they neither count towards
  // the line budget nor keep a push from being trivial on their own.
  const reviewable = changes.filter((change) => !isIgnored(change.path, threshold.ignore_patterns));
  if (reviewable.length === 0) return true;

  let lines = 0;
  for (const change of reviewable) {
    if (change.lines === null) return false; // a binary file is unreadable, not trivial
    lines += change.lines;
  }
  return lines <= threshold.max_lines;
}
