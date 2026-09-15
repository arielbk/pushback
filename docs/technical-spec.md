# Pushback — Technical Specification

This document covers the implementation architecture for Pushback v1 as defined in the [Product Requirements Document](./prd-pushback.md). It uses a native git pre-push hook to gate all pushes — from any client (terminal, IDE, AI agent).

## 1. System Architecture

Pushback is composed of three parts that work together:

```
┌─────────────────────────────────────────────────────────┐
│                      SKILL                              │
│                                                         │
│  skill/ — Agent instructions for the verification       │
│  conversation. Reads the diff, asks as many questions   │
│  as its size warrants, evaluates answers, writes the    │
│  receipt and the commit trailers.                       │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                    PUSHBACK-CLI                         │
│                                                         │
│  `pushback check` — the gate. A native git pre-push     │
│  hook runs it before every push; it hashes the          │
│  outgoing diff and compares that to the receipt.        │
│  Blocks (exit 1) or allows (exit 0). The same binary    │
│  provides `pushback setup` and `pushback install`.      │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                 VERIFICATION STATE                      │
│                                                         │
│  .pushback/verified — Local receipt file containing     │
│  a hash of the outgoing diff. Auto-invalidates when     │
│  local commits change what would be pushed.             │
│                                                         │
│  Pushback-Verified and Pushback-Summary trailers on     │
│  the commit — what travels to the remote, and what the  │
│  GitHub Action reads on a pull request.                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Data flow on `git push`:**

```
1. Developer (or agent) runs `git push` from any client
2. Git fires the pre-push hook (.git/hooks/pre-push), which execs
   `pushback check` and pipes it the ref lines git writes to the hook's
   stdin: `<local ref> <local sha> <remote ref> <remote sha>`
3. `pushback check` runs:
   a. Check for override env var → allow if set
   b. Turn each ref line into a `<remote sha>..<local sha>` range
   c. Concatenate `git diff <range>` for each range, in git's order
   d. Empty diff, or trivial under `trivial_threshold` → allow
   e. SHA-256 that diff and compare it to .pushback/verified
4. If match → exit 0 (allow)
5. If no match → exit 1 (block) + print message to stderr
   telling the developer to run Pushback verification
6. Developer invokes the skill in their AI agent
7. Agent activates the skill → conversational verification
8. On pass → skill writes a new receipt and amends HEAD with the
   Pushback-Verified and Pushback-Summary trailers → developer retries push
9. On fail → skill offers to walk the developer through the diff file by
   file, then asks again
```

Whenever the check allows the push, it first hands the same stdin and the same
arguments to `.git/hooks/pre-push.previous` if one exists, and exits with that
hook's status.

This design lets the agent freely commit during a work session. Verification only triggers at the trust boundary — when code is about to leave the developer's machine and reach the team. Because it's a native git hook, it works regardless of how the push is initiated.

## 2. Directory Structure

```
pushback/
├── src/
│   ├── cli.ts                        # `pushback` entry point: check | setup | install
│   ├── commands/
│   │   ├── check.ts                  # The gate: ref lines → diff → hash → allow/block
│   │   ├── setup.ts                  # First run: config, gitignore, hook shim, workflow
│   │   └── install.ts                # Silent hook-shim installer (for prepare scripts)
│   └── lib/
│       ├── config.ts                 # Defaults, loading, per-field validation
│       ├── git.ts                    # git invocations
│       ├── paths.ts                  # Repo-relative paths
│       ├── refs.ts                   # Pre-push stdin ref-line parsing
│       ├── shim.ts                   # The pre-push hook body (single source of truth)
│       └── trivial.ts                # Trivial-change rules
├── skill/
│   ├── SKILL.md                      # Skill definition (Cursor + Claude Code)
│   ├── setup.md                      # Setup workflow the agent follows
│   ├── verification.md               # Verification workflow the agent follows
│   └── references/
│       ├── verification-guide.md     # Detailed verification criteria and examples
│       └── .pushback.config.example.json   # Example project-level configuration
├── action/                           # Composite GitHub Action (verify-pr.sh)
└── test/                             # End-to-end scenarios against a scratch repo
```

`src/` is bundled by tsup to a single `dist/cli.js` and published to npm as
**`pushback-cli`**, which provides the `pushback` binary. The package has no
runtime dependencies — only Node built-ins (`fs`, `path`, `child_process`,
`crypto`).

When installed in a project, the following is created:

```
<project-root>/
├── .git/
│   └── hooks/
│       └── pre-push                  # Shell shim → pushback check "$@"
├── .github/
│   └── workflows/
│       └── pushback.yml              # CI check for the commit trailer
└── .pushback/
    ├── config.json                   # Project-level configuration (committed)
    └── verified                      # Current verification receipt (gitignored)
