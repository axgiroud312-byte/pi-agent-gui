import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const CHORD_PACKAGE_NAME = '@earendil-works/chord';

function readManifest(packageRoot) {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
}

function assertWithin(stagingRoot, target) {
  const rel = relative(stagingRoot, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Chord esbuild target escapes staging: ${target}`);
  }
}

/** Chord owns its esbuild version. Keep both packages below Chord so root consumers stay untouched. */
export function resolveChordEsbuildPlan({ sourceChordPackageRoot, targetPlatformKey, readPackagedManifest, asarEntries = [] }) {
  if (!sourceChordPackageRoot) throw new Error('Chord source package not found');
  const chord = readManifest(sourceChordPackageRoot);
  const version = chord.dependencies?.esbuild;
  if (chord.name !== CHORD_PACKAGE_NAME || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error('Chord source must declare an exact esbuild dependency');
  }
  const packagedChord = readPackagedManifest(join('node_modules', CHORD_PACKAGE_NAME, 'package.json'));
  if (packagedChord && (packagedChord.name !== CHORD_PACKAGE_NAME || packagedChord.version !== chord.version)) {
    throw new Error(`Packaged Chord version differs from source: ${packagedChord?.version}`);
  }
  const packages = [
    { moduleName: 'esbuild', sourceModulePath: join(sourceChordPackageRoot, 'node_modules', 'esbuild') },
    { moduleName: `@esbuild/${targetPlatformKey}`, sourceModulePath: join(sourceChordPackageRoot, 'node_modules', '@esbuild', targetPlatformKey) },
  ].map(entry => {
    const source = readManifest(entry.sourceModulePath);
    if (source.name !== entry.moduleName || source.version !== version) {
      throw new Error(`Chord esbuild source mismatch: ${entry.moduleName}@${source.version}; expected ${version}`);
    }
    const packagedPath = join('node_modules', CHORD_PACKAGE_NAME, 'node_modules', entry.moduleName, 'package.json');
    const packaged = readPackagedManifest(packagedPath);
    return { ...entry, version, packagedPath, needsCopy: packaged?.name !== entry.moduleName || packaged.version !== version };
  });
  return {
    version,
    packages,
    toCopy: packages.filter(entry => entry.needsCopy),
    nonTargetPlatforms: findNonTargetEsbuildPlatforms(asarEntries, targetPlatformKey),
  };
}

export function filterChordEsbuildFromRootRuntimeModules(runtimeModules) {
  return runtimeModules.filter(entry => entry.moduleName !== 'esbuild' && !entry.moduleName.startsWith('@esbuild/'));
}

export function findNonTargetEsbuildPlatforms(asarEntries, targetPlatformKey) {
  const found = new Set();
  for (const entry of asarEntries) {
    const path = (typeof entry === 'string' ? entry : entry.path).replaceAll('\\', '/');
    const match = /(?:^|\/)node_modules\/@esbuild\/([^/]+)(?:\/|$)/.exec(path);
    if (match && match[1] !== targetPlatformKey) found.add(match[1]);
  }
  return [...found].sort();
}

function prunePlatformRoot(platformRoot, targetPlatformKey) {
  if (!existsSync(platformRoot)) return;
  for (const entry of readdirSync(platformRoot, { withFileTypes: true })) {
    if (entry.name !== targetPlatformKey) {
      rmSync(join(platformRoot, entry.name), { force: true, recursive: true });
    }
  }
}

/** Only remove modules inside the temporary, owned asar staging tree. */
export function pruneNonTargetEsbuildPlatforms({ stagingDir, targetPlatformKey }) {
  const root = resolve(stagingDir);
  for (const platformRoot of [
    resolve(root, 'node_modules', '@esbuild'),
    resolve(root, 'node_modules', CHORD_PACKAGE_NAME, 'node_modules', '@esbuild'),
  ]) {
    assertWithin(root, platformRoot);
    prunePlatformRoot(platformRoot, targetPlatformKey);
  }
}

/** Chord's source node_modules contains many platform binaries; copy only its own code. */
export function copyChordPackageWithoutNestedModules({ sourceModulePath, targetModulePath }) {
  cpSync(sourceModulePath, targetModulePath, {
    recursive: true,
    dereference: true,
    filter: sourcePath => {
      const rel = relative(sourceModulePath, sourcePath).replaceAll('\\', '/');
      return rel !== 'node_modules' && !rel.startsWith('node_modules/');
    },
  });
}

export function copyChordEsbuildPackages({ stagingDir, entries }) {
  const root = resolve(stagingDir);
  for (const { moduleName, sourceModulePath } of entries) {
    const target = resolve(root, 'node_modules', CHORD_PACKAGE_NAME, 'node_modules', moduleName);
    assertWithin(root, target);
    rmSync(target, { force: true, recursive: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(sourceModulePath, target, { recursive: true, dereference: true });
  }
}

export function chordEsbuildBinaryPath(targetPlatformKey) {
  return targetPlatformKey.startsWith('win32-') ? 'esbuild.exe' : join('bin', 'esbuild');
}
