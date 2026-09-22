import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkNativeProvenance } from "../check-native-provenance.mjs";
import { assertMatchingNoticeWorkspace, assertProductionGraphs } from "../third-party-npm.mjs";
import { readVerifiedNotices } from "../third-party-notices.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const put = async (root, file, text) => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
};
const putJson = (root, file, value) => put(root, file, `${JSON.stringify(value)}\n`);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "native-provenance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = ".agents/skills/example/SKILL.md";
  const upstreamText = "Original copyright\r\nLicense terms\n";
  const upstream = `third-party/upstream/${hash(upstreamText)}.txt`;
  const nativeText = "Native copyright\r\nNative terms\r\n";
  const native = `third-party/native-search/licenses/${hash(nativeText)}.txt`;
  const files = {
    "package.json": '{"name":"fixture"}\n',
    "THIRD-PARTY-NOTICES.md": `Notices\n${upstreamText}${nativeText}`,
    [skill]: "# Original copied source\n",
    [upstream]: upstreamText,
    [native]: nativeText,
    "third-party/runtime/node-LICENSE.txt": "Node copyright\n",
    "scripts/native-config.mjs": "export const version = '1';\n",
    "patches/package.patch": "Retained patch\n",
  };
  for (const [file, text] of Object.entries(files)) await put(root, file, text);
  const runtime = {
    file: "third-party/runtime/node-LICENSE.txt",
    sha256: hash(files["third-party/runtime/node-LICENSE.txt"]),
  };
  await putJson(root, "third-party/runtime/sources.json", { node: [runtime] });
  await putJson(root, "third-party/native-search/sources.json", {
    inputs: { "scripts/native-config.mjs": hash(files["scripts/native-config.mjs"]) },
    components: [{ notices: [{ file: native, sha256: hash(nativeText) }] }],
  });
  await putJson(root, "third-party/inventory.json", {
    schemaVersion: 1,
    noticesSha256: hash(files["THIRD-PARTY-NOTICES.md"]),
    inputs: { "package.json": hash(files["package.json"]), [skill]: hash(files[skill]) },
    packages: [],
    copied: [
      {
        file: upstream,
        sha256: hash(upstreamText),
        files: [{ file: skill, sha256: hash(files[skill]) }],
      },
    ],
    embedded: [{ notices: [{ file: upstream, sha256: hash(upstreamText) }] }],
    patches: [{ file: "patches/package.patch", sha256: hash(files["patches/package.patch"]) }],
    reviewRequired: [{ id: "publisher-material", reason: "Original notice remains incomplete." }],
  });
  return { root, skill, upstream, native, files };
}

test("offline verification retains mixed notice bytes and reports unresolved material", async (t) => {
  const { root, files } = await fixture(t);
  const result = await checkNativeProvenance(root);
  assert.equal(result.restoredSkillInputs, 1);
  assert.equal(result.reviewRequired[0].id, "publisher-material");
  assert.equal((await readVerifiedNotices(root)).toString(), files["THIRD-PARTY-NOTICES.md"]);
  await assert.rejects(
    checkNativeProvenance(root, { strict: true }),
    /Unresolved material: publisher-material/,
  );
});

test("missing vendored skill is a failure, not a skipped input", async (t) => {
  const { root, skill } = await fixture(t);
  await rm(join(root, skill));
  await assert.rejects(checkNativeProvenance(root), /SKILL\.md: missing/);
});

test("branding metadata needs regeneration but manifest CRLF alone does not", async (t) => {
  const { root, files } = await fixture(t);
  await put(root, "package.json", files["package.json"].replaceAll("\n", "\r\n"));
  await checkNativeProvenance(root);
  await put(root, "package.json", '{"name":"new-brand"}\n');
  await assert.rejects(checkNativeProvenance(root), /package\.json: input hash mismatch/);
});

for (const target of ["THIRD-PARTY-NOTICES.md", "upstream", "native", "skill"]) {
  test(`checkout line-ending corruption is rejected for ${target}`, async (t) => {
    const data = await fixture(t);
    const file = data[target] ?? target;
    const bytes = data.files[file];
    const changed = bytes.includes("\r\n")
      ? bytes.replaceAll("\r\n", "\n")
      : bytes.replaceAll("\n", "\r\n");
    await put(data.root, file, changed);
    await assert.rejects(checkNativeProvenance(data.root), /byte hash mismatch/);
  });
}

for (const file of [
  "third-party/runtime/node-LICENSE.txt",
  "scripts/native-config.mjs",
  "patches/package.patch",
]) {
  test(`modified provenance material is rejected: ${file}`, async (t) => {
    const { root } = await fixture(t);
    await put(root, file, "changed\n");
    await assert.rejects(checkNativeProvenance(root), /byte hash mismatch/);
  });
}

test("read-only dependency reuse requires identical lockfile and every workspace manifest", async (t) => {
  const { root } = await fixture(t);
  const source = join(root, "source");
  const installed = join(root, "installed");
  const manifests = ["packages/example/package.json"];
  const inputs = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ...manifests];
  for (const file of inputs) {
    await put(source, file, "same\n");
    await put(installed, file, "same\r\n");
  }
  await assertMatchingNoticeWorkspace(source, installed, manifests);
  for (const file of inputs) {
    await put(installed, file, "different\n");
    await assert.rejects(
      assertMatchingNoticeWorkspace(source, installed, manifests),
      /workspace differs/,
    );
    await put(installed, file, "same\r\n");
  }
  assert.equal(await readFile(join(source, "pnpm-lock.yaml"), "utf8"), "same\n");
});

test("installed graph cannot supply notices for a different locked version", () => {
  const graph = (version) => [{ name: "workspace", dependencies: { dep: { version } } }];
  assert.doesNotThrow(() => assertProductionGraphs(graph("1.0.0"), graph("1.0.0")));
  assert.throws(
    () => assertProductionGraphs(graph("1.0.0"), graph("2.0.0")),
    /Missing: dep@1\.0\.0[\s\S]*Stale: dep@2\.0\.0/,
  );
});