```

No executable code is committed into the project. The version the team shares
is whichever `pushback-cli` their package manager resolves — pinned as a dev
dependency, or fetched by `npx` on demand. The shim at `.git/hooks/pre-push` is
not version-controlled; each developer gets it from `pushback setup`,
`pushback install`, or their hook manager.

## 3. Skill Definition

### SKILL.md Structure

The skill is the brain of Pushback. It instructs the agent on how to conduct the verification conversation. Key responsibilities:

- Detect whether the pre-push hook is installed; if not, run `pushback setup`
- Read the outgoing diff via `git diff @{upstream}..HEAD`
- Size the diff and pick a question count from it
- Generate targeted questions based on the diff
- Conduct a conversational back-and-forth with the developer
- Evaluate responses as pass/fail
- On pass, write the verification receipt and the commit trailers
- On fail, offer a file-by-file walkthrough of the diff and ask again

The agent-facing workflows live in `skill/setup.md` and `skill/verification.md`;
`SKILL.md` itself only routes between them.

### Verification Conversation Design

The skill prompt must instruct the agent to follow this structure:

**Phase 1 — Diff Analysis (silent, no user interaction)**
- Determine the outgoing changes: `git diff @{upstream}..HEAD` (or, for a new branch with no upstream, `git diff $(git symbolic-ref refs/remotes/origin/HEAD)..HEAD`)
- Read `git diff @{upstream}..HEAD --stat` for an overview
- Read the full diff for detailed changes
- Identify the key modules, patterns, and architectural decisions present in the diff
- Note whether the change is trivial (the hook already applies the threshold rules from config, so a trivial push never reaches the conversation)

**Phase 2 — Question Generation (silent)**
- Pick a question count from the size of the diff. `skill/verification.md` holds the tiers, keyed to the same `trivial_threshold.max_lines` the hook gates on: small diffs get one question, medium two, large or multi-module three. The tier sets the number of *questions*, not the number of *areas* — a single question on a small diff still folds all three categories below into one ask, because Phase 4 still looks for all three.
- Draw the questions from these categories:
  - **Architectural intent**: Why does this change exist? What problem does it solve? Why was this approach chosen over alternatives?
  - **Integration awareness**: What other parts of the system does this touch? How do these changes interact with existing code?
  - **Trade-off consciousness**: What could go wrong? What are the performance/security/maintainability implications?
- Questions must reference specific parts of the diff — not generic questions that could apply to any codebase.

**Phase 3 — Conversation (interactive)**
- Present the questions to the developer one at a time or as a group (configurable in future; v1 presents all at once).
- The tone must be collaborative: "Before we push, let's make sure we're aligned on these changes."
- Allow free-form responses. Follow up if an answer is vague or incomplete.

**Phase 4 — Evaluation (silent)**
- Evaluate each answer against the diff context. Criteria:
  - Does the developer correctly identify the purpose of the change?
  - Can they describe how it connects to the broader system?
  - Are they aware of at least one meaningful trade-off or risk?
- A pass requires demonstrating understanding across all three areas. Partial understanding with honest acknowledgment of gaps is acceptable — the goal is genuine engagement, not perfection.

**Phase 5 — Outcome**
- **Pass**: Write the verification receipt, amend HEAD with the `Pushback-Verified` and `Pushback-Summary` trailers, inform the developer, retry the original git command.
- **Fail**: Explain which areas need more attention, then offer to walk the developer through the diff file by file — stopping for questions as it goes — and return to Phase 3 for a second round at the same question count. The walkthrough is read-only: the agent explains the diff, it does not change it. Do not write the receipt until a round passes.

### Trivial Change Detection

`pushback check` applies these rules itself, so a trivial push is never blocked
and never needs a receipt. **Any one** of them is enough:

| Condition | Default Threshold |
|-----------|-------------------|
| Reviewable lines changed | 5 or fewer (`trivial_threshold.max_lines`) |
| Every changed file is in the ignore list | lockfiles, auto-generated |
| Only whitespace / formatting changes | line counts come from `git diff --numstat -w`, so whitespace costs nothing |

Files matching `ignore_patterns` are subtracted before the line count is taken,
so they neither spend the budget nor make a real change look trivial. A binary
file among the reviewable changes is never trivial. Thresholds are configurable
via `.pushback/config.json`; the skill applies the same rules when it is
invoked directly rather than through a blocked push.

## 4. Hook Implementation

### Git Pre-Push Hook

Pushback uses a native git `pre-push` hook. The `.git/hooks/pre-push` file is a
three-line shell shim that hands control to the CLI:

```sh
#!/usr/bin/env sh
# Pushback pre-push hook
exec npx --package pushback-cli pushback check "$@"
```

`--package pushback-cli` is load-bearing. A bare `npx pushback` makes npm infer
the package name from the bin name and resolve the unrelated `pushback` package
on npm, which ships no `pushback` executable — the hook then dies with "could
not determine executable to run" and never runs the check. The shim body lives
in `src/lib/shim.ts` so `setup` and `install` cannot drift from each other. In a
project that has `pushback-cli` installed as a dev dependency, `npx` resolves
the local copy without hitting the network.

The logic runs before every push, regardless of client — terminal, IDE, or AI
agent — and makes no network calls of its own:

```
1. Read the ref lines git pipes to the hook's stdin, once:
     <local ref> <local sha> <remote ref> <remote sha>
   (a line that is not exactly four fields is ignored)
