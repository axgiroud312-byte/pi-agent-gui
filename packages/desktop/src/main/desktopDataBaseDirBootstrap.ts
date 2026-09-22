import { applyDesktopProductProfile, resolveDesktopProductProfile } from "./desktopProductProfile.js";

export function applyEarlyDataBaseDirBootstrap(): string {
  const profile = resolveDesktopProductProfile();
  applyDesktopProductProfile(profile);
  return profile.dataBaseDir;
}
