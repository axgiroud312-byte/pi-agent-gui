import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { CredentialSynchronizationError, ModelRuntime } from "@earendil-works/pi-coding-agent";

export type PiAuthAction = "login" | "resolve" | "logout" | "catalog";
export type PiAuthMethod = "api_key" | "oauth";
export type PiAuthOutcome = "running" | "waiting" | "saved" | "ready" | "unconfigured" |
  "logged-out" | "refreshed" | "cancelled" | "expired" | "needs-login" |
  "committed-sync-failed" | "error";
export interface PiAuthPromptView {
  id: string;
  type: AuthPrompt["type"];
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
}
export type PiAuthNotice =
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; verificationUri: string; userCode: string; expiresAt?: number }
  | { type: "info" | "progress"; message: string };
export interface PiAuthOperationView {
  id: string;
  providerId: string;
  action: PiAuthAction;
  outcome: PiAuthOutcome;
  message: string;
  prompts: PiAuthPromptView[];
  notices: PiAuthNotice[];
}
export interface PiAuthView {
  generation: string;
  agentDir: string;
  providers: Array<{ id: string; name: string; configured: boolean; source?: string;
    storedType?: "api_key" | "oauth"; modelCount: number;
    methods: Array<{ type: PiAuthMethod; label: string; canLogin: boolean }> }>;
  operations: PiAuthOperationView[];
}

interface PendingPrompt {
  resolve(value: string): void;
  reject(error: Error): void;
}
interface Operation {
  view: PiAuthOperationView;
  controller: AbortController;
  pending: Map<string, PendingPrompt>;
  task: Promise<void>;
}
const active = (outcome: PiAuthOutcome) => outcome === "running" || outcome === "waiting";
const display = (value: string) => Array.from(value, char => {
  const code = char.charCodeAt(0);
  return code < 32 || code === 127 ? " " : char;
}).join("").slice(0, 1000);
function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch { return undefined; }
}

/** The fixed Pi ModelRuntime owns credentials; this class only presents its public auth workflow. */
export class PiAuthManager {
  readonly generation = randomUUID();
  private runtimePromise?: Promise<ModelRuntime>;
  private readonly operations = new Map<string, Operation>();
  private readonly sensitive = new Set<string>();
  private claiming = false;
  private disposed = false;

  constructor(readonly agentDir: string,
    private readonly createRuntime: () => Promise<ModelRuntime> = () => ModelRuntime.create({
      authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"),
      allowModelNetwork: false,
    }), private readonly synchronizeSessions?: () => Promise<void>) {}

  private runtime(): Promise<ModelRuntime> {
    this.runtimePromise ??= this.createRuntime();
    return this.runtimePromise;
  }

  private sanitize(value: string): string {
    for (const secret of this.sensitive) value = value.split(secret).join("[redacted]");
    return display(value);
  }

  async snapshot(): Promise<PiAuthView> {
    if (this.disposed) throw new Error("Pi authentication manager is closed");
    const runtime = await this.runtime();
    const stored = new Map((await runtime.listCredentials()).map(item => [item.providerId, item.type]));
    return { generation: this.generation, agentDir: this.agentDir,
      providers: runtime.getProviders().map(provider => {
        const status = runtime.getProviderAuthStatus(provider.id);
        return { id: provider.id, name: this.sanitize(provider.name), configured: status.configured,
          source: status.source, storedType: stored.get(provider.id), modelCount: provider.getModels().length,
          methods: [
            ...(provider.auth.apiKey ? [{ type: "api_key" as const,
              label: this.sanitize(provider.auth.apiKey.name), canLogin: !!provider.auth.apiKey.login }] : []),
            ...(provider.auth.oauth ? [{ type: "oauth" as const,
              label: this.sanitize(provider.auth.oauth.loginLabel ?? provider.auth.oauth.name), canLogin: true }] : []),
          ] };
      }).sort((a, b) => a.name.localeCompare(b.name)),
      operations: [...this.operations.values()].map(operation => structuredClone(operation.view)) };
  }

