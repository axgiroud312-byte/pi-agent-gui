// Node-only desktop identity boundary. Do not import services/shared SDKs here:
// their module-level path snapshots must run after the environment is selected.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

type ProfileEnv = Record<string, string | undefined>;
const PRODUCT_PROFILE_DIRECTORY = ".pi-agent-ide";

export interface DesktopProductProfile {
  settingsHome: string;
  settingsFile: string;
  dataBaseDir: string;
  explicitDataBaseDir: string | null;
}

const PROFILE_STATE = Symbol.for("pi-agent-ide.desktop-profile");
const RELAUNCH_ARGUMENT = "--pi-desktop-profile-relaunch=";
interface RelaunchState {
  version: 1;
  explicitDataBaseDir: string | null;
  derivedDataBaseDir: string;
}

export function resolveDesktopSettingsHome(
  env: ProfileEnv = process.env,
  homePath: string = homedir(),
  cwd: string = process.cwd(),
): string {
  const explicit = env.ZCODE_DESKTOP_PROFILE_HOME?.trim();
  if (explicit) return resolve(cwd, explicit);
  const home = env.ZCODE_DESKTOP_HOME_DIR?.trim() || env.HOME?.trim() || env.USERPROFILE?.trim() || homePath;
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
  const explicitDataBaseDir = env.ZCODE_DATA_BASE_DIR?.trim()
    ? resolve(options.cwd ?? process.cwd(), env.ZCODE_DATA_BASE_DIR.trim())
    : null;
  let dataBaseDir = explicitDataBaseDir ?? settingsHome;
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
  const profileHome = resolve(settingsHome);
  const dataRoot = join(profileHome, ".zcode");
  const sessionDatabase = join(dataRoot, "cli", "db", "db.sqlite");
  return {
    ZCODE_DESKTOP_PROFILE_HOME: profileHome,
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
  Object.assign(env, buildDesktopProfileRuntimeEnv(profile.dataBaseDir, profile.settingsHome));
}

export function getDesktopProductProfileState(): DesktopProductProfile | undefined {
  return (globalThis as unknown as Record<symbol, DesktopProductProfile | undefined>)[PROFILE_STATE];
}

/** Called only by the unsplit package.main, before the first application dependency evaluates. */
export function initializeDesktopProductProfile(
  env: ProfileEnv = process.env,
  argv: string[] = process.argv,
): DesktopProductProfile {
  const markers = argv.filter((arg) => arg.startsWith(RELAUNCH_ARGUMENT));
  if (markers.length > 1) throw new Error("Multiple desktop profile relaunch markers");
  // Read canonical keys before copying: process.env is case-insensitive on Windows,
  // whereas a spread snapshot of a caller's lower-case keys is an ordinary object.
  const callerEnv: ProfileEnv = {
    HOME: env.HOME,
    USERPROFILE: env.USERPROFILE,
    ZCODE_DESKTOP_HOME_DIR: env.ZCODE_DESKTOP_HOME_DIR,
    ZCODE_DESKTOP_PROFILE_HOME: env.ZCODE_DESKTOP_PROFILE_HOME,
    ZCODE_DATA_BASE_DIR: env.ZCODE_DATA_BASE_DIR,
  };
  if (markers[0]) {
    const state: unknown = JSON.parse(decodeURIComponent(markers[0].slice(RELAUNCH_ARGUMENT.length)));
    const value = state as Partial<RelaunchState> | null;
    if (!value || value.version !== 1 || typeof value.derivedDataBaseDir !== "string" ||
      !isAbsolute(value.derivedDataBaseDir) ||
      (value.explicitDataBaseDir !== null &&
        (typeof value.explicitDataBaseDir !== "string" || !isAbsolute(value.explicitDataBaseDir)))) {
      throw new Error("Invalid desktop profile relaunch state");
    }
    // A newly changed caller override wins. Only restore the original caller state when
    // the inherited value is exactly the computed value from the previous application entry.
    if (env.ZCODE_DATA_BASE_DIR === value.derivedDataBaseDir) {
      callerEnv.ZCODE_DATA_BASE_DIR = value.explicitDataBaseDir ?? undefined;
    }
    argv.splice(0, argv.length, ...argv.filter((arg) => !arg.startsWith(RELAUNCH_ARGUMENT)));
  }
  const profile = resolveDesktopProductProfile({ env: callerEnv });
  applyDesktopProductProfile(profile, env);
  (globalThis as unknown as Record<symbol, DesktopProductProfile>)[PROFILE_STATE] = Object.freeze(profile);
  return profile;
}

interface RelaunchOptions { args?: string[]; execPath?: string }
export function installDesktopProfileRelaunch(
  app: { relaunch(options?: RelaunchOptions): void },
  profile: DesktopProductProfile,
  argv: readonly string[] = process.argv,
): void {
  const relaunch = app.relaunch.bind(app);
  app.relaunch = (options = {}) => {
    const state: RelaunchState = {
      version: 1,
      explicitDataBaseDir: profile.explicitDataBaseDir,
      derivedDataBaseDir: profile.dataBaseDir,
    };
    const args = (options.args ?? argv.slice(1)).filter((arg) => !arg.startsWith(RELAUNCH_ARGUMENT));
    relaunch({ ...options, args: [...args, `${RELAUNCH_ARGUMENT}${encodeURIComponent(JSON.stringify(state))}`] });
  };
}
