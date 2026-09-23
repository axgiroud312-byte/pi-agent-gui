import { isAbsolute, resolve } from "node:path";
import type { ConversationDelta, ConversationRow } from "@zcode/shared/zcode-protocol-v4";

type Data = Record<string, unknown>;

function object(value: unknown): Data {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map(part => {
    const content = object(part);
    return content.type === "text" && typeof content.text === "string" ? content.text : "";
  }).join("");
}

function timestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function resultText(value: unknown): string {
  const result = object(value);
  return text(result.content);
}

function serialize(value: unknown): string {
  try { return JSON.stringify(value) ?? ""; } catch { return "[unserializable Pi value]"; }
}

interface ToolState {
  status: "inputStreaming" | "running" | "success" | "error" | "cancelled";
  result?: unknown;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

/** Stable row IDs from Pi message order, with final messages replacing stream estimates. */
export class PiMessageRows {
  constructor(private readonly workspacePath?: string) {}

  private messages: Data[] = [];
  private activeMessageIndex: number | undefined;
  private readonly rowIds = new Map<string, number>();
  private readonly tools = new Map<string, ToolState>();
  private readonly userCommands: string[] = [];
  private readonly sourceByMessageIndex = new Map<number, string>();
  private readonly turnStates = new Map<string, "completedSuccess" | "completedInterrupted" | "failed">();
  private nextRowId = 1;
  private rows: ConversationRow[] = [];

  expectUserCommand(commandId: string): void {
    this.userCommands.push(commandId);
  }

  cancelExpectedUserCommand(commandId: string): void {
    const index = this.userCommands.indexOf(commandId);
    if (index >= 0) this.userCommands.splice(index, 1);
  }

  restore(messages: unknown[]): ConversationRow[] {
    this.messages = messages.map(message => object(message));
    this.activeMessageIndex = undefined;
    this.tools.clear();
    this.rowIds.clear();
    this.sourceByMessageIndex.clear();
    this.turnStates.clear();
    this.userCommands.length = 0;
    this.nextRowId = 1;
    let lastUserIndex: number | undefined;
    for (const [index, item] of this.messages.entries()) {
      if (item.role === "user") lastUserIndex = index;
      if (item.role === "assistant" && lastUserIndex !== undefined) {
        this.turnStates.set(`pi-turn-${lastUserIndex}`, item.stopReason === "error" ? "failed"
          : item.stopReason === "aborted" ? "completedInterrupted" : "completedSuccess");
      }
    }
    this.rows = this.buildRows();
    return [...this.rows];
  }

  getRows(): ConversationRow[] {
    return [...this.rows];
  }

  apply(record: Data): ConversationDelta[] {
    switch (record.type) {
      case "message_start": {
        const message = object(record.message);
        this.activeMessageIndex = this.messages.length;
        this.messages.push(message);
        if (message.role === "user") {
          const commandId = this.userCommands.shift();
          if (commandId) this.sourceByMessageIndex.set(this.activeMessageIndex, commandId);
        }
        break;
      }
      case "message_update":
        this.applyContentDelta(object(record.assistantMessageEvent));
        break;
      case "message_end": {
        const final = object(record.message);
        if (this.activeMessageIndex === undefined) this.messages.push(final);
        else this.messages[this.activeMessageIndex] = final;
        this.activeMessageIndex = undefined;
        break;
      }
      case "tool_execution_start":
        if (typeof record.toolCallId === "string") {
          this.tools.set(record.toolCallId, { status: "running", startedAt: Date.now() });
        }
        break;
      case "tool_execution_update":
        if (typeof record.toolCallId === "string") {
          const tool = this.tools.get(record.toolCallId) ?? { status: "running" as const };
          // Pi partialResult is cumulative. Replacing it avoids duplicate output.
          tool.result = record.partialResult;
          this.tools.set(record.toolCallId, tool);
        }
        break;
      case "tool_execution_end":
        if (typeof record.toolCallId === "string") {
          const tool = this.tools.get(record.toolCallId) ?? { status: "running" as const };
          tool.status = record.isError === true ? "error" : "success";
          tool.result = record.result;
          tool.endedAt = Date.now();
          if (record.isError === true) tool.error = resultText(record.result) || "Pi tool failed";
          this.tools.set(record.toolCallId, tool);
        }
        break;
      case "agent_settled": {
        this.settleCurrentTurn(false);
        break;
      }
      default:
        return [];
    }
    const next = this.buildRows();
    const deltas = this.diff(this.rows, next);
    this.rows = next;
    return deltas;
  }

