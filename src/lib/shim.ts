/**
 * The body of the pre-push hook we install.
 *
 * `--package pushback-cli` is load-bearing: a bare `npx pushback` makes npm
 * infer the package name from the bin name and resolve the unrelated `pushback`
 * package on npm, which ships no `pushback` executable — the hook then dies with
 * "could not determine executable to run" instead of ever running the check.
 */
export const PUSHBACK_NPX = 'npx --package pushback-cli pushback';

export const SHIM_CONTENT = `#!/usr/bin/env sh
# Pushback pre-push hook
exec ${PUSHBACK_NPX} check "$@"
`;
