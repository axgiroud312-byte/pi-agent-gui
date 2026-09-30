import { PI_RUNTIME_SETTINGS_FIELDS, parsePiRuntimeSettings, readPiRuntimeSetting,
  updatePiRuntimeSetting } from "./piRuntimeSettingsFields.js";
import { Input } from "@/components/ui/input.js";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { SettingsGroupCard, SettingsRow } from "./SettingsPageParts.js";

const INHERIT = "__pi_inherit__";

export function PiRuntimeSettingsForm({ text, scope, disabled, onChange, onError }: {
  text: string;
  scope: "user" | "project";
  disabled: boolean;
  onChange: (text: string) => void;
  onError: (message: string) => void;
}) {
  let document: Record<string, unknown>;
  try { document = parsePiRuntimeSettings(text); }
  catch { return <p className="text-sm text-muted-foreground">请先修复下方 JSON，再使用表单；不会用默认值覆盖原配置。</p>; }
  const change = (path: string, value: string | number | boolean | undefined) => {
    try { onChange(updatePiRuntimeSetting(text, path, value)); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return <details data-testid="pi-runtime-fields" className="rounded-md border border-border p-3 text-sm">
    <summary className="cursor-pointer font-medium">常用 Pi 配置</summary>
    <p className="my-3 text-xs text-muted-foreground">这些字段直接编辑下方同一份 Pi settings.json。修改后点击“保存 Pi 设置”；空白或“遵循 Pi”移除当前作用域覆盖，不写入另一套桌面配置。</p>
    <SettingsGroupCard>
      {PI_RUNTIME_SETTINGS_FIELDS.map(field => {
        const raw = readPiRuntimeSetting(document, field.path);
        const unsupportedScope = scope === "project" && field.globalOnly;
        const invalid = raw !== undefined && (field.kind === "boolean" ? typeof raw !== "boolean" :
          field.kind === "number" ? typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 : typeof raw !== "string" ||
          field.kind === "enum" && !field.options?.includes(raw));
        const value = raw === undefined || invalid ? "" : String(raw);
        const locked = disabled || unsupportedScope || invalid;
        const id = `pi-runtime-${field.path}`;
        const props = { id, "data-testid": id, "aria-label": field.label, "aria-invalid": invalid,
          disabled: locked, className: "w-full min-w-0" };
        return <SettingsRow key={field.path} controlLayout="wide"
          label={<label htmlFor={id}>{field.label}{field.globalOnly ? "（仅用户设置）" : ""}</label>}
          description={<>
            <code>{field.path}</code>
            {invalid ? <p className="text-destructive">原配置值不符合此表单类型；请在 JSON 中修复，表单不会覆盖。</p> : null}
            {unsupportedScope ? <p>Pi 不读取此项的项目覆盖，请切换到用户设置。</p> : null}
          </>}
          control={field.kind === "boolean" || field.kind === "enum" ?
            <Select value={value || INHERIT} disabled={locked} onValueChange={next => {
              change(field.path, next === INHERIT ? undefined : field.kind === "boolean" ? next === "true" : next);
            }}>
              <SelectTrigger {...props} size="lg"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={INHERIT}>遵循 Pi 默认 / 上层配置</SelectItem>
                {(field.kind === "boolean" ? ["true", "false"] : field.options ?? []).map(option =>
                  <SelectItem key={option} value={option}>{option === "true" ? "开启" : option === "false" ? "关闭" : option}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select> : <Input {...props} size="lg" value={value} type={field.kind === "number" ? "number" : "text"} min={0} step={1}
              placeholder="未配置：遵循 Pi 默认 / 上层配置" onChange={event => {
                const next = event.target.value;
                change(field.path, next === "" ? undefined : field.kind === "number" ? Number(next) : next);
              }} />}
        />;
      })}
    </SettingsGroupCard>
  </details>;
}
