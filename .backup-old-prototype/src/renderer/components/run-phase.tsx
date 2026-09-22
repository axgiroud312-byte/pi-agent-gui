import { Badge } from '@/components/ui/badge';
import type { RunPhase, SessionSnapshot } from '../../shared/contracts';

export const phaseLabels: Record<RunPhase, string> = {
  starting: '正在启动',
  idle: '就绪',
  submitting: '正在提交',
  accepted: '已接收',
  running: '运行中',
  retrying: '重试中',
  compacting: '压缩中',
  waiting: '等待交互',
  settled: '已完成',
  error: '运行失败',
  exited: '已退出',
};

export const phaseDescriptions: Record<RunPhase, string> = {
  starting: '正在检查 Pi 版本并启动独立进程。',
  idle: '会话已就绪，可以发送消息。',
  submitting: '正在等待 Pi 确认接收；不会自动重发。',
  accepted: 'Pi 已接收请求，运行尚未结束。',
  running: 'Pi 正在处理消息；运行结束后可继续发送。',
  retrying: 'Pi 正在自动重试，当前运行仍在继续。',
  compacting: 'Pi 正在压缩上下文，当前运行尚未结束。',
  waiting: 'Pi 正在等待交互，请查看诊断中的具体请求。',
  settled: 'Pi 已确认本次运行结束，可以继续对话。',
  error: '查看错误信息，修正配置或登录后新建会话重试。',
  exited: '此会话的 Pi 进程已退出，可新建会话继续工作。',
};

export function isActiveRun(phase: RunPhase) {
  return phase === 'submitting' || phase === 'accepted' || phase === 'running' || phase === 'retrying'
    || phase === 'compacting' || phase === 'waiting';
}

export function canSendPrompt(session: Pick<SessionSnapshot, 'canSubmit'>) {
  return session.canSubmit;
}

export function RunPhaseBadge({ phase, live = false }: { phase: RunPhase; live?: boolean }) {
  return (
    <Badge
      variant={phase === 'error' ? 'destructive' : isActiveRun(phase) ? 'default' : 'secondary'}
      data-testid={live ? 'run-phase' : undefined}
      data-phase={phase}
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
      aria-atomic={live ? true : undefined}
      title={phaseDescriptions[phase]}
    >
      {phaseLabels[phase]}
    </Badge>
  );
}
