import { useCallback, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider, MessagePartPrimitive, MessagePrimitive, ThreadPrimitive,
  useAuiState, useExternalStoreRuntime,
  type AppendMessage, type DataMessagePartProps, type ThreadMessageLike,
} from '@assistant-ui/react';
import { ArrowDown, ArrowUp, Bot, MessageSquare, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { ChatMessage, SessionSnapshot } from '../../shared/contracts';
import { canSendPrompt, isActiveRun, phaseDescriptions } from './run-phase';

// Original adapter for @assistant-ui/react 0.15.21 (MIT):
// https://github.com/assistant-ui/assistant-ui / docs/runtimes/custom/external-store.
// Pi snapshots own history and execution; no local queue, tools, or model loop.
function projectMessage(message: ChatMessage): ThreadMessageLike {
  const content: Exclude<ThreadMessageLike['content'], string>[number][] = message.content.map((part) => (
    part.type === 'text' && typeof part.text === 'string'
      ? { type: 'text', text: part.text }
      : { type: 'data', name: part.type, data: part }
  ));
  if (message.role !== 'user' && message.role !== 'assistant') {
    content.push({ type: 'data', name: `消息 · ${message.role}`, data: message.raw });
  }
  return {
    id: message.id,
    // assistant-ui only admits user/assistant/system; custom Pi roles keep their
    // actual attribution and raw payload instead of becoming invisible system rows.
    role: message.role === 'user' ? 'user' : 'assistant',
    content,
    ...(message.timestamp !== undefined ? { createdAt: new Date(message.timestamp) } : {}),
    metadata: { custom: { piRole: message.role, timestamp: message.timestamp } },
  };
}

function RawContent({ name, data }: DataMessagePartProps<unknown>) {
  const [open, setOpen] = useState(false);
  return (
    <details className="rounded-lg border px-3 py-2" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-muted-foreground">原始内容 · {name}</summary>
      {open && <pre className="mt-3 max-h-80 overflow-auto text-xs leading-relaxed">{JSON.stringify(data, null, 2)}</pre>}
    </details>
  );
}

function MessageText() {
  return <MessagePartPrimitive.Text smooth={false} className="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]" />;
}

const messageParts = { Text: MessageText, data: { Fallback: RawContent } };

function ConversationMessage() {
  const role = useAuiState((state) => state.message.metadata.custom.piRole);
  const timestamp = useAuiState((state) => state.message.metadata.custom.timestamp);
  const optimistic = useAuiState((state) => state.message.metadata.isOptimistic);
  const hasContent = useAuiState((state) => state.message.content.length > 0);
  // The library's speculative empty assistant row is not Pi output.
  if (optimistic || !hasContent) return null;
  const user = role === 'user';
  const label = user ? '你' : role === 'assistant' ? 'Pi' : role === 'toolResult' ? '工具结果' : `消息 · ${String(role)}`;
  const time = typeof timestamp === 'number' && Number.isFinite(timestamp) ? new Date(timestamp) : null;
  return (
    <MessagePrimitive.Root className="flex min-w-0 gap-3 py-4">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
        {user ? <UserRound className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{label}</span>
          {time && !Number.isNaN(time.getTime()) && (
            <time dateTime={time.toISOString()} className="text-xs text-muted-foreground">
              {time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </time>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <MessagePrimitive.Parts components={messageParts} />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

interface ConversationProps {
  session: SessionSnapshot;
  draft: string;
  pending: boolean;
  onDraft: (text: string) => void;
  onSend: (text: string) => Promise<boolean>;
}

export function Conversation({ session, draft, pending, onDraft, onSend }: ConversationProps) {
  const composing = useRef(false);
  const compositionEndedAt = useRef(-Infinity);
  const enabled = canSendPrompt(session) && !pending;
  const onNew = useCallback(async (message: AppendMessage) => {
    const text = message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n');
    await onSend(text);
  }, [onSend]);
  const runtime = useExternalStoreRuntime({
    messages: session.messages,
    convertMessage: projectMessage,
    isRunning: isActiveRun(session.phase),
    isSendDisabled: !enabled,
    onNew,
  });

  const submit = () => {
    if (enabled && draft.trim() && !composing.current) void onSend(draft);
  };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
        <ThreadPrimitive.Viewport
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-3"
          autoScroll scrollToBottomOnRunStart={false} aria-label="会话消息"
        >
          {session.messages.length === 0 && (
            <Empty className="my-auto py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon"><MessageSquare /></EmptyMedia>
                <EmptyTitle>{session.phase === 'idle' ? '从一条消息开始' : '等待会话消息'}</EmptyTitle>
                <EmptyDescription>
                  {session.phase === 'idle' ? '描述你想了解的问题或要完成的工作。回复会实时显示在这里。' : phaseDescriptions[session.phase]}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <div className="mx-auto w-full max-w-3xl">
            <ThreadPrimitive.Messages>{() => <ConversationMessage />}</ThreadPrimitive.Messages>
          </div>
          <ThreadPrimitive.ScrollToBottom asChild>
            <Button variant="outline" size="sm" className="sticky bottom-2 mx-auto mt-2 disabled:hidden">
              <ArrowDown data-icon="inline-start" />返回最新
            </Button>
          </ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.Viewport>
        <Separator />
        <form
          className="shrink-0 px-5 py-4"
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          <FieldGroup className="mx-auto max-w-3xl gap-2">
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="message">消息</FieldLabel>
                <Badge variant="outline">文本</Badge>
              </div>
              <Textarea
                id="message" value={draft} onChange={(event) => onDraft(event.target.value)}
                className="max-h-52 min-h-24 resize-none" rows={3} autoFocus
                placeholder={enabled ? '描述你的问题或下一步工作…' : '可以先写下草稿，待会话就绪后发送…'}
                aria-describedby="composer-help"
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; compositionEndedAt.current = performance.now(); }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;
                  if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229
                    || performance.now() - compositionEndedAt.current < 100) return;
                  event.preventDefault();
                  if (!event.repeat) submit();
                }}
              />
            </Field>
            <Field orientation="horizontal" className="justify-between gap-3">
              <div id="composer-help" className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                <span>{pending ? '正在提交消息…' : enabled ? 'Enter / Ctrl+Enter 发送 · Shift+Enter 换行' : phaseDescriptions[session.phase]}</span>
                {!enabled && <span>{session.submissionBlockedReason || '正在提交'}；草稿保留在当前会话。</span>}
              </div>
              <Button type="submit" disabled={!enabled || !draft.trim()}>
                <ArrowUp data-icon="inline-start" />发送
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
