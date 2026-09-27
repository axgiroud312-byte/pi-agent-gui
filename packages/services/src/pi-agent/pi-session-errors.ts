export const PI_SESSION_NOT_FOUND = "PI_SESSION_NOT_FOUND";

/** Absence of the requested Pi JSONL in its verified workspace and session directory. */
export class PiSessionNotFoundError extends Error {
  readonly code = PI_SESSION_NOT_FOUND;

  constructor() {
    super("Pi session not found in this workspace");
    this.name = "PiSessionNotFoundError";
  }
}

export function isPiSessionNotFoundError(error: unknown): boolean {
  return error instanceof Error &&
    (error as Error & { code?: unknown }).code === PI_SESSION_NOT_FOUND;
}
