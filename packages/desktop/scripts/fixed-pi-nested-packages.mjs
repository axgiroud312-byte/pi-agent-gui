import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const FIXED_PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const FIXED_PI_PACKAGE_VERSION = "0.87.0";
// Chord is excluded: its nested esbuild tree contains binaries for six platforms
// (~66 MB locally). Copying it wholesale would violate the target native policy.
// A target-specific Chord/esbuild runtime path still requires packaged testing.
export const FIXED_PI_NESTED_PACKAGE_OWNERS = Object.freeze([
  FIXED_PI_PACKAGE_NAME,
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
]);
// These root modules were observed as inner `{ type }` markers in the old archive.
// Their workspace-root versions belong to other consumers; Pi keeps its own nested versions.
const ROOT_LAYOUT_MODULES = new Set(["long", "diff", "lru-cache", "brace-expansion", "minimatch", "hosted-git-info"]);

export function createAsarPackageManifestReader({ archivePath, asarEntries, extractFile }) {
  const entrySet = new Set(asarEntries.map(entry => entry.replaceAll("\\", "/")));
  return relativePath => {
    const entry = `/${relativePath.replaceAll("\\", "/")}`;
    if (!entrySet.has(entry)) return null;
    return JSON.parse(extractFile(archivePath, relativePath).toString("utf8"));
  };
}

function readPackageManifest(packageRoot) {
  return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
}

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function collectSourceNestedPackages(sourcePackageRoot, ownerPackageName) {
  const nestedRoot = join(sourcePackageRoot, "node_modules");
  if (!existsSync(nestedRoot)) return [];

  const packages = [];
  const addPackage = (moduleName, sourceModulePath) => {
    const sourceManifest = readPackageManifest(sourceModulePath);
    if (sourceManifest.name !== moduleName || typeof sourceManifest.version !== "string") {
      throw new Error(`Pi nested source package manifest mismatch: ${sourceModulePath}`);
    }
    packages.push({ ownerPackageName, moduleName, sourceModulePath, version: sourceManifest.version });
  };

  for (const entry of readdirSync(nestedRoot, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = join(nestedRoot, entry.name);
    if (!isDirectory(entryPath)) continue;
    if (!entry.name.startsWith("@")) {
      addPackage(entry.name, entryPath);
      continue;
    }
    for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
      const scopedPath = join(entryPath, scopedEntry.name);
      if (scopedEntry.name.startsWith(".") || !isDirectory(scopedPath)) continue;
      addPackage(`${entry.name}/${scopedEntry.name}`, scopedPath);
    }
  }
  return packages.sort((left, right) => left.moduleName.localeCompare(right.moduleName));
}

function resolveNestedOwnerPackagePlan({
  ownerPackageName,
  sourcePackageRoot,
  expectedOwnerVersion,
  readPackagedManifest,
  allowMissingPackagedOwner = false,
}) {
  const sourceOwner = readPackageManifest(sourcePackageRoot);
  if (sourceOwner.name !== ownerPackageName || sourceOwner.version !== expectedOwnerVersion) {
    throw new Error(`Pi source version mismatch: expected ${ownerPackageName}@${expectedOwnerVersion}, found ${sourceOwner.name}@${sourceOwner.version}`);
  }

  const packagedOwner = readPackagedManifest(join("node_modules", ownerPackageName, "package.json"));
  if ((!packagedOwner && !allowMissingPackagedOwner) || (packagedOwner && (packagedOwner.name !== ownerPackageName || packagedOwner.version !== expectedOwnerVersion))) {
    throw new Error(`Pi packaged version mismatch: expected ${ownerPackageName}@${expectedOwnerVersion}, found ${packagedOwner?.name ?? "missing"}@${packagedOwner?.version ?? "missing"}`);
  }

  const sourcePackages = collectSourceNestedPackages(sourcePackageRoot, ownerPackageName);
  const toCopy = sourcePackages.filter(({ moduleName, version }) => {
    const packaged = readPackagedManifest(join("node_modules", ownerPackageName, "node_modules", moduleName, "package.json"));
    return packaged?.name !== moduleName || packaged.version !== version;
  });
  return { sourcePackages, toCopy };
}

