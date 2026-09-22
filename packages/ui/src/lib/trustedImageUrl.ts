import { PRODUCT_CAPABILITIES, isVendorProductAssetUrl } from "@zcode/shared";

/** UI 远端图片只允许 HTTPS；厂商产品图标回退到本地图标。 */
export function isTrustedImageUrl(url: string | undefined): url is string {
  return (
    typeof url === "string" &&
    url.startsWith("https://") &&
    (PRODUCT_CAPABILITIES.vendorCatalog || !isVendorProductAssetUrl(url))
  );
}