  async refresh(): Promise<PiAuthView> {
    if (this.disposed || this.claiming || [...this.operations.values()].some(op => active(op.view.outcome))) {
      throw new Error("Finish or cancel the current Pi authentication operation first");
    }
    this.claiming = true;
    try {
      const result = await (await this.runtime()).refresh({ allowNetwork: false });
      if (result.aborted || result.errors.size) throw new Error("Pi provider directory could not be refreshed");
      await this.synchronizeSessions?.();
      return this.snapshot();
    } finally { this.claiming = false; }
  }

  async start(providerId: string, action: PiAuthAction, method?: PiAuthMethod): Promise<string> {
    if (this.disposed || this.claiming || [...this.operations.values()].some(op => active(op.view.outcome))) {
      throw new Error("Pi authentication is already active");
    }
    this.claiming = true;
    try {
      const runtime = await this.runtime();
      const provider = runtime.getProvider(providerId);
      if (!provider) throw new Error("Pi provider is no longer registered");
      if (!["login", "resolve", "logout", "catalog"].includes(action)) throw new Error("Unknown Pi auth action");
      if (action === "login" && (!method || !provider.auth[method === "api_key" ? "apiKey" : "oauth"])) {
        throw new Error("Pi provider does not support this login method");
      }
      for (const [id, operation] of this.operations) {
        if (operation.view.providerId === providerId && !active(operation.view.outcome)) this.operations.delete(id);
      }
      const id = randomUUID();
      const operation: Operation = { view: { id, providerId, action, outcome: "running",
        message: "Pi 正在处理认证…", prompts: [], notices: [] }, controller: new AbortController(),
        pending: new Map(), task: Promise.resolve() };
      this.operations.set(id, operation);
      const timer = setTimeout(() => operation.controller.abort(), 15 * 60_000);
      operation.task = this.perform(runtime, operation, method).finally(() => clearTimeout(timer));
      return id;
    } finally { this.claiming = false; }
  }

  private async perform(runtime: ModelRuntime, operation: Operation, method?: PiAuthMethod): Promise<void> {
    const { view, controller } = operation;
    let committed = false;
    try {
      switch (view.action) {
        case "login":
          await runtime.login(view.providerId, method!, { signal: controller.signal,
            prompt: prompt => this.prompt(operation, prompt),
            notify: event => this.notify(operation, event) });
          committed = true;
          {
            const result = await runtime.refresh({ providers: [view.providerId],
              allowNetwork: false, signal: controller.signal });
            if (result.aborted || result.errors.size) throw new Error("Pi auth catalog synchronization failed");
          }
          await this.synchronizeSessions?.();
          view.outcome = "saved";
          view.message = "凭据已保存；尚未验证模型服务。";
          break;
        case "resolve": {
          const auth = await runtime.getAuth(view.providerId, { signal: controller.signal });
          // AuthResult contains keys, headers and OAuth access tokens. Never serialize it.
          view.outcome = auth ? "ready" : "unconfigured";
          view.message = auth ? "Pi 请求认证可用；尚未执行模型调用。" : "Pi 尚未配置认证。";
          break;
        }
        case "logout":
          await runtime.logout(view.providerId, { signal: controller.signal });
          committed = true;
          {
            const result = await runtime.refresh({ providers: [view.providerId],
              allowNetwork: false, signal: controller.signal });
            if (result.aborted || result.errors.size) throw new Error("Pi auth catalog synchronization failed");
          }
          await this.synchronizeSessions?.();
          view.outcome = "logged-out";
          view.message = runtime.getProviderAuthStatus(view.providerId).configured
            ? "已删除保存的凭据；环境或 Pi 配置仍提供认证。远端授权未撤销。"
            : "已删除保存的凭据。远端授权未撤销。";
          break;
        case "catalog": {
          const result = await runtime.refresh({ providers: [view.providerId],
            allowNetwork: true, force: true, signal: controller.signal });
          if (result.aborted || result.errors.size) throw new Error("Pi provider catalog refresh failed");
          await this.synchronizeSessions?.();
          view.outcome = "refreshed";
          view.message = "Pi 模型目录已刷新。";
          break;
        }
      }
    } catch (error) {
      if (committed || error instanceof CredentialSynchronizationError ||
        error instanceof Error && error.name === "CredentialSynchronizationError") {
        view.outcome = "committed-sync-failed";
        view.message = view.action === "logout" ? "凭据已删除，当前 Pi 会话同步失败；空闲后刷新目录。" :
          "凭据已保存，当前 Pi 会话同步失败；空闲后刷新目录。";
      } else if (controller.signal.aborted) {
        view.outcome = "cancelled";
        view.message = "认证已取消或超时；未自动重试。";
      } else if (error instanceof Error && /(?:expired|timed out)/iu.test(error.message)) {
        view.outcome = "expired";
        view.message = "认证步骤已过期；请重新开始。";
      } else if (typeof error === "object" && error !== null && "code" in error && error.code === "oauth") {
        view.outcome = "needs-login";
        view.message = "OAuth 已过期或刷新失败；凭据仍保留。";
      } else {
        view.outcome = "error";
        view.message = "Pi 认证失败；请检查网络或 provider 设置。详细响应可能含凭据，不进入诊断。";
      }
    } finally {
      controller.abort();
      for (const pending of operation.pending.values()) pending.reject(new Error("Pi auth ended"));
      operation.pending.clear();
      view.prompts = [];
      view.notices = [];
    }
  }

