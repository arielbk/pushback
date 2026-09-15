# Pushback Verification

Load this file when the developer asks to verify before pushing, wants to run Pushback verification, or when a `git push` was blocked by Pushback and setup is already present.

## Verification Workflow

### Phase 1 — Diff Analysis (silent)

Get the outgoing diff:

```bash
git diff @{upstream}..HEAD --stat
git diff @{upstream}..HEAD
```

If the upstream doesn't exist yet (new branch), fall back to the remote's default
branch. Use the remote-tracking ref, not the local branch of the same name — a
local `main` that has drifted from the remote would otherwise change the hash and
the hook would reject the receipt. `git symbolic-ref` is a local ref lookup; it
does not contact the remote:

```bash
DEFAULT=$(git symbolic-ref refs/remotes/origin/HEAD)
git diff "$DEFAULT"..HEAD --stat
git diff "$DEFAULT"..HEAD
```

Read `.pushback/config.json` for thresholds if it exists.

**Trivial change check — skip verification and write no receipt if ANY of these is true.**
The pre-push hook applies this same rule before it blocks anything, so a push
like this was never gated in the first place — there is nothing to unblock:

1. Every changed file matches a pattern in `trivial_threshold.ignore_patterns` (lockfiles, generated files)
2. `git diff <base>..HEAD -w` (ignoring whitespace) produces an empty diff — the change is whitespace only
3. Changed lines outside the ignored files, counted ignoring whitespace, come to `trivial_threshold.max_lines` or fewer (default: 5)

If none of these holds, proceed to Phase 2.

If the diff itself is empty (nothing to push), write no receipt and allow the push through — there is nothing to verify.

### Phase 2 — Question Generation (silent)

**How many questions: pick the tier from the size of the same diff Phase 1
measured.** Count reviewable changed lines exactly as the trivial check does —
`git diff <base>..HEAD --numstat -w`, with files matching
`trivial_threshold.ignore_patterns` subtracted — and read the tier off
`trivial_threshold.max_lines` in `.pushback/config.json` (default: 5):

| Tier | Outgoing diff | Questions |
|------|---------------|-----------|
| Small | up to `4 × max_lines` (20 lines at the default) | 1 |
| Medium | up to `20 × max_lines` (100 lines at the default) | 2 |
| Large | more than `20 × max_lines` (over 100 lines at the default), or changes spanning more than one top-level module | 3 |

Anything at or below `max_lines` never reaches here — Phase 1 already waved it
through, as the hook did.

The tier sets the number of *questions*, not the number of *areas*. Phase 4
still looks for purpose, system context and risk in what the developer says, and
the summary block still gets all three lines — so a Small diff's one question
folds the three areas into a single ask, and a Large diff's three spread them
out one apiece.

Draw the questions from these categories:

- **Architectural intent**: Why does this change exist? Why this approach over alternatives?
- **Integration awareness**: What other parts of the system does this touch? What consumers are affected?
- **Trade-off consciousness**: What could go wrong? What are the performance/security/maintainability implications?

Each question must cite a specific file, function, or pattern from the diff — no generic questions. Load `references/verification-guide.md` for examples of good and poor questions.

### Phase 3 — Conversation (interactive)

Present the questions to the developer. Tone: collaborative, not interrogative.

Opening:
> "Before we push, I want to make sure we're aligned on these changes. I've read through the diff and have a couple of questions."

