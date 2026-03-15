# Pushback — Technical Specification

This document covers the implementation architecture for Pushback v1 as defined in the [Product Requirements Document](./prd-pushback.md). It focuses on the skill + hook combo approach targeting Cursor and Claude Code.

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
│                      HOOK                               │
│                                                         │
│  check-verification.sh — Called by the editor before    │
│  git push (default) or git commit (opt-in).             │
│  Checks for a valid receipt.                            │
│  Blocks (exit 2) or allows (exit 0).                    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                 VERIFICATION STATE                      │
│                                                         │
│  .pushback/verified — Local receipt file containing   │
│  a hash of the outgoing diff. Auto-invalidates when     │
│  local commits change what would be pushed.              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Data flow on `git push` (default trigger):**

```
1. Developer (or agent) runs `git push`
2. Editor hook fires (beforeShellExecution / PreToolUse)
3. check-verification.sh runs:
   a. Compute SHA-256 of outgoing diff (local vs. remote)
   b. Read .pushback/verified
   c. Compare hashes
4. If match → exit 0 (allow)
5. If no match → exit 2 (block) + return agent_message
   instructing the agent to run the Pushback verification
6. Agent activates the skill → conversational verification
7. On pass → skill writes new receipt → agent retries push
8. On fail → skill explains gaps, developer reviews and retries
```

This design lets the agent freely commit during a work session. Verification only triggers at the trust boundary — when code is about to leave the developer's machine and reach the team.

## 2. Directory Structure

```
pushback/
├── SKILL.md                          # Skill definition (Cursor + Claude Code)
├── scripts/
│   ├── setup.sh                      # Auto-installs hooks for detected editors
│   └── check-verification.sh         # Hook script — receipt validation
├── references/
│   └── verification-guide.md         # Detailed verification criteria and examples
└── .pushback.config.example.json   # Example project-level configuration
```

When installed in a project, the following is created:

```
<project-root>/
├── .cursor/
│   └── hooks.json                    # Cursor hook config (merged)
├── .claude/
│   └── settings.json                 # Claude Code hook config (merged)
└── .pushback/
    ├── config.json                   # Project-level configuration
    ├── verified                      # Current verification receipt (gitignored)
    └── hooks/
        └── check-verification.sh     # Copied hook script
```

## 3. Skill Definition

### SKILL.md Structure

The skill is the brain of Pushback. It instructs the agent on how to conduct the verification conversation. Key responsibilities:

- Detect whether hooks are installed; if not, run `scripts/setup.sh`
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

### Cursor — `beforeShellExecution`

Cursor hooks are configured in `.cursor/hooks.json`. The default configuration intercepts `git push`. Teams can add `git commit` to the matcher if they want per-commit gating.

```json
{
  "version": 1,
  "hooks": {
    "beforeShellExecution": [
      {
        "command": ".pushback/hooks/check-verification.sh",
        "matcher": "git push"
      }
    ]
  }
}
```

### Claude Code — `PreToolUse`

Claude Code hooks are configured in `.claude/settings.json`. The hook listens for Bash tool usage matching git commands.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/check-verification.sh"
          }
        ]
      }
    ]
  }
}
```

Note: Claude Code's matcher targets the tool name (`Bash`), not the command content. The `check-verification.sh` script itself inspects the command string from the JSON input to determine if it's a `git push` (or `git commit` if configured).

### check-verification.sh

The hook script receives JSON on stdin from the editor. Its logic:

```
1. Parse the command from JSON input
2. Check if command matches configured triggers (default: git push)
   - If no match → exit 0 (allow, not a relevant command)
3. Check for override flag
   - If PUSHBACK_OVERRIDE env var is set → exit 0 (allow)
4. Compute the outgoing diff hash:
   - If upstream exists: `git diff @{upstream}..HEAD | shasum -a 256`
   - If no upstream (new branch): `git diff main..HEAD | shasum -a 256`
     (falls back to default branch detection via `git remote show origin`)
   - If no outgoing changes: exit 0 (allow, nothing to verify)
5. Read .pushback/verified
6. If file exists and hash matches → exit 0 (allow)
7. If no match → output deny JSON and exit 2 (block)
```

The deny response includes an `agent_message` directing the agent to the skill:

```json
{
  "permission": "deny",
  "user_message": "Pushback: verification required before pushing.",
  "agent_message": "The push has been blocked because the developer has not yet verified their understanding of the outgoing changes. Use the Pushback skill to conduct a verification conversation. Compare local vs. remote with `git diff @{upstream}..HEAD` to see all outgoing changes, ask the developer 2-3 questions about the architectural intent, integration points, and trade-offs, evaluate their responses, and write the verification receipt to .pushback/verified if they demonstrate understanding."
}
```

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

`scripts/setup.sh` handles first-time installation. The skill instructs the agent to run this on first use.

### Detection Logic

```
1. Check for .cursor/ directory → Cursor project
2. Check for .claude/ directory → Claude Code project
3. Both can be true simultaneously
```

### Installation Steps

For each detected editor:

1. **Read existing hook config** (if any)
2. **Merge** the Pushback hook entry into the existing config (do not overwrite)
3. **Write** the updated config back
4. **Copy** `check-verification.sh` to the appropriate hooks directory
5. **Make executable**: `chmod +x`

Additionally:

6. **Create** `.pushback/` directory
7. **Create** `.pushback/config.json` with defaults
8. **Add** `.pushback/verified` to `.gitignore` (if not already present)

### Config Merging

The setup script must handle these cases when merging hook configurations:

- **No existing config file**: Create it with only the Pushback entry.
- **Existing config, no conflicting hooks**: Add the Pushback entry to the hooks array.
- **Existing config, Pushback already present**: Update in place (idempotent).

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

### Differences Between Cursor and Claude Code Hooks

| Aspect | Cursor | Claude Code |
|--------|--------|-------------|
| Config file | `.cursor/hooks.json` | `.claude/settings.json` |
| Hook event | `beforeShellExecution` | `PreToolUse` (matcher: `Bash`) |
| Command matching | `matcher` field on the hook entry | Script inspects command from JSON stdin |
| Block mechanism | Exit code 2 or `"permission": "deny"` | Exit code 2 or `"decision": "block"` |
| Response format | `{ permission, user_message, agent_message }` | `{ decision, reason }` or stdout message |

The `check-verification.sh` script must handle both input formats. It can detect the source by checking for the `hook_event_name` field in the JSON input, or by checking which fields are present.

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

### Hook script not found
If `check-verification.sh` is missing (e.g., deleted accidentally), the hook fails. In Cursor, hooks fail open by default (command proceeds). The `failClosed: true` option can be set for stricter enforcement, but v1 defaults to fail-open to avoid blocking developers due to setup issues.

## 11. Future Technical Considerations

These are out of scope for v1 but inform the architecture:

- **Git hook fallback**: A `.git/hooks/pre-push` script that checks for the receipt file. No LLM needed — just hash comparison. Covers manual terminal pushes.
- **Receipt-in-commit-message**: Appending a `Verified-By: pushback` trailer or emoji to the final commit message for team visibility.
- **Verification transcript storage**: Saving Q&A transcripts (locally or in a `.pushback/history/` directory) for developer self-review.
- **Depth scaling**: Using diff complexity metrics (files touched, cyclomatic complexity delta, new dependencies) to scale question count from 1 to 5.
- **Codex / OpenCode support**: Adding hook configurations for these tools as their hook systems mature.
- **Per-commit gating**: Opt-in configuration to also gate `git commit`, using `git diff --cached` for the hash instead of the upstream diff. Useful for teams that want tighter control.
