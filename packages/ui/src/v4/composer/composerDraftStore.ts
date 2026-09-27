// composer parity：v4 composer 的 per-session 草稿持久化（新做，轻量 localStorage）。
//
// 旧草稿面（zcodeSessionStore composerDraftByScopeId + chatComposerDraftStorage 写路径）
// 已随 store 收尾删除；本模块是 v4 侧替代——键空间独立（v4 前缀），不与旧键互写，
// 旧键清理仍归 chatComposerDraftStorage 的 janitor。
// 语义：scope = sessionId（draft 态 = "__draft__"）；保存 text + editorStateJson，外部预填在
// Lexical 尚未挂载时额外保存 mention（保证重挂载不降级为纯文本）。
// mode/modelSelection 与正文同 scope 保存；发送只清内容，显式清理才删除整个 scope。
// 图片字节由 composerImageDraftStorage 独立保存在 profile 的 IndexedDB，本文字草稿
// 只保存可同步序列化的输入与配置；发送后按同一 scope 清理两处草稿。
import { logger } from "@/logger.js";
import { modelSelectionSchema, type ModelSelection } from "@zcode/shared";
import { submissionModeSchema, type SubmissionMode } from "@zcode/shared/zcode-protocol-v4";
import type { ComposerMentionPrefill } from "@/store/zcodeSessionStoreTypes.js";

export interface V4ComposerDraft {
  text: string;
  editorStateJson?: string;
  mention?: ComposerMentionPrefill;
  /** 有合法 mode 表示已经初始化；没有模型仍是明确空态，不能按旧文本草稿补默认。 */
  mode?: SubmissionMode;
  planEnabled?: boolean;
  /** 已处理的工具变更，防止重连快照再次覆盖用户选择。 */
  lastPlanTransitionId?: string;
  lastPermissionGrantId?: string;
  modelSelection?: ModelSelection;
  /** 首次分享导入等待公共新任务初始化；不能由空 Session snapshot 抢先填充。 */
  initializeFromNewTask?: true;
  updatedAt: number;
}

interface V4DraftFile {
  version: 1;
  scopes: Record<string, V4ComposerDraft>;
}

const STORAGE_KEY_PREFIX = "zcode-v4-composer-drafts:v1:";
const SCOPE_FALLBACK_PREFIX = "zcode-v4-composer-scope-drafts:v1:";
export const V4_DRAFT_SCOPE_ROOT = "__draft__";
const warnedStorageKeys = new Set<string>();

