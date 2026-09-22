import {
  isVendorProductAssetUrl,
  requireProductCapability,
  ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
} from "@zcode/shared";

const REMOTE_PLUGIN_SOURCE_KINDS = new Set(["github", "git", "url", "git-subdir"]);

/** Shared by source resolution and dry-run validation before a remote source can be deferred. */
export function assertPluginSourceResolutionAllowed(marketplace: string, source: unknown): void {
  if (!source || typeof source !== "object" || Array.isArray(source)) return;
  const value = source as Record<string, unknown>;
  if (typeof value.source !== "string" || !REMOTE_PLUGIN_SOURCE_KINDS.has(value.source)) return;
  assertPluginRemoteSourceAllowed({
    marketplace,
    url: typeof value.url === "string" ? value.url : undefined,
  });
}

/** Apply only at remote plugin/catalog boundaries; bundled and local paths stay readable. */
export function assertPluginRemoteSourceAllowed(input: {
  marketplace?: string;
  url?: string;
}): void {
  if (
    input.marketplace === ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID ||
    isVendorProductAssetUrl(input.url)
  ) {
    requireProductCapability("vendorCatalog");
  }
}
