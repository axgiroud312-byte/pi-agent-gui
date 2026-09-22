import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { repairNativeProvenanceBytes } from "../repair-native-provenance-bytes.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const runtimeFile = "third-party/runtime/node-LICENSE.txt";
const sourceFile = "copied/button.tsx";
const smokeFile = "scripts/native-desktop-smoke.mjs";
const put = async (root, file, bytes) => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), bytes);
};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "native-byte-repair-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args, input) =>
    execFileSync("git", args, {
      cwd: root,
      input,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
  git(["init", "--quiet"]);
  const originalNode = "Node copyright\nNode terms\n";
  const originalNative = "Native copyright\r\nNative terms\r\n";
  const originalUpstream = "Original upstream copyright\nMIT terms\n";
  const nativeFile = `third-party/native-search/licenses/${sha(originalNative)}.txt`;
  const upstreamFile = `third-party/upstream/${sha(originalUpstream)}.txt`;
  const notices = `Notices\n${originalNative}`;
  const apache = "Apache terms fixture\n";
  const config = "export const version = 1;\n";
  const files = {
    ".gitattributes":
      "* text=auto eol=crlf\nTHIRD-PARTY-NOTICES.md -text\nthird-party/native-search/licenses/** -text\n",
    [runtimeFile]: originalNode.replaceAll("\n", "\r\n"),
    [sourceFile]: "Brand: Pi Agent IDE\r\n",
    [smokeFile]: "// Main-owned smoke\r\n",
    [upstreamFile]: originalUpstream.replaceAll("\n", "\r\n"),
    [nativeFile]: originalNative,
    "THIRD-PARTY-NOTICES.md": notices,
    "scripts/native-config.mjs": config.replaceAll("\n", "\r\n"),
    "patches/dep.patch": "Dependency patch\r\n",
    "scripts/license-texts/Apache-2.0.txt": apache.replaceAll("\n", "\r\n"),
  };
  const metadata = {
    "package.json": { pnpm: { patchedDependencies: { "dep@1": "patches/dep.patch" } } },
    "third-party/inventory.json": {
      noticesSha256: sha(notices),
      inputs: { "scripts/license-texts/Apache-2.0.txt": sha(apache) },
      copied: [{ files: [{ file: sourceFile, sha256: sha("Brand: ZCode\n") }] }],
    },
    "third-party/runtime/sources.json": {
      node: [{ file: runtimeFile, sha256: sha(originalNode) }],
    },
    "third-party/native-search/sources.json": {
      inputs: { "scripts/native-config.mjs": sha(config) },
      components: [{ notices: [{ file: nativeFile, sha256: sha(originalNative) }] }],
    },
    "third-party/copied-components.json": [
      { roots: ["copied"], file: upstreamFile, sha256: sha(originalUpstream) },
    ],
    "third-party/embedded-components.json": [],
    "third-party/npm-overrides.json": [],
  };
  for (const [file, data] of Object.entries(metadata)) files[file] = `${JSON.stringify(data)}\n`;
  for (const [file, bytes] of Object.entries(files)) await put(root, file, bytes);
  // Model an old checkout, not a racy-new file that Git deliberately rehashes.
  await utimes(join(root, runtimeFile), new Date("2020-01-01"), new Date("2020-01-01"));
  git(["add", "--all"]);
  // The only index change is attributes; unchanged files keep their cached stat data.
  await put(
    root,
    ".gitattributes",
    "* text=auto eol=lf\nTHIRD-PARTY-NOTICES.md -text\nthird-party/**/*.txt -text\n",
  );
  git(["add", "--", ".gitattributes"]);
  return { root, git, files, metadata, originalNode, originalNative, nativeFile };
}

test("checkout-index --force can retain old CRLF with correct cwd and new -text attributes", async (t) => {
  const { root, git, files, originalNode } = await fixture(t);
  assert.equal(git(["show", `:${runtimeFile}`]).toString(), originalNode);
  git(["checkout-index", "--force", "-z", "--stdin"], Buffer.from(`${runtimeFile}\0`));
  assert.equal(await readFile(join(root, runtimeFile), "utf8"), files[runtimeFile]);
  const report = await repairNativeProvenanceBytes(root);
  assert.ok(report.repairs.some((item) => item.file === runtimeFile));
});

test("dry run is byte-read-only, including the index", async (t) => {
  const { root, git, files } = await fixture(t);
  const index = resolve(root, git(["rev-parse", "--git-path", "index"]).toString().trim());
  const before = await readFile(index);
  const report = await repairNativeProvenanceBytes(root);
  assert.equal(report.blocked.length, 0);
  assert.ok(report.repairCount > 0);
  assert.deepEqual(await readFile(index), before);
  for (const [file, bytes] of Object.entries(files))
    if (file !== ".gitattributes") assert.equal(await readFile(join(root, file), "utf8"), bytes);
});

test("repair writes exact current-index bytes, preserves branding, original CRLF and smoke, and is idempotent", async (t) => {
  const { root, git, files, originalNode, nativeFile, originalNative } = await fixture(t);
  const report = await repairNativeProvenanceBytes(root, { write: true });
  for (const item of report.repairs)
    assert.deepEqual(await readFile(join(root, item.file)), git(["show", `:${item.file}`]));
  assert.equal(await readFile(join(root, runtimeFile), "utf8"), originalNode);
  assert.equal(await readFile(join(root, sourceFile), "utf8"), "Brand: Pi Agent IDE\n");
  assert.equal(await readFile(join(root, nativeFile), "utf8"), originalNative);
  assert.equal(await readFile(join(root, smokeFile), "utf8"), files[smokeFile]);
  assert.equal((await repairNativeProvenanceBytes(root)).repairCount, 0);
});

test("an unstaged non-EOL source edit blocks every write", async (t) => {
  const { root, files } = await fixture(t);
  await put(root, sourceFile, "Brand: newer uncommitted product\n");
  await assert.rejects(repairNativeProvenanceBytes(root, { write: true }), /no files written/);
  assert.equal(await readFile(join(root, runtimeFile), "utf8"), files[runtimeFile]);
  assert.equal(
    await readFile(join(root, sourceFile), "utf8"),
    "Brand: newer uncommitted product\n",
  );
});

test("a wrong indexed license hash blocks repair rather than accepting the Git blob blindly", async (t) => {
  const { root, git, files } = await fixture(t);
  await put(root, runtimeFile, "Wrong indexed copyright\n");
  git(["add", "--", runtimeFile]);
  const report = await repairNativeProvenanceBytes(root);
  assert.match(
    report.blocked.find((item) => item.file === runtimeFile).reason,
    /declared material hash/,
  );
  await assert.rejects(repairNativeProvenanceBytes(root, { write: true }), /no files written/);
  assert.equal(await readFile(join(root, "patches/dep.patch"), "utf8"), files["patches/dep.patch"]);
});

test("invalid UTF-8 byte changes cannot masquerade as EOL-only drift", async (t) => {
  const { root, git, files } = await fixture(t);
  await put(root, sourceFile, Buffer.from([0xff, 10]));
  git(["add", "--", sourceFile]);
  await put(root, sourceFile, Buffer.from([0xfe, 13, 10]));
  await assert.rejects(repairNativeProvenanceBytes(root, { write: true }), /no files written/);
  assert.deepEqual(await readFile(join(root, sourceFile)), Buffer.from([0xfe, 13, 10]));
  assert.equal(await readFile(join(root, runtimeFile), "utf8"), files[runtimeFile]);
});

test("unstaged metadata is preserved and cannot change the repair scope", async (t) => {
  const { root, files } = await fixture(t);
  await put(root, "third-party/copied-components.json", "[]\n");
  await assert.rejects(
    repairNativeProvenanceBytes(root, { write: true }),
    /Unstaged metadata changes/,
  );
  assert.equal(await readFile(join(root, runtimeFile), "utf8"), files[runtimeFile]);
});

test("foreign inherited Git root is rejected before reading a different repository", async (t) => {
  const { root, files } = await fixture(t);
  const script = resolve(import.meta.dirname, "../repair-native-provenance-bytes.mjs");
  assert.throws(
    () =>
      execFileSync(process.execPath, [script, "--root", root, "--write"], {
        cwd: root,
        env: { ...process.env, GIT_WORK_TREE: dirname(root) },
        stdio: ["pipe", "pipe", "pipe"],
      }),
    (error) => /Refusing inherited GIT_WORK_TREE/u.test(error.stderr.toString()),
  );
  assert.equal(await readFile(join(root, runtimeFile), "utf8"), files[runtimeFile]);
});
