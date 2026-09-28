import type { AppSettings } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface SettingsReadStatus {
  kind: "ready" | "degraded";
  /** Local recovery path; no setting values or credential material are returned. */
  settingsFile?: string;
  message?: string;
  backupPath?: string;
}

export interface ISettingService {
  get(): Promise<AppSettings>;
  /** Startup may read safe defaults; this status makes any degraded read visible. */
  getReadStatus?(): Promise<SettingsReadStatus>;
  update(
    patch: Partial<AppSettings>,
    expectedAccountSettings?: Pick<
      AppSettings,
      "providerFamilyDomain" | "providerFamilyConnectionSelections"
    >,
  ): Promise<void>;
  /** Change the data base directory: copy data from old → new location, then persist the setting. */
  updateDataBaseDir(newDir: string | undefined): Promise<void>;
  ensureDefaultProject(homedir: string): Promise<{ path: string; created: boolean }>;
}

export const ISettingService = createServiceDescriptor<ISettingService>(ServiceChannels.Setting);
