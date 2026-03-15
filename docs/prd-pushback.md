# Pushback — Product Requirements Document

## 1. Introduction / Overview

AI coding agents are transforming how software gets built. Developers increasingly hand implementation work to agents in tools like Cursor, Claude Code, and Codex — and in collaborative team settings, this creates a trust problem: **how do you know your teammate actually understands the code they're shipping?**

It's too easy to tell the agent "do it," glance at the output at 5pm, and push to production. The code might work, but the developer may not understand *why* it works, how it fits into the broader architecture, or what trade-offs were made. In digital agencies and collaborative teams, this erodes collective ownership and creates hidden knowledge gaps.

**Pushback** adds intentional friction to the development workflow. Before code leaves a developer's machine, it verifies — through a short, conversational check — that the developer understands what they're shipping. Not line-by-line code review, but architectural understanding: the *what*, the *why*, and the *how it connects*.

## 2. Goals

- **Verify developer understanding** of code changes before they leave the developer's machine, through a conversational back-and-forth — not a checkbox. The default gate is `git push` — the moment code crosses from local to shared.
- **Create trust in collaborative teams** by ensuring that every push represents understood code, not just agent-generated output.
- **Add productive friction** that pushes developers toward understanding, not away from shipping. The verification process itself should be educational.
- **Run on the developer's own LLM subscription** (Cursor, Claude Code) with zero additional API cost to the developer or to us.
- **Support the two leading AI coding tools** — Cursor and Claude Code — from day one, with a single installation step.
- **Be opinionated about what understanding means**, focusing on architectural intent, system integration awareness, and trade-off consciousness.

## 3. User Stories

### Developer (primary user)

- As a developer using an AI coding agent, I want to be prompted to demonstrate my understanding of the code before I push, so that I catch my own knowledge gaps before sharing code with my team.
- As a developer, I want the verification to happen naturally in my editor's chat panel, so that it doesn't break my flow.
- As a developer, I want to be able to override the verification for urgent situations, so that I'm not completely blocked when I need to ship quickly.
- As a developer, I want trivial changes (typo fixes, config tweaks) to skip verification automatically, so that the friction is proportional to the risk.

### Tech Lead / Team Lead

- As a tech lead, I want confidence that my team members understand the AI-generated code they're pushing, so that we maintain code quality and shared ownership.
- As a tech lead, I want to install Pushback across the team's project with a single setup step, so that adoption is frictionless.
- As a tech lead, I want to configure which actions trigger verification (commit, push, or both), so that I can calibrate the level of friction for my team.

### Team

- As a team, we want a verification system that doesn't shame individuals for failing checks, so that people actually want to use it.
- As a team, we want the verification to encourage understanding rather than penalize lack of it, so that it becomes a learning tool, not a gatekeeping tool.

## 4. Functional Requirements

### 4.1 Conversational Verification

1. When a developer attempts to push code, the system must initiate a conversational understanding check in the editor's agent/chat panel. (Optionally configurable to also trigger on commit.)
2. The system must analyze the outgoing changes (the diff between the local branch and the remote) and generate 2–3 probing questions tailored to the specific changes.
3. Questions must focus on three areas:
  - **Architectural intent** — What problem does this change solve? Why this approach?
  - **Integration awareness** — How does this change interact with the rest of the system?
  - **Trade-off consciousness** — What are the risks or trade-offs of this approach?
