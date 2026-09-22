#!/usr/bin/env node
// Fix only checkout EOL drift in declared provenance paths. Default: read-only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function lf(bytes) {
  const output = Buffer.allocUnsafe(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
    output[length++] = bytes[i];
  }
  return output.subarray(0, length);
}
const metadataFiles = [
  "package.json",
  "third-party/inventory.json",
  "third-party/runtime/sources.json",
  "third-party/native-search/sources.json",
  "third-party/copied-components.json",
  "third-party/embedded-components.json",
  "third-party/npm-overrides.json",
];

function readIndex(git) {
  const entries = new Map();
  for (const line of git(["ls-files", "--stage", "-z"]).toString("utf8").split("\0")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const header = line.slice(0, tab);
    const file = line.slice(tab + 1);
    const [mode, oid, stage] = header.split(" ");
    entries.set(file, { mode, oid, stage });
  }
  return entries;
}

function readBlobs(git, oids) {
  const unique = [...new Set(oids)];
  const output = git(["cat-file", "--batch"], Buffer.from(`${unique.join("\n")}\n`));
  const blobs = new Map();
  let offset = 0;
  for (const oid of unique) {
    const end = output.indexOf(10, offset);
    const [actual, type, sizeText] = output.subarray(offset, end).toString().split(" ");
    const size = Number(sizeText);
    if (end < offset || actual !== oid || type !== "blob" || !Number.isSafeInteger(size))
      throw new Error(`Invalid Git blob response: ${oid}`);
    const bytes = output.subarray(end + 1, end + 1 + size);
    if (bytes.length !== size || output[end + 1 + size] !== 10)
      throw new Error(`Truncated Git blob: ${oid}`);
    blobs.set(oid, bytes);
    offset = end + size + 2;
  }
  return blobs;
}

