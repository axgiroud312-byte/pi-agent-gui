import type { SessionUsageState } from "@zcode/shared/zcode-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import type { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function PiSessionUsagePopover({
  usage,
  intl,
  locale,
}: {
  usage: SessionUsageState;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
  locale: string;
}) {
  const count = new Intl.NumberFormat(locale);
  const cost = usage.cumulative.costUSD;
  const context = usage.contextWindow;
  const rows = [
    ["chat.piSessionUsage.input", usage.cumulative.inputTokens],
    ["chat.piSessionUsage.output", usage.cumulative.outputTokens],
    ["chat.piSessionUsage.cacheRead", usage.cumulative.cacheReadTokens],
    ["chat.piSessionUsage.cacheWrite", usage.cumulative.cacheWriteTokens],
  ] as const;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-1.5 text-ui-xs text-foreground-subtle"
          data-testid="pi-session-usage-trigger"
        >
          {intl.formatMessage({ id: "chat.piSessionUsage.trigger" })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-72 gap-2" data-testid="pi-session-usage-panel">
        <h2 className="text-ui-sm font-medium">{intl.formatMessage({ id: "chat.piSessionUsage.trigger" })}</h2>
        <div className="flex justify-between gap-3 text-ui-sm">
          <span className="text-foreground-subtle">{intl.formatMessage({ id: "chat.piSessionUsage.current" })}</span>
          <span data-testid="pi-effective-context" className="font-mono tabular-nums">
            {context
              ? `${count.format(context.usedTokens)} / ${count.format(context.maxTokens)}`
              : intl.formatMessage({ id: "chat.contextUsage.piUnknown" })}
          </span>
        </div>
        <div className="border-t border-border pt-2 text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "chat.piSessionUsage.cumulative" })}
        </div>
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-ui-sm" data-pi-usage-key={label}>
            <span className="text-foreground-subtle">{intl.formatMessage({ id: label })}</span>
            <span className="font-mono tabular-nums">{count.format(value)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-border pt-2 text-ui-sm">
          <span className="text-foreground-subtle">{intl.formatMessage({ id: "chat.piSessionUsage.cost" })}</span>
          <span className="font-mono tabular-nums" data-testid="pi-session-cost">
            {cost === undefined
              ? intl.formatMessage({ id: "chat.piSessionUsage.costUnknown" })
              : new Intl.NumberFormat(locale, {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 4,
              }).format(cost)}
          </span>
        </div>
        <p className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: cost === undefined
            ? "chat.piSessionUsage.costUnknownDetail" : "chat.piSessionUsage.costDetail" })}
        </p>
      </PopoverContent>
    </Popover>
  );
}
