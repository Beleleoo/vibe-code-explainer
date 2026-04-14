/**
 * Session ID validation. Claude Code generates UUID-style IDs, but the
 * value is untrusted input from the hook's stdin — an attacker-controlled
 * session_id like `../../evil` would escape the user tmpdir and drop files
 * at arbitrary paths. Reject anything outside [A-Za-z0-9_-]{1,64}.
 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeSessionId(id: unknown): id is string {
  return typeof id === "string" && SAFE_ID_PATTERN.test(id);
}

/**
 * Defence-in-depth: throw when an unsafe ID reaches a path builder.
 * The hook's parsePayload already rejects unsafe IDs, so this is only
 * reachable via an internal caller that forgot to validate.
 */
export function assertSafeSessionId(id: string): void {
  if (!isSafeSessionId(id)) {
    throw new Error(`unsafe session id: ${JSON.stringify(id)}`);
  }
}
