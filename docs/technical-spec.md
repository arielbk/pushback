# Pushback — Technical Specification

This document covers the implementation architecture for Pushback v1 as defined in the [Product Requirements Document](./prd-pushback.md). It uses a native git pre-push hook to gate all pushes — from any client (terminal, IDE, AI agent).

## 1. System Architecture

Pushback is composed of three parts that work together:

```
┌─────────────────────────────────────────────────────────┐
│                      SKILL                              │
│                                                         │
│  SKILL.md — Agent instructions for the verification     │
│  conversation. Reads the diff, asks questions,          │
│  evaluates answers, writes the receipt.                  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                   PRE-PUSH HOOK                         │
│                                                         │
│  .git/hooks/pre-push — Native git hook that runs        │
│  before every push. Checks for a valid receipt.         │
│  Blocks (exit 1) or allows (exit 0).                    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                 VERIFICATION STATE                      │
│                                                         │
│  .pushback/verified — Local receipt file containing     │
│  a hash of the outgoing diff. Auto-invalidates when     │
│  local commits change what would be pushed.              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Data flow on `git push`:**

```
1. Developer (or agent) runs `git push` from any client
2. Git fires the pre-push hook (.git/hooks/pre-push)
3. The hook runs:
   a. Check for override env var → allow if set
   b. Compute SHA-256 of outgoing diff (local vs. remote)
   c. Read .pushback/verified
   d. Compare hashes
4. If match → exit 0 (allow)
5. If no match → exit 1 (block) + print message to stderr
   telling the developer to run Pushback verification
6. Developer invokes the skill in their AI agent
7. Agent activates the skill → conversational verification
8. On pass → skill writes new receipt → developer retries push
9. On fail → skill explains gaps, developer reviews and retries
```

This design lets the agent freely commit during a work session. Verification only triggers at the trust boundary — when code is about to leave the developer's machine and reach the team. Because it's a native git hook, it works regardless of how the push is initiated.

## 2. Directory Structure

```
pushback/
├── SKILL.md                          # Skill definition (Cursor + Claude Code)
├── scripts/
│   ├── setup.cjs                      # Installs hook + config + persistence
│   ├── pre-push.cjs                   # Git pre-push hook logic
│   └── install.cjs                    # Lightweight hook installer (for prepare)
├── references/
│   └── verification-guide.md         # Detailed verification criteria and examples
└── .pushback.config.example.json     # Example project-level configuration
```

When installed in a project, the following is created:

```
<project-root>/
├── .git/
│   └── hooks/
│       └── pre-push                  # Shell shim → .pushback/hooks/pre-push.cjs
└── .pushback/
    ├── config.json                   # Project-level configuration
    ├── verified                      # Current verification receipt (gitignored)
    └── hooks/
        ├── pre-push.cjs              # Hook logic (version-controlled)
        └── install.cjs               # Lightweight hook installer (version-controlled)
