# Pushback

**You ship code you understand. Your team knows it.**

AI agents write code fast. That's the easy part. The hard part is making sure the person pushing that code actually understands what they're pushing. Not line-by-line — architecturally. The *what*, the *why*, and the *what could go wrong*.

Pushback adds one checkpoint before `git push`: a short conversation. The agent reads your outgoing diff, asks you 2-3 targeted questions, and only lets the push through if you demonstrate genuine understanding. No quiz. No checkbox. A real conversation that takes under two minutes.

This is opinionated, and that's the point. It adds friction — but it puts you in the driver's seat. You're the architect. The agent handles implementation. Pushback makes sure you stay engaged with what's being built.

For teams, it goes further. Every verified push carries a cryptographic receipt. A GitHub Action checks for it on pull requests. Your team can see, at a glance, that the author understood what they shipped. Not because they said so — because they proved it.

## Install

```bash
npx skills add arielbk/pushback
```

That's it. On first use, the skill detects your editor (Cursor, Claude Code, or both), installs the hooks, writes a default config, and sets up a GitHub Action workflow for your PRs. From that point on, every `git push` through the agent is gated.

## How it works

```
You say "push"
  → Editor hook checks for a valid verification receipt
    → No receipt? Push blocked. Agent starts a conversation.
      → You answer 2-3 questions about your changes
        → Pass → receipt written → push goes through
        → Fail → agent points you to what to review
```

The receipt is a SHA-256 hash of your outgoing diff. Make new commits after verification? The hash changes. Re-verification required. The system is self-invalidating — you can't verify once and keep pushing different code.

### What you get asked

Questions come from the actual diff — not generic prompts. They target three areas:

- **Architectural intent** — Why does this change exist? Why this approach?
- **Integration awareness** — What does this touch? What else is affected?
- **Trade-off consciousness** — What could go wrong? What are the implications?

Honest gaps with self-awareness are fine. The goal is genuine engagement, not perfection. See [`verification-guide.md`](skill/references/verification-guide.md) for detailed criteria.

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

The action reports which commits are verified and which aren't. Missing verification fails the check. Your team gets transparency without surveillance — every push represents understood code, not just agent output.

| Input | Default | Description |
|-------|---------|-------------|
| `require-all-commits` | `false` | Require every commit to have a trailer (vs. just the last) |
| `fail-on-missing` | `true` | Fail the check when verification is missing |

## Configuration

`.pushback/config.json` lives in your project root. Commit it so the whole team shares the same settings.

```json
{
  "triggers": ["push"],
  "trivial_threshold": {
    "max_lines": 5,
    "ignore_patterns": ["*.lock", "*.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "*.generated.*"]
  },
  "override_env_var": "PUSHBACK_OVERRIDE"
}
```

| Field | Default | What it does |
|-------|---------|-------------|
| `triggers` | `["push"]` | Which git commands trigger verification. Add `"commit"` to also gate commits. |
| `trivial_threshold.max_lines` | `5` | Changes below this skip verification automatically. |
| `trivial_threshold.ignore_patterns` | lockfiles, generated | Files that are always considered trivial. |
| `override_env_var` | `PUSHBACK_OVERRIDE` | Env var that bypasses verification when set. |

**Override** (emergencies only):

```bash
PUSHBACK_OVERRIDE=1 git push
```

Or tell the agent: *"Use the override and push."*

## Why this exists

AI coding agents are transforming how software gets built. But speed without understanding creates a trust problem — especially on teams. It's too easy to tell the agent "do it," glance at the output, and push. The code might work, but does the developer know *why* it works?

Pushback is built on a simple belief: **the thinking is the skill**. Models change. Tools change. The way you understand your own code — that compounds. This isn't about slowing you down. It's about making sure you're actually driving.

## Compatibility

| | Cursor | Claude Code |
|--|--------|-------------|
| Hook config | `.cursor/hooks.json` | `.claude/settings.json` |
| Hook event | `beforeShellExecution` | `PreToolUse` (Bash) |

A single skill definition works in both editors without modification.

## Repository structure

```
pushback/
├── action/                              # GitHub Action for PR verification
│   ├── action.yml
│   ├── verify-pr.sh
│   └── README.md
├── docs/                                # PRD and technical spec
└── skill/                               # Bundled by npx skills add
    ├── SKILL.md                         # Agent instructions
    ├── scripts/
    │   ├── setup.sh                     # Auto-installs hooks + workflow
    │   └── check-verification.sh        # Receipt validation
    └── references/
        ├── verification-guide.md        # Evaluation criteria
        ├── pushback-workflow.yml      # GitHub Action template
        └── .pushback.config.example.json
```
