# Human Hook GitHub Action

A GitHub Action that verifies pull request commits have been reviewed and understood by their authors using Human Hook.

## How it works

When a developer pushes code verified by Human Hook, a `Human-Hook-Verified` trailer is added to the commit message containing a SHA-256 hash of the outgoing diff. This action checks for that trailer on PR commits and reports pass/fail as a check.

## Usage

Add this workflow to your repository at `.github/workflows/human-hook.yml`:

```yaml
name: Human Hook Verification

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
      - uses: arielbk/human-hook/action@main
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `require-all-commits` | Require every commit to have a verification trailer (not just the last one) | `false` |
| `fail-on-missing` | Fail the check when verification is missing | `true` |

## What gets checked

By default, the action checks that the **last commit** in the PR has a `Human-Hook-Verified` trailer. This is because Human Hook verification covers the entire outgoing diff at push time, so the trailer on the final commit represents verification of all changes up to that point.

Set `require-all-commits: 'true'` if you want every individual commit to carry its own verification trailer.

## Commit trailer format

Human Hook adds this trailer to commits when verification passes:

```
Human-Hook-Verified: <sha256-hash-of-diff>
```

The hash is the SHA-256 of `git diff @{upstream}..HEAD` at the time of verification.

## PR check output

The action writes a summary table to the GitHub Actions step summary showing each commit's verification status, and logs details to the console. When verification fails, it reports which commits are missing trailers.