  markStopped(): ConversationDelta[] {
    this.settleCurrentTurn(true);
    const next = this.buildRows();
    const deltas = this.diff(this.rows, next);
    this.rows = next;
    return deltas;
  }

  private settleCurrentTurn(interrupted: boolean): void {
    const userIndex = this.messages.findLastIndex(item => item.role === "user");
    if (userIndex < 0) return;
    const lastAssistant = this.messages.slice(userIndex + 1).findLast(item => item.role === "assistant");
    this.turnStates.set(`pi-turn-${userIndex}`,
      interrupted || lastAssistant?.stopReason === "aborted" ? "completedInterrupted"
        : lastAssistant?.stopReason === "error" ? "failed" : "completedSuccess");
  }

  private applyContentDelta(delta: Data): void {
    if (this.activeMessageIndex === undefined) return;
    const message = this.messages[this.activeMessageIndex];
    if (!message || message.role !== "assistant") return;
    const index = delta.contentIndex;
    if (!Number.isInteger(index) || typeof index !== "number" || index < 0 || index > 10_000) return;
    const content = Array.isArray(message.content) ? [...message.content] : [];
    const part = { ...object(content[index]) };
    const kind = delta.type;
    if (kind === "text_start" || kind === "text_delta" || kind === "text_end") {
      part.type = "text";
      if (kind === "text_delta" && typeof delta.delta === "string") part.text = String(part.text ?? "") + delta.delta;
      if (kind === "text_end" && typeof delta.content === "string") part.text = delta.content;
    } else if (kind === "thinking_start" || kind === "thinking_delta" || kind === "thinking_end") {
      part.type = "thinking";
      if (kind === "thinking_delta" && typeof delta.delta === "string") part.thinking = String(part.thinking ?? "") + delta.delta;
      if (kind === "thinking_end" && typeof delta.content === "string") part.thinking = delta.content;
    } else if (kind === "toolcall_start" || kind === "toolcall_delta" || kind === "toolcall_end") {
      part.type = "toolCall";
      if (kind === "toolcall_start") {
        part.id = delta.id;
        part.name = delta.toolName;
      }
      if (kind === "toolcall_delta" && typeof delta.delta === "string") part.partialArguments = String(part.partialArguments ?? "") + delta.delta;
      if (kind === "toolcall_end") Object.assign(part, object(delta.toolCall));
    }
    content[index] = part;
    message.content = content;
  }

  private rowId(key: string): number {
    const existing = this.rowIds.get(key);
    if (existing !== undefined) return existing;
    const id = this.nextRowId++;
    this.rowIds.set(key, id);
    return id;
  }

