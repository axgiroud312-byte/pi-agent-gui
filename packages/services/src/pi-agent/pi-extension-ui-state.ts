import type { PiExtensionUiState } from "@zcode/shared/zcode-protocol-v4";
import { PI_CONTROL_LIFECYCLE_PREFIX, piControlRecord } from "./pi-control-protocol.js";

const MAX_STATUS_TEXT = 4096;
const MAX_WIDGET_LINE = 4096;
const MAX_NOTICE_TEXT = 8192;
const MAX_TITLE_TEXT = 512;
const MAX_EDITOR_TEXT = 65_536;

export function emptyPiExtensionUiState(): PiExtensionUiState {
  return { statuses: [], widgets: [], notices: [] };
}

function key(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("\0");
}

function lifecycle(message: string): { kind: "start" | "shutdown"; generation: string } | null {
  if (!message.startsWith(PI_CONTROL_LIFECYCLE_PREFIX)) return null;
  try {
    const value: unknown = JSON.parse(message.slice(PI_CONTROL_LIFECYCLE_PREFIX.length));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.protocol !== 1 || !key(record.generation) ||
      (record.kind !== "start" && record.kind !== "shutdown")) return null;
    return { kind: record.kind, generation: record.generation };
  } catch { return null; }
}

/** Apply only public RPC records. No response is sent for fire-and-forget UI methods. */
export function reducePiExtensionUiState(
  state: PiExtensionUiState,
  record: Record<string, unknown>,
): PiExtensionUiState {
  if (record.type !== "extension_ui_request" || typeof record.id !== "string" || !record.id) return state;
  if (record.method === "notify" && typeof record.message === "string") {
    if (piControlRecord(record)) return state;
    const marker = lifecycle(record.message);
    if (marker) {
      if (marker.kind === "start") return { ...state, generation: marker.generation };
      if (state.generation !== marker.generation) return state;
      return { ...emptyPiExtensionUiState(), generation: marker.generation };
    }
    if (record.message.startsWith(PI_CONTROL_LIFECYCLE_PREFIX) || record.message.length > MAX_NOTICE_TEXT ||
      !(record.notifyType === undefined || record.notifyType === "info" ||
        record.notifyType === "warning" || record.notifyType === "error")) return state;
    if (state.notices.some(notice => notice.id === record.id)) return state;
    return { ...state, notices: [...state.notices, { id: record.id, message: record.message,
      type: (record.notifyType ?? "info") as "info" | "warning" | "error", at: Date.now() }].slice(-8) };
  }
  if (record.method === "setStatus" && key(record.statusKey) &&
    (record.statusText === undefined || typeof record.statusText === "string" && record.statusText.length <= MAX_STATUS_TEXT)) {
    const remaining = state.statuses.filter(item => item.key !== record.statusKey);
    if (record.statusText === undefined) return { ...state, statuses: remaining };
    return { ...state, statuses: [...remaining, { key: record.statusKey, text: record.statusText }].slice(-32) };
  }
  if (record.method === "setTitle" && typeof record.title === "string" &&
    record.title.length <= MAX_TITLE_TEXT) {
    return { ...state, title: { id: record.id, text: record.title } };
  }
  if (record.method === "set_editor_text" && typeof record.text === "string" &&
    record.text.length <= MAX_EDITOR_TEXT) {
    return { ...state, editorText: { id: record.id, text: record.text } };
  }
  if (record.method === "setWidget" && key(record.widgetKey) &&
    (record.widgetLines === undefined || Array.isArray(record.widgetLines) &&
      record.widgetLines.length <= 32 && record.widgetLines.every(line => typeof line === "string" && line.length <= MAX_WIDGET_LINE)) &&
    (record.widgetPlacement === undefined || record.widgetPlacement === "aboveEditor" || record.widgetPlacement === "belowEditor")) {
    const remaining = state.widgets.filter(item => item.key !== record.widgetKey);
    if (record.widgetLines === undefined) return { ...state, widgets: remaining };
    return { ...state, widgets: [...remaining, { key: record.widgetKey, lines: record.widgetLines as string[],
      placement: (record.widgetPlacement ?? "aboveEditor") as "aboveEditor" | "belowEditor" }].slice(-16) };
  }
  return state;
}
