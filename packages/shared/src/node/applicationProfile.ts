import { homedir } from "node:os";
import { join } from "node:path";

/** Application files only. Never use this for shell HOME, Git, SSH or external .agents roots. */
export function getApplicationProfileHome(
  executionHome: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.ZCODE_DESKTOP_PROFILE_HOME?.trim() || executionHome;
}

/** Keep ordinary ~/ expansion native; only the application's ~/.zcode namespace is scoped. */
export function expandApplicationTilde(path: string, executionHome: string = homedir()): string {
  const home = path === "~/.zcode" || path.startsWith("~/.zcode/")
    ? getApplicationProfileHome(executionHome)
    : executionHome;
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}