2. Check for override env var (default: PUSHBACK_OVERRIDE)
   - If set → chain and allow
3. Turn each ref line into a diff range:
   - Ordinary update: `<remote sha>..<local sha>`
   - New remote branch (remote sha all zeros): base on the remote-tracking
     HEAD, `git symbolic-ref refs/remotes/<remote>/HEAD`
   - Branch deletion (local sha all zeros): nothing to read, skipped
   - Hand-run with no ref lines at all: `@{upstream}..HEAD`
4. Concatenate `git diff <range>` for every range, in git's order
   - If the result is empty: chain and allow (nothing to verify)
   - If it is trivial under `trivial_threshold`: chain and allow
5. SHA-256 the concatenated diff and read .pushback/verified
6. If the file exists and the hash matches → chain and allow
7. If no match → print the block message to stderr and exit 1 (block)
```

Ref lines matter: git tells the hook exactly which refs it is about to update,
so `git push origin HEAD:other-branch` hashes what is actually going to the
remote rather than what `@{upstream}` happens to point at, and a stale local
`main` cannot change the hash.

The remote-tracking HEAD is read with `git symbolic-ref`, a local ref lookup.
The obvious alternative, `git remote show <remote>`, opens a connection to the
remote: inside a pre-push hook that means a second round trip on every new
branch, and on an unreachable remote it hangs the developer's push. When a clone
has no remote HEAD at all, the base falls back to git's empty-tree object, which
treats the whole branch as outgoing — over-asking rather than waving a push
through.

The CLI is written in TypeScript and bundled to a single JavaScript file with no
npm dependencies (only built-in modules: `fs`, `path`, `child_process`,
`crypto`). This keeps it cross-platform — macOS, Linux, and Windows (via Git
Bash) — without worrying about shell differences.

The block message speaks to both humans and agents:

```
Pushback: verification required before pushing.

This push was blocked because the developer hasn't verified their
understanding of the outgoing changes yet.

To proceed, run the Pushback skill — it will walk through the diff,
ask about the changes (how much it asks scales with the size of the
diff), and write a verification receipt if the developer demonstrates
understanding. The push will succeed on retry once the receipt is in
place.

  If you're the developer: ask your AI agent to run Pushback, or
  invoke it directly in your editor's chat.

  If you're an AI agent: invoke the "pushback" skill now. Do not
  attempt to bypass verification, skip the hook, or write the
  receipt directly — the developer must go through the conversation.
