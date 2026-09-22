/** Pi product policy. Stage 0 retains the isolated native Agent for UI comparison only. */
export const PRODUCT_NAME = "Pi Agent IDE";
export const PRODUCT_REPOSITORY_URL = "https://github.com/axgiroud312-byte/pi-agent-gui";
export const PRODUCT_ISSUES_URL = `${PRODUCT_REPOSITORY_URL}/issues`;

// These are product-service capabilities, NOT model-provider capabilities. In particular,
// a user's Z.AI/BigModel API key, custom base URL, generic MCP and local resources remain valid.
// Rebinding sharing/updates requires an implementation and acceptance evidence, not a flag flip.
export const PRODUCT_CAPABILITIES = Object.freeze({
  vendorAccount: false,
  vendorServices: false,
  cloudSharing: false,
  vendorFeedback: false,
  vendorUpdates: false,
  vendorTelemetry: false,
  vendorCatalog: false,
  offPeak: false,
});

export function requireProductCapability(capability: keyof typeof PRODUCT_CAPABILITIES): void {
  if (!PRODUCT_CAPABILITIES[capability]) {
    throw new Error(`${PRODUCT_NAME}: ${capability} is not available in this product.`);
  }
}

/** Only wrap the upstream product API transport; never wrap inference or user-configured URLs. */
export function productServiceFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    requireProductCapability("vendorServices");
    return fetchImpl(input, init);
  };
}

/** Vendor product artwork/catalog URLs, never inference hosts or user provider IDs. */
export function isVendorProductAssetUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).hostname === "cdn-zcode.z.ai";
  } catch {
    return false;
  }
}

/** Brand static UI copy before interpolation, so user content and paths are never rewritten.
 * The native Agent name remains accurate until #33 is confirmed and #34 replaces the engine.
 * Legal notices and provider names are not passed through this helper.
 */
export function productMessage(message: string): string {
  return message.replace(/\bZCode\b(?! Agent| CDN| MCP)/g, PRODUCT_NAME);
}
