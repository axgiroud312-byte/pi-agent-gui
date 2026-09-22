// Node-only desktop identity boundary. Do not import services/shared SDKs here:
// their module-level path snapshots must run after the environment is selected.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

type ProfileEnv = Record<string, string | undefined>;
const PRODUCT_PROFILE_DIRECTORY = ".pi-agent-ide";

export interface DesktopProductProfile {
  settingsHome: string;
  settingsFile: string;
  dataBaseDir: string;
  explicitDataBaseDir: boolean;
}

export function resolveDesktopSettingsHome(
  env: ProfileEnv = process.env,
  homePath: string = homedir(),
  cwd: string = process.cwd(),
): string {
  const explicit = env.ZCODE_DATA_BASE_DIR?.trim() || env.ZCODE_DESKTOP_HOME_DIR?.trim();
  if (explicit) return resolve(cwd, explicit);
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homePath;
  return resolve(cwd, home, PRODUCT_PROFILE_DIRECTORY);
}

export function resolveDesktopSettingsFile(
  env: ProfileEnv = process.env,
  homePath: string = homedir(),
): string {
  return join(resolveDesktopSettingsHome(env, homePath), ".zcode", "v2", "setting.json");
}

export function resolveDesktopProductProfile(options: {
  env?: ProfileEnv;
  homePath?: string;
  cwd?: string;
  readSettings?: (file: string) => string;
} = {}): DesktopProductProfile {
  const env = options.env ?? process.env;
  const settingsHome = resolveDesktopSettingsHome(env, options.homePath, options.cwd);
  const settingsFile = join(settingsHome, ".zcode", "v2", "setting.json");
  const explicitDataBaseDir = Boolean(env.ZCODE_DATA_BASE_DIR?.trim());
  let dataBaseDir = settingsHome;
  if (!explicitDataBaseDir) {
    try {
      const readSettings = options.readSettings ?? ((file: string) => readFileSync(file, "utf8"));
      const settings: unknown = JSON.parse(readSettings(settingsFile));
      if (settings && typeof settings === "object" && !Array.isArray(settings)) {
        const value = (settings as { dataBaseDir?: unknown }).dataBaseDir;
        if (typeof value === "string" && value.trim()) {
          dataBaseDir = resolve(settingsHome, value.trim());
        }
      }
    } catch {
      // First launch or invalid Pi settings: stay inside the Pi profile, never probe legacy HOME.
    }
  }
  return { settingsHome, settingsFile, dataBaseDir, explicitDataBaseDir };
}

export function buildDesktopProfileRuntimeEnv(
  dataBaseDir: string,
  settingsHome: string,
): Record<string, string> {
  const base = resolve(dataBaseDir);
  const dataRoot = join(base, ".zcode");
  const sessionDatabase = join(dataRoot, "cli", "db", "db.sqlite");
  return {
    HOME: base,
    USERPROFILE: base,
    ZCODE_DESKTOP_HOME_DIR: resolve(settingsHome),
    ZCODE_DATA_BASE_DIR: base,
    ZCODE_HOME: dataRoot,
    ZCODE_STORAGE_DIR: dataRoot,
    ZCODE_LOG_DIR: join(dataRoot, "cli", "log"),
    ZCODE_SESSION_DB_PATH: sessionDatabase,
    ZCODE_SESSION_DB: sessionDatabase,
  };
}

export function applyDesktopProductProfile(
  profile: DesktopProductProfile,
  env: ProfileEnv = process.env,
): void {
  const runtimeEnv = buildDesktopProfileRuntimeEnv(profile.dataBaseDir, profile.settingsHome);
  if (!profile.explicitDataBaseDir) {
    // Keep app.relaunch() distinguishable from an explicit caller override. The stable
    // settings anchor survives; its persisted custom data directory is resolved again.
    delete runtimeEnv.ZCODE_DATA_BASE_DIR;
    delete env.ZCODE_DATA_BASE_DIR;
  }
  Object.assign(env, runtimeEnv);
}
