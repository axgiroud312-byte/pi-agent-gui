import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** Resolve only a packaged fixed-Pi RPC child to Chord's physical esbuild binary. */
export function packagedPiEsbuildEnv(
  piEntry: string,
  inheritedEnv: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  arch = process.arch,
  binaryExists: (path: string) => boolean = existsSync,
): NodeJS.ProcessEnv {
  // An explicitly supplied binary belongs to the caller, even when empty.
  if (Object.hasOwn(inheritedEnv, 'ESBUILD_BINARY_PATH')) return {};
  if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) return {};
  const absoluteEntry = resolve(piEntry);
  const archiveSeparator = `${sep}app.asar${sep}`;
  const archiveIndex = absoluteEntry.toLowerCase().indexOf(archiveSeparator.toLowerCase());
  if (archiveIndex < 0) return {};
  const withinArchive = absoluteEntry.slice(archiveIndex + archiveSeparator.length).toLowerCase();
  const expectedPrefix = ['node_modules', '@earendil-works', 'pi-coding-agent'].join(sep).toLowerCase();
  if (withinArchive !== expectedPrefix && !withinArchive.startsWith(`${expectedPrefix}${sep}`)) return {};
  const resourcesRoot = absoluteEntry.slice(0, archiveIndex);
  const targetPlatformKey = `${platform}-${arch}`;
  const binaryPath = join(
    resourcesRoot, 'app.asar.unpacked', 'node_modules', '@earendil-works', 'chord',
    'node_modules', '@esbuild', targetPlatformKey,
    ...(platform === 'win32' ? ['esbuild.exe'] : ['bin', 'esbuild']),
  );
  if (!binaryExists(binaryPath)) {
    throw new Error(`Packaged Pi Chord esbuild binary is missing: ${binaryPath}`);
  }
  return { ESBUILD_BINARY_PATH: binaryPath };
}
