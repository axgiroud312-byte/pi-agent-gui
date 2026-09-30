import type { IZCodeAgentService } from "@zcode/services";
import { PiAuthSection } from "./PiAuthSection.js";
import { PiSettingsSection } from "./PiSettingsSection.js";

export function PiModelSettingsSection({ service, workspacePath, initialProviderId }: {
  service: IZCodeAgentService; workspacePath: string; initialProviderId?: string;
}) {
  return <div className="flex flex-col gap-6" data-testid="pi-model-settings-section">
    <PiAuthSection service={service} workspacePath={workspacePath} initialProviderId={initialProviderId} />
    <details>
      <summary className="cursor-pointer text-ui-base font-medium">高级 Pi 设置（用户 / 项目）</summary>
      <div className="mt-4"><PiSettingsSection workspacePath={workspacePath} /></div>
    </details>
  </div>;
}
