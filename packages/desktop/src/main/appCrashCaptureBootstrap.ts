import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";
import { ZCODE_ARMS_RUM_ENDPOINT, ZCODE_TELEMETRY_ENABLED } from "@zcode/shared";

// 须在 appARMSBootstrap 之前完成：先由 desktopEarlyDataBaseDirBootstrap 注入 dataBaseDir，再配置 crashDumps。
// Only a genuinely enabled remote reporter owns capture. Disabling vendor telemetry
// must retain the upstream local-only reporter (uploadToServer=false).
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(
  logger,
  Boolean(ZCODE_TELEMETRY_ENABLED && ZCODE_ARMS_RUM_ENDPOINT),
);
