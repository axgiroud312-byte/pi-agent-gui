/**
 * llama.cpp router HTTP/SSE adapter for pinned Pi 0.87.0.
 * Protocol and status semantics follow the MIT implementation in
 * @earendil-works/pi-coding-agent 0.87.0 src/extensions/llama/client.ts.
 * That module is not a public package export, so this Host adapter does not
 * import it. Pi's bundled provider remains the sole inference implementation.
 */
export interface PiLlamaModel {
  id: string;
  status: { value: string; failed?: boolean; exit_code?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PiLlamaProgress { message: string; ratio?: number; detail?: string }

interface ActiveOperation {
  controller: AbortController;
  postSettled: Promise<void>;
  settlePost(): void;
  postOutcome: "notStarted" | "accepted" | "rejected" | "uncertain";
  cancelRequested: boolean;
  cancelPromise?: Promise<void>;
}
interface Options { pollIntervalMs?: number; loadTimeoutMs?: number; downloadTimeoutMs?: number;
  unloadTimeoutMs?: number; fetch?: typeof fetch }
class RouterHttpError extends Error {}

function normalizeUrl(value: string): string {
  const input = value.trim();
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Router URL must use HTTP or HTTPS");
  if (url.username || url.password || /^https?:\/\/[^/?#]*@/iu.test(input)) {
    throw new Error("Router URL must not contain userinfo credentials");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "") || "/";
  return url.toString().replace(/\/$/u, "");
}

function isModel(value: unknown): value is PiLlamaModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Record<string, unknown>;
  const status = model.status && typeof model.status === "object" ? model.status as Record<string, unknown> : {};
  return typeof model.id === "string" && typeof status.value === "string";
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new Error("Cancelled")); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error("Cancelled")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function progressOf(event: Record<string, unknown>): PiLlamaProgress | undefined {
  const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
  const progress = data.progress && typeof data.progress === "object" ? data.progress as Record<string, unknown> : {};
  if (event.event === "download_progress") {
    let done = 0; let total = 0;
    for (const raw of Object.values(progress)) {
      if (!raw || typeof raw !== "object") continue;
      const file = raw as Record<string, unknown>;
      if (typeof file.done === "number" && typeof file.total === "number") {
        done += file.done; total += file.total;
      }
    }
    return total > 0 ? { message: "Downloading model", ratio: Math.min(1, done / total),
      detail: `${done} / ${total} bytes` } : undefined;
  }
  const stage = typeof progress.current === "string" ? progress.current
    : typeof progress.stage === "string" ? progress.stage : undefined;
  if (!stage && typeof progress.value !== "number") return undefined;
  const stages = Array.isArray(progress.stages) ? progress.stages.filter(item => typeof item === "string") : [];
  const part = typeof progress.value === "number" ? Math.max(0, Math.min(1, progress.value)) : 0;
  const index = stage ? stages.indexOf(stage) : -1;
  return { message: stage ? `Loading ${stage.replaceAll("_", " ")}` : "Loading model",
    ratio: index >= 0 ? (index + part) / stages.length : part };
}

/** A live operation is never replayed by this adapter after a transport error. */
export class PiLlamaRouterClient {
  readonly serverUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly loadTimeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly unloadTimeoutMs: number;
  private readonly active = new Map<string, ActiveOperation>();

  constructor(serverUrl: string, private readonly apiKey?: string, options: Options = {}) {
    this.serverUrl = normalizeUrl(serverUrl);
    this.fetchImpl = options.fetch ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.loadTimeoutMs = options.loadTimeoutMs ?? 10 * 60_000;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? 2 * 60 * 60_000;
    this.unloadTimeoutMs = options.unloadTimeoutMs ?? 30_000;
  }

  private headers(body?: unknown): Headers {
    const headers = new Headers();
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);
    return headers;
  }

  private async request(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(15_000);
    const response = await this.fetchImpl(`${this.serverUrl}${path}`, {
      method, headers: this.headers(body), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!response.ok) {
      const error = payload?.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>).message : undefined;
      throw new RouterHttpError(typeof error === "string" ? error : `llama.cpp router returned HTTP ${response.status}`);
    }
    return payload;
  }

  async list(signal?: AbortSignal, reload = false): Promise<PiLlamaModel[]> {
    const payload = await this.request(reload ? "/models?reload=1" : "/models", "GET", undefined, signal);
    const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>).data : undefined;
    if (!Array.isArray(data)) throw new Error("llama.cpp returned an invalid model catalog");
    if (!data.every(isModel)) throw new Error("Server is not running in llama.cpp router mode");
    return data;
  }

