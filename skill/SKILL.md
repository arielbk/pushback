---
name: pushback
description: Use when the developer wants to verify their understanding of changes before pushing, run pushback verification, or when a git push has been blocked.
---

# Pushback

Pushback ensures the developer understands what the AI agent is about to push. It conducts a brief conversational check, then writes a verification receipt so the push can proceed.

## Routing

When this skill is invoked, first determine whether the developer needs setup or verification:

- **Setup**: The developer asks to set up, install, enable, or initialize Pushback, or Pushback appears to be missing. Read `setup.md` and follow it.
- **Verification**: The developer asks to verify before pushing, wants Pushback verification, or a push was blocked by Pushback and setup already exists. Read `verification.md` and follow it.

If you are not sure which path applies, first check whether Pushback is installed:

```bash
test -f .git/hooks/pre-push && grep -q '.pushback' .git/hooks/pre-push && echo "installed" || echo "not installed"
```

- `installed` -> read `verification.md`
- `not installed` -> read `setup.md`

## References

- Setup workflow: `setup.md`
- Verification workflow: `verification.md`
- Detailed evaluation criteria and examples: `references/verification-guide.md`
- Config defaults: `references/.pushback.config.example.json`
