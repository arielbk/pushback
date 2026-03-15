#!/usr/bin/env bash
set -euo pipefail

# Human Hook PR Verification
# Checks that commits in a pull request have Human-Hook-Verified trailers.

TRAILER_KEY="Human-Hook-Verified"

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
  echo "## Human Hook Verification" >> "$GITHUB_STEP_SUMMARY"
  echo "" >> "$GITHUB_STEP_SUMMARY"
  echo "No commits to verify." >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

TOTAL=0
VERIFIED=0
UNVERIFIED=0
UNVERIFIED_LIST=""

# Summary table header
TABLE="| Status | SHA | Author | Subject |\n|--------|-----|--------|---------|\n"

for SHA in $COMMITS; do
  TOTAL=$((TOTAL + 1))
  SHORT=$(git rev-parse --short "$SHA")
  AUTHOR=$(git log -1 --format='%an' "$SHA")
  SUBJECT=$(git log -1 --format='%s' "$SHA")

  # Check for the Human-Hook-Verified trailer in the commit message
  TRAILER_VALUE=$(git log -1 --format='%(trailers:key=Human-Hook-Verified,valueonly)' "$SHA" | head -1)

  if [ -n "$TRAILER_VALUE" ]; then
    STATUS_ICON="pass"
    VERIFIED=$((VERIFIED + 1))
    TABLE+="| :white_check_mark: | \`${SHORT}\` | ${AUTHOR} | ${SUBJECT} |\n"
  else
    STATUS_ICON="fail"
    UNVERIFIED=$((UNVERIFIED + 1))
    UNVERIFIED_LIST+="  - ${SHORT} ${SUBJECT}\n"
    TABLE+="| :x: | \`${SHORT}\` | ${AUTHOR} | ${SUBJECT} |\n"
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
  LAST_TRAILER=$(git log -1 --format='%(trailers:key=Human-Hook-Verified,valueonly)' "$LAST_SHA" | head -1)
  if [ -n "$LAST_TRAILER" ]; then
    RESULT="pass"
  else
    RESULT="fail"
  fi
fi

# Write summary to GITHUB_STEP_SUMMARY
{
  echo "## Human Hook Verification"
  echo ""
  if [ "$RESULT" = "pass" ]; then
    echo "> **Passed** — ${VERIFIED}/${TOTAL} commits verified."
  else
    echo "> **Failed** — ${UNVERIFIED}/${TOTAL} commits missing verification."
  fi
  echo ""
  echo -e "$TABLE"
  echo ""
  if [ "$REQUIRE_ALL" = "true" ]; then
    echo "_Mode: all commits required_"
  else
    echo "_Mode: last commit required_"
  fi
} >> "$GITHUB_STEP_SUMMARY"

# Console output
echo ""
echo "=== Human Hook Verification ==="
echo "Commits: ${TOTAL}  Verified: ${VERIFIED}  Missing: ${UNVERIFIED}"
echo ""

if [ "$RESULT" = "fail" ]; then
  echo "Unverified commits:"
  echo -e "$UNVERIFIED_LIST"

  if [ "$FAIL_ON_MISSING" = "true" ]; then
    echo "::error::Human Hook verification failed. ${UNVERIFIED} commit(s) missing verification."
    exit 1
  else
    echo "::warning::Human Hook verification incomplete. ${UNVERIFIED} commit(s) missing verification."
    exit 0
  fi
else
  echo "All required commits are verified."
  exit 0
fi
