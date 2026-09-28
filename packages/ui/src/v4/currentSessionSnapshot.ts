/** Select the projection owned by the session currently bound to this pane. */
export function currentSessionSnapshot<T extends { sessionId: string }>(
  sessionId: string | null,
  snapshot: T | null,
): T | null {
  return sessionId && snapshot?.sessionId === sessionId ? snapshot : null;
}