  async props(model?: string, signal?: AbortSignal): Promise<{ models_autoload?: boolean; chat_template?: string }> {
    const suffix = model ? `?${new URLSearchParams({ model, autoload: "false" })}` : "";
    const payload = await this.request(`/props${suffix}`, "GET", undefined, signal);
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    return { ...(typeof record.models_autoload === "boolean" ? { models_autoload: record.models_autoload } : {}),
      ...(typeof record.chat_template === "string" ? { chat_template: record.chat_template } : {}) };
  }

  private async watch(model: string, onProgress: (value: PiLlamaProgress) => void,
    onEvent: (event: Record<string, unknown>) => void, signal: AbortSignal): Promise<void> {
    const response = await this.fetchImpl(`${this.serverUrl}/models/sse`, { headers: this.headers(), signal });
    if (!response.ok || !response.body) throw new Error(`llama.cpp SSE returned HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
        for (let boundary = buffer.indexOf("\n\n"); boundary >= 0; boundary = buffer.indexOf("\n\n")) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = frame.split("\n").filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          try {
            const event = JSON.parse(data) as Record<string, unknown>;
            if (event.model === model) {
              onEvent(event);
              const progress = progressOf(event);
              if (progress) onProgress(progress);
            }
          } catch { /* Polling remains authoritative after malformed SSE. */ }
        }
      }
    } finally { await reader.cancel().catch(() => {}); }
  }

  private async waitFor(model: string, wanted: (status: string) => boolean, signal: AbortSignal): Promise<PiLlamaModel | undefined> {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new Error("Cancelled");
      const entry = (await this.list(signal)).find(candidate => candidate.id === model);
      if (entry?.status.failed) throw new Error(entry.status.exit_code === undefined
        ? "llama.cpp model operation failed" : `llama.cpp model exited with code ${entry.status.exit_code}`);
      if (wanted(entry?.status.value ?? "missing")) return entry;
      await delay(this.pollIntervalMs, signal);
    }
  }

  private async run(kind: "load" | "download", model: string,
    onProgress: (value: PiLlamaProgress) => void): Promise<PiLlamaModel | undefined> {
    if (!model || model.includes("\0")) throw new Error("Invalid llama.cpp model ID");
    if (this.active.has(model)) throw new Error("A llama.cpp model operation is already active");
    const controller = new AbortController();
    let settlePost!: () => void;
    const postSettled = new Promise<void>(resolve => { settlePost = resolve; });
    const active: ActiveOperation = { controller, postSettled, settlePost,
      postOutcome: "notStarted", cancelRequested: false };
    this.active.set(model, active);
    const watcher = new AbortController();
    let downloadFinished = false;
    let downloadFailure: string | undefined;
    let sawDownloading = false;
    void this.watch(model, onProgress, event => {
      if (event.event === "download_finished") downloadFinished = true;
      if (event.event === "download_failed") downloadFailure = detail(event.data);
      if (event.event === "download_progress") sawDownloading = true;
    }, watcher.signal).catch(() => {});
    try {
      // Read before POST. On reconnect the caller can inspect this catalog;
      // this function intentionally never retries an uncertain write.
      await this.list(controller.signal);
      if (active.cancelRequested) throw new Error("Cancelled llama.cpp operation");
      try {
        // Do not abort an in-flight POST locally: router mutation could still
        // commit later. Explicit cancel waits for this response, then unloads.
        await this.request(kind === "load" ? "/models/load" : "/models", "POST", { model });
        active.postOutcome = "accepted";
      } catch (error) {
        active.postOutcome = error instanceof RouterHttpError ? "rejected" : "uncertain";
        if (error instanceof RouterHttpError) throw error;
        const actual = await this.list().then(catalog => catalog.find(item => item.id === model)?.status.value)
          .catch(() => "unavailable");
        throw new Error(`llama.cpp ${kind} result is uncertain (router status: ${actual}); refresh before retrying: ${detail(error)}`);
      } finally {
        active.settlePost();
      }
      if (active.cancelRequested) {
        await active.cancelPromise;
        throw new Error("Cancelled llama.cpp operation");
      }
      onProgress({ message: kind === "load" ? "Loading model" : "Downloading model" });
      const deadline = AbortSignal.timeout(kind === "load" ? this.loadTimeoutMs : this.downloadTimeoutMs);
      const waitSignal = AbortSignal.any([controller.signal, deadline]);
      try {
        if (kind === "load") return await this.waitFor(model, status => status === "loaded", waitSignal);
        let polls = 0;
        while (true) {
          if (waitSignal.aborted) throw waitSignal.reason ?? new Error("Cancelled");
          if (downloadFailure) throw new Error(`llama.cpp download failed: ${downloadFailure}`);
          const entry = (await this.list(waitSignal)).find(candidate => candidate.id === model);
          polls++;
          if (entry?.status.failed) throw new Error("llama.cpp download failed");
          if (entry?.status.value === "downloading") {
            sawDownloading = true;
            const progress = progressOf({ event: "download_progress", data: { progress: entry.status.progress } });
            if (progress) onProgress(progress);
          } else if (downloadFinished || entry && (sawDownloading || polls >= 2)) {
            return (await this.list(waitSignal, true)).find(candidate => candidate.id === model);
          }
          await delay(this.pollIntervalMs, waitSignal);
        }
      } catch (error) {
        if (deadline.aborted && !active.cancelRequested) {
          const status = await this.list().then(catalog => catalog.find(item => item.id === model)?.status.value)
            .catch(() => "unavailable");
          throw new Error(`llama.cpp ${kind} timed out (router status: ${status}); refresh or cancel explicitly`);
        }
        throw error;
      }
    } finally {
      active.settlePost();
      if (active.cancelPromise) await active.cancelPromise.catch(() => {});
      watcher.abort();
      if (this.active.get(model) === active) this.active.delete(model);
    }
  }

  load(model: string, onProgress: (value: PiLlamaProgress) => void): Promise<PiLlamaModel | undefined> {
    return this.run("load", model, onProgress);
  }

  download(model: string, onProgress: (value: PiLlamaProgress) => void): Promise<PiLlamaModel | undefined> {
    return this.run("download", model, onProgress);
  }

  async unload(model: string): Promise<void> {
    await this.request("/models/unload", "POST", { model });
    const deadline = AbortSignal.timeout(this.unloadTimeoutMs);
    try { await this.waitFor(model, status => status === "unloaded" || status === "missing", deadline); }
    catch (error) {
      if (deadline.aborted) throw new Error("llama.cpp unload timed out; refresh router state before retrying");
      throw error;
    }
  }

  /** Actual router termination, then catalog verification; aborting a local wait is insufficient. */
  async cancel(model: string): Promise<void> {
    const active = this.active.get(model);
    if (active) {
      if (active.cancelPromise) return active.cancelPromise;
      active.cancelRequested = true;
      active.cancelPromise = (async () => {
        await active.postSettled;
        try {
          if (active.postOutcome === "accepted" || active.postOutcome === "uncertain") await this.unload(model);
          active.controller.abort(new Error("Cancelled llama.cpp operation"));
        } catch (error) {
          // The router may still be loading. Stop only this local wait, retain
          // the remote status as unknown, and let an explicit refresh/retry
          // perform another unload after this operation settles.
          const failure = new Error(`llama.cpp cancellation could not verify remote unload; ` +
            `router state is unknown. Refresh and retry cancellation: ${detail(error)}`);
          active.controller.abort(failure);
          throw failure;
        }
      })();
      return active.cancelPromise;
    }
    const status = (await this.list()).find(entry => entry.id === model)?.status.value;
    if (status !== "loading" && status !== "downloading") {
      throw new Error("No active llama.cpp operation for this model");
    }
    await this.unload(model);
  }
}