/** Preserve the fixed Pi package's own nested dependency versions. */
export function resolveFixedPiNestedPackagePlan({ sourcePiPackageRoot, expectedPiVersion, readPackagedManifest, allowMissingPackagedPi = false }) {
  return resolveNestedOwnerPackagePlan({
    ownerPackageName: FIXED_PI_PACKAGE_NAME,
    sourcePackageRoot: sourcePiPackageRoot,
    expectedOwnerVersion: expectedPiVersion,
    readPackagedManifest,
    allowMissingPackagedOwner: allowMissingPackagedPi,
  });
}

/** Add Pi's three direct runtime packages, while deliberately excluding chord's platform binaries. */
export function resolveFixedPiFamilyNestedPackagePlan({ sourcePackageRoots, expectedPiVersion, readPackagedManifest, allowMissingPackagedOwners = false }) {
  const sourcePiRoot = sourcePackageRoots.get(FIXED_PI_PACKAGE_NAME);
  if (!sourcePiRoot) throw new Error(`Fixed Pi source package not found: ${FIXED_PI_PACKAGE_NAME}`);
  const piManifest = readPackageManifest(sourcePiRoot);
  if (piManifest.name !== FIXED_PI_PACKAGE_NAME || piManifest.version !== expectedPiVersion) {
    throw new Error(`Pi source version mismatch: expected ${FIXED_PI_PACKAGE_NAME}@${expectedPiVersion}`);
  }

  const sourcePackages = [];
  const toCopy = [];
  for (const ownerPackageName of FIXED_PI_NESTED_PACKAGE_OWNERS) {
    if (ownerPackageName !== FIXED_PI_PACKAGE_NAME && !piManifest.dependencies?.[ownerPackageName]) {
      throw new Error(`Fixed Pi no longer declares direct dependency ${ownerPackageName}`);
    }
    const sourcePackageRoot = sourcePackageRoots.get(ownerPackageName);
    if (!sourcePackageRoot) throw new Error(`Pi family source package not found: ${ownerPackageName}`);
    const expectedOwnerVersion = ownerPackageName === FIXED_PI_PACKAGE_NAME
      ? expectedPiVersion : readPackageManifest(sourcePackageRoot).version;
    const plan = resolveNestedOwnerPackagePlan({
      ownerPackageName, sourcePackageRoot, expectedOwnerVersion, readPackagedManifest,
      allowMissingPackagedOwner: allowMissingPackagedOwners,
    });
    sourcePackages.push(...plan.sourcePackages);
    toCopy.push(...plan.toCopy);
  }
  return { sourcePackages, toCopy };
}

/** Pi AI's two proxy agents require agent-base 9, but the archive root may contain 7. */
export function resolvePiAiProxyAgentBasePlan({ sourcePackageRoots, workspaceRoot, readPackagedManifest }) {
  const ownerPackageName = "@earendil-works/pi-ai";
  const sourceOwner = sourcePackageRoots.get(ownerPackageName);
  if (!sourceOwner) throw new Error(`Pi family source package not found: ${ownerPackageName}`);
  const moduleName = "agent-base";
  const sourceModulePath = join(workspaceRoot, "node_modules", moduleName);
  const sourceManifest = readPackageManifest(sourceModulePath);
  if (sourceManifest.name !== moduleName || typeof sourceManifest.version !== "string") {
    throw new Error(`Pi AI source package missing: ${moduleName}`);
  }
  for (const proxyName of ["http-proxy-agent", "https-proxy-agent"]) {
    const proxy = readPackageManifest(join(sourceOwner, "node_modules", proxyName));
    if (proxy.name !== proxyName || proxy.dependencies?.[moduleName] !== sourceManifest.version) {
      throw new Error(`Pi AI ${proxyName} source does not match ${moduleName}@${sourceManifest.version}`);
    }
  }

  const nested = readPackagedManifest(join("node_modules", ownerPackageName, "node_modules", moduleName, "package.json"));
  const root = readPackagedManifest(join("node_modules", moduleName, "package.json"));
  const correctNested = nested?.name === moduleName && nested.version === sourceManifest.version;
  const correctRoot = !nested && root?.name === moduleName && root.version === sourceManifest.version;
  return { toCopy: correctNested || correctRoot ? [] : [{ ownerPackageName, moduleName, sourceModulePath, version: sourceManifest.version }] };
}

