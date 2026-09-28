import { ZCODE_PACKAGED_RESOURCES_PATH_ENV } from "@zcode/shared";

export function resolvePackagedResourcesHostEnv(options: {
  isPackaged: boolean;
  resourcesPath?: string;
}): Record<string, string> {
  const resourcesPath = options.resourcesPath?.trim();
  return options.isPackaged && resourcesPath
    ? { [ZCODE_PACKAGED_RESOURCES_PATH_ENV]: resourcesPath }
    : {};
}
