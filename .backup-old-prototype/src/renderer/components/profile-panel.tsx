import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Save } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PI_VERSION, type LaunchProfile } from '../../shared/contracts';
import { errorMessage } from './use-host-snapshot';

interface ProfilePanelProps {
  profile: LaunchProfile;
  onSave: (profile: LaunchProfile) => Promise<LaunchProfile>;
}

export function ProfilePanel({ profile, onSave }: ProfilePanelProps) {
  const [executable, setExecutable] = useState(profile.executable);
  const [args, setArgs] = useState(JSON.stringify(profile.args, null, 2));
  const [agentDir, setAgentDir] = useState(profile.agentDir || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<'executable' | 'args' | null>(null);
  const inFlight = useRef(false);
  const savedArgs = JSON.stringify(profile.args, null, 2);

  useEffect(() => {
    if (dirty) return;
    setExecutable(profile.executable);
    setArgs(savedArgs);
    setAgentDir(profile.agentDir || '');
  }, [profile.executable, profile.agentDir, savedArgs, dirty]);

  const edit = () => {
    setDirty(true);
    setSaved(false);
    setError(null);
    setInvalid(null);
  };

  const save = async () => {
    if (inFlight.current) return;
    setError(null);
    setSaved(false);
    setInvalid(null);
    if (!executable.trim()) {
      setInvalid('executable');
      setError('请输入 Pi 或 Node 可执行文件的路径。');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every((value): value is string => typeof value === 'string')) {
        throw new Error('参数必须是仅包含字符串的 JSON 数组，例如 [] 或 ["C:/tools/pi.js"]。');
      }
    } catch (cause) {
      setInvalid('args');
      setError(`无法解析启动参数：${errorMessage(cause)}`);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await onSave({
        executable: executable.trim(),
        args: parsed as string[],
        ...(agentDir.trim() ? { agentDir: agentDir.trim() } : {}),
      });
      setExecutable(result.executable);
      setArgs(JSON.stringify(result.args, null, 2));
      setAgentDir(result.agentDir || '');
      setDirty(false);
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Badge variant="outline">兼容 Pi {PI_VERSION}</Badge>
        <p className="text-sm leading-relaxed text-muted-foreground">
          保存后新建会话，使用此配置启动独立 Pi 进程。可直接运行 Pi，或指定 Node 并在参数中填写 Pi 入口文件。
        </p>
      </div>
      <FieldGroup className="gap-4">
        <Field data-invalid={invalid === 'executable'} data-disabled={saving}>
          <FieldLabel htmlFor="pi-executable">Pi 可执行文件</FieldLabel>
          <Input
            id="pi-executable" value={executable} disabled={saving} autoComplete="off" spellCheck={false}
            onChange={(event) => { edit(); setExecutable(event.target.value); }}
            aria-invalid={invalid === 'executable'}
            aria-describedby={invalid === 'executable' ? 'profile-executable-error' : undefined}
          />
          {invalid === 'executable' && <FieldError id="profile-executable-error">{error}</FieldError>}
        </Field>
        <Field data-invalid={invalid === 'args'} data-disabled={saving}>
          <FieldLabel htmlFor="pi-args">Pi 参数（JSON 数组）</FieldLabel>
          <Textarea
            id="pi-args" value={args} disabled={saving} spellCheck={false} rows={4}
            className="max-h-48 min-h-24 resize-y"
            onChange={(event) => { edit(); setArgs(event.target.value); }}
            aria-invalid={invalid === 'args'}
            aria-describedby={invalid === 'args' ? 'profile-args-error' : 'profile-args-help'}
          />
          {invalid === 'args'
            ? <FieldError id="profile-args-error">{error}</FieldError>
            : <FieldDescription id="profile-args-help">每个参数独立为一个字符串；没有参数时填写 []。Windows 路径可使用正斜杠。</FieldDescription>}
        </Field>
        <Field data-disabled={saving}>
          <FieldLabel htmlFor="pi-agent-dir">Pi 配置目录</FieldLabel>
          <Input
            id="pi-agent-dir" value={agentDir} disabled={saving} autoComplete="off" spellCheck={false}
            placeholder="可选，留空使用 Pi 默认目录"
            onChange={(event) => { edit(); setAgentDir(event.target.value); }}
            aria-describedby="profile-dir-help"
          />
          <FieldDescription id="profile-dir-help">对应 PI_CODING_AGENT_DIR，用于 Pi 配置与认证。</FieldDescription>
        </Field>
        <Field>
          <Button type="submit" disabled={saving}>
            {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Save data-icon="inline-start" />}
            保存启动配置
          </Button>
        </Field>
      </FieldGroup>
      {error && !invalid && (
        <Alert variant="destructive">
          <AlertTitle>无法保存启动配置</AlertTitle>
          <AlertDescription className="break-words">{error} 请修改后重新保存。</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert role="status">
          <Check aria-hidden="true" />
          <AlertTitle>启动配置已保存</AlertTitle>
          <AlertDescription>点击左侧“新建会话”应用配置。Pi 版本与启动结果将在会话中显示。</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
