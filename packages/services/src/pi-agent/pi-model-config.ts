import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface PiModelProviderConfig {
  id: string;
  baseUrl: string;
  api: string;
  modelIds: string[];
}
export interface PiModelConfigView {
  path: string;
  revision: string;
  providers: PiModelProviderConfig[];
  error?: string;
}
export interface PiModelConfigChange {
  expectedRevision: string;
  providerId: string;
  create?: boolean;
  /** null removes only this models.json entry, never auth.json or extension registrations. */
  config: Omit<PiModelProviderConfig, "id"> | null;
}

type Document = Record<string, unknown> & { providers?: Record<string, Record<string, unknown>> };
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const corrupt = "Pi models.json 无效；请先在外部修复，再重新读取。";

async function read(agentDir: string): Promise<{ view: PiModelConfigView; document: Document }> {
  const path = join(agentDir, "models.json");
  let bytes: Buffer;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Pi models.json 必须是小于 1 MiB 的普通文件。");
    bytes = await readFile(path);
    if (bytes.length > 1024 * 1024) throw new Error("Pi models.json 超过 1 MiB。");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { view: { path, revision: digest("pi-models:missing"), providers: [] }, document: {} };
  }
  const view: PiModelConfigView = { path, revision: digest(bytes), providers: [] };
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ""));
    if (!isObject(value) || (value.providers !== undefined && !isObject(value.providers))) throw new Error(corrupt);
    const document = value as Document;
    for (const [id, config] of Object.entries(document.providers ?? {})) {
      if (!isObject(config) || (config.models !== undefined && !Array.isArray(config.models))) throw new Error(corrupt);
      const models = (config.models ?? []) as unknown[];
      if (models.some(model => !isObject(model) || typeof model.id !== "string")) throw new Error(corrupt);
      view.providers.push({ id, baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : "",
        api: typeof config.api === "string" ? config.api : "",
        modelIds: models.map(model => (model as { id: string }).id) });
    }
    // Only editable connection fields leave the Host; apiKey, headers, OAuth and
    // arbitrary provider/model properties remain in the authoritative document.
    return { view, document };
  } catch { return { view: { ...view, providers: [], error: corrupt }, document: {} }; }
}

export async function readPiModelConfig(agentDir: string): Promise<PiModelConfigView> {
  return (await read(agentDir)).view;
}

function apply(document: Document, request: PiModelConfigChange): Document {
  const id = request.providerId;
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(id)) {
    throw new Error("提供商 ID 只能使用字母、数字、点、下划线和短横线。");
  }
  const providers = { ...document.providers };
  if (request.create && Object.hasOwn(providers, id)) throw new Error("此提供商已有配置，请在列表中选择后编辑。");
  if (request.config === null) {
    if (!Object.hasOwn(providers, id)) throw new Error("此提供商没有可删除的 models.json 配置。");
    delete providers[id];
  } else {
    const { baseUrl, api, modelIds } = request.config;
    if (typeof baseUrl !== "string" || typeof api !== "string" || !Array.isArray(modelIds) ||
      modelIds.length > 1000 || modelIds.some(model => typeof model !== "string" || !model.trim() || model.length > 500) ||
      new Set(modelIds).size !== modelIds.length) throw new Error("请输入有效且不重复的模型 ID。");
    if (baseUrl) {
      try { if (!["http:", "https:"].includes(new URL(baseUrl).protocol)) throw new Error(); }
      catch { throw new Error("模型地址必须是 HTTP 或 HTTPS URL。"); }
    }
    const previous = (Object.hasOwn(providers, id) ? providers[id] : undefined) ?? {};
    const oldModels = Array.isArray(previous.models) ? previous.models as Record<string, unknown>[] : [];
    providers[id] = { ...previous,
      ...(baseUrl ? { baseUrl } : {}), ...(api ? { api } : {}),
      ...(modelIds.length || oldModels.length ? {
        models: modelIds.map(modelId => oldModels.find(model => model.id === modelId) ?? { id: modelId }),
      } : {}) };
    if (!baseUrl) delete providers[id].baseUrl;
    if (!api) delete providers[id].api;
  }
  return { ...document, providers };
}

/** CAS on Pi's actual models.json; staged bytes are validated by the pinned public runtime. */
export async function savePiModelConfig(agentDir: string, request: PiModelConfigChange): Promise<PiModelConfigView> {
  await mkdir(agentDir, { recursive: true });
  const path = join(agentDir, "models.json");
  try { await mkdir(`${path}.lock`); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Pi 模型配置正在被修改，请稍后重试。");
    throw error;
  }
  const staged = join(agentDir, `.models-${randomUUID()}.json`);
  try {
    const current = await read(agentDir);
    if (current.view.error) throw new Error(current.view.error);
    if (current.view.revision !== request.expectedRevision) throw new Error("Pi 模型配置已在外部改变，请重新读取后再保存。");
    const text = JSON.stringify(apply(current.document, request), null, 2) + "\n";
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("Pi models.json 超过 1 MiB。");
    await writeFile(staged, text, { flag: "wx", mode: 0o600 });
    const runtime = await ModelRuntime.create({ modelsPath: staged, authPath: join(agentDir, "auth.json"),
      allowModelNetwork: false, refreshOnCreate: false });
    if (runtime.getError()) throw new Error("Pi 未接受此模型配置，请检查地址、API 协议及模型 ID。");
    for (const delay of [0, 50, 100, 200, 400, 800]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if ((await read(agentDir)).view.revision !== current.view.revision) {
        throw new Error("Pi 模型配置已在外部改变，请重新读取后再保存。");
      }
      try { await rename(staged, path); break; }
      catch (error) {
        if (delay === 800 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
    }
    return readPiModelConfig(agentDir);
  } finally {
    await unlink(staged).catch(() => {});
    await rmdir(`${path}.lock`);
  }
}
