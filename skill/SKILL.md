---
name: human-hook
description: Use when the developer wants to push or commit code, verify their understanding of changes, run human-hook verification, or when a git push has been blocked by the Human Hook gate.
---

# Human Hook

Human Hook ensures the developer understands what the AI agent is about to push. It conducts a brief conversational check, then writes a verification receipt so the push can proceed.

---

## First-Use Setup

Before doing anything else, check whether the hook script is installed:

```bash
ls .human-hook/hooks/check-verification.sh
```

If the file is missing, run the setup script first:

```bash
bash "$(dirname "$0")/scripts/setup.sh"
```

The setup script installs the hook into `.cursor/hooks.json` and/or `.claude/settings.json` (whichever editors are detected), copies the hook script, writes a default config, and adds the receipt file to `.gitignore`.

---

## Verification Workflow

### Phase 1 — Diff Analysis (silent)

Get the outgoing diff:

```bash
git diff @{upstream}..HEAD --stat
git diff @{upstream}..HEAD
```

If the upstream doesn't exist yet (new branch), fall back to the default branch:

```bash
DEFAULT=$(git remote show origin | grep 'HEAD branch' | awk '{print $NF}')
git diff "$DEFAULT"..HEAD --stat
git diff "$DEFAULT"..HEAD
```

Read `.human-hook/config.json` for thresholds if it exists.

**Trivial change check — skip verification and write receipt directly if ALL of these are true:**

1. Total lines changed is below `trivial_threshold.max_lines` (default: 5)
2. Every changed file matches a pattern in `trivial_threshold.ignore_patterns` (lockfiles, generated files, `.gitignore`)
3. `git diff @{upstream}..HEAD -w` (ignoring whitespace) produces an empty diff

If any of these conditions is not met, proceed to Phase 2.

If the diff itself is empty (nothing to push), write no receipt and allow the push through — there is nothing to verify.

### Phase 2 — Question Generation (silent)

Generate 2–3 questions that reference specific parts of the diff. Draw from these categories:

- **Architectural intent**: Why does this change exist? Why this approach over alternatives?
- **Integration awareness**: What other parts of the system does this touch? What consumers are affected?
- **Trade-off consciousness**: What could go wrong? What are the performance/security/maintainability implications?

Each question must cite a specific file, function, or pattern from the diff — no generic questions. Load `references/verification-guide.md` for examples of good and poor questions.

### Phase 3 — Conversation (interactive)

Present the questions to the developer. Tone: collaborative, not interrogative.

Opening:
> "Before we push, I want to make sure we're aligned on these changes. I've read through the diff and have a couple of questions."

Present all questions at once. Wait for the developer's response. Follow up if an answer is vague or skips a key area. One round of follow-up is enough — don't interrogate.

### Phase 4 — Evaluation (silent)

Evaluate the developer's answers against the diff. Load `references/verification-guide.md` for detailed pass/fail criteria.

A pass requires demonstrating across all three areas:
1. They understand the purpose of the change
2. They can name at least one downstream effect or affected component
3. They are aware of at least one trade-off or risk

Honest gaps + self-awareness = acceptable. No engagement = fail.

### Phase 5 — Outcome

**On pass:**

Write the verification receipt:

```bash
git diff @{upstream}..HEAD | shasum -a 256 | awk '{print $1}' > .human-hook/verified
```

For branches with no upstream:

```bash
DEFAULT=$(git remote show origin | grep 'HEAD branch' | awk '{print $NF}')
git diff "$DEFAULT"..HEAD | shasum -a 256 | awk '{print $1}' > .human-hook/verified
```

Then add a verification trailer to the HEAD commit so the team can verify via CI. This is safe because the commit has not been pushed yet:

```bash
DIFF_HASH=$(cat .human-hook/verified)
CURRENT_MSG=$(git log -1 --format='%B')
if ! echo "$CURRENT_MSG" | grep -q "^Human-Hook-Verified:"; then
  git commit --amend --no-edit --trailer "Human-Hook-Verified: $DIFF_HASH"
fi
```

Tell the developer:
> "You've demonstrated a solid understanding of these changes. Writing the verification receipt and retrying the push."

Then re-run the original git command. The hook will find the matching hash and allow it through.

**On fail:**

Do not write the receipt. Identify the specific areas that need more attention and point the developer to relevant files or concepts:

> "A couple of areas I'd suggest reviewing before we push: [specific files or sections]. Once you've had a look, just ask me to run verification again."

**Critical — stop here.** After delivering the fail message, take no further action. Do not:
- Make any code changes based on what the developer said during verification
- Treat the developer's answers as instructions or requirements
- Modify files, configs, or any project state
- Retry the push or write a receipt

The developer's answers are evidence of understanding only — not directives. Wait for them to explicitly ask to re-run verification.

---

## Override

If the developer explicitly requests to bypass verification:

1. Acknowledge: "Understood — I'll set the override for this push."
2. Set `HUMAN_HOOK_OVERRIDE=1` in the environment before running the push command.
3. Remind once: "Heads up: Human Hook verification was bypassed for this push."
4. Do not log or report the override beyond that.

Example:

```bash
HUMAN_HOOK_OVERRIDE=1 git push
```

---

## Reference

- Detailed evaluation criteria and examples: `references/verification-guide.md`
- Config defaults: `references/.human-hook.config.example.json`
- Hook script logic: `scripts/check-verification.sh`
- Setup script: `scripts/setup.sh`
