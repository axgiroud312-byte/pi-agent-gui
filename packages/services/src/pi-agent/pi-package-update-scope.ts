import type { PiPackageScope, PiPackageUpdateAdmission } from "./pi-control-protocol.js";

type ConfiguredPackage = { source: string; scope: PiPackageScope };
type PackageIdentity = { kind: "npm" | "git"; value: string };

// Pi 0.87.0's public update(source) selects every configured package with the
// same identity across both settings scopes. Its public API cannot select one
// scope, so this admission check fails closed when a row is not a unique target.
function packageIdentity(source: string): PackageIdentity | undefined {
  if (source.startsWith("npm:")) {
    const spec = source.slice(4).trim();
    const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
    return match?.[1] ? { kind: "npm", value: `npm:${match[1]}` } : undefined;
  }
  const gitSource = source.startsWith("git:") ? source.slice(4).trim() : source;
  let host: string;
  let path: string;
  const scp = gitSource.match(/^git@([^:]+):(.+)$/);
  if (scp) {
    host = scp[1]!;
    path = scp[2]!;
  } else if (/^(?:https?|ssh|git):\/\//i.test(gitSource)) {
    try {
      const url = new URL(gitSource);
      host = url.hostname;
      path = url.pathname.replace(/^\/+/, "");
    } catch { return undefined; }
  } else {
    const alias = gitSource.match(/^(github|gitlab|bitbucket):(.+)$/i);
    if (alias) {
      host = `${alias[1]!.toLowerCase()}.${alias[1]!.toLowerCase() === "bitbucket" ? "org" : "com"}`;
      path = alias[2]!;
    } else {
      const shorthand = gitSource.match(/^([^/]+\.[^/]+)\/(.+)$/);
      if (!shorthand) return undefined;
      host = shorthand[1]!;
      path = shorthand[2]!;
    }
  }
  if (path.includes("?")) return undefined;
  path = path.split("@")[0]!.split("#")[0]!.replace(/\.git$/, "").replace(/^\/+/, "");
  if (!host || path.split("/").length < 2 || path.split("/").some(part => !part || part === "..")) {
    return undefined;
  }
  return { kind: "git", value: `git:${host.toLowerCase()}/${path}` };
}

function mightBeSameKind(source: string, kind: PackageIdentity["kind"]): boolean {
  return kind === "npm" ? source.startsWith("npm:") :
    source.startsWith("git:") || /^(?:https?|ssh|git):\/\//i.test(source);
}

export function piPackageUpdateAdmission(packages: readonly ConfiguredPackage[],
  selected: ConfiguredPackage): PiPackageUpdateAdmission {
  const identity = packageIdentity(selected.source);
  if (!identity) return { state: "unknown", scopes: [] };
  const matches: ConfiguredPackage[] = [];
  for (const pkg of packages) {
    const candidate = packageIdentity(pkg.source);
    if (!candidate && mightBeSameKind(pkg.source, identity.kind)) return { state: "unknown", scopes: [] };
    if (candidate?.value === identity.value) matches.push(pkg);
  }
  if (!matches.some(pkg => pkg.scope === selected.scope && pkg.source === selected.source)) {
    return { state: "unknown", scopes: [] };
  }
  return { state: matches.length === 1 ? "single" : "multiple",
    scopes: (["user", "project"] as const).filter(scope => matches.some(pkg => pkg.scope === scope)) };
}
