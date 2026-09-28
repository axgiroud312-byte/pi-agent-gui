import { PRODUCT_NAME, type Locale } from "@zcode/shared";

export function unsupportedShareRowsNotice(locale: Locale): string {
  return locale === "zh-CN"
    ? `部分内容需要更新 ${PRODUCT_NAME} 查看`
    : `Some content requires a newer version of ${PRODUCT_NAME}`;
}
