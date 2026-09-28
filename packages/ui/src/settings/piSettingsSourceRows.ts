type Scope = "user" | "project";

export interface PiSettingsSourceRow {
  path: string;
  value: string;
  source: Scope | "unknown";
}

/** Pi merges nested objects by leaf; render that same granularity in the native settings table. */
export function buildPiSettingsSourceRows(snapshot: {
  effective: Record<string, unknown>;
  sources: Record<string, Scope>;
  sourcePaths: Record<string, Scope>;
}): PiSettingsSourceRow[] {
  const rows: PiSettingsSourceRow[] = [];
  const escapePointer = (key: string) => key.replace(/~/gu, "~0").replace(/\//gu, "~1");
  const visit = (value: unknown, path: string, rootKey: string) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value);
      if (entries.length > 0) {
        for (const [key, child] of entries) visit(child, `${path}/${escapePointer(key)}`, rootKey);
        return;
      }
    }
    rows.push({ path, value: JSON.stringify(value) ?? String(value),
      source: snapshot.sourcePaths[path] ?? snapshot.sources[rootKey] ?? "unknown" });
  };
  for (const [key, value] of Object.entries(snapshot.effective)) {
    visit(value, `/${escapePointer(key)}`, key);
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
