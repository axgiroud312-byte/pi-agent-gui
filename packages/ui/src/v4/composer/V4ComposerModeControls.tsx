import { memo } from "react";
import { ShieldAlertIcon } from "lucide-react";
import { TID_CHAT_MODE_SELECT_TRIGGER } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { V4ComposerToolbarProps } from "@/v4/composer/V4ComposerToolbar.js";

/**
 * The Pi desktop product has no per-file approval or ZCode execution modes.
 * Retain the native toolbar position, but never offer a selectable permission
 * that the Pi RPC boundary cannot enforce. The fixed original ZCode reference
 * is run from its separate upstream archive, not this product component.
 */
function V4ComposerModeSwitchImpl({ disabled }: Pick<
  V4ComposerToolbarProps,
  | "workspacePath"
  | "workspaceIdentity"
  | "provider"
  | "draftConfig"
  | "disabled"
  | "activeConfigPicker"
  | "onConfigPickerOpenChange"
  | "onSwitchMode"
>) {
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: "pi.mode.directTools" });
  return (
    <ControlHintTooltip
      title={label}
      description={intl.formatMessage({ id: "pi.mode.noApproval" })}
    >
      <span
        role="status"
        data-testid={TID_CHAT_MODE_SELECT_TRIGGER}
        data-composer-collapse-priority="0"
        aria-label={label}
        className={cn(
          "group/mode inline-flex size-7 items-center justify-center gap-1 rounded-lg p-0 text-ui-base @xl/composer:w-auto @xl/composer:px-2 data-[composer-compact=true]:w-7 data-[composer-compact=true]:px-0",
          disabled && "opacity-50",
        )}
      >
        <ShieldAlertIcon className="size-4" />
        <span className="hidden @xl/composer:inline group-data-[composer-compact=true]/mode:hidden">
          {label}
        </span>
      </span>
    </ControlHintTooltip>
  );
}

export const V4ComposerModeSwitch = memo(V4ComposerModeSwitchImpl);
