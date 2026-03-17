# Pushback Setup

Load this file when the developer asks to set up or install Pushback, when Pushback appears not to be installed yet, or when a push is blocked because the hook is missing.

## First-Use Setup

Before doing anything else, check whether Pushback is fully set up — both the hook logic and the active git hook:

```bash
test -f .git/hooks/pre-push && grep -q '.pushback' .git/hooks/pre-push && echo "installed" || echo "not installed"
```

If it is already installed, continue with verification instead of re-running setup.

If it is not installed, the agent should handle setup end-to-end:

1. Detect whether this project already has a Node package-manager context:
   - `pnpm-lock.yaml` -> pnpm
   - `yarn.lock` -> yarn
   - `bun.lockb` -> bun
   - `package-lock.json` -> npm
   - `packageManager` in `package.json` -> use that as fallback
2. If a project package manager is detected, check whether `pushback-cli` is already present in `dependencies` or `devDependencies`.
3. If a project package manager is detected and `pushback-cli` is missing, install it as a dev dependency:

```bash
# pnpm
pnpm add -D pushback-cli

# yarn
yarn add -D pushback-cli

# bun
bun add -D pushback-cli

# npm
npm install -D pushback-cli
```

4. Run setup using the matching command runner:

```bash
# pnpm
pnpm exec pushback setup

# yarn
yarn pushback setup

# bun
bunx pushback setup

# npm
npx pushback setup
```

5. If there is no existing Node package-manager context, do not create one just to install Pushback. Use `npx` as the fallback transport and run setup remotely:

```bash
npx pushback setup
```

The setup command creates the `.pushback/` directory, writes a default config, adds the receipt to `.gitignore`, installs the git hook shim, and sets up the GitHub Action workflow. The hook gates all pushes — from the terminal, IDE, or AI agent.

If Pushback is already set up (`.pushback/config.json` exists) but the git hook is missing, reinstall just the hook shim with the same runner logic:

```bash
# pnpm
pnpm exec pushback install

# yarn
yarn pushback install

# bun
bunx pushback install

# npm or non-Node fallback
npx pushback install
```

## Hook Persistence

After setup, make sure teammates will get the hook automatically when they clone and install. Reuse the same runner you detected above:

- pnpm: `pnpm exec`
- yarn: `yarn`
- bun: `bunx`
- npm or non-Node fallback: `npx`

Look at what the project already uses and integrate accordingly:

- **Husky** (`.husky/` directory exists): Add `{runner} pushback check` to `.husky/pre-push` — create the file if it doesn't exist, append if it does. Husky runs these on every push for anyone who runs the project's normal install command.
- **lefthook** (`lefthook.yml` or `.lefthook.yml` exists): Add a `pushback` command under the `pre-push` section with `run: {runner} pushback check`. If a `pre-push:` block already exists, merge into it — don't create a duplicate top-level key.
- **Other hook managers**: Read their docs/config and add the equivalent pre-push entry. The command to run is always `{runner} pushback check`.
- **No hook manager, but has `package.json`**: Add `{runner} pushback install` to the `prepare` script. If a `prepare` script already exists, append with `&&`. The install command is lightweight and silent — it just installs the git hook shim.
- **No hook manager, no `package.json`**: Note that teammates will need Node and `npx`, and will need to run `npx pushback install` manually after cloning.

Check that whatever you've added doesn't duplicate existing Pushback entries (look for `.pushback` in the relevant config). If the project uses a hook manager that sets `core.hooksPath` (like Husky), the setup script's `.git/hooks/pre-push` shim won't run — the hook manager's integration is what actually gates pushes.

## Reference

- Verification workflow: `verification.md`
- Config defaults: `references/.pushback.config.example.json`
- CLI package: `pushback-cli` (`pushback setup`, `pushback install`, `pushback check` via the detected runner, or `npx` as fallback)