/** Protect the root package layout separately from Pi's nested versions. */
export function resolveRootRuntimePackageRepairs({ runtimeModules, workspaceRoot, readPackagedManifest }) {
  return runtimeModules.flatMap(entry => {
    const { moduleName } = entry;
    const packaged = readPackagedManifest(join("node_modules", moduleName, "package.json"));
    const workspaceSource = join(workspaceRoot, "node_modules", moduleName);
    const sourceModulePath = ROOT_LAYOUT_MODULES.has(moduleName) && existsSync(join(workspaceSource, "package.json"))
      ? workspaceSource : entry.sourceModulePath;
    if (!sourceModulePath || readPackageManifest(sourceModulePath).name !== moduleName) {
      throw new Error(`Root runtime source package missing or invalid: ${moduleName}`);
    }
    const sourceVersion = readPackageManifest(sourceModulePath).version;
    if (packaged?.name === moduleName && (!ROOT_LAYOUT_MODULES.has(moduleName) || packaged.version === sourceVersion)) return [];
    return [{ ...entry, sourceModulePath }];
  });
}

/** Root minimatch needs brace-expansion 5.x below itself; the root brace 2.x serves other callers. */
export function resolveRootMinimatchNestedPackagePlan({ workspaceRoot, readPackagedManifest, allowMissingPackagedOwner = false }) {
  const ownerPackageName = "minimatch";
  const sourcePackageRoot = join(workspaceRoot, "node_modules", ownerPackageName);
  const expectedOwnerVersion = readPackageManifest(sourcePackageRoot).version;
  const plan = resolveNestedOwnerPackagePlan({
    ownerPackageName, sourcePackageRoot, expectedOwnerVersion, readPackagedManifest,
    allowMissingPackagedOwner,
  });
  if (!plan.sourcePackages.some(entry => entry.moduleName === "brace-expansion")) {
    throw new Error("Root minimatch source is missing its nested brace-expansion");
  }
  return plan;
}

/**
 * Keep a root runtime package's physically nested dependency when the archive
 * root contains another version of the same dependency. Electron Builder can
 * flatten the owner while dropping that nested directory, which leaves every
 * package manifest present but changes the CommonJS API that the owner loads.
 */
export function resolveRuntimeNestedPackagePlan({
  runtimeModules,
  readPackagedManifest,
  excludedOwnerPackageNames = [],
}) {
  const excludedOwners = new Set(excludedOwnerPackageNames);
  const sourcePackages = [];
  const toCopy = [];
  for (const { moduleName: ownerPackageName, sourceModulePath } of runtimeModules) {
    if (!sourceModulePath || excludedOwners.has(ownerPackageName)) continue;
    const ownerManifest = readPackageManifest(sourceModulePath);
    if (ownerManifest.name !== ownerPackageName) {
      throw new Error(`Runtime nested owner source mismatch: ${sourceModulePath}`);
    }
    for (const entry of collectSourceNestedPackages(sourceModulePath, ownerPackageName)) {
      sourcePackages.push(entry);
      const nested = readPackagedManifest(join(
        "node_modules",
        ownerPackageName,
        "node_modules",
        entry.moduleName,
        "package.json",
      ));
      const root = readPackagedManifest(join("node_modules", entry.moduleName, "package.json"));
      const correctNested = nested?.name === entry.moduleName && nested.version === entry.version;
      const correctRootFallback = !nested && root?.name === entry.moduleName && root.version === entry.version;
      if (!correctNested && !correctRootFallback) toCopy.push(entry);
    }
  }
  return { sourcePackages, toCopy };
}

/** Copy the source package's real nested dependency directories into its archive staging path. */
export function copyFixedPiNestedPackages({ stagingDir, entries }) {
  const stagingRoot = resolve(stagingDir);
  for (const { ownerPackageName = FIXED_PI_PACKAGE_NAME, moduleName, sourceModulePath } of entries) {
    const target = resolve(stagingRoot, "node_modules", ownerPackageName, "node_modules", moduleName);
    const targetRelative = relative(stagingRoot, target);
    if (!targetRelative || targetRelative.startsWith(`..${sep}`) || targetRelative === ".." || isAbsolute(targetRelative)) {
      throw new Error(`Nested runtime package target escapes staging: ${target}`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(sourceModulePath, target, { recursive: true, dereference: true });
  }
}
