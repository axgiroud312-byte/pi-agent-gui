import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ZCODE_PACKAGED_RESOURCES_PATH_ENV } from "@zcode/shared";
import { resolvePackagedResourcesHostEnv } from "../src/main/desktopPackagedResourcesEnv.ts";

test("packaged main passes its trusted resources directory to utility hosts", () => {
  const resourcesPath = join("D:", "isolated-install", "resources");
  assert.deepEqual(
    resolvePackagedResourcesHostEnv({ isPackaged: true, resourcesPath }),
    { [ZCODE_PACKAGED_RESOURCES_PATH_ENV]: resourcesPath },
  );
  assert.deepEqual(
    resolvePackagedResourcesHostEnv({ isPackaged: false, resourcesPath }),
    {},
  );
});
