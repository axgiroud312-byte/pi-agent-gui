import { getDesktopProductProfileState, initializeDesktopProductProfile } from "./desktopProductProfile.js";

export function applyEarlyDataBaseDirBootstrap(): string {
  const profile = getDesktopProductProfileState() ?? initializeDesktopProductProfile();
  return profile.dataBaseDir;
}
