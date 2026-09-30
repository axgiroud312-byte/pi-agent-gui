import type { SettingsSectionId } from "../lib/settingsNavigation.js";

/** Pi desktop must never expose a writable legacy Agent configuration surface. */
export function piSettingsRoute(section: SettingsSectionId): "resources" | "unsupported" | null {
  if (["plugin", "skill", "commands", "memory"].includes(section)) return "resources";
  if (["mcp", "subagents", "hooks", "automations", "migration"].includes(section)) return "unsupported";
  return null;
}
