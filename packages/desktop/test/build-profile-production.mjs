// Build the actual production bootstrap + multi-entry main tsup targets, sequentially.
// Borrow external dependencies through NODE_PATH when this exclusive worktree is uninstalled.
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { readFile, readdir, rm } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { external, workspace } from "../../../apps/zcode-cli/test/run-product-policy.mjs";

const desktop = fileURLToPath(new URL("../", import.meta.url));
assert.equal(resolve(process.cwd()), resolve(desktop), "Run with packages/desktop as cwd");
const require = createRequire(import.meta.url);
const { bundleRequire } = require("bundle-require");
const { build } = require("tsup");
process.env.NODE_ENV = "production";
process.env.ZCODE_ENV = "production";

const resolver = registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || specifier.startsWith(".") || specifier.startsWith("file:")) throw error;
      return next(pathToFileURL(external(specifier, fileURLToPath(context.parentURL))).href, context);
    }
  },
});
const sourcePlugin = {
  name: "owned-workspace-source",
  setup(builder) {
    builder.onResolve({ filter: /^@zcode\// }, ({ path }) => ({ path: workspace(path) }));
  },
};
try {
  const { mod } = await bundleRequire({
    filepath: resolve(desktop, "tsup.config.ts"),
    cwd: desktop,
    notExternal: [/^@zcode\//],
    esbuildOptions: { plugins: [sourcePlugin] },
  });
  const options = typeof mod.default === "function" ? await mod.default({}) : mod.default;
  const targets = options.filter((target) => ["bootstrap", "main"].includes(target.name));
  assert.equal(targets.length, 2);
  const main = targets.find((target) => target.name === "main");
  const bootstrap = targets.find((target) => target.name === "bootstrap");
  assert.ok(Object.keys(main.entry).length > 1, "Must exercise actual multi-entry production config");
  assert.equal(main.splitting, true);
  assert.equal(bootstrap.splitting, false);
  assert.equal(main.minify, true);
  assert.equal(main.sourcemap, false);
  assert.equal(bootstrap.minify, true);
  // Hashed chunks from an earlier build must not count as evidence for this source revision.
  await rm(resolve(desktop, "out/main"), { recursive: true, force: true });
  for (const target of targets) {
    await build({
      ...target,
      config: false,
      esbuildPlugins: [...(target.esbuildPlugins ?? []), sourcePlugin],
      esbuildOptions(options, context) {
        target.esbuildOptions?.(options, context);
        options.nodePaths = (process.env.NODE_PATH ?? "").split(delimiter).filter(Boolean);
      },
    });
  }
  const pkg = JSON.parse(await readFile(resolve(desktop, "package.json"), "utf8"));
  assert.equal(pkg.main, "out/bootstrap.mjs");
  const entry = await readFile(resolve(desktop, pkg.main), "utf8");
  assert.doesNotMatch(entry, /(?:from|import\s*)["'](?:\.\.?\/|@zcode\/)/, "Bootstrap must not statically depend on SDK/chunks");
  assert.match(entry, /ZCODE_DATA_BASE_DIR/);
  assert.match(entry, /import\([^"']/);
  const chunks = (await readdir(resolve(desktop, "out/main"))).filter((name) => /^chunk-.*\.js$/.test(name));
  assert.ok(chunks.length, "Production main must actually emit shared chunks");
  console.log(JSON.stringify({ entry: pkg.main, mainEntries: Object.keys(main.entry), chunks: chunks.length, production: true }));
} finally {
  resolver.deregister();
}
