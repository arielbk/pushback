#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_SCRIPT_SRC="$SKILL_DIR/scripts/check-verification.sh"
HUMAN_HOOK_DIR="$REPO_ROOT/.human-hook"
HOOKS_DEST_DIR="$HUMAN_HOOK_DIR/hooks"
CONFIG_FILE="$HUMAN_HOOK_DIR/config.json"
RECEIPT_FILE="$HUMAN_HOOK_DIR/verified"
GITIGNORE="$REPO_ROOT/.gitignore"

echo "Human Hook: running setup..."

# ── Create .human-hook/ structure ──────────────────────────────────────────

mkdir -p "$HOOKS_DEST_DIR"
cp "$HOOK_SCRIPT_SRC" "$HOOKS_DEST_DIR/check-verification.sh"
chmod +x "$HOOKS_DEST_DIR/check-verification.sh"
echo "  ✓ Hook script installed at .human-hook/hooks/check-verification.sh"

# Write default config if not already present
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<'EOF'
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
  "override_env_var": "HUMAN_HOOK_OVERRIDE"
}
EOF
  echo "  ✓ Created .human-hook/config.json with defaults"
else
  echo "  · .human-hook/config.json already exists, skipping"
fi

# Add receipt to .gitignore
if [ -f "$GITIGNORE" ]; then
  if ! grep -qF ".human-hook/verified" "$GITIGNORE"; then
    echo "" >> "$GITIGNORE"
    echo "# Human Hook — local verification receipt" >> "$GITIGNORE"
    echo ".human-hook/verified" >> "$GITIGNORE"
    echo "  ✓ Added .human-hook/verified to .gitignore"
  else
    echo "  · .human-hook/verified already in .gitignore, skipping"
  fi
else
  printf "# Human Hook — local verification receipt\n.human-hook/verified\n" > "$GITIGNORE"
  echo "  ✓ Created .gitignore with .human-hook/verified entry"
fi

# ── Cursor ─────────────────────────────────────────────────────────────────

CURSOR_DIR="$REPO_ROOT/.cursor"
CURSOR_HOOKS="$CURSOR_DIR/hooks.json"

if [ -d "$CURSOR_DIR" ]; then
  echo "  Cursor detected..."
  mkdir -p "$CURSOR_DIR"

  NEW_HOOK=$(cat <<'EOF'
{
  "command": ".human-hook/hooks/check-verification.sh",
  "matcher": "git "
}
EOF
)

  if [ ! -f "$CURSOR_HOOKS" ]; then
    jq -n --argjson hook "$NEW_HOOK" \
      '{"version": 1, "hooks": {"beforeShellExecution": [$hook]}}' \
      > "$CURSOR_HOOKS"
    echo "  ✓ Created .cursor/hooks.json"
  else
    # Check if human-hook entry already present
    if jq -e '.hooks.beforeShellExecution[]? | select(.command == ".human-hook/hooks/check-verification.sh")' \
        "$CURSOR_HOOKS" >/dev/null 2>&1; then
      # Update matcher in-place in case it's using an older value
      jq '.hooks.beforeShellExecution = [
            .hooks.beforeShellExecution[]
            | if .command == ".human-hook/hooks/check-verification.sh" then
                .matcher = "git "
              else . end
          ]' \
        "$CURSOR_HOOKS" > "$CURSOR_HOOKS.tmp" && mv "$CURSOR_HOOKS.tmp" "$CURSOR_HOOKS"
      echo "  · Human Hook already in .cursor/hooks.json (matcher updated)"
    else
      # Merge into existing hooks
      jq --argjson hook "$NEW_HOOK" \
        '.hooks.beforeShellExecution = ((.hooks.beforeShellExecution // []) + [$hook])' \
        "$CURSOR_HOOKS" > "$CURSOR_HOOKS.tmp" && mv "$CURSOR_HOOKS.tmp" "$CURSOR_HOOKS"
      echo "  ✓ Merged hook into existing .cursor/hooks.json"
    fi
  fi
else
  echo "  · No .cursor/ directory found, skipping Cursor setup"
fi

# ── Claude Code ────────────────────────────────────────────────────────────

CLAUDE_DIR="$REPO_ROOT/.claude"
CLAUDE_SETTINGS="$CLAUDE_DIR/settings.json"

if [ -d "$CLAUDE_DIR" ]; then
  echo "  Claude Code detected..."
  mkdir -p "$CLAUDE_DIR"

  NEW_HOOK=$(cat <<'EOF'
{
  "type": "command",
  "command": ".human-hook/hooks/check-verification.sh"
}
EOF
)

  if [ ! -f "$CLAUDE_SETTINGS" ]; then
    jq -n --argjson hook "$NEW_HOOK" \
      '{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [$hook]}]}}' \
      > "$CLAUDE_SETTINGS"
    echo "  ✓ Created .claude/settings.json"
  else
    if jq -e '.hooks.PreToolUse[]?.hooks[]? | select(.command == ".human-hook/hooks/check-verification.sh")' \
        "$CLAUDE_SETTINGS" >/dev/null 2>&1; then
      echo "  · Human Hook already in .claude/settings.json, skipping"
    else
      # Merge: find the Bash PreToolUse group or create a new one
      jq --argjson hook "$NEW_HOOK" '
        if (.hooks.PreToolUse // []) | map(select(.matcher == "Bash")) | length > 0 then
          .hooks.PreToolUse = [
            .hooks.PreToolUse[]
            | if .matcher == "Bash" then
                .hooks = (.hooks + [$hook])
              else . end
          ]
        else
          .hooks.PreToolUse = ((.hooks.PreToolUse // []) + [{"matcher": "Bash", "hooks": [$hook]}])
        end
      ' "$CLAUDE_SETTINGS" > "$CLAUDE_SETTINGS.tmp" && mv "$CLAUDE_SETTINGS.tmp" "$CLAUDE_SETTINGS"
      echo "  ✓ Merged hook into existing .claude/settings.json"
    fi
  fi
else
  echo "  · No .claude/ directory found, skipping Claude Code setup"
fi

# ── Done ───────────────────────────────────────────────────────────────────

echo ""
echo "Human Hook setup complete."
echo ""
echo "  Default trigger: git push"
echo "  Config:          .human-hook/config.json"
echo "  Receipt:         .human-hook/verified (gitignored)"
echo ""
echo "  To override verification for a single push:"
echo "    HUMAN_HOOK_OVERRIDE=1 git push"
echo ""
echo "  To also gate git commit, edit .human-hook/config.json:"
echo "    \"triggers\": [\"push\", \"commit\"]"
