import { useRef, useState } from 'react';
import { Folder, FolderOpen, LoaderCircle, MessageSquare, Plus, Settings2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import type { AppSnapshot, Workspace } from '../../shared/contracts';
import { RunPhaseBadge } from './run-phase';
import { errorMessage } from './use-host-snapshot';

interface WorkspaceSidebarProps {
  snapshot: AppSnapshot;
  workspace?: Workspace;
  sessionId?: string;
  creating: boolean;
  onOpen: (path?: string) => Promise<void>;
  onSelectWorkspace: (id: string) => void;
  onSelectSession: (id: string) => void;
  onCreate: () => void;
  onProfile: () => void;
}

export function WorkspaceSidebar({
  snapshot, workspace, sessionId, creating, onOpen, onSelectWorkspace,
  onSelectSession, onCreate, onProfile,
}: WorkspaceSidebarProps) {
  const [path, setPath] = useState('');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const sessions = snapshot.sessions.filter((session) => session.workspaceId === workspace?.id);

  const open = async (chooseFolder: boolean) => {
    if (inFlight.current) return;
    if (!chooseFolder && !path.trim()) {
      setError('请输入一个本地目录的完整路径，或使用文件夹选择器。');
      return;
    }
    inFlight.current = true;
    setOpening(true);
    setError(null);
    try {
      await onOpen(chooseFolder ? undefined : path.trim());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setOpening(false);
    }
  };

  return (
    <aside aria-label="工作区与会话" className="flex min-h-0 w-64 shrink-0 flex-col bg-muted/40">
      <div className="flex h-16 shrink-0 items-center gap-3 px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary font-mono text-xl text-primary-foreground" aria-hidden="true">π</div>
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight">Pi Agent IDE</div>
          <div className="text-xs text-muted-foreground">本地工作台</div>
        </div>
      </div>
      <Separator />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
        <form onSubmit={(event) => { event.preventDefault(); void open(false); }}>
          <FieldGroup className="gap-2">
            <Field data-invalid={!!error} data-disabled={opening}>
              <FieldLabel htmlFor="workspace-path">工作区路径</FieldLabel>
              <Input
                id="workspace-path"
                value={path}
                onChange={(event) => { setPath(event.target.value); setError(null); }}
                placeholder="输入本地项目目录"
                autoComplete="off"
                spellCheck={false}
                disabled={opening}
                aria-invalid={!!error}
                aria-describedby={error ? 'workspace-error' : undefined}
              />
            </Field>
            <Field orientation="horizontal">
              <Button type="submit" variant="outline" className="flex-1" disabled={opening}>
                {opening ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Plus data-icon="inline-start" />}
                打开工作区
              </Button>
              <Button
                type="button" variant="outline" size="icon" disabled={opening}
                aria-label="选择本地文件夹" title="选择本地文件夹"
                onClick={() => void open(true)}
              >
                <FolderOpen data-icon="inline-start" />
              </Button>
            </Field>
          </FieldGroup>
        </form>
        {error && (
          <Alert id="workspace-error" variant="destructive">
            <AlertTitle>无法打开工作区</AlertTitle>
            <AlertDescription className="break-words">
              {error} 请检查目录是否存在、是否可访问，修改路径后重新打开。
            </AlertDescription>
          </Alert>
        )}
        <nav aria-label="工作区列表" className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-medium text-muted-foreground">工作区</h2>
            <Badge variant="outline">{snapshot.workspaces.length}</Badge>
          </div>
          {snapshot.workspaces.length === 0 ? (
            <Empty className="px-1 py-4">
              <EmptyHeader>
                <EmptyTitle>还没有工作区</EmptyTitle>
                <EmptyDescription>普通文件夹和 Git 项目都可以打开。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : snapshot.workspaces.map((item) => (
            <Button
              key={item.id} variant={item.id === workspace?.id ? 'secondary' : 'ghost'}
              className="w-full justify-start" title={item.path}
              aria-current={item.id === workspace?.id ? 'page' : undefined}
              onClick={() => onSelectWorkspace(item.id)}
            >
              {item.id === workspace?.id ? <FolderOpen data-icon="inline-start" /> : <Folder data-icon="inline-start" />}
              <span className="truncate">{item.name}</span>
            </Button>
          ))}
        </nav>
        <Separator />
        <section aria-label="会话列表" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <h2 className="text-xs font-medium text-muted-foreground">当前工作区的会话</h2>
            <span className="text-xs text-muted-foreground">{sessions.length}</span>
          </div>
          <Button onClick={onCreate} disabled={!workspace || creating}>
            {creating ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Plus data-icon="inline-start" />}
            新建会话
          </Button>
          {sessions.length === 0 ? (
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              {workspace ? '新建会话后，Pi 将在此目录中工作。' : '先打开一个工作区，再开始对话。'}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {sessions.map((session, index) => (
                <Button
                  key={session.id} variant={session.id === sessionId ? 'secondary' : 'ghost'}
                  className="h-auto w-full justify-start py-2.5"
                  aria-label={`会话 ${session.nativeSessionId || index + 1}`}
                  aria-current={session.id === sessionId ? 'true' : undefined}
                  title={session.nativeSessionId || session.id}
                  onClick={() => onSelectSession(session.id)}
                >
                  <MessageSquare data-icon="inline-start" />
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                    <span className="max-w-full truncate">{session.nativeSessionId || `会话 ${index + 1}`}</span>
                    <RunPhaseBadge phase={session.phase} />
                  </span>
                </Button>
              ))}
            </div>
          )}
        </section>
      </div>
      <Separator />
      <div className="flex shrink-0 flex-col gap-2 p-3">
        <Button variant="ghost" className="justify-start" onClick={onProfile}>
          <Settings2 data-icon="inline-start" />启动配置
        </Button>
        <div className="px-2 text-xs text-muted-foreground">GUI {snapshot.version}</div>
      </div>
    </aside>
  );
}