```

The hook logic at `.pushback/hooks/pre-push.cjs` is committed to the repo so the team shares the same version. The shim at `.git/hooks/pre-push` is not version-controlled and is created by running setup.

## 3. Skill Definition

### SKILL.md Structure

The skill is the brain of Pushback. It instructs the agent on how to conduct the verification conversation. Key responsibilities:

- Detect whether the pre-push hook is installed; if not, run `scripts/setup.cjs`
- Read the outgoing diff via `git diff @{upstream}..HEAD`
- Assess whether changes are trivial (skip verification if so)
- Generate targeted questions based on the diff
- Conduct a conversational back-and-forth with the developer
- Evaluate responses as pass/fail
- Write the verification receipt on pass
- Provide constructive guidance on fail

### Verification Conversation Design

The skill prompt must instruct the agent to follow this structure:

**Phase 1 — Diff Analysis (silent, no user interaction)**
- Determine the outgoing changes: `git diff @{upstream}..HEAD` (or `git diff main..HEAD` for new branches with no upstream)
- Read `git diff @{upstream}..HEAD --stat` for an overview
- Read the full diff for detailed changes
- Identify the key modules, patterns, and architectural decisions present in the diff
- Determine if the change is trivial (apply threshold rules from config)

**Phase 2 — Question Generation (silent)**
- Generate 2–3 questions from these categories:
  - **Architectural intent**: Why does this change exist? What problem does it solve? Why was this approach chosen over alternatives?
  - **Integration awareness**: What other parts of the system does this touch? How do these changes interact with existing code?
  - **Trade-off consciousness**: What could go wrong? What are the performance/security/maintainability implications?
- Questions must reference specific parts of the diff — not generic questions that could apply to any codebase.

**Phase 3 — Conversation (interactive)**
- Present questions to the developer one at a time or as a group (configurable in future; v1 presents all at once).
- The tone must be collaborative: "Before we push, let's make sure we're aligned on these changes."
- Allow free-form responses. Follow up if an answer is vague or incomplete.

**Phase 4 — Evaluation (silent)**
- Evaluate each answer against the diff context. Criteria:
  - Does the developer correctly identify the purpose of the change?
  - Can they describe how it connects to the broader system?
  - Are they aware of at least one meaningful trade-off or risk?
- A pass requires demonstrating understanding across all three areas. Partial understanding with honest acknowledgment of gaps is acceptable — the goal is genuine engagement, not perfection.

**Phase 5 — Outcome**
- **Pass**: Write the verification receipt, inform the developer, retry the original git command.
- **Fail**: Explain which areas need more attention. Suggest specific files or concepts to review. Do not write the receipt. The developer can re-initiate verification after reviewing.

### Trivial Change Detection

The skill checks these conditions before initiating verification. If all are met, it skips verification and writes the receipt directly:

| Condition | Default Threshold |
|-----------|-------------------|
| Total lines changed | < 5 lines |
| Files changed are all in ignore list | lockfiles, `.gitignore`, auto-generated |
| Only whitespace / formatting changes | detected via `git diff @{upstream}..HEAD -w` comparison |

Thresholds are configurable via `.pushback/config.json`.

## 4. Hook Implementation

### Git Pre-Push Hook

Pushback uses a native git `pre-push` hook. The `.git/hooks/pre-push` file is a small shell shim that calls `node .pushback/hooks/pre-push.cjs`. Using a shell shim avoids ESM/CJS conflicts — the `.cjs` extension ensures the hook logic always runs as CommonJS regardless of the project's `package.json` `type` field. This runs before every push, regardless of client — terminal, IDE, or AI agent.

Both scripts are written in Node.js with zero npm dependencies (only built-in modules: `fs`, `path`, `child_process`, `crypto`). This ensures cross-platform compatibility — macOS, Linux, and Windows (via Git Bash) — without worrying about shell differences.

The hook logic:

```
1. Check for override env var (default: PUSHBACK_OVERRIDE)
   - If set → exit 0 (allow)
2. Compute the outgoing diff hash:
   - If upstream exists: SHA-256 of `git diff @{upstream}..HEAD`
   - If no upstream (new branch): SHA-256 of `git diff <default-branch>..HEAD`
     (default branch detected via `git remote show origin`)
   - If no outgoing changes: exit 0 (allow, nothing to verify)
