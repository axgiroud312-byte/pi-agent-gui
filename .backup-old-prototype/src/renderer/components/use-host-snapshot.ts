import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSnapshot, LaunchProfile, SessionSnapshot, Workspace } from '../../shared/contracts';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useHostSnapshot() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<AppSnapshot | null>(null);
  const revision = useRef(0);

  const receive = useCallback((next: AppSnapshot) => {
    revision.current += 1;
    latest.current = next;
    setSnapshot(next);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    setError(null);

    try {
      if (!window.piIde) throw new Error('桌面宿主连接不可用。请通过 Electron 启动 Pi Agent IDE。');

      // Subscribe before reading. A late initial response must not roll back a live event.
      unsubscribe = window.piIde.onSnapshot((next) => {
        if (disposed) return;
        receive(next);
        setError(null);
      });
      const startedAt = revision.current;
      void window.piIde.snapshot().then((next) => {
        if (!disposed && revision.current === startedAt) receive(next);
      }).catch((cause: unknown) => {
        if (!disposed && revision.current === startedAt) setError(errorMessage(cause));
      });
    } catch (cause) {
      setError(errorMessage(cause));
    }

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [attempt, receive]);

  // API return values cover the interval before a broadcast arrives. Never replace a
  // session already received via the subscription with an older createSession result.
  const rememberWorkspace = (workspace: Workspace) => {
    const current = latest.current;
    if (current && !current.workspaces.some((item) => item.id === workspace.id)) {
      receive({ ...current, workspaces: [...current.workspaces, workspace] });
    }
  };
  const rememberSession = (session: SessionSnapshot) => {
    const current = latest.current;
    if (current && !current.sessions.some((item) => item.id === session.id)) {
      receive({ ...current, sessions: [...current.sessions, session] });
    }
  };
  const rememberProfile = (profile: LaunchProfile) => {
    if (latest.current) receive({ ...latest.current, profile });
  };

  return {
    snapshot, latest, error, rememberWorkspace, rememberSession, rememberProfile,
    reconnect: () => setAttempt((value) => value + 1),
  };
}
