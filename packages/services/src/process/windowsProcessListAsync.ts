import { execFile } from "node:child_process";
import { join } from "node:path";
import type {
  ProcessIdentity,
  ProcessTreeTerminatorOptions,
} from "#src/process/processTreeTypes.js";
import { WINDOWS_TOOLHELP_PROCESS_COMMAND } from "#src/process/windowsToolhelpProcessCommand.js";

const WINDOWS_PROCESS_LOOKUP_TIMEOUT_MS = 25_000;
const DOTNET_UNIX_EPOCH_TICKS = 621_355_968_000_000_000n;
const TICKS_PER_MICROSECOND = 10n;
const WINDOWS_START_TIME_PREFIX = "windows-utc-us:";

type WindowsInventoryCapability = "toolhelp" | "identity-unavailable";

interface WindowsProcessListFlight {
  promise: Promise<readonly ProcessIdentity[]>;
  startedAtMs: number;
}

let windowsProcessListInFlight: WindowsProcessListFlight | undefined;
let windowsInventoryCapability: WindowsInventoryCapability | undefined;

function systemPowerShell(): { executable: string; env: NodeJS.ProcessEnv } {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
  const home = join(systemRoot, "System32", "WindowsPowerShell", "v1.0");
  return { executable: join(home, "powershell.exe"), env: process.env };
}

function isHardInventoryUnavailable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM";
}

function lookupFailure(error: unknown, stderr: string): string {
  const failure = error as NodeJS.ErrnoException & { signal?: string; killed?: boolean } | undefined;
  return `code=${failure?.code ?? "?"} signal=${failure?.signal ?? "?"} ` +
    `killed=${failure?.killed === true} phase=${stderr.trim().slice(-120)}`;
}

function remainingWindowsCleanupMs(options: ProcessTreeTerminatorOptions): number | undefined {
  return options.windowsCleanupDeadlineAtMs === undefined
    ? undefined
    : Math.max(options.windowsCleanupDeadlineAtMs - Date.now(), 0);
}

function boundedWindowsLookupTimeoutMs(
  defaultTimeoutMs: number,
  options: ProcessTreeTerminatorOptions,
): number {
  const remainingMs = remainingWindowsCleanupMs(options);
  return remainingMs === undefined
    ? defaultTimeoutMs
    : Math.max(Math.min(defaultTimeoutMs, remainingMs), 0);
}

async function awaitWindowsProcessListWithinDeadline(
  request: Promise<readonly ProcessIdentity[]>,
  options: ProcessTreeTerminatorOptions,
): Promise<readonly ProcessIdentity[]> {
  const remainingMs = remainingWindowsCleanupMs(options);
  if (remainingMs === undefined) return await request;
  if (remainingMs <= 0) return [];

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<readonly ProcessIdentity[]>((resolve) => {
        deadlineTimer = setTimeout(() => resolve([]), remainingMs);
      }),
    ]);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

