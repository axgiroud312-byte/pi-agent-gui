#!/usr/bin/env node
// Offline source-checkout verification. No installation, downloads, or writes.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { repositoryRoot } from "./third-party-notices.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function checkNativeProvenance(root = repositoryRoot, { strict = false } = {}) {
  const json = async (file) => JSON.parse(await readFile(resolve(root, file), "utf8"));
  const inventory = await json("third-party/inventory.json");
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.reviewRequired))
    throw new Error("Unsupported or incomplete third-party inventory; regenerate notices.");
  const errors = [];
  let checked = 0;
  const verify = async (file, expected, normalize = false) => {
    try {
      const bytes = await readFile(resolve(root, file));
      const actual = hash(normalize ? bytes.toString("utf8").replaceAll("\r\n", "\n") : bytes);
      if (actual !== expected)
        errors.push(`${file}: ${normalize ? "input" : "byte"} hash mismatch`);
      checked += 1;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      errors.push(`${file}: missing`);
    }
  };
  await verify("THIRD-PARTY-NOTICES.md", inventory.noticesSha256);
  for (const [file, expected] of Object.entries(inventory.inputs))
    await verify(file, expected, true);

  // These are byte snapshots, unlike the CRLF-tolerant source input hashes above.
  for (const directory of ["third-party/upstream", "third-party/native-search/licenses"]) {
    for (const file of await readdir(resolve(root, directory))) {
      if (/^[a-f0-9]{64}\.txt$/u.test(file))
        await verify(`${directory}/${file}`, file.slice(0, -4));
    }
  }
  const runtimes = await json("third-party/runtime/sources.json");
  for (const runtime of runtimes.node) await verify(runtime.file, runtime.sha256);
  const native = await json("third-party/native-search/sources.json");
  for (const [file, expected] of Object.entries(native.inputs)) await verify(file, expected);
  for (const component of native.components)
    for (const notice of component.notices) await verify(notice.file, notice.sha256);
  for (const component of inventory.copied) {
    if (component.file) await verify(component.file, component.sha256);
    for (const source of component.files) await verify(source.file, source.sha256);
  }
  for (const component of inventory.embedded)
    for (const record of [...component.notices, ...(component.buildEvidence ?? [])])
      await verify(record.file, record.sha256);
  for (const record of inventory.patches) await verify(record.file, record.sha256);
  if (strict)
    for (const item of inventory.reviewRequired)
      errors.push(`Unresolved material: ${item.id}: ${item.reason}`);
  if (errors.length)
    throw new Error(
      `Native provenance failed (${errors.length}):\n${errors.join("\n")}\nFor changed inputs, restore source bytes or run node scripts/licenses.mjs notices. Outstanding material requires the missing evidence, not just regeneration.`,
    );
  return {
    checked,
    inputs: Object.keys(inventory.inputs).length,
    packages: inventory.packages.length,
    copiedComponents: inventory.copied.length,
    restoredSkillInputs: Object.keys(inventory.inputs).filter((file) => file.startsWith(".agents/"))
      .length,
    noticesSha256: inventory.noticesSha256,
    reviewRequired: inventory.reviewRequired,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { root: { type: "string" }, strict: { type: "boolean" } },
  });
  try {
    const result = await checkNativeProvenance(values.root ?? repositoryRoot, {
      strict: values.strict,
    });
    console.log(JSON.stringify({ status: "verified", ...result }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
