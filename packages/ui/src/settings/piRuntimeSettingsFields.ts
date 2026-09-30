export interface PiRuntimeSettingsField {
  path: string;
  label: string;
  kind: "text" | "number" | "boolean" | "enum";
  options?: readonly string[];
  globalOnly?: boolean;
}

/** Keys from the pinned Pi 0.87.0 settings contract, not desktop AppSettings. */
export const PI_RUNTIME_SETTINGS_FIELDS: readonly PiRuntimeSettingsField[] = [
  { path: "defaultProvider", label: "默认提供商 ID", kind: "text" },
  { path: "defaultModel", label: "默认模型 ID", kind: "text" },
  { path: "defaultThinkingLevel", label: "默认思考级别", kind: "enum", options: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { path: "httpProxy", label: "Pi HTTP / HTTPS 代理", kind: "text", globalOnly: true },
  { path: "transport", label: "模型传输方式", kind: "enum", options: ["auto", "sse", "websocket", "websocket-cached"] },
  { path: "httpIdleTimeoutMs", label: "HTTP 空闲超时（毫秒）", kind: "number" },
  { path: "websocketConnectTimeoutMs", label: "WebSocket 连接超时（毫秒）", kind: "number" },
  { path: "compaction.enabled", label: "自动压缩", kind: "boolean" },
  { path: "compaction.reserveTokens", label: "压缩预留回复 token", kind: "number" },
  { path: "compaction.keepRecentTokens", label: "压缩保留最近 token", kind: "number" },
  { path: "retry.enabled", label: "自动重试", kind: "boolean" },
  { path: "retry.maxRetries", label: "Agent 最大重试次数", kind: "number" },
  { path: "retry.baseDelayMs", label: "重试起始间隔（毫秒）", kind: "number" },
  { path: "retry.maxAgentDelayMs", label: "Agent 最大重试间隔（毫秒）", kind: "number" },
  { path: "retry.provider.timeoutMs", label: "模型请求超时（毫秒）", kind: "number" },
  { path: "retry.provider.maxRetries", label: "Provider 最大重试次数", kind: "number" },
  { path: "steeringMode", label: "转向消息处理方式", kind: "enum", options: ["one-at-a-time", "all"] },
  { path: "followUpMode", label: "后续消息处理方式", kind: "enum", options: ["one-at-a-time", "all"] },
  { path: "cacheWarming", label: "缓存预热", kind: "enum", options: ["off", "streaming", "idle"], globalOnly: true },
  { path: "images.autoResize", label: "自动缩放发送的图片", kind: "boolean" },
  { path: "images.blockImages", label: "禁止向模型发送图片", kind: "boolean" },
  { path: "shellPath", label: "Pi bash 工具 Shell 路径", kind: "text" },
  { path: "shellCommandPrefix", label: "Pi bash 命令前缀", kind: "text" },
  { path: "sessionDir", label: "Pi 会话历史目录", kind: "text" },
  { path: "enableSkillCommands", label: "注册 Skill 斜杠命令", kind: "boolean" },
  { path: "defaultProjectTrust", label: "未确认项目的信任策略", kind: "enum", options: ["ask", "always", "never"], globalOnly: true },
  { path: "enableInstallTelemetry", label: "Pi 安装遥测与提供商归属头", kind: "boolean" },
  { path: "enableAnalytics", label: "Pi 可选分析数据分享", kind: "boolean" },
];

export function parsePiRuntimeSettings(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text.replace(/^\uFEFF/u, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pi 设置必须是 JSON 对象。");
  return value as Record<string, unknown>;
}

export function readPiRuntimeSetting(document: Record<string, unknown>, path: string): unknown {
  let value: unknown = document;
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Change one known leaf in the very same JSON draft saved by savePiSettings. */
export function updatePiRuntimeSetting(text: string, path: string, value: string | number | boolean | undefined): string {
  const field = PI_RUNTIME_SETTINGS_FIELDS.find(item => item.path === path);
  if (!field) throw new Error("未知 Pi 配置项。");
  if (value !== undefined && (field.kind === "number" ? typeof value !== "number" ||
    !Number.isSafeInteger(value) || value < 0 : field.kind === "boolean" ? typeof value !== "boolean" :
    typeof value !== "string" || field.kind === "enum" && !field.options?.includes(value))) {
    throw new Error(`Pi ${path} 的值不符合此配置项类型。`);
  }
  const document = parsePiRuntimeSettings(text);
  let parent = document;
  const keys = path.split(".");
  for (const key of keys.slice(0, -1)) {
    const current = parent[key];
    if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current))) {
      throw new Error(`Pi ${key} 配置不是对象，请先在 JSON 中修复；不会覆盖原值。`);
    }
    parent[key] = { ...(current as Record<string, unknown> | undefined) };
    parent = parent[key] as Record<string, unknown>;
  }
  const key = keys[keys.length - 1];
  if (!key) throw new Error("未知 Pi 配置项。");
  if (value === undefined) delete parent[key];
  else parent[key] = value;
  return JSON.stringify(document, null, 2) + "\n";
}
