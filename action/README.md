# Pushback GitHub Action

A GitHub Action that verifies pull request commits have been reviewed and understood by their authors using Pushback.

## How it works

When a developer pushes code verified by Pushback, the skill amends the commit with a `Pushback-Verified` trailer containing a SHA-256 hash of the outgoing diff, plus a `Pushback-Summary` block holding the developer's own account of the change. This action checks for the verification trailer on PR commits, reports pass/fail as a check, and renders the summary block so reviewers read it on the PR.

## Usage

Add this workflow to your repository at `.github/workflows/pushback.yml`:

```yaml
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

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `require-all-commits` | Require every commit to have a verification trailer (not just the last one) | `false` |
| `fail-on-missing` | Fail the check when verification is missing | `true` |

## What gets checked

By default, the action checks that the **last commit** in the PR has a `Pushback-Verified` trailer. This is because Pushback verification covers the entire outgoing diff at push time, so the trailer on the final commit represents verification of all changes up to that point.

Set `require-all-commits: 'true'` if you want every individual commit to carry its own verification trailer.

## Commit trailer format

Pushback adds these trailers to a commit when verification passes:

```
Pushback-Verified: <sha256-hash-of-diff>
Pushback-Summary: Intent: stop the profile page re-querying the DB on every render
Pushback-Summary: Touches: UserService and anything calling getProfile; adds a Redis keyspace
Pushback-Summary: Risk: profiles can be up to 60s stale — no invalidation on write yet
```

The hash is the SHA-256 of the diff the push would put on the remote, taken at
the time of verification.

`Pushback-Summary` is three **repeated** trailers, one per line, each carrying
its own label — not a single folded multi-line value. Each line is one sentence
in the developer's own words: why the change exists, what it affects, and the
risk they already know about. The action reads them with
`git log -1 --format='%(trailers:key=Pushback-Summary,valueonly)'`, which
returns them in order.

The summary block is advisory. A commit with no summary lines still passes or
fails purely on its `Pushback-Verified` trailer.

## PR check output

The action writes a summary table to the GitHub Actions step summary and logs
details to the console. Each row is one commit: status, SHA, author, subject,
and an **Understanding** column holding that commit's `Pushback-Summary` lines
(an em dash when it has none). When verification fails, it reports which commits
are missing trailers.

```
| Status | SHA | Author | Subject | Understanding |
|--------|-----|--------|---------|---------------|
| :white_check_mark: | `ce41e0b` | dev | feat: cache profile lookups | Intent: …<br>Touches: …<br>Risk: … |
| :x: | `b2f87bc` | dev | chore: unrelated tweak | — |
```
