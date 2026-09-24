#!/usr/bin/env node

// Prune only disposable #34 reruns kept under this repository's release tree.
// Review snapshots and comparison builds elsewhere are never candidates.
// Usage: node scripts/prune-build-artifacts.mjs [--apply]

import { lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = resolve(repoRoot, 'release', 'issue-34-closeout');
const apply = process.argv.includes('--apply');
const maxAgeMs = 24 * 60 * 60 * 1000;

function familyOf(name) {
  const match = /^(.*?)(?:-(\d+))?$/.exec(name);
  return { stem: match[1], index: match[2] ? Number(match[2]) : 1 };
}

function selectRemovable(entries, now) {
  const grouped = new Map();
  for (const entry of entries) {
    const { stem } = familyOf(entry.name);
    grouped.set(stem, [...(grouped.get(stem) ?? []), entry]);
  }
  return [...grouped.values()].flatMap(group => [...group]
    .sort((a, b) => b.mtimeMs - a.mtimeMs || familyOf(b.name).index - familyOf(a.name).index)
    .slice(1).filter(entry => now - entry.mtimeMs >= maxAgeMs));
}

function candidates() {
  try {
    const realRepo = realpathSync.native(repoRoot);
    const realRelease = realpathSync.native(releaseRoot);
    if (relative(realRepo, realRelease).toLowerCase() !== join('release', 'issue-34-closeout').toLowerCase()) {
      throw new Error('Refusing to prune a release directory redirected outside this repository');
    }
    return readdirSync(releaseRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^pi34-[a-z0-9-]+$/u.test(entry.name))
      .map(entry => {
        const path = resolve(releaseRoot, entry.name);
        const rel = relative(releaseRoot, path);
        const real = realpathSync.native(path);
        const realRel = relative(realRelease, real);
        if (rel.startsWith('..') || rel === '' || basename(path) !== entry.name ||
          realRel.startsWith('..') || !realRel || isAbsolute(realRel)) {
          throw new Error(`Refusing to prune a path outside release: ${path}`);
        }
        return { name: entry.name, path, mtimeMs: lstatSync(path).mtimeMs };
      });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

const removable = selectRemovable(candidates(), Date.now());
for (const entry of removable) {
  if (apply) rmSync(entry.path, { recursive: true, force: true });
  console.log(`${apply ? 'removed' : 'would remove'} ${join(releaseRoot, entry.name)}`);
}
console.log(`${apply ? 'removed' : 'would remove'} ${removable.length} director${removable.length === 1 ? 'y' : 'ies'}`);

export { familyOf, selectRemovable };