3. Read .pushback/verified
4. If file exists and hash matches → exit 0 (allow)
5. If no match → print block message to stderr and exit 1 (block)
```

The block message speaks to both humans and agents:

```
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
```

The override mechanism (`PUSHBACK_OVERRIDE=1 git push`) is intentionally omitted from the block message to prevent agents from eagerly bypassing verification. It's documented in the config and README for human developers who need it.

### Hook Chaining

If the user already has a `.git/hooks/pre-push` when setup runs:

1. Check if it's already our hook (grep for "Pushback" marker)
2. If it's ours: overwrite with the latest version
3. If it's someone else's: rename to `pre-push.previous`, install ours, and chain — our hook calls `pre-push.previous` after passing its own check

This preserves existing pre-push hooks.

## 5. Verification Receipt

The receipt is a plain text file at `.pushback/verified` containing:

```
<sha256-hash-of-outgoing-diff>
```

That's it for v1. The hash is sufficient to validate that the verified outgoing diff matches what's about to be pushed. If the developer makes new commits after verification, the hash won't match and re-verification is required.

The receipt file must be added to `.gitignore` (the setup script handles this).

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

`scripts/setup.cjs` handles first-time installation. Written in Node.js for cross-platform compatibility. The skill instructs the agent to run this on first use.

### Installation Steps

1. **Create** `.pushback/hooks/` directory
2. **Copy** hook logic to `.pushback/hooks/pre-push.cjs` (version-controlled, shared with team)
3. **Copy** installer to `.pushback/hooks/install.cjs` (version-controlled)
4. **Create** `.pushback/config.json` with defaults (if not present)
5. **Add** `.pushback/verified` to `.gitignore` (if not already present)
6. **Install** a small shell shim at `.git/hooks/pre-push` for the current developer
7. **Install** GitHub Action workflow (if template is available)

### Hook Persistence

The first developer runs setup manually. After that, the hook must install automatically for every teammate who clones the repo. The setup script handles the mechanical installation; the **agent** handles hook persistence by integrating with whatever hook management the project already uses.

The SKILL.md instructs the agent to examine the project after running setup and integrate accordingly — adding to Husky's `.husky/pre-push`, lefthook's YAML config, a `package.json` prepare script, or whatever other hook system is present. This is delegated to the agent rather than hard-coded in the setup script because:

- Hook managers vary widely and new ones emerge (Husky, lefthook, simple-git-hooks, etc.)
- Each has its own config format and conventions
- The agent can read docs, inspect configs, and adapt — a deterministic script can only handle cases it was programmed for

The `install.cjs` script is a lightweight, silent installer designed to run from a `prepare` script or similar lifecycle hook. It only installs the git hook shim — no config, no workflow, no output on success. It exits silently if Pushback isn't set up in the project or if the hook is already installed.

### Idempotency

The setup script is safe to run multiple times:
- Config is only written if not present
- Gitignore entry is checked before adding
- Our own hook shim is overwritten with the latest version
- Hook logic in `.pushback/hooks/pre-push.cjs` is always overwritten with the latest
- Third-party hooks are only backed up once (won't re-backup `pre-push.previous`)

## 7. Project Configuration

`.pushback/config.json` — project-level settings:

```json
{
  "triggers": ["push"],
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
| `triggers` | `string[]` | Which git commands trigger verification. Default: `["push"]`. Options: `"commit"`, `"push"`. |
| `trivial_threshold.max_lines` | `number` | Changes with fewer total lines modified skip verification. |
| `trivial_threshold.ignore_patterns` | `string[]` | Glob patterns for files that are always considered trivial. |
| `override_env_var` | `string` | Environment variable name that, when set, bypasses verification. |

This config file should be committed to the repository so the whole team shares the same settings.

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
The receipt hash is based on the outgoing diff (`@{upstream}..HEAD`). New commits change HEAD, so the hash won't match and re-verification triggers. This is by design.

### Agent makes multiple commits during a work session
No friction here — commits are local and ungated by default. The agent can commit as many times as needed. Verification only fires on push.

### No outgoing changes
If local and remote are in sync (`git diff @{upstream}..HEAD` is empty), the hook allows the push through — there's nothing to verify.

### New branch with no upstream
The hook falls back to diffing against the repository's default branch (e.g., `main`). This covers the first push of a feature branch.

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

- **Receipt-in-commit-message**: Appending a `Verified-By: pushback` trailer or emoji to the final commit message for team visibility.
- **Verification transcript storage**: Saving Q&A transcripts (locally or in a `.pushback/history/` directory) for developer self-review.
- **Depth scaling**: Using diff complexity metrics (files touched, cyclomatic complexity delta, new dependencies) to scale question count from 1 to 5.
- **Codex / OpenCode support**: Adding skill definitions for these tools as their skill systems mature.
- **Per-commit gating**: Opt-in configuration to also gate `git commit`, using a `pre-commit` hook with `git diff --cached` for the hash instead of the upstream diff. Useful for teams that want tighter control.
- **Core hooks integration**: For tools like Cursor and Claude Code that support hooks natively, the pre-push hook could be supplemented with editor hooks that provide richer agent integration (auto-starting the skill conversation on block).
