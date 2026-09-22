import type { LaunchProfile } from '../shared/contracts.js';

export function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function text(value: unknown, name: string, max = 32_768): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new Error(`${name} 必须为有效文本（最多 ${max} 字符）`);
  }
  return value;
}

export function launchProfile(value: unknown): LaunchProfile {
  const input = object(value);
  const executable = text(input.executable, 'Pi 可执行文件');
  if (!Array.isArray(input.args) || input.args.length > 100 || input.args.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 32_768)) {
    throw new Error('Pi 参数必须为最多 100 项的字符串数组');
  }
  const reserved = new Set(['--session', '--session-id', '--continue', '-c', '--resume', '-r', '--fork', '--mode', '--print', '-p', '--export', '--version', '--help', '-h', '--list-models']);
  for (const arg of input.args as string[]) {
    if (reserved.has(arg.split('=')[0]!)) throw new Error(`启动配置不能包含 ${arg}；原生会话和 RPC 模式由宿主独占管理`);
  }
  return { executable, args: input.args as string[], ...(input.agentDir ? { agentDir: text(input.agentDir, 'Pi 配置目录') } : {}) };
}

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function diagnosticText(value: string): string {
  return value.replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/(["']?(?:api[_-]?key|access_token|refresh_token|authorization)["']?\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}]+)/gi, '$1[redacted]')
    .slice(0, 8_192);
}
