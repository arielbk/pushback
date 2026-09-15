# Pushback

**Ship code you understand.**

AI agents write code fast. The harder thing is staying engaged with what they produce: the architecture, the trade-offs, how it fits into the rest of the system.

Pushback adds one checkpoint before `git push`: a short conversation. It reads your outgoing diff, asks 2-3 targeted questions, and only lets the push through when you can explain the intent behind your changes. Not a quiz. Not a checkbox. A real conversation that takes under two minutes.

Every AI tool right now is racing to remove friction. This adds a little back where it counts, so you can move at the speed of agents and still be in the driver's seat.

For teams, every verified push carries a cryptographic receipt. A GitHub Action checks for it on pull requests, so the team can see at a glance that each push represents code the author engaged with.

## Install

```bash
npx skills add arielbk/pushback
```

Then tell your agent: *"Set up Pushback in this project."*

On first use, the agent detects your project's package manager when one exists, installs `pushback-cli` when appropriate, and otherwise falls back to `npx` without forcing the repo into an npm-based workflow.

Setup installs a git `pre-push` hook, writes a default config, and sets up a GitHub Action workflow for your PRs. From that point on, every `git push` is gated: terminal, IDE, or AI agent.

If you prefer to do it manually, install `pushback-cli` as a dev dependency with your package manager and run `pushback setup`.

After setup, the agent integrates with your existing hook management. Whether you use Husky, lefthook, a `prepare` script, or something else, teammates get the hook automatically.

## How it works

```
git push (from anywhere)
  → Git pre-push hook checks for a valid verification receipt
    → No receipt? Push blocked.
      → Run Pushback verification in your AI agent
        → You answer 2-3 questions about your changes
          → Pass → receipt written → push goes through
          → Fail → agent points you to what to review
```

The receipt is a SHA-256 hash of your outgoing diff. New commits after verification change the hash, which triggers re-verification. The system is self-invalidating.

The receipt lives in `.pushback/verified` and is local-only: it unblocks the pre-push hook, is gitignored, and never leaves your machine. Separately, Pushback writes a `Pushback-Verified` trailer into the commit message. That's what travels to the remote and what CI checks on pull requests. The receipt is ephemeral; the trailer is permanent.

### What you get asked

Questions come from the actual diff, not generic prompts. They target three areas:

- **Architectural intent.** Why does this change exist? Why this approach?
- **Integration awareness.** What does this touch? What else is affected?
- **Trade-off consciousness.** What could go wrong? What are the implications?

You don't need perfect answers. Honest gaps with self-awareness are fine. The goal is genuine engagement, not recall. See [`verification-guide.md`](skill/references/verification-guide.md) for detailed criteria.

## For teams: CI verification

When verification passes locally, Pushback adds a `Pushback-Verified` trailer to the commit. The included GitHub Action checks for this on pull requests:

```yaml
# .github/workflows/pushback.yml (auto-installed by setup)
name: Pushback Verification
on:
  pull_request:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: arielbk/pushback/action@main
```

The action reports which commits are verified and which aren't. Missing verification fails the check. The result is transparency without surveillance: every push represents code the author engaged with, not just agent output.

| Input | Default | Description |
|-------|---------|-------------|
| `require-all-commits` | `false` | Require every commit to have a trailer (vs. just the last) |
| `fail-on-missing` | `true` | Fail the check when verification is missing |

## Configuration

`.pushback/config.json` lives in your project root. Commit it so the whole team shares the same settings.

```json
{
  "trivial_threshold": {
    "max_lines": 5,
    "ignore_patterns": ["*.lock", "*.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "*.generated.*"]
  },
  "override_env_var": "PUSHBACK_OVERRIDE"
}
```

| Field | Default | What it does |
|-------|---------|-------------|
| `trivial_threshold.max_lines` | `5` | Pushes changing this many lines or fewer skip verification automatically. |
| `trivial_threshold.ignore_patterns` | lockfiles, generated | Files that never count towards the line budget. A push touching only these skips verification. |
| `override_env_var` | `PUSHBACK_OVERRIDE` | Env var that bypasses verification when set. |

**Override** (emergencies only):

```bash
PUSHBACK_OVERRIDE=1 git push
```

Or tell the agent: *"Use the override and push."*
