import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, RefreshCw } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useServices } from "@/hooks/useServices.js";

type Page = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["readPiContextInspection"]>>;
type Section = Page["section"];
type Item = Page["items"][number];
const PAGE_SIZE = 20;
const sections: Array<{ id: Section; label: string }> = [
  { id: "history", label: "原始历史" },
  { id: "effective", label: "当前消息" },
  { id: "edits", label: "Context edits" },
  { id: "summaries", label: "摘要" },
];

export function PiContextPageView({ page }: { page: Page }) {
  return <div className="min-h-0 max-h-[55vh] space-y-2 overflow-auto" data-testid="pi-context-page">
    {page.items.length === 0 ? <p className="p-3 text-sm text-foreground-subtle">此页没有 Pi 记录。</p> : null}
    {page.items.map((item: Item) => <article key={item.id} className="space-y-1 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-foreground-subtle">
        <strong className="text-foreground">{item.role ?? item.kind}</strong>
        {item.role ? <span>{item.kind}</span> : null}
        {page.section !== "effective" ? <span className="break-all">Pi ID: {item.id}</span> : null}
        {item.timestamp ? <time>{item.timestamp}</time> : null}
      </div>
      {item.targetId ? <p className="break-all text-xs">目标 Pi ID: {item.targetId} ·
        {item.change === "omit" ? "从当前投影省略" : "替换内容"}</p> : null}
      {item.excludedFromModel ? <p className="text-xs text-foreground-subtle">Pi 标记为排除于模型上下文</p> : null}
      {item.tokensBefore !== undefined ? <p className="text-xs text-foreground-subtle">压缩前 token: {item.tokensBefore}</p> : null}
      {item.blocks.map((block, index) => block.kind === "text"
        ? <div key={index} className="space-y-1">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm" data-testid="pi-context-text">{block.text}</pre>
          {block.truncated ? <p className="text-xs text-foreground-subtle">仅显示前 {block.text.length} / {block.totalChars} 字符</p> : null}
        </div>
        : block.kind === "image" ? <p key={index} className="text-xs text-foreground-subtle">
          图片 · {block.mimeType}{block.bytes !== undefined ? ` · ${block.bytes} 字节` : ""} · 不在检查器传输图片数据
        </p>
          : block.kind === "tool" ? <p key={index} className="text-xs text-foreground-subtle">工具调用 · {block.name}（参数隐藏）</p>
            : <p key={index} className="text-xs text-foreground-subtle">{block.type} 内容块（详情隐藏）</p>)}
      {item.omittedBlocks > 0 ? <p className="text-xs text-foreground-subtle">另有 {item.omittedBlocks} 个内容块未显示</p> : null}
    </article>)}
  </div>;
}

export function PiContextDialog({ sessionId, workspacePath, workspaceIdentity }: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  const { zcodeAgentService } = useServices();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("history");
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<{ targetKey: string; page: Page } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ targetKey: string; message: string } | null>(null);
  const requestId = useRef(0);
  const target = useMemo(() => ({ sessionId, workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}) }), [sessionId, workspacePath, workspaceIdentity]);
  const targetKey = JSON.stringify([sessionId, workspacePath, workspaceIdentity]);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true); setError(null); setLoaded(null);
    try {
      const next = await zcodeAgentService.readPiContextInspection({ ...target, section, offset, limit: PAGE_SIZE });
      if (id === requestId.current) setLoaded({ targetKey, page: next });
    } catch (cause) {
      if (id === requestId.current) setError({ targetKey,
        message: cause instanceof Error ? cause.message : String(cause) });
    } finally { if (id === requestId.current) setLoading(false); }
  }, [zcodeAgentService, target, targetKey, section, offset]);
  useEffect(() => {
    if (open) void refresh();
    else { requestId.current++; setLoaded(null); setError(null); setLoading(false); }
    return () => { requestId.current++; };
  }, [open, refresh]);
  const page = loaded?.targetKey === targetKey ? loaded.page : null;
  const current = page?.section === section && page.offset === offset ? page : null;

  return <>
    <Button type="button" variant="outline" size="icon-md" title="Pi 上下文检查" aria-label="Pi 上下文检查"
      className="pointer-events-auto bg-[var(--color-popover)] shadow-md"
      onClick={() => setOpen(true)} data-testid="pi-context-open">
      <BookOpenText className="size-4" />
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="pi-context-dialog" className="max-h-[85vh] max-w-[min(56rem,calc(100vw-2rem))] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Pi 上下文检查</DialogTitle>
          <DialogDescription>只读检查固定 Pi 0.87.0 的原始 entries 与当前 messages；每次只传输一页文本预览。</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-foreground-subtle">
          “当前消息”是 Pi get_messages 的会话投影，不等同最终 provider 请求；Pi 可在请求前过滤内容或运行扩展钩子。
          原始历史可包含旧分支与压缩前记录，其他元数据条目仅显示类型和 ID；摘要与原文同时出现时不可相加计算 token。
        </p>
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Pi 上下文视图">
          {sections.map(tab => <Button key={tab.id} type="button" size="sm"
            variant={section === tab.id ? "default" : "outline"} role="tab" aria-selected={section === tab.id}
            data-testid={`pi-context-tab-${tab.id}`} onClick={() => { setSection(tab.id); setOffset(0); }}>
            {tab.label}
          </Button>)}
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw className="size-3" /> 刷新
          </Button>
        </div>
        {error?.targetKey === targetKey ? <p role="alert" className="text-sm text-destructive">{error.message}</p> : null}
        {loading ? <p className="text-sm text-foreground-subtle">正在读取 Pi…</p> : null}
        {current ? <PiContextPageView page={current} /> : null}
        <div className="flex items-center justify-end gap-2 text-xs">
          <span className="mr-auto">{current ? `${current.total} 条 · ${current.total ? offset + 1 : 0}–${offset + current.items.length}` : ""}</span>
          <Button type="button" variant="outline" size="sm" disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</Button>
          <Button type="button" variant="outline" size="sm" disabled={loading || !current?.hasMore}
            onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