  private buildRows(): ConversationRow[] {
    const rows: ConversationRow[] = [];
    let turnId = "pi-turn-0";
    for (const [messageIndex, message] of this.messages.entries()) {
      const at = timestamp(message.timestamp);
      if (message.role === "user") {
        turnId = `pi-turn-${messageIndex}`;
        const sourceCommandId = this.sourceByMessageIndex.get(messageIndex);
        const headerId = this.rowId(`${messageIndex}:turn`);
        const turnState = this.turnStates.get(turnId);
        rows.push({
          kind: "turnHeader", rowId: headerId, turnId, createdAt: at, createdAtSeq: headerId,
          origin: "userInput", executionKind: "agent", state: turnState ?? "running", startedAt: at,
          ...(sourceCommandId ? { sourceCommandId } : {}),
        });
        const inputId = this.rowId(`${messageIndex}:user`);
        rows.push({
          kind: "userInput", rowId: inputId, turnId, createdAt: at, createdAtSeq: inputId,
          origin: "realUser", text: text(message.content),
          ...(sourceCommandId ? { sourceCommandId, rootSourceCommandId: sourceCommandId } : {}),
        });
      } else if (message.role === "assistant") {
        const content = Array.isArray(message.content) ? message.content : [];
        for (const [partIndex, rawPart] of content.entries()) {
          const part = object(rawPart);
          if (part.type === "text" && typeof part.text === "string") {
            const rowId = this.rowId(`${messageIndex}:text:${partIndex}`);
            rows.push({
              kind: "assistantText", rowId, turnId, createdAt: at, createdAtSeq: rowId,
              text: part.text,
              state: this.activeMessageIndex === messageIndex ? "streaming"
                : message.stopReason === "error" ? "failed"
                  : message.stopReason === "aborted" ? "interrupted" : "complete",
              ...(typeof message.model === "string" ? { model: message.model } : {}),
            });
          } else if (part.type === "thinking" && typeof part.thinking === "string") {
            const rowId = this.rowId(`${messageIndex}:thinking:${partIndex}`);
            rows.push({
              kind: "reasoning", rowId, turnId, createdAt: at, createdAtSeq: rowId,
              text: part.thinking,
              state: this.activeMessageIndex === messageIndex ? "streaming" : "complete",
            });
          } else if (part.type === "toolCall") {
            const toolCallId = typeof part.id === "string" ? part.id : `pi-tool-${messageIndex}-${partIndex}`;
            const tool = this.tools.get(toolCallId);
            const rowId = this.rowId(`${messageIndex}:tool:${partIndex}`);
            const inputText = part.arguments === undefined ? String(part.partialArguments ?? "") : serialize(part.arguments);
            const argumentsValue = object(part.arguments);
            // Pi executes a relative read path against the session cwd. The
            // native Read chip opens a file, so point it at that same target,
            // not Electron's or the Host's cwd. Keep inputText as Pi's raw args.
            const displayInput = part.name === "read" && this.workspacePath &&
              typeof argumentsValue.path === "string" && !isAbsolute(argumentsValue.path)
              ? { ...argumentsValue, path: resolve(this.workspacePath, argumentsValue.path) }
              : part.arguments;
            rows.push({
              kind: "toolCall", rowId, turnId, createdAt: at, createdAtSeq: rowId,
              toolCallId,
              toolName: typeof part.name === "string" ? part.name : "unknown",
              status: tool?.status ?? "inputStreaming",
              inputText,
              ...(displayInput !== undefined ? { input: displayInput } : {}),
              ...(tool?.result !== undefined ? { output: { text: resultText(tool.result) } } : {}),
              ...(tool?.error ? { error: { code: "pi.toolError", message: tool.error } } : {}),
            });
          }
        }
      } else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
        const tool = this.tools.get(message.toolCallId) ?? { status: "running" as const };
        tool.status = message.isError === true ? "error" : "success";
        tool.result = message;
        if (message.isError === true) tool.error = text(message.content) || "Pi tool failed";
        this.tools.set(message.toolCallId, tool);
        // The tool result updates the preceding call row rather than creating a second card.
        const call = rows.find(row => row.kind === "toolCall" && row.toolCallId === message.toolCallId);
        if (call?.kind === "toolCall") {
          call.status = tool.status;
          call.output = { text: text(message.content) };
          if (tool.error) call.error = { code: "pi.toolError", message: tool.error };
        }
      }
    }
    return rows;
  }

  private diff(previous: ConversationRow[], next: ConversationRow[]): ConversationDelta[] {
    const deltas: ConversationDelta[] = [];
    for (let index = 0; index < next.length; index++) {
      const row = next[index]!;
      const old = previous[index];
      if (!old) { deltas.push({ op: "row.appended", row }); continue; }
      if (old.rowId !== row.rowId) {
        deltas.push({ op: "row.removed", fromRowId: old.rowId });
        for (const tail of next.slice(index)) deltas.push({ op: "row.appended", row: tail });
        return deltas;
      }
      if (serialize(old) === serialize(row)) continue;
      if (old.kind === "assistantText" && row.kind === "assistantText" &&
        old.state === "streaming" && row.state === "streaming" && row.text.startsWith(old.text)) {
        deltas.push({ op: "row.delta", rowId: row.rowId, path: "text", append: row.text.slice(old.text.length) });
      } else if (old.kind === "reasoning" && row.kind === "reasoning" &&
        old.state === "streaming" && row.state === "streaming" && row.text.startsWith(old.text)) {
        deltas.push({ op: "row.delta", rowId: row.rowId, path: "text", append: row.text.slice(old.text.length) });
      } else {
        deltas.push({ op: "row.upserted", row });
      }
    }
    if (next.length < previous.length) deltas.push({ op: "row.removed", fromRowId: previous[next.length]!.rowId });
    return deltas;
  }
}
