import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const FIXED_PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const FIXED_PI_PACKAGE_VERSION = "0.87.0";

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

function collectSourceNestedPackages(sourcePiPackageRoot) {
  const nestedRoot = join(sourcePiPackageRoot, "node_modules");
  if (!existsSync(nestedRoot)) return [];

  const packages = [];
  const addPackage = (moduleName, sourceModulePath) => {
    const sourceManifest = readPackageManifest(sourceModulePath);
    if (sourceManifest.name !== moduleName || typeof sourceManifest.version !== "string") {
      throw new Error(`Pi nested source package manifest mismatch: ${sourceModulePath}`);
    }
    packages.push({ moduleName, sourceModulePath, version: sourceManifest.version });
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

/** Return only source nested packages that the archive lost or replaced with another version. */
export function resolveFixedPiNestedPackagePlan({
  sourcePiPackageRoot,
  expectedPiVersion,
  readPackagedManifest,
  allowMissingPackagedPi = false,
}) {
  const sourcePi = readPackageManifest(sourcePiPackageRoot);
  if (sourcePi.name !== FIXED_PI_PACKAGE_NAME || sourcePi.version !== expectedPiVersion) {
    throw new Error(`Pi source version mismatch: expected ${FIXED_PI_PACKAGE_NAME}@${expectedPiVersion}, found ${sourcePi.name}@${sourcePi.version}`);
  }

  const packagedPi = readPackagedManifest(join("node_modules", FIXED_PI_PACKAGE_NAME, "package.json"));
  if ((!packagedPi && !allowMissingPackagedPi) || (packagedPi && (packagedPi.name !== FIXED_PI_PACKAGE_NAME || packagedPi.version !== expectedPiVersion))) {
    throw new Error(`Pi packaged version mismatch: expected ${FIXED_PI_PACKAGE_NAME}@${expectedPiVersion}, found ${packagedPi?.name ?? "missing"}@${packagedPi?.version ?? "missing"}`);
  }

  const sourcePackages = collectSourceNestedPackages(sourcePiPackageRoot);
  const toCopy = sourcePackages.filter(({ moduleName, version }) => {
    const packaged = readPackagedManifest(join("node_modules", FIXED_PI_PACKAGE_NAME, "node_modules", moduleName, "package.json"));
    return packaged?.name !== moduleName || packaged.version !== version;
  });
  return { sourcePackages, toCopy };
}

/** Copy the source package's real nested dependency directories into its archive staging path. */
export function copyFixedPiNestedPackages({ stagingDir, entries }) {
  const stagingRoot = resolve(stagingDir);
  for (const { moduleName, sourceModulePath } of entries) {
    const target = resolve(stagingRoot, "node_modules", FIXED_PI_PACKAGE_NAME, "node_modules", moduleName);
    const targetRelative = relative(stagingRoot, target);
    if (!targetRelative || targetRelative.startsWith(`..${sep}`) || targetRelative === ".." || isAbsolute(targetRelative)) {
      throw new Error(`Pi nested package target escapes staging: ${target}`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(sourceModulePath, target, { recursive: true, dereference: true });
  }
}
