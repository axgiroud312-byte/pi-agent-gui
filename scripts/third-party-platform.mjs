// pnpm ls flattens transitive optionalDependencies into dependencies. Only the
// exact lockfile snapshot plus its platform constraints can justify an omission.
export function platformOptionalPackages(lockfile, supported = {}, current = {
  os: process.platform,
  cpu: process.arch,
  libc: process.platform === "linux"
    ? (process.report.getReport().header.glibcVersionRuntime ? "glibc" : "musl")
    : undefined,
}) {
  const snapshots = new Map();
  for (const [key, snapshot] of Object.entries(lockfile.snapshots ?? {})) {
    const base = key.split("(")[0];
    const entries = snapshots.get(base) ?? [];
    entries.push(snapshot);
    snapshots.set(base, entries);
  }
  const missing = new Map();
  for (const [key, pkg] of Object.entries(lockfile.packages ?? {})) {
    const entries = snapshots.get(key);
    // A required occurrence (including another peer resolution) always wins.
    if (!entries?.length || !entries.every(entry => entry.optional === true)) continue;
    const incompatible = ["os", "cpu", "libc"].filter(dimension => {
      const constraints = pkg[dimension];
      if (!Array.isArray(constraints) || constraints.length === 0) return false;
      const targets = (supported[dimension] ?? ["current"])
        .map(value => value === "current" ? current[dimension] : value);
      // Unknown current libc is not evidence that a package can be omitted.
      if (targets.some(value => value === undefined || value === "any")) return false;
      const positive = constraints.filter(value => !value.startsWith("!"));
      return !targets.some(value => !constraints.includes(`!${value}`) &&
        (positive.length === 0 || positive.includes("any") || positive.includes(value)));
    });
    if (incompatible.length) missing.set(key, {
      reason: "Optional lockfile package is outside the configured installation platforms",
      constraints: Object.fromEntries(["os", "cpu", "libc"].filter(key => pkg[key]).map(key => [key, pkg[key]])),
    });
  }
  return missing;
}

export function assertProductionNoticeCoverage(required, installed, inventory) {
  const covered = new Map(inventory.packages.map(item => [`${item.name}@${item.version}`, item]));
  for (const [key] of required) {
    // Installed cross-platform optional packages are never exempt from notices.
    if (!installed.has(key)) continue;
    const item = covered.get(key);
    if (!item?.notices?.length) throw new Error(`Missing production notice coverage: ${key}`);
  }
}
