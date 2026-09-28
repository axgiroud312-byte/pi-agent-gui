export type AppShutdownKind = "normal" | "update-install";

interface AppShutdownPolicy {
  forceKillDelayMs: number;
  waitTimeoutMs: number;
}

interface AppShutdownPolicySelection {
  kind: AppShutdownKind;
  policy: AppShutdownPolicy;
  upgraded: boolean;
}

// Host concurrently closes remote services and Pi; Pi RPC cancellation can take
// 21s, then its identity-checked process-tree cleanup up to 35s. The 65s Host
// alarm leaves startup/drain margin; Main must not preempt that owner.
const STRICT_SHUTDOWN_POLICY: AppShutdownPolicy = {
  forceKillDelayMs: 75_000,
  waitTimeoutMs: 80_000,
};

const WINDOWS_NORMAL_SHUTDOWN_POLICY: AppShutdownPolicy = STRICT_SHUTDOWN_POLICY;

export function resolveAppShutdownPolicy(
  kind: AppShutdownKind,
  platform: NodeJS.Platform,
): AppShutdownPolicy {
  if (platform === "win32" && kind === "normal") {
    return WINDOWS_NORMAL_SHUTDOWN_POLICY;
  }
  return STRICT_SHUTDOWN_POLICY;
}

export function selectAppShutdownPolicy(
  activeKind: AppShutdownKind | null,
  requestedKind: AppShutdownKind,
  platform: NodeJS.Platform,
): AppShutdownPolicySelection {
  // 更新安装的优先级只增不减：已创建的普通退出短 timer 不做破坏性重建，更新仍在
  // 现有屏障后 fail-open 进入资源扫描和安装器，保证“可能残留”不会升级成“无法更新”。
  const kind =
    activeKind === "update-install" || requestedKind === "update-install"
      ? "update-install"
      : "normal";
  return {
    kind,
    policy: resolveAppShutdownPolicy(kind, platform),
    upgraded: activeKind === "normal" && kind === "update-install",
  };
}