```

The override mechanism (`PUSHBACK_OVERRIDE=1 git push`) is intentionally omitted from the block message to prevent agents from eagerly bypassing verification. It's documented in the config and README for human developers who need it.

### Hook Chaining

If the user already has a `.git/hooks/pre-push` when setup runs:

1. Check if it's already our hook (grep for a `pushback` marker)
2. If it's ours: overwrite in place with the current shim, so upgrades reach developers who already ran setup once
3. If it's someone else's: rename to `pre-push.previous`, install ours, and chain

Chaining is faithful, not best-effort: on every allowing path — override, empty
diff, trivial change, matching receipt — `pushback check` runs
`.git/hooks/pre-push.previous` with the *same* buffered stdin and the same
arguments git gave it, and exits with that hook's status. A chained hook
therefore sees exactly the ref lines it would have seen on its own.

## 5. Verification Receipt

The receipt is a plain text file at `.pushback/verified` containing:

```
<sha256-hash-of-outgoing-diff>
```

That's it for v1. The hash is sufficient to validate that the verified outgoing diff matches what's about to be pushed. If the developer makes new commits after verification, the hash won't match and re-verification is required.

The receipt file must be added to `.gitignore` (`pushback setup` handles this).
It is local-only and never leaves the machine.

### Commit trailers

The receipt unblocks the hook; the trailers are what the team sees. On a pass
the skill amends HEAD with both, in a single `git commit --amend`:

```
Pushback-Verified: <sha256-hash-of-outgoing-diff>
Pushback-Summary: Intent: <why this change exists>
Pushback-Summary: Touches: <what it affects>
Pushback-Summary: Risk: <the known risk>
```

`Pushback-Summary` is three *repeated* trailers, one per line, each carrying its
own label — not one folded multi-line value. The lines are the developer's own
answers, condensed rather than rewritten, and the GitHub Action renders them on
the PR so a reviewer reads the author's account of the change next to its
verification status. The receipt is ephemeral; the trailers are permanent.

### Future receipt enhancements

For later versions, the receipt could be expanded to a JSON format:

```json
{
  "diff_hash": "<sha256>",
  "verified_at": "<ISO-8601 timestamp>",
  "verified_by": "<git user.email>",
  "questions_asked": 3,
  "summary": "<one-line summary of what was verified>"
}
```

## 6. Setup Script

`pushback setup` handles first-time installation. The skill instructs the agent
to run it on first use, after installing `pushback-cli` with whatever package
manager the project already uses (or falling back to `npx`).

### Installation Steps

1. **Create** the `.pushback/` directory
2. **Create** `.pushback/config.json` with defaults (if not present)
3. **Add** `.pushback/verified` to `.gitignore` (if not already present)
4. **Install** the shell shim at `.git/hooks/pre-push` for the current developer
5. **Install** the GitHub Action workflow at `.github/workflows/pushback.yml` (if not present)

### Hook Persistence

The first developer runs setup manually. After that, the hook must install automatically for every teammate who clones the repo. The setup script handles the mechanical installation; the **agent** handles hook persistence by integrating with whatever hook management the project already uses.

The skill instructs the agent to examine the project after running setup and integrate accordingly — adding to Husky's `.husky/pre-push`, lefthook's YAML config, a `package.json` prepare script, or whatever other hook system is present. This is delegated to the agent rather than hard-coded in the setup script because:

- Hook managers vary widely and new ones emerge (Husky, lefthook, simple-git-hooks, etc.)
- Each has its own config format and conventions
- The agent can read docs, inspect configs, and adapt — a deterministic script can only handle cases it was programmed for

`pushback install` is a lightweight, near-silent installer designed to run from
a `prepare` script or similar lifecycle hook. It only installs the git hook
shim — no config, no workflow. It exits silently when the current directory is
not a git repo, when Pushback isn't set up in the project (no
`.pushback/config.json`), or when the current shim is already in place.

### Idempotency

`pushback setup` is safe to run multiple times:
- Config is only written if not present
- Gitignore entry is checked before adding
- Our own hook shim is overwritten with the current version, so upgrades land
- The workflow file is only written if not present
- Third-party hooks are only backed up once (won't re-backup `pre-push.previous`)

## 7. Project Configuration

`.pushback/config.json` — project-level settings:

```json
{
  "trivial_threshold": {
    "max_lines": 5,
    "ignore_patterns": [
      "*.lock",
      "*.lockb",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "*.generated.*"
    ]
  },
  "override_env_var": "PUSHBACK_OVERRIDE"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `trivial_threshold.max_lines` | `number` | Pushes changing this many reviewable lines or fewer skip verification. |
| `trivial_threshold.ignore_patterns` | `string[]` | Glob patterns for files that never count towards the line budget. |
| `override_env_var` | `string` | Environment variable name that, when set, bypasses verification. |

This config file should be committed to the repository so the whole team shares the same settings.

Loading is defensive by design: the hook runs on every push, so a malformed
config must never take the gate down. Each field is validated on its own and
falls back to its default when missing or the wrong type, and unknown keys are
dropped rather than carried forward.

## 8. Override Mechanism

Developers can bypass verification by setting the configured environment variable before running the git command:

```bash
PUSHBACK_OVERRIDE=1 git push
```

When using an AI agent, the developer would tell the agent to set this variable. The skill should acknowledge the override and remind the developer that verification was skipped.

No logging or reporting of overrides in v1.

## 9. Cross-Tool Compatibility

### Universal Hook

Because Pushback uses a native git pre-push hook, it works with any git client:

| Client | Supported |
|--------|-----------|
| Terminal (`git push`) | ✓ |
| Cursor (agent or terminal) | ✓ |
| Claude Code (agent or terminal) | ✓ |
| VS Code integrated terminal | ✓ |
| Git GUIs (GitKraken, Fork, etc.) | ✓ |
| CI/CD (if pushing from pipelines) | ✓ (use override env var) |

### Skill Compatibility

The SKILL.md format is identical for Cursor and Claude Code. Both use the same frontmatter schema (`name`, `description`) and both load the body as markdown instructions. A single SKILL.md works in both tools without modification.

Skill installation location:
- **Project-level (recommended)**: `.cursor/skills/pushback/` (Cursor) — Claude Code picks up skills from the project directory or via its own skill paths
- **User-level**: `~/.cursor/skills/pushback/` or equivalent Claude Code path

For team adoption, project-level installation is preferred so the skill is shared via version control.

## 10. Edge Cases

### Developer makes new commits after verification
The receipt hash is based on the outgoing diff — the ranges git says it is about to push. New commits change the local sha, so the hash won't match and re-verification triggers. This is by design.

### Pushing a ref other than the current branch
`git push origin HEAD:other-branch`, or a push of several refs at once, is covered: the hash is taken over every range git lists, concatenated in git's order. Pushing the same work to a different remote branch is a different diff and needs its own verification.

### Agent makes multiple commits during a work session
No friction here — commits are local and ungated by default. The agent can commit as many times as needed. Verification only fires on push.

### No outgoing changes
If the concatenated diff for every ref git is pushing is empty, the hook allows the push through — there's nothing to verify.

### New branch with no upstream
Git reports an all-zero remote sha. The hook bases the diff on the remote-tracking HEAD (`refs/remotes/<remote>/HEAD`) rather than the local branch of the same name, so a stale local `main` can't change what gets hashed. This covers the first push of a feature branch.

### Trivial change
A change at or under `trivial_threshold.max_lines`, or touching only ignored files, or whitespace-only, is allowed through with no receipt and no conversation.

### Merge commits
Merge commits may produce complex diffs. For v1, treat them like any other push — the verification questions adapt to whatever diff is present.

### Agent retries push after verification
After writing the receipt, the skill instructs the agent to re-run the original push command. The hook fires again, finds a valid receipt, and allows it through. No infinite loop.

### Multiple developers on the same machine
The receipt is per-project, not per-user. On shared machines, one developer's verification could theoretically clear the gate for another. This is acceptable for v1 given it's a local development tool.

### Existing pre-push hook
If the user already has a `.git/hooks/pre-push`, the setup script backs it up to `pre-push.previous` and chains execution. The Pushback hook runs first; if it passes, the previous hook runs with the original arguments.

### Hook not found
If the pre-push hook is deleted accidentally, pushes will proceed without verification. The skill checks for the hook's presence on first use and re-installs if needed.

## 11. Future Technical Considerations

These are out of scope for v1 but inform the architecture:

- **Verification transcript storage**: Saving Q&A transcripts (locally or in a `.pushback/history/` directory) for developer self-review.
- **Richer depth signals**: Question count already scales with the size of the diff (§3). Complexity metrics — new dependencies, cyclomatic complexity delta — could sharpen the tiers further.
- **Codex / OpenCode support**: Adding skill definitions for these tools as their skill systems mature.
- **Per-commit gating**: Opt-in configuration to also gate `git commit`, using a `pre-commit` hook with `git diff --cached` for the hash instead of the upstream diff. Useful for teams that want tighter control.
- **Core hooks integration**: For tools like Cursor and Claude Code that support hooks natively, the pre-push hook could be supplemented with editor hooks that provide richer agent integration (auto-starting the skill conversation on block).
