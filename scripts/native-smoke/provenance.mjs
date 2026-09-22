import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';

const pinned = '872ad960de7ec172591f7e1952f7849229f94521';
const sha = data => createHash('sha256').update(data).digest('hex');
const blob = data => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
export async function provenance(f, filename = 'provenance.json') {
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: f.env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim();
  const result = { pinnedUpstream: pinned, root: f.root, head: git(f.root, 'rev-parse', 'HEAD'),
    dirty: git(f.root, 'status', '--short'), node: process.version, platform: process.platform,
    source: [], sourceMismatches: [], artifacts: [], baseline: f.baseline,
    installedDependencies: f.dependencies,
    execution: 'original native Agent with controlled loopback OpenAI endpoint; NOT Pi; NOT live provider',
  };
  let tree;
  for (const repo of [f.root, join(dirname(f.root), 'zcode-source-872ad96')]) {
    try { tree = git(repo, 'ls-tree', '-r', pinned, '--', 'packages', 'apps'); result.upstreamObjectRepository = repo; break; }
    catch { /* imported repos may not contain upstream Git objects; report this explicitly */ }
  }
  const reference = new Map((tree ?? '').split('\n').map(line => {
    const [, hash, path] = /^\d+ blob (\w+)\t(.+)$/.exec(line) ?? []; return [path, hash];
  }));
  const sourcePaths = git(f.root, 'ls-files', '--', 'packages', 'apps').split('\n');
  for (const path of sourcePaths) {
    if (!path.match(/^(?:packages\/[^/]+|apps\/.+)\/src\//)) continue;
    const hash = reference.get(path);
    const data = await readFile(join(f.root, path));
    const normalized = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
    const matchesPinned = hash ? hash === blob(data) || hash === blob(normalized) : null;
    result.source.push({ path, sha256: sha(data), upstreamBlob: hash, matchesPinned });
    if (tree && !matchesPinned) result.sourceMismatches.push(path);
  }
  if (!tree) result.sourceVerification = 'Actual source hashes recorded; pinned upstream Git object unavailable';
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        const data = await readFile(path);
        result.artifacts.push({ path: relative(f.root, path).replaceAll('\\', '/'), bytes: data.length,
          sha256: sha(data), mtime: (await stat(path)).mtime.toISOString() });
      }
    }
  }
  await walk(join(f.root, 'packages/desktop/out'));
  const agent = join(f.root, 'packages/desktop/bundled-agents/win32-x64/glm/zcode.cjs');
  try {
    const data = await readFile(agent);
    result.artifacts.push({ path: relative(f.root, agent).replaceAll('\\', '/'), bytes: data.length, sha256: sha(data) });
  } catch { result.agentArtifact = 'Not available at pinned upstream Windows bundle path'; }
  result.artifactDigest = sha(JSON.stringify(result.artifacts.map(a => [a.path, a.sha256])));
  result.sourceDigest = sha(JSON.stringify(result.source.map(a => [a.path, a.sha256])));
  await writeFile(join(f.output, filename), JSON.stringify(result, null, 2));
  return { pinnedUpstream: pinned, head: result.head, sourceFiles: result.source.length,
    pinnedSourceVerified: Boolean(tree),
    sourceMismatches: result.sourceMismatches, artifactDigest: result.artifactDigest, sourceDigest: result.sourceDigest };
}
