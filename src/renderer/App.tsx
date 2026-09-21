import { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, FolderOpen, GitBranch, LoaderCircle, Monitor, Plus, RotateCw, Settings2, Terminal, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { LaunchProfile } from '../shared/contracts';
import { Conversation } from './components/conversation';
import { DiagnosticsPanel } from './components/diagnostics-panel';
import { ProfilePanel } from './components/profile-panel';
import { canSendPrompt, phaseDescriptions, RunPhaseBadge } from './components/run-phase';
import { errorMessage, useHostSnapshot } from './components/use-host-snapshot';
import { WorkspaceSidebar } from './components/workspace-sidebar';

export default function App() {
  const host = useHostSnapshot();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState<'profile' | 'diagnostics' | null>('profile');
  const [creating, setCreating] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [loggingIn, setLoggingIn] = useState<Record<string, boolean>>({});
  const [workspaceErrors, setWorkspaceErrors] = useState<Record<string, string>>({});
  const [promptErrors, setPromptErrors] = useState<Record<string, string>>({});
  const [loginNotices, setLoginNotices] = useState<Record<string, string>>({});
  const createLocks = useRef(new Set<string>());
  const sendLocks = useRef(new Set<string>());
  const loginLocks = useRef(new Set<string>());
  const selectionRevision = useRef(0);

  const { snapshot } = host;
  const workspace = snapshot?.workspaces.find((item) => item.id === workspaceId) ?? snapshot?.workspaces[0];
  const sessions = snapshot?.sessions.filter((item) => item.workspaceId === workspace?.id) ?? [];
  const session = sessions.find((item) => item.id === (workspace && selectedSessions[workspace.id])) ?? sessions[0];

  useEffect(() => {
    if (!snapshot) return;
    setWorkspaceId((current) => snapshot.workspaces.some((item) => item.id === current)
      ? current : snapshot.workspaces[0]?.id ?? null);
    setSelectedSessions((current) => {
      let next = current;
      for (const item of snapshot.workspaces) {
        const available = snapshot.sessions.filter((candidate) => candidate.workspaceId === item.id);
        if (!available.some((candidate) => candidate.id === current[item.id]) && available[0]) {
          next = { ...next, [item.id]: available[0].id };
        }
      }
      return next;
    });
  }, [snapshot]);

  const selectWorkspace = (id: string) => {
    selectionRevision.current += 1;
    setWorkspaceId(id);
  };
  const selectSession = (id: string) => {
    if (!workspace) return;
    selectionRevision.current += 1;
    setSelectedSessions((current) => ({ ...current, [workspace.id]: id }));
  };

  const openWorkspace = async (path?: string) => {
    const intent = ++selectionRevision.current;
    const opened = path === undefined
      ? await window.piIde.chooseWorkspace()
      : await window.piIde.openWorkspace(path);
    if (!opened) return;
    host.rememberWorkspace(opened);
    if (selectionRevision.current === intent) setWorkspaceId(opened.id);
  };

  const createSession = async () => {
    if (!workspace || createLocks.current.has(workspace.id)) return;
    const id = workspace.id;
    const intent = selectionRevision.current;
    createLocks.current.add(id);
    setCreating((current) => ({ ...current, [id]: true }));
    setWorkspaceErrors((current) => ({ ...current, [id]: '' }));
    setLoginNotices((current) => ({ ...current, [id]: '' }));
    try {
      const created = await window.piIde.createSession(id);
      host.rememberSession(created);
      if (selectionRevision.current === intent) {
        setWorkspaceId(id);
        setSelectedSessions((current) => ({ ...current, [id]: created.id }));
      }
    } catch (cause) {
      setWorkspaceErrors((current) => ({ ...current, [id]: errorMessage(cause) }));
      if (selectionRevision.current === intent) setPanel('profile');
    } finally {
      createLocks.current.delete(id);
      setCreating((current) => ({ ...current, [id]: false }));
    }
  };

  const saveProfile = async (profile: LaunchProfile) => {
    const saved = await window.piIde.saveProfile(profile);
    host.rememberProfile(saved);
    return saved;
  };

  const sendPrompt = async (id: string, text: string): Promise<boolean> => {
    // Check the most recent host snapshot as well as the synchronous click lock.
    const currentSession = host.latest.current?.sessions.find((item) => item.id === id);
    if (!text.trim() || !currentSession || !canSendPrompt(currentSession.phase) || sendLocks.current.has(id)) return false;
    sendLocks.current.add(id);
    setSending((current) => ({ ...current, [id]: true }));
    setPromptErrors((current) => ({ ...current, [id]: '' }));
    try {
      await window.piIde.sendPrompt(id, text);
      setDrafts((current) => current[id] === text ? { ...current, [id]: '' } : current);
      return true;
    } catch (cause) {
      setPromptErrors((current) => ({ ...current, [id]: errorMessage(cause) }));
      return false;
    } finally {
      sendLocks.current.delete(id);
      setSending((current) => ({ ...current, [id]: false }));
    }
  };

  const openLogin = async () => {
    if (!workspace || loginLocks.current.has(workspace.id)) return;
    const id = workspace.id;
    loginLocks.current.add(id);
    setLoggingIn((current) => ({ ...current, [id]: true }));
    setWorkspaceErrors((current) => ({ ...current, [id]: '' }));
    setLoginNotices((current) => ({ ...current, [id]: '' }));
    try {
      await window.piIde.openPiLogin(id);
      setLoginNotices((current) => ({ ...current, [id]: '已请求打开 Pi 登录终端。在终端中完成 /login 后，新建会话读取认证配置。' }));
    } catch (cause) {
      setWorkspaceErrors((current) => ({ ...current, [id]: `无法打开 Pi 登录终端：${errorMessage(cause)}` }));
    } finally {
      loginLocks.current.delete(id);
      setLoggingIn((current) => ({ ...current, [id]: false }));
    }
  };

  if (!snapshot) {
    return (
      <main className="flex h-full items-center justify-center p-6">
        <Empty className="max-w-lg">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {host.error ? <AlertCircle /> : <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
            </EmptyMedia>
            <EmptyTitle>{host.error ? '无法连接桌面宿主' : '正在打开 Pi Agent IDE'}</EmptyTitle>
            <EmptyDescription>{host.error || '正在读取工作区与 Pi 启动配置…'}</EmptyDescription>
          </EmptyHeader>
          {host.error && <EmptyContent><Button onClick={host.reconnect}><RotateCw data-icon="inline-start" />重试连接</Button></EmptyContent>}
        </Empty>
      </main>
    );
  }

  const errors = [...new Set([
    workspace && workspaceErrors[workspace.id],
    session && promptErrors[session.id],
    session?.error,
  ].filter((value): value is string => !!value))];
  const isCreating = !!(workspace && creating[workspace.id]);
  const isLoggingIn = !!(workspace && loggingIn[workspace.id]);

  return (
    <div className="flex h-full min-w-0">
      <WorkspaceSidebar
        snapshot={snapshot} workspace={workspace} sessionId={session?.id} creating={isCreating}
        onOpen={openWorkspace} onSelectWorkspace={selectWorkspace} onSelectSession={selectSession}
        onCreate={() => void createSession()} onProfile={() => setPanel('profile')}
      />
      <Separator orientation="vertical" />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-col gap-3 px-5 py-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="truncate text-base font-semibold">{workspace?.name || '开始你的工作'}</h1>
              {session && <RunPhaseBadge phase={session.phase} live />}
            </div>
            <Button
              variant={panel === 'diagnostics' ? 'secondary' : 'ghost'} size="sm"
              onClick={() => setPanel((current) => current === 'diagnostics' ? null : 'diagnostics')}
              aria-expanded={panel === 'diagnostics'} aria-controls="workspace-details"
            >
              <Activity data-icon="inline-start" />诊断
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            {workspace && <>
              <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" aria-hidden="true" />本地</span>
              <span className="inline-flex min-w-0 items-center gap-1.5" title={workspace.branch || '宿主未报告 Git 分支'}>
                <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="max-w-48 truncate">{workspace.branch || '无分支信息'}</span>
              </span>
            </>}
            <span className="min-w-0 break-all">模型：{session?.model || '未报告'}</span>
          </div>
          {workspace && <div className="truncate font-mono text-xs text-muted-foreground" title={workspace.path}>cwd · {workspace.path}</div>}
          {session && <p className="text-xs text-muted-foreground">{phaseDescriptions[session.phase]}</p>}
        </header>
        <Separator />
        {(host.error || errors.length > 0 || (workspace && loginNotices[workspace.id])) && (
          <div className="flex max-h-[35vh] shrink-0 flex-col gap-2 overflow-y-auto px-5 py-3">
            {host.error && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertTitle>宿主连接失败</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <span className="break-words">{host.error}</span>
                  <Button variant="outline" size="sm" className="self-start" onClick={host.reconnect}>重试连接</Button>
                </AlertDescription>
              </Alert>
            )}
            {errors.length > 0 && (
              <Alert variant="destructive" data-testid="session-error">
                <AlertCircle aria-hidden="true" />
                <AlertTitle>会话需要处理</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  {errors.map((message) => <span key={message} className="whitespace-pre-wrap break-words">{message}</span>)}
                  <span>检查工作区路径、Pi 版本与启动配置。认证失败时，在 Pi 终端完成登录，再新建会话重试。</span>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPanel('profile')}>
                      <Settings2 data-icon="inline-start" />编辑启动配置
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void createSession()} disabled={!workspace || isCreating}>
                      <RotateCw data-icon="inline-start" />新建会话重试
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void openLogin()} disabled={!workspace || isLoggingIn}>
                      <Terminal data-icon="inline-start" />打开 Pi 登录终端
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {workspace && loginNotices[workspace.id] && (
              <Alert role="status">
                <Terminal aria-hidden="true" />
                <AlertTitle>继续完成 Pi 登录</AlertTitle>
                <AlertDescription>{loginNotices[workspace.id]}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
        {session ? (
          <Conversation
            key={`${session.id}:${session.generation}`} session={session} draft={drafts[session.id] || ''}
            pending={!!sending[session.id]}
            onDraft={(text) => setDrafts((current) => ({ ...current, [session.id]: text }))}
            onSend={(text) => sendPrompt(session.id, text)}
          />
        ) : (
          <Empty className="min-h-0 overflow-y-auto">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FolderOpen /></EmptyMedia>
              <EmptyTitle>{workspace ? '工作区已打开' : '把项目带到这里'}</EmptyTitle>
              <EmptyDescription>
                {workspace ? '确认右侧启动配置，然后新建会话。Pi 将在当前工作区运行。' : '在左侧输入目录路径，或选择一个本地文件夹。你的对话将按工作区组织。'}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {workspace && <Button disabled={isCreating} onClick={() => void createSession()}><Plus data-icon="inline-start" />创建第一个会话</Button>}
              <Button variant="outline" onClick={() => setPanel('profile')}><Settings2 data-icon="inline-start" />检查 Pi 启动配置</Button>
              <Badge variant="outline">本地目录 · 独立 Pi 进程</Badge>
            </EmptyContent>
          </Empty>
        )}
      </main>
      <aside
        id="workspace-details" aria-label={panel === 'diagnostics' ? '会话诊断' : 'Pi 启动配置'}
        className={cn('flex min-h-0 w-80 shrink-0 flex-col border-l bg-card', !panel && 'hidden')}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
          <h2 className="text-sm font-semibold">{panel === 'diagnostics' ? '会话诊断' : 'Pi 启动配置'}</h2>
          <Button variant="ghost" size="icon-sm" aria-label="关闭侧面板" onClick={() => setPanel(null)}><X data-icon="inline-start" /></Button>
        </div>
        <Separator />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div hidden={panel !== 'profile'}>
            <ProfilePanel profile={snapshot.profile} onSave={saveProfile} />
          </div>
          {panel === 'diagnostics' && (
            <DiagnosticsPanel
              snapshot={snapshot} session={session} workspace={workspace} loggingIn={isLoggingIn}
              showLogin={errors.length === 0}
              onLogin={() => void openLogin()} onProfile={() => setPanel('profile')}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