4. The system must evaluate the developer's responses using the user's own LLM (via the editor's built-in model) and determine whether they demonstrate genuine understanding.
5. On pass: the push proceeds normally.
6. On fail: the push is blocked, and the system provides guidance on what to review before retrying.

### 4.2 Installation and Setup

1. Pushback must be installable as a single skill that works across both Cursor and Claude Code.
2. On first use, the skill must automatically configure the necessary editor hooks (no manual hook setup required by the developer).
3. The setup must detect which tools are present (Cursor, Claude Code, or both) and configure hooks accordingly.
4. The setup must not overwrite existing hook configurations — it must merge its configuration alongside any hooks already in place.

### 4.3 Hook Behavior

1. The hook must intercept `git push` initiated through the AI agent by default. Optionally, teams can configure it to also trigger on `git commit`.
2. Which commands trigger verification must be configurable at the project level.
3. The hook must check for a valid verification receipt before allowing the command to proceed.
4. If no valid receipt exists, the hook must block the command and direct the agent to initiate the verification conversation.

### 4.4 Verification State

1. Upon successful verification, the system must store a verification receipt tied to the current state of the outgoing changes (diff hash of local vs. remote).
2. The receipt must automatically invalidate if the outgoing changes are modified after verification (e.g., new commits are made after verification but before push).
3. The verification state must be local to the developer's machine and not committed to the repository.

### 4.5 Trivial Change Threshold

1. The system must detect trivial changes and skip verification for them.
2. Trivial changes include: changes below a configurable line threshold, changes to lockfiles or auto-generated files, and whitespace-only changes.
3. The threshold must be configurable at the project level.

### 4.6 Override Mechanism

1. Developers must be able to override the verification gate when necessary (e.g., urgent hotfixes).
2. The override must require explicit intent (not just re-running the command).

## 5. Non-Goals (Out of Scope)

- **Team-visible verification logs or dashboards** — v1 is a local gate only. No shaming, no leaderboards, no team-facing reports.
- **Commit message annotations** — No verification metadata in commit messages for v1 (potential future feature: a small indicator like an emoji).
- **Manual terminal coverage** — v1 only intercepts commands initiated through the AI agent. Developers committing from a standalone terminal are not covered (future enhancement).
- **Standalone CLI mode** — v1 does not ship as an independent CLI tool. It operates through the skill + hook mechanism within supported editors.
- **LLM API cost burden** — The system must never require its own API keys or incur costs beyond the user's existing editor/LLM subscription.
- **Codex / OpenCode support** — Not in v1 due to less mature hook systems. Can be added later.
- **Pair/mob programming workflows** — Out of scope for v1.
- **Custom question templates** — v1 is opinionated. Configurable question frameworks are a future consideration.

## 6. Design Considerations

### User Experience

- The verification conversation must feel natural, not like a test. The tone should be collaborative: "Let's make sure we're on the same page about these changes" rather than "Prove you understand this code."
- The verification should take **under 2 minutes** for a typical set of changes. It's friction, but it's fast friction.
- Failed verification should be helpful, not punitive. The system should point the developer toward the specific areas they need to understand better.

### Interaction Flow

- The entire experience happens in the editor's existing chat/agent panel — no new UI, no popups, no separate tools.
- The developer's normal workflow is: work with agent → agent writes code and commits → developer says "push" → verification triggers → short conversation → push proceeds. The agent is free to make as many local commits as needed; the gate only activates when code is about to leave the machine.

### Competitive Context

- **Gater.app** is the closest existing product. It generates quizzes from GitHub PRs to verify reviewer understanding before merge. Key differences from Pushback:
  - Gater operates at the PR level (post-push); Pushback operates pre-push (shift-left).
  - Gater uses multiple-choice quizzes; Pushback uses open-ended conversation.
  - Gater verifies the *reviewer*; Pushback verifies the *author*.
  - Gater requires a GitHub App + Chrome Extension; Pushback lives inside the editor.

## 7. Success Metrics

- **Adoption**: Number of projects / teams that install and keep Pushback active after 2 weeks.
- **Verification completion rate**: Percentage of triggered verifications that are completed (vs. overridden or abandoned).
- **Developer sentiment**: Qualitative feedback — do developers feel it helps them understand their code better, or is it just annoying friction?
- **Time to verify**: Average time from verification trigger to pass. Target: under 2 minutes.
- **Knowledge gap detection**: How often does verification surface genuine misunderstandings (developer fails on first attempt, passes after review)?

## 8. Open Questions

1. **Team visibility (future)**: What's the right minimal signal for teams? A commit message emoji? A field in PR descriptions? How do we communicate "this code was understood" without creating a shame dynamic?
2. **Git hook fallback**: Should v1 include a lightweight git pre-push hook that just checks for the receipt file (no LLM needed) as a safety net for manual terminal pushes?
3. **Verification depth scaling**: Should the number/depth of questions scale with the size or risk of the change? A 500-line architectural change might warrant deeper probing than a 20-line feature.
4. **Commit-level gating (opt-in)**: Some teams may want to gate individual commits rather than just pushes. The configuration supports this, but should v1 actively promote it or keep it as an advanced option?

