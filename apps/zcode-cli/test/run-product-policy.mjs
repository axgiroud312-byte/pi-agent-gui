// Compile only the source contracts into a disposable Node test entry, not an Agent/app build.
// NODE_PATH can borrow installed external dependencies from another worktree.
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const dependencyPaths = (process.env.NODE_PATH ?? "").split(delimiter).filter(Boolean);
const sourceFile = (base) =>
  [base, `${base}.ts`, join(base, "index.ts")].find(
    (candidate) => candidate.endsWith(".ts") && existsSync(candidate),
  );

export function external(specifier, importer) {
  const parents = [
    importer,
    ...dependencyPaths.map((path) => join(dirname(path), relative(root, importer))),
  ];
  for (const parent of parents) {
    try {
      return createRequire(parent).resolve(specifier);
    } catch {
      // Try the next installed dependency location.
    }
  }
  return require.resolve(specifier);
}
export function workspace(specifier) {
  const [name, ...rest] = specifier.slice("@zcode/".length).split("/");
  for (const base of [join(root, "packages", name), join(root, "apps/zcode-cli/packages", name)]) {
    const direct = sourceFile(join(base, "src", rest.join("/").replace(/\.js$/, "") || "index"));
    if (direct) return direct;
    if (!existsSync(join(base, "package.json"))) continue;
    const entry = JSON.parse(readFileSync(join(base, "package.json"), "utf8")).exports?.[
      rest.length ? `./${rest.join("/")}` : "."
    ];
    const target = typeof entry === "string" ? entry : entry?.import;
    const source = target?.startsWith("./dist/")
      ? sourceFile(join(base, target.replace("./dist/", "./src/").replace(/\.js$/, "")))
      : undefined;
    if (source) return source;
    if (target && existsSync(join(base, target))) return join(base, target);
  }
  throw new Error(`No native source for ${specifier}`);
}

export async function runSourceContracts(entry = process.argv[2]) {
  const directory = await mkdtemp(join(tmpdir(), "pi-product-policy-tests-"));
  try {
    const outfile = join(directory, "contracts.mjs");
    await build({
      entryPoints: [entry
        ? resolve(entry)
        : fileURLToPath(new URL("product-marketplace.test.mjs", import.meta.url))],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      banner: {
        js: "import { createRequire as __testRequire } from 'node:module'; const require = __testRequire(import.meta.url);",
      },
      plugins: [
        {
          name: "native-source-and-installed-dependencies",
          setup(builder) {
            builder.onResolve({ filter: /^@zcode\// }, ({ path }) => ({ path: workspace(path) }));
            builder.onResolve({ filter: /^[^./]/ }, ({ path, importer }) => {
              if (isAbsolute(path)) return undefined;
              if (isBuiltin(path)) return { path, external: true };
              if (path.startsWith("@zcode/")) return undefined;
              if (path.startsWith("#")) return undefined;
              return { path: pathToFileURL(external(path, importer)).href, external: true };
            });
            builder.onResolve({ filter: /^\.\/libs\.generated\.js$/ }, ({ importer }) => {
              const base = join(dirname(importer), "libs.generated");
              const path = sourceFile(base) ?? dependencyPaths
                .map((dependency) => sourceFile(join(dirname(dependency), relative(root, base))))
                .find(Boolean);
              // Generated TypeScript standard-library text may be borrowed; all app logic stays local.
              if (!path) throw new Error("Run dynamic-workflow/scripts/generate-libs.mjs first");
              return { path };
            });
          },
        },
      ],
    });
    const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runSourceContracts();
}