  private prompt(operation: Operation, prompt: AuthPrompt): Promise<string> {
    const signal = prompt.signal ? AbortSignal.any([operation.controller.signal, prompt.signal]) : operation.controller.signal;
    signal.throwIfAborted();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        operation.pending.delete(id);
        operation.view.prompts = operation.view.prompts.filter(item => item.id !== id);
        if (active(operation.view.outcome)) operation.view.outcome = operation.pending.size ? "waiting" : "running";
      };
      const abort = () => { cleanup(); reject(new Error("Pi auth prompt cancelled")); };
      operation.pending.set(id, { resolve: value => { cleanup(); resolve(value); },
        reject: error => { cleanup(); reject(error); } });
      operation.view.prompts.push({ id, type: prompt.type, message: this.sanitize(prompt.message),
        ...(prompt.type === "select" ? { options: prompt.options.map(option => ({
          id: option.id, label: this.sanitize(option.label),
          ...(option.description ? { description: this.sanitize(option.description) } : {}) })) } :
          prompt.placeholder ? { placeholder: this.sanitize(prompt.placeholder) } : {}) });
      operation.view.outcome = "waiting";
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  private notify(operation: Operation, event: AuthEvent): void {
    if (!active(operation.view.outcome) || operation.controller.signal.aborted) return;
    let notice: PiAuthNotice | undefined;
    switch (event.type) {
      case "auth_url": {
        const url = safeUrl(event.url);
        if (url) notice = { type: "auth_url", url,
          ...(event.instructions ? { instructions: this.sanitize(event.instructions) } : {}) };
        break;
      }
      case "device_code": {
        const verificationUri = safeUrl(event.verificationUri);
        if (verificationUri) notice = { type: "device_code", verificationUri,
          userCode: display(event.userCode).slice(0, 128),
          ...(event.expiresInSeconds ? { expiresAt: Date.now() + event.expiresInSeconds * 1000 } : {}) };
        break;
      }
      case "info": notice = { type: "info", message: this.sanitize(event.message) }; break;
      case "progress": notice = { type: "progress", message: "Pi provider 正在处理认证…" }; break;
    }
    if (notice) operation.view.notices = [...operation.view.notices.filter(item => item.type !== notice.type), notice].slice(-8);
  }

  answer(operationId: string, promptId: string, value: string): void {
    const operation = this.operations.get(operationId);
    const prompt = operation?.view.prompts.find(item => item.id === promptId);
    const pending = operation?.pending.get(promptId);
    if (!operation || !prompt || !pending || !active(operation.view.outcome) ||
      typeof value !== "string" || value.length > 65_536 ||
      prompt.type === "select" && !prompt.options?.some(option => option.id === value)) {
      throw new Error("Pi auth prompt is no longer active or answer is invalid");
    }
    if (value && prompt.type !== "select") this.sensitive.add(value);
    pending.resolve(value);
  }

  cancel(operationId: string): void {
    const operation = this.operations.get(operationId);
    if (!operation || !active(operation.view.outcome)) throw new Error("Pi auth operation is no longer active");
    operation.controller.abort();
  }

  dispose(): void {
    this.disposed = true;
    for (const operation of this.operations.values()) operation.controller.abort();
  }
}
