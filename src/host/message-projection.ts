import { randomUUID } from 'node:crypto';
import type { ChatMessage, MessageContent, SessionSnapshot } from '../shared/contracts.js';
import { object } from './validation.js';

function contentOf(value: unknown): MessageContent[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  if (!Array.isArray(value)) return [];
  return value.map(part => {
    const data = object(part);
    return { ...data, type: typeof data.type === 'string' ? data.type : 'unknown' };
  });
}

export function projectMessage(rawValue: unknown, id: string = randomUUID()): ChatMessage {
  const raw = object(rawValue);
  return { id, role: typeof raw.role === 'string' ? raw.role : 'unknown', content: contentOf(raw.content), raw,
    ...(typeof raw.timestamp === 'number' ? { timestamp: raw.timestamp } : {}) };
}

/** A single Pi stream owns this projection; final messages replace provisional deltas. */
export class MessageProjection {
  private currentId?: string;

  apply(snapshot: SessionSnapshot, event: Record<string, unknown>): void {
    if (event.type === 'message_start') {
      const message = projectMessage(event.message);
      this.currentId = message.id;
      snapshot.messages.push(message);
    } else if (event.type === 'message_update') {
      const message = snapshot.messages.find(item => item.id === this.currentId);
      if (!message) return;
      const delta = object(event.assistantMessageEvent);
      const index = delta.contentIndex;
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 10_000) return;
      const kind = String(delta.type);
      const part = message.content[index] ?? { type: kind.startsWith('thinking') ? 'thinking' : kind.startsWith('toolcall') ? 'toolCall' : 'text' };
      message.content[index] = part;
      if (kind === 'text_delta' && typeof delta.delta === 'string') part.text = (part.text ?? '') + delta.delta;
      if (kind === 'thinking_delta' && typeof delta.delta === 'string') part.thinking = (part.thinking ?? '') + delta.delta;
      if (kind === 'toolcall_start') { part.id = delta.id; part.name = delta.toolName; }
      if (kind === 'toolcall_delta' && typeof delta.delta === 'string') part.partialArguments = String(part.partialArguments ?? '') + delta.delta;
      if (kind === 'toolcall_end') Object.assign(part, object(delta.toolCall));
    } else if (event.type === 'message_end') {
      const index = snapshot.messages.findIndex(item => item.id === this.currentId);
      const message = projectMessage(event.message, this.currentId);
      if (index >= 0) snapshot.messages[index] = message;
      else snapshot.messages.push(message);
      this.currentId = undefined;
    }
  }
}
