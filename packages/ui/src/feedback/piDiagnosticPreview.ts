/** A small allowlisted report for a user to inspect before sharing it manually. */
export interface PiDiagnosticPreviewInput {
  guiVersion: unknown;
  buildCommit: unknown;
  piBridge?: unknown;
}

function safeVersion(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64 ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:dev|alpha|beta|rc)(?:\.\d+)?)?$/u.test(value)) return null;
  return value;
}

function safeCommit(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{7,40}$/iu.test(value) ? value : null;
}

/** Unknown bridge data, error messages and extension payloads never enter the report. */
export function buildPiDiagnosticPreview(input: PiDiagnosticPreviewInput): string {
  const bridge = input.piBridge && typeof input.piBridge === "object"
    ? input.piBridge as Record<string, unknown> : null;
  const verified = bridge?.mode === "rpc";
  return [
    "Pi Agent IDE diagnostics",
    `GUI: ${safeVersion(input.guiVersion) ?? "unavailable"}`,
    `Build commit: ${safeCommit(input.buildCommit) ?? "unavailable"}`,
    `Pi runtime: ${verified ? safeVersion(bridge.piVersion) ?? "not checked" : "not checked"}`,
    `Pi bridge: ${verified ? safeVersion(bridge.bridgeVersion) ?? "not checked" : "not checked"}`,
    "",
    "No logs, messages, paths, credentials or session identifiers are included.",
  ].join("\n");
}
