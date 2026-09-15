#!/usr/bin/env bash
set -euo pipefail

# Pushback PR Verification
# Checks that commits in a pull request have Pushback-Verified trailers.

TRAILER_KEY="Pushback-Verified"

# Resolve commit range
BASE="${PR_BASE_SHA}"
HEAD="${PR_HEAD_SHA}"

if [ -z "$BASE" ] || [ -z "$HEAD" ]; then
  echo "::error::Could not determine PR base or head SHA. Is this running on a pull_request event?"
  exit 1
fi

# Collect all commits in the PR
COMMITS=$(git rev-list --reverse "$BASE".."$HEAD")

if [ -z "$COMMITS" ]; then
  echo "No commits found in range ${BASE}..${HEAD}"
  echo "## Pushback Verification" >> "$GITHUB_STEP_SUMMARY"
  echo "" >> "$GITHUB_STEP_SUMMARY"
  echo "No commits to verify." >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

TOTAL=0
VERIFIED=0
UNVERIFIED=0
UNVERIFIED_LIST=""

# The developer's own account of the change, one trailer line per question:
# intent, what it touches, the known risk. Reviewers read these on the PR.
SUMMARY_KEY="Pushback-Summary"

# Fold a commit's summary lines into one markdown table cell. Pipes are escaped
# so a line like "Touches: a | b" cannot break the table; blank lines are
# dropped; a commit with no summary block gets an em dash.
summary_cell() {
  printf '%s\n' "$1" | awk '
    { gsub(/\|/, "\\|"); if (NF == 0) next; out = (out == "" ? $0 : out "<br>" $0) }
    END { print (out == "" ? "—" : out) }
  '
}

# Summary table header. Rows carry real newlines rather than "\n" escapes, so
# nothing in a commit subject or a developer's own words gets re-interpreted.
TABLE="| Status | SHA | Author | Subject | Understanding |"
TABLE+=$'\n'"|--------|-----|--------|---------|---------------|"$'\n'

for SHA in $COMMITS; do
  TOTAL=$((TOTAL + 1))
  SHORT=$(git rev-parse --short "$SHA")
  AUTHOR=$(git log -1 --format='%an' "$SHA")
  SUBJECT=$(git log -1 --format='%s' "$SHA")

  # Check for the Pushback-Verified trailer in the commit message
  TRAILER_VALUE=$(git log -1 --format='%(trailers:key=Pushback-Verified,valueonly)' "$SHA" | head -1)
  UNDERSTANDING=$(summary_cell "$(git log -1 --format="%(trailers:key=${SUMMARY_KEY},valueonly)" "$SHA")")

  if [ -n "$TRAILER_VALUE" ]; then
    STATUS_ICON="pass"
    VERIFIED=$((VERIFIED + 1))
    TABLE+="| :white_check_mark: | \`${SHORT}\` | ${AUTHOR} | ${SUBJECT} | ${UNDERSTANDING} |"$'\n'
  else
    STATUS_ICON="fail"
    UNVERIFIED=$((UNVERIFIED + 1))
    UNVERIFIED_LIST+="  - ${SHORT} ${SUBJECT}"$'\n'
    TABLE+="| :x: | \`${SHORT}\` | ${AUTHOR} | ${SUBJECT} | ${UNDERSTANDING} |"$'\n'
  fi
done

# Determine overall result
if [ "$REQUIRE_ALL" = "true" ]; then
  # All commits must be verified
  if [ "$UNVERIFIED" -gt 0 ]; then
    RESULT="fail"
  else
    RESULT="pass"
  fi
else
  # Only the last commit needs to be verified
  LAST_SHA=$(echo "$COMMITS" | tail -1)
  LAST_TRAILER=$(git log -1 --format='%(trailers:key=Pushback-Verified,valueonly)' "$LAST_SHA" | head -1)
  if [ -n "$LAST_TRAILER" ]; then
    RESULT="pass"
  else
    RESULT="fail"
  fi
fi

# Write summary to GITHUB_STEP_SUMMARY
{
  echo "## Pushback Verification"
  echo ""
  if [ "$RESULT" = "pass" ]; then
    echo "> **Passed** — ${VERIFIED}/${TOTAL} commits verified."
  else
    echo "> **Failed** — ${UNVERIFIED}/${TOTAL} commits missing verification."
  fi
  echo ""
  echo "$TABLE"
  echo ""
  if [ "$REQUIRE_ALL" = "true" ]; then
    echo "_Mode: all commits required_"
  else
    echo "_Mode: last commit required_"
  fi
} >> "$GITHUB_STEP_SUMMARY"

# Console output
echo ""
echo "=== Pushback Verification ==="
echo "Commits: ${TOTAL}  Verified: ${VERIFIED}  Missing: ${UNVERIFIED}"
echo ""

if [ "$RESULT" = "fail" ]; then
  echo "Unverified commits:"
  echo "$UNVERIFIED_LIST"

  if [ "$FAIL_ON_MISSING" = "true" ]; then
    echo "::error::Pushback verification failed. ${UNVERIFIED} commit(s) missing verification."
    exit 1
  else
    echo "::warning::Pushback verification incomplete. ${UNVERIFIED} commit(s) missing verification."
    exit 0
  fi
else
  echo "All required commits are verified."
  exit 0
fi
