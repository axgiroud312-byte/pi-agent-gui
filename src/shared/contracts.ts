export const PI_VERSION = '0.87.0';

export interface LaunchProfile {
  executable: string;
  args: string[];
  agentDir?: string;
}

export interface Workspace { id: string; path: string; name: string; target: 'local'; branch: string | null }
export type RunPhase = 'starting' | 'idle' | 'submitting' | 'accepted' | 'running' | 'retrying' | 'compacting' | 'waiting' | 'settled' | 'error' | 'exited';
export interface MessageContent { type: string; text?: string; thinking?: string; [key: string]: unknown }
export interface ChatMessage { id: string; role: string; content: MessageContent[]; timestamp?: number; raw: Record<string, unknown> }
export interface SessionSnapshot {
  id: string;
  workspaceId: string;
  generation: string;
  phase: RunPhase;
  canSubmit: boolean;
  submissionBlockedReason?: string;
  pid?: number;
  piVersion: string;
  nativeSessionId?: string;
  sessionFile?: string;
  model?: string;
  messages: ChatMessage[];
  diagnostics: { kind: string; message: string; time: string }[];
  error?: string;
}
export interface AppSnapshot { workspaces: Workspace[]; sessions: SessionSnapshot[]; profile: LaunchProfile; version: string }
export interface PiIdeApi {
  snapshot(): Promise<AppSnapshot>;
  chooseWorkspace(): Promise<Workspace | null>;
  openWorkspace(path: string): Promise<Workspace>;
  saveProfile(profile: LaunchProfile): Promise<LaunchProfile>;
  createSession(workspaceId: string): Promise<SessionSnapshot>;
  sendPrompt(sessionId: string, message: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  openPiLogin(workspaceId: string): Promise<void>;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
}

declare global { interface Window { piIde: PiIdeApi } }