function warnStorageFailure(key: string, error: unknown) {
  if (warnedStorageKeys.has(key)) return;
  warnedStorageKeys.add(key);
  logger.warn("[v4-composer-draft] 草稿持久化访问失败", {
    error: error instanceof Error ? error.message : String(error),
    key,
  });
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getV4ComposerDraftStorageKey(workspacePath: string, workspaceIdentity?: string): string {
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceKey)}`;
}

function getScopeFallbackKey(key: string, scopeId: string): string {
  return `${SCOPE_FALLBACK_PREFIX}${encodeURIComponent(`${key}\0${scopeId}`)}`;
}

function readScopeFallback(key: string, scopeId: string): { draft: V4ComposerDraft | null; updatedAt: number } | null {
  try {
    const raw = getStorage()?.getItem(getScopeFallbackKey(key, scopeId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || typeof value.updatedAt !== "number" ||
      !Number.isFinite(value.updatedAt)) return null;
    if (value.draft === null) return { draft: null, updatedAt: value.updatedAt };
    const draft = readDraft(value.draft);
    return draft ? { draft, updatedAt: value.updatedAt } : null;
  } catch (error) {
    warnStorageFailure(getScopeFallbackKey(key, scopeId), error);
    return null;
  }
}

function writeScopeFallback(key: string, scopeId: string, draft: V4ComposerDraft | null,
  updatedAt: number): boolean {
  const fallbackKey = getScopeFallbackKey(key, scopeId);
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.setItem(fallbackKey, JSON.stringify({ version: 1, draft, updatedAt }));
    warnedStorageKeys.delete(fallbackKey);
    return true;
  } catch (error) {
    warnStorageFailure(fallbackKey, error);
    return false;
  }
}

function readDraftFile(key: string): V4DraftFile {
  const storage = getStorage();
  try {
    const raw = storage?.getItem(key);
    if (!raw) return { version: 1, scopes: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.scopes)) {
      return { version: 1, scopes: {} };
    }
    const scopes = Object.fromEntries(
      Object.entries(parsed.scopes).flatMap(([scopeId, value]) => {
        const draft = readDraft(value);
        return draft ? [[scopeId, draft]] : [];
      }),
    );
    return { version: 1, scopes };
  } catch (error) {
    warnStorageFailure(key, error);
    return { version: 1, scopes: {} };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDraft(value: unknown): V4ComposerDraft | null {
  if (!isRecord(value) || typeof value.text !== "string") return null;
  const mode = submissionModeSchema.safeParse(value.mode);
  const selection = modelSelectionSchema.safeParse(value.modelSelection);
  // 坏 options 不应连带丢掉可确定的模型身份；不读取旧 provider/model/thought 别名。
  const identity = isRecord(value.modelSelection)
    ? modelSelectionSchema.safeParse({
        providerId: value.modelSelection.providerId,
        modelId: value.modelSelection.modelId,
      })
    : null;
  const modelSelection = selection.success
    ? selection.data
    : identity?.success
      ? identity.data
      : undefined;
  const mention = value.mention;
  const hasMention =
    isRecord(mention) &&
    ["id", "category", "label", "value", "markdown"].every(
      (key) => typeof mention[key] === "string",
    ) &&
    ["files", "skills", "commands", "subagents", "whiteboards", "sessions", "plugins"].includes(
      String(mention.category),
    );
  return {
    text: value.text,
    ...(typeof value.editorStateJson === "string"
      ? { editorStateJson: value.editorStateJson }
      : {}),
    ...(hasMention ? { mention: mention as unknown as ComposerMentionPrefill } : {}),
    ...(mode.success ? { mode: mode.data === "plan" ? ("build" as const) : mode.data } : {}),
    ...(typeof value.planEnabled === "boolean"
      ? { planEnabled: value.planEnabled }
      : mode.success
        ? { planEnabled: mode.data === "plan" }
        : {}),
    ...(typeof value.lastPermissionGrantId === "string"
      ? { lastPermissionGrantId: value.lastPermissionGrantId }
      : {}),
    ...(typeof value.lastPlanTransitionId === "string"
      ? { lastPlanTransitionId: value.lastPlanTransitionId }
      : {}),
    ...(modelSelection ? { modelSelection } : {}),
    ...(value.initializeFromNewTask === true && !mode.success
      ? { initializeFromNewTask: true as const }
      : {}),
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  };
}

function writeDraftFile(key: string, file: V4DraftFile) {
  const storage = getStorage();
  if (!storage) {
    return false;
  }
  try {
    if (Object.keys(file.scopes).length === 0) {
      storage.removeItem(key);
      return true;
    }
    storage.setItem(key, JSON.stringify(file));
    warnedStorageKeys.delete(key);
    return true;
  } catch (error) {
    // 配额/隐私模式失败只降级为不持久化，不影响输入。
    warnStorageFailure(key, error);
    return false;
  }
}

export function readV4ComposerDraft(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  scopeId: string,
): V4ComposerDraft | null {
  const key = getV4ComposerDraftStorageKey(workspacePath, workspaceIdentity);
  const primary = readDraftFile(key).scopes[scopeId] ?? null;
  const fallback = readScopeFallback(key, scopeId);
  const draft = fallback && fallback.updatedAt >= (primary?.updatedAt ?? 0)
    ? fallback.draft : primary;
  if (!draft || typeof draft.text !== "string") {
    return null;
  }
  return draft;
}

export function persistV4ComposerDraft(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  scopeId: string,
  draft: Omit<V4ComposerDraft, "updatedAt">,
) {
  const key = getV4ComposerDraftStorageKey(workspacePath, workspaceIdentity);
  const file = readDraftFile(key);
  const fallback = readScopeFallback(key, scopeId);
  const updatedAt = Math.max(Date.now(), (file.scopes[scopeId]?.updatedAt ?? 0) + 1,
    (fallback?.updatedAt ?? 0) + 1);
  if (
    !draft.text.trim() &&
    !draft.editorStateJson &&
    !draft.mention &&
    !draft.mode &&
    !draft.modelSelection &&
    !draft.initializeFromNewTask
  ) {
    // Clearing needs a tombstone before dropping the workspace entry; a stale
    // per-scope fallback must never resurrect already submitted text.
    return clearV4ComposerDraft(workspacePath, workspaceIdentity, scopeId);
  }
  file.scopes[scopeId] = { ...draft, updatedAt };
  if (!writeDraftFile(key, file)) {
    return writeScopeFallback(key, scopeId, file.scopes[scopeId] ?? null, updatedAt);
  }
  // The committed workspace file is newer than any fallback, even when the
  // clock tick is shared. A failed cleanup cannot resurrect stale text.
  try { getStorage()?.removeItem(getScopeFallbackKey(key, scopeId)); }
  catch { /* The primary version has a strictly newer updatedAt. */ }
  return true;
}

/** Pi gives forked user text back to the caller; seed the child scope before switching panes. */
export function seedPiForkComposerDraft(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  childSessionId: string,
  restoredText: string,
): "stored" | "conflict" | "failed" {
  if (!childSessionId.trim() || !restoredText.trim()) return "failed";
  const existing = readV4ComposerDraft(workspacePath, workspaceIdentity, childSessionId);
  if (existing?.text.trim() && existing.text !== restoredText) return "conflict";
  if (existing?.text === restoredText) return "stored";
  return persistV4ComposerDraft(workspacePath, workspaceIdentity, childSessionId, {
    ...existing,
    text: restoredText,
    editorStateJson: undefined,
    mention: undefined,
  }) ? "stored" : "failed";
}

export function clearV4ComposerDraft(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  scopeId: string,
) {
  const key = getV4ComposerDraftStorageKey(workspacePath, workspaceIdentity);
  const file = readDraftFile(key);
  const fallback = readScopeFallback(key, scopeId);
  if (!(scopeId in file.scopes) && !fallback?.draft) {
    return true;
  }
  const updatedAt = Math.max(Date.now(), (file.scopes[scopeId]?.updatedAt ?? 0) + 1,
    (fallback?.updatedAt ?? 0) + 1);
  if (!writeScopeFallback(key, scopeId, null, updatedAt)) return false;
  delete file.scopes[scopeId];
  if (writeDraftFile(key, file)) {
    try { getStorage()?.removeItem(getScopeFallbackKey(key, scopeId)); }
    catch { /* The tombstone remains authoritative over any stale workspace entry. */ }
  }
  return true;
}

/** Call only after an actual project removal, never when closing or hiding a tab. */
export function clearV4ComposerWorkspaceDrafts(
  workspacePath: string,
  workspaceIdentity?: string,
): boolean {
  const key = getV4ComposerDraftStorageKey(workspacePath, workspaceIdentity);
  const storage = getStorage();
  if (!storage) return false;
  try {
    const fallbackKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const candidate = storage.key(index);
      if (!candidate?.startsWith(SCOPE_FALLBACK_PREFIX)) continue;
      let decoded: string;
      try { decoded = decodeURIComponent(candidate.slice(SCOPE_FALLBACK_PREFIX.length)); }
      catch { continue; }
      if (decoded.startsWith(`${key}\0`)) fallbackKeys.push(candidate);
    }
    for (const fallbackKey of fallbackKeys) storage.removeItem(fallbackKey);
    storage.removeItem(key);
    return true;
  } catch (error) {
    warnStorageFailure(key, error);
    return false;
  }
}
