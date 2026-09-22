import { spawn } from 'node:child_process';
import type { LaunchProfile } from '../shared/contracts.js';

const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Pi itself handles /login. The GUI never reads or forwards its credential input. */
export async function openLoginTerminal(profile: LaunchProfile, cwd: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('请在项目终端运行 Pi 后输入 /login；集成终端将在终端能力中提供。');
  const script = [
    `Set-Location -LiteralPath ${psQuote(cwd)}`,
    "$env:ELECTRON_RUN_AS_NODE = '1'",
    ...(profile.agentDir ? [`$env:PI_CODING_AGENT_DIR = ${psQuote(profile.agentDir)}`] : []),
    "Write-Host 'Pi authentication: enter /login. Return to the IDE and create a new session afterwards.'",
    `& ${psQuote(profile.executable)} ${profile.args.map(psQuote).join(' ')}`,
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const start = `Start-Process powershell.exe -ArgumentList '-NoLogo -NoProfile -NoExit -EncodedCommand ${encoded}'`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(start, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`无法打开 Pi 登录终端（${code}）`)));
  });
}
