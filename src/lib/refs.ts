/**
 * Git pipes one line per ref into a pre-push hook's stdin:
 *
 *   <local ref> SP <local sha> SP <remote ref> SP <remote sha> LF
 *
 * These shas are what git is *about to* transfer — they come from the live
 * connection to the remote, so they are authoritative in a way the local
 * remote-tracking refs are not.
 */
export interface RefUpdate {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

/** Git spells "this ref does not exist" as an all-zero sha. */
export function isNullSha(sha: string): boolean {
  return /^0+$/.test(sha);
}

export function parseRefLines(stdin: string): RefUpdate[] {
  const updates: RefUpdate[] = [];
  for (const line of stdin.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4) continue;
    const [localRef, localSha, remoteRef, remoteSha] = parts;
    updates.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return updates;
}