export async function repairNativeProvenanceBytes(requestedRoot, { write = false } = {}) {
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"])
    if (process.env[name])
      throw new Error(`Refusing inherited ${name}; select the worktree with --root.`);
  const root = await realpath(requestedRoot);
  const git = (args, input) =>
    execFileSync("git", ["-C", root, ...args], {
      cwd: root,
      input,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
    });
  const actualRoot = await realpath(git(["rev-parse", "--show-toplevel"]).toString().trim());
  if (actualRoot !== root) throw new Error("--root must be the exact Git worktree root.");
  const entries = readIndex(git);
  const safePath = async (file) => {
    const path = resolve(root, file);
    const rel = relative(root, path);
    if (!rel || isAbsolute(rel) || rel.startsWith("..") || file.includes("\\"))
      throw new Error(`Invalid provenance path: ${file}`);
    // Also reject symlinked parents/junctions; never repair outside the chosen worktree.
    const actual = await realpath(path);
    const stat = await lstat(path);
    if (actual !== path || !stat.isFile() || stat.isSymbolicLink())
      throw new Error(`Not an ordinary in-worktree file: ${file}`);
    return path;
  };
  const entryFor = (file) => {
    const entry = entries.get(file);
    if (!entry || entry.stage !== "0" || !["100644", "100755"].includes(entry.mode))
      throw new Error(`Missing, unmerged or non-file index entry: ${file}`);
    return entry;
  };
  const metadataBlobs = readBlobs(
    git,
    metadataFiles.map((file) => entryFor(file).oid),
  );
  const metadata = {};
  for (const file of metadataFiles) {
    const bytes = metadataBlobs.get(entryFor(file).oid);
    const working = await readFile(await safePath(file));
    if (!lf(working).equals(lf(bytes)))
      throw new Error(`Unstaged metadata changes: ${file}. Preserve/review them before repair.`);
    metadata[file] = JSON.parse(bytes);
  }

  const targets = new Map();
  const add = (file, expected) => {
    entryFor(file);
    const old = targets.get(file);
    if (old && expected && old !== expected) throw new Error(`Conflicting notice hashes: ${file}`);
    targets.set(file, expected ?? old);
  };
  const pin = (file, expected) => {
    if (!/^[a-f0-9]{64}$/u.test(expected ?? ""))
      throw new Error(`Missing declared material SHA-256: ${file}`);
    add(file, expected);
  };
  const inventory = metadata["third-party/inventory.json"];
  pin("THIRD-PARTY-NOTICES.md", inventory.noticesSha256);
  for (const record of metadata["third-party/runtime/sources.json"].node)
    pin(record.file, record.sha256);
  const native = metadata["third-party/native-search/sources.json"];
  for (const [file, expected] of Object.entries(native.inputs)) pin(file, expected);
  for (const component of native.components)
    for (const notice of component.notices) pin(notice.file, notice.sha256);
  for (const file of entries.keys()) {
    const match = /^third-party\/(?:upstream|native-search\/licenses)\/([a-f0-9]{64})\.txt$/u.exec(
      file,
    );
    if (match) pin(file, match[1]);
  }
  for (const component of metadata["third-party/copied-components.json"]) {
    if (component.file) pin(component.file, component.sha256);
    // Current indexed roots retain committed/staged branding, additions and deletions.
    // Old inventory snapshot hashes are deliberately not used as source to restore.
    for (const sourceRoot of component.roots) {
      const paths = [...entries.keys()].filter(
        (file) => file === sourceRoot || file.startsWith(`${sourceRoot}/`),
      );
      if (!paths.length) throw new Error(`Copied root absent from current index: ${sourceRoot}`);
      for (const file of paths) add(file);
    }
  }
  for (const component of metadata["third-party/embedded-components.json"])
    for (const record of [...component.notices, ...(component.buildEvidence ?? [])])
      pin(record.file, record.sha256);
  for (const record of metadata["third-party/npm-overrides.json"])
    if (record.file) pin(record.file, record.sha256);
  for (const file of Object.values(metadata["package.json"].pnpm?.patchedDependencies ?? {}))
    add(file);
  pin(
    "scripts/license-texts/Apache-2.0.txt",
    inventory.inputs["scripts/license-texts/Apache-2.0.txt"],
  );

  const blobs = readBlobs(
    git,
    [...targets.keys()].map((file) => entryFor(file).oid),
  );
  const repairs = [];
  const blocked = [];
  let alreadyExact = 0;
  for (const [file, expected] of [...targets].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    try {
      const bytes = blobs.get(entryFor(file).oid);
      if (expected && sha(bytes) !== expected)
        throw new Error(
          "Index blob does not match declared material hash; do not overwrite from an older revision.",
        );
      const path = await safePath(file);
      const working = await readFile(path);
      if (working.equals(bytes)) {
        alreadyExact += 1;
        continue;
      }
      if (working.includes(0) || bytes.includes(0) || !lf(working).equals(lf(bytes)))
        throw new Error("Working content differs beyond CRLF/LF; preserve the local edit.");
      repairs.push({ file, path, bytes, workingSha256: sha(working), indexSha256: sha(bytes) });
    } catch (error) {
      blocked.push({ file, reason: error.message });
    }
  }
  const report = {
    mode: write ? "write" : "dry-run",
    root,
    gitDir: git(["rev-parse", "--absolute-git-dir"]).toString().trim(),
    indexFile: git(["rev-parse", "--path-format=absolute", "--git-path", "index"])
      .toString()
      .trim(),
    pathsChecked: targets.size,
    alreadyExact,
    repairCount: repairs.length,
    repairs: repairs.map(({ file, workingSha256, indexSha256 }) => ({
      file,
      workingSha256,
      indexSha256,
    })),
    blocked,
  };
  // Finish all validation before writing even the first file. Never stage or alter metadata.
  if (write && blocked.length)
    throw new Error(`Repair blocked; no files written:\n${JSON.stringify(report, null, 2)}`);
  if (write) {
    const current = readIndex(git);
    for (const file of new Set([...metadataFiles, ...targets.keys()]))
      if (current.get(file)?.oid !== entryFor(file).oid || current.get(file)?.stage !== "0")
        throw new Error(`Index changed during repair planning: ${file}`);
    for (const repair of repairs) {
      if (sha(await readFile(await safePath(repair.file))) !== repair.workingSha256)
        throw new Error(`Working file changed during repair: ${repair.file}`);
    }
    for (const repair of repairs) {
      const path = await safePath(repair.file);
      if (sha(await readFile(path)) !== repair.workingSha256)
        throw new Error(`Working file changed before write: ${repair.file}`);
      await writeFile(path, repair.bytes);
      if (sha(await readFile(repair.path)) !== repair.indexSha256)
        throw new Error(`Raw-byte write verification failed: ${repair.file}`);
    }
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { root: { type: "string" }, write: { type: "boolean" } },
  });
  try {
    const report = await repairNativeProvenanceBytes(values.root ?? process.cwd(), {
      write: values.write,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.blocked.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