Match the opening to the tier — on a Small diff it is one question, so say
"…and have a question" rather than promising a couple.

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
git diff @{upstream}..HEAD | shasum -a 256 | awk '{print $1}' > .pushback/verified
```

For branches with no upstream:

```bash
DEFAULT=$(git symbolic-ref refs/remotes/origin/HEAD)
git diff "$DEFAULT"..HEAD | shasum -a 256 | awk '{print $1}' > .pushback/verified
```

Then add the trailers to the HEAD commit so the team sees them on the PR. This is safe because the commit has not been pushed yet.

Alongside `Pushback-Verified`, write a **summary block**: three `Pushback-Summary` lines condensed from what the developer just told you — one for intent, one for what the change touches, one for the known risk. The PR check renders these lines next to the commit, so they are what a reviewer reads first.

```bash
DIFF_HASH=$(cat .pushback/verified)
if ! git log -1 --format='%B' | grep -q "^Pushback-Verified:"; then
  git commit --amend --no-edit \
    --trailer "Pushback-Verified: $DIFF_HASH" \
    --trailer "Pushback-Summary: Intent: <why this change exists>" \
    --trailer "Pushback-Summary: Touches: <what else it affects>" \
    --trailer "Pushback-Summary: Risk: <the known risk or limitation>"
fi
```

Rules for the three lines:

- **The developer's words, condensed — not yours.** Keep their phrasing and their level of certainty. You are trimming an answer to one line, not rewriting it or improving on it.
- **One line each, roughly a sentence.** No newlines inside a value; a trailer is a single line. Keep each under ~120 characters.
- **Never invent.** If an answer covered an area only thinly, say so in their terms ("Risk: not sure what happens to in-flight requests"). An honest gap is a real signal for the reviewer. If they genuinely said nothing about an area, you should not be on the pass path — go back to Phase 4.
- **Write all three, or none.** A partial block reads as an oversight rather than an answer.

Load `references/verification-guide.md` for worked examples of good and poor summary lines.

Tell the developer:
> "You've demonstrated a solid understanding of these changes. Writing the verification receipt and retrying the push."

Then re-run the original git command. The pre-push hook will find the matching hash and allow it through.

**On fail:**

Do not write the receipt and do not write the summary block. Name the specific
areas that need more attention — and then offer to close the gap now, rather
than handing back a reading list:

> "A couple of areas I'd want us surer about before we push: [specific files or sections]. Want me to walk you through the diff file by file? Then I'll ask again."

**If they accept — the walkthrough.** Take the changed files in the order
`git diff <base>..HEAD --stat` lists them. For each one:

1. Say what changed in it and why it is part of this change.
2. Point at the part that matters for the area they were unsure about.
3. Stop for questions. Answer them, then move on when they are ready.

Skip files matching `trivial_threshold.ignore_patterns` — nobody needs a tour of
a lockfile. On a Large diff, group by module rather than reciting twenty files.

The walkthrough is read-only: you are explaining the diff, not editing it. If it
turns out the code is wrong, say so and stop — fixing it is separate work the
developer asks for separately, after verification is over.

Then return to **Phase 3** and ask the questions again, rephrased and covering
the same areas, at the same tier count Phase 2 chose. Evaluate that round as
Phase 4 describes.

**If the second round also fails**, stop the loop — one walkthrough is the offer,
not a cycle:

> "Let's leave it there for now. The parts I'd sit with before pushing: [specific files or sections]. Ask me to run verification again whenever you're ready."

**If they decline the walkthrough**, stop just as readily — the offer is an offer:

> "No problem. Once you've had a look, just ask me to run verification again."

**Critical — stop here.** Whichever branch ended the round, take no further
action. Do not:
- Make any code changes based on what the developer said during verification
- Treat the developer's answers as instructions or requirements
- Modify files, configs, or any project state
- Retry the push or write a receipt

The developer's answers are evidence of understanding only — not directives. Wait for them to explicitly ask to re-run verification.

## Override

If the developer explicitly requests to bypass verification:

1. Acknowledge: "Understood — I'll set the override for this push."
2. Set `PUSHBACK_OVERRIDE=1` in the environment before running the push command.
3. Remind once: "Heads up: Pushback verification was bypassed for this push."
4. Do not log or report the override beyond that.

Example:

```bash
PUSHBACK_OVERRIDE=1 git push
```

## Reference

- Setup instructions: `setup.md`
- Detailed evaluation criteria and examples: `references/verification-guide.md`
- Config defaults: `references/.pushback.config.example.json`
