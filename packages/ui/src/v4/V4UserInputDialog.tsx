import { useCallback, useState } from "react";
import {
  TID_V4_USER_INPUT_DIALOG,
  TID_V4_USER_INPUT_OPTION,
  TID_V4_USER_INPUT_TEXT,
  testId,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import type { V4UserInputViewModel } from "@/v4/pendingInteractionAdapter.js";

interface V4UserInputDialogProps {
  model: V4UserInputViewModel;
  onSubmit: (answer: { optionId?: string; freeText?: string; action?: "cancel" }) => Promise<boolean>;
}

/** v4 userInput 交互最小弹窗（竖切）。 */
export function V4UserInputDialog({ model, onSubmit }: V4UserInputDialogProps) {
  const [freeText, setFreeText] = useState(model.prefill ?? "");
  const [responding, setResponding] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = useCallback(async (answer: { optionId?: string; freeText?: string; action?: "cancel" }) => {
    if (responding) return;
    setResponding(true);
    setFailed(false);
    try {
      if (!await onSubmit(answer)) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setResponding(false);
    }
  }, [onSubmit, responding]);

  const handleOption = useCallback(
    (optionId: string) => {
      void submit({ optionId });
    },
    [submit],
  );

  const handleFreeTextSubmit = useCallback(() => {
    // Pi input and editor accept an empty string. Trim only legacy free-text
    // elicitation, which historically requires a nonempty answer.
    const value = model.method ? freeText : freeText.trim();
    if (!value && model.freeText && !model.method) return;
    void submit(model.freeText ? { freeText: value } : { optionId: model.options[0]?.optionId });
  }, [freeText, model.freeText, model.method, model.options, submit]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      data-testid={TID_V4_USER_INPUT_DIALOG}
    >
      <div role="dialog" aria-modal="true" aria-label={model.prompt}
        className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg">
        <p className="mb-3 text-ui-base text-[var(--color-foreground)]">{model.prompt}</p>
        {model.message ? <p className="mb-3 text-ui-sm text-[var(--color-muted-foreground)]">{model.message}</p> : null}
        {model.options.length > 0 ? (
          <div className="mb-3 flex flex-col gap-2">
            {model.options.map((option) => (
              <Button
                key={option.optionId}
                type="button"
                variant="outline"
                data-testid={testId(TID_V4_USER_INPUT_OPTION, option.optionId)}
                disabled={responding}
                onClick={() => handleOption(option.optionId)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        ) : null}
        {model.freeText ? (
          <div className="flex flex-col gap-2">
            {model.method === "editor" ? <Textarea
              value={freeText}
              onChange={(event) => setFreeText(event.target.value)}
              data-testid={TID_V4_USER_INPUT_TEXT}
              rows={8}
              disabled={responding}
            /> : <Input
              type={model.sensitive ? "password" : "text"}
              value={freeText}
              onChange={(event) => setFreeText(event.target.value)}
              placeholder={model.placeholder}
              data-testid={TID_V4_USER_INPUT_TEXT}
              disabled={responding}
            />}
            <Button type="button" onClick={handleFreeTextSubmit} disabled={responding}>
              提交
            </Button>
          </div>
        ) : null}
        {model.method ? <Button type="button" variant="ghost" disabled={responding}
          onClick={() => { void submit({ action: "cancel" }); }}>取消</Button> : null}
        {failed ? <p role="alert" className="text-ui-sm text-[var(--color-destructive)]">
          回答未被 Pi 接收，请重试或取消。
        </p> : null}
      </div>
    </div>
  );
}