function warn(options: ProcessTreeTerminatorOptions, message: string, ...args: unknown[]): void {
  options.log?.warn(options.traceId, message, ...args);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseWindowsProcessList(stdout: string): ProcessIdentity[] {
  const identities: ProcessIdentity[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [pidText, parentPidText, rawStartTime] = line.trim().split(/\s+/);
    const pid = parsePositiveInteger(pidText);
    const parentPid = parseNonNegativeInteger(parentPidText);
    const startTime = normalizeDotNetStartTime(rawStartTime);
    if (pid === undefined || parentPid === undefined || !startTime) continue;
    identities.push({ parentPid, pid, startTime });
  }
  return identities;
}

function normalizeDotNetStartTime(rawStartTime: string | undefined): string | undefined {
  if (!rawStartTime) return undefined;
  try {
    const unixMicroseconds =
      (BigInt(rawStartTime) - DOTNET_UNIX_EPOCH_TICKS) / TICKS_PER_MICROSECOND;
    return `${WINDOWS_START_TIME_PREFIX}${unixMicroseconds}`;
  } catch {
    return undefined;
  }
}

export async function verifyWindowsProcessIdentityAsync(
  identity: ProcessIdentity,
  timeoutMs: number,
  options: ProcessTreeTerminatorOptions = {},
): Promise<boolean> {
  if (process.platform !== "win32" || timeoutMs <= 0) return false;
  if (windowsInventoryCapability === "identity-unavailable") return false;
  // A fresh Toolhelp snapshot must match the original creation time before
  // taskkill uses a PID. A failed inventory still forbids an unverified kill.
  return await new Promise<boolean>((resolve) => {
    const shell = systemPowerShell();
    execFile(
      shell.executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        WINDOWS_TOOLHELP_PROCESS_COMMAND,
      ],
      {
        encoding: "utf8",
        env: shell.env,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error || !stdout) {
          if (isHardInventoryUnavailable(error)) windowsInventoryCapability = "identity-unavailable";
          warn(
            options,
            `Windows root 身份原生快照复核失败 pid=${identity.pid}:`,
            lookupFailure(error, stderr),
          );
          resolve(false);
          return;
        }
        const current = parseWindowsProcessList(stdout).find(
          (processIdentity) => processIdentity.pid === identity.pid,
        );
        windowsInventoryCapability = "toolhelp";
        resolve(current?.startTime === identity.startTime);
      },
    );
  });
}

export async function readWindowsProcessListAsync(
  options: ProcessTreeTerminatorOptions,
): Promise<readonly ProcessIdentity[]> {
  if (windowsInventoryCapability === "identity-unavailable") return [];
  const ownedProcessStartedAtMs = options.ownedProcessStartedAtMs;
  if (
    windowsProcessListInFlight &&
    (ownedProcessStartedAtMs === undefined ||
      ownedProcessStartedAtMs < windowsProcessListInFlight.startedAtMs)
  ) {
    return await awaitWindowsProcessListWithinDeadline(windowsProcessListInFlight.promise, options);
  }

  // Toolhelp returns PID/PPID and GetProcessTimes supplies a creation identity.
  // Keep the lookup asynchronous so Host can honor its owner barrier.
  // 旧共享 Promise 可能早于新 Agent 的 spawn 开始，复用这张进程表必然找不到
  // 新 root 并退化为 unverified。只有严格晚于 root 启动的查询才具备可复用资格。
  const startedAtMs = Date.now();
  const request = new Promise<readonly ProcessIdentity[]>((resolve) => {
    // A failed native inventory yields no identity; the owner remains
    // quarantined rather than falling back to an unchecked PID signal.
    const timeoutMs = boundedWindowsLookupTimeoutMs(WINDOWS_PROCESS_LOOKUP_TIMEOUT_MS, options);
    if (timeoutMs <= 0) {
      resolve([]);
      return;
    }

    const shell = systemPowerShell();
    execFile(
      shell.executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        WINDOWS_TOOLHELP_PROCESS_COMMAND,
      ],
      {
        encoding: "utf8",
        env: shell.env,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error || !stdout) {
          if (isHardInventoryUnavailable(error)) windowsInventoryCapability = "identity-unavailable";
          warn(options, "查询 Windows runtime 原生进程快照失败:", lookupFailure(error, stderr));
          resolve([]);
          return;
        }
        const identities = parseWindowsProcessList(stdout);
        if (identities.length === 0)
          warn(options, "Toolhelp 未返回可解析的 Windows runtime 进程表");
        if (identities.length > 0) windowsInventoryCapability = "toolhelp";
        resolve(identities);
      },
    );
  }).finally(() => {
    if (windowsProcessListInFlight?.promise === request) windowsProcessListInFlight = undefined;
  });
  windowsProcessListInFlight = { promise: request, startedAtMs };
  return await awaitWindowsProcessListWithinDeadline(request, options);
}
