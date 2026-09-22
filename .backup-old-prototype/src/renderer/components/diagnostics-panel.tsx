import { Activity, Settings2, Terminal } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { PI_VERSION, type AppSnapshot, type SessionSnapshot, type Workspace } from '../../shared/contracts';
import { phaseLabels } from './run-phase';

interface DiagnosticsPanelProps {
  snapshot: AppSnapshot;
  session?: SessionSnapshot;
  workspace?: Workspace;
  loggingIn: boolean;
  showLogin: boolean;
  onLogin: () => void;
  onProfile: () => void;
}

export function DiagnosticsPanel({ snapshot, session, workspace, loggingIn, showLogin, onLogin, onProfile }: DiagnosticsPanelProps) {
  const entries = [
    ['Pi 版本', session?.piVersion || '尚未检测'],
    ['兼容版本', PI_VERSION],
    ['进程状态', session ? phaseLabels[session.phase] : '未启动'],
    ['PID', session?.pid === undefined ? '未报告' : String(session.pid)],
    ['nativeSessionId', session?.nativeSessionId || '未报告'],
    ['会话文件', session?.sessionFile || '未报告'],
    ['宿主会话 ID', session?.id || '未创建'],
    ['Generation', session?.generation || '未创建'],
    ['GUI 版本', snapshot.version],
  ];

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Pi 进程诊断" className="flex flex-col gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">当前会话 · 进程与身份</h3>
        <dl className="flex flex-col gap-3 text-xs">
          {entries.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="select-text break-all font-mono leading-relaxed">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <Separator />
      <section aria-label="保存的启动配置" className="flex flex-col gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">保存的启动配置 · 用于新会话</h3>
        <dl className="flex flex-col gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">可执行文件</dt>
            <dd className="break-all font-mono">{snapshot.profile.executable}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">参数</dt>
            <dd><pre>{JSON.stringify(snapshot.profile.args, null, 2)}</pre></dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">配置目录</dt>
            <dd className="break-all font-mono">{snapshot.profile.agentDir || 'Pi 默认目录'}</dd>
          </div>
        </dl>
        <Button variant="outline" onClick={onProfile}>
          <Settings2 data-icon="inline-start" />编辑启动配置
        </Button>
        {showLogin && (
          <Button variant="outline" onClick={onLogin} disabled={!workspace || loggingIn}>
            <Terminal data-icon="inline-start" />打开 Pi 登录终端
          </Button>
        )}
      </section>
      <Separator />
      <section aria-label="诊断记录" className="flex flex-col gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">诊断记录 · {session?.diagnostics.length || 0}</h3>
        {session?.error && (
          <Alert variant="destructive">
            <AlertTitle>会话错误</AlertTitle>
            <AlertDescription className="break-words">{session.error}</AlertDescription>
          </Alert>
        )}
        {session?.diagnostics.length ? (
          <ol className="flex flex-col gap-3">
            {session.diagnostics.map((entry, index) => (
              <li key={`${index}-${entry.time}`} className="flex flex-col gap-1 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-1 text-muted-foreground">
                  <span>{entry.kind}</span>
                  <time>{entry.time}</time>
                </div>
                <pre className="select-text leading-relaxed">{entry.message}</pre>
              </li>
            ))}
          </ol>
        ) : (
          <Empty className="px-0 py-4">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Activity /></EmptyMedia>
              <EmptyTitle>暂无诊断记录</EmptyTitle>
              <EmptyDescription>Pi 的启动、协议与进程诊断会显示在这里。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  );
}
