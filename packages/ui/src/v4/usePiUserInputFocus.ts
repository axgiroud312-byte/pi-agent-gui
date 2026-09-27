import { useCallback, useEffect, useRef } from "react";
import { TID_V4_USER_INPUT_DIALOG } from "@zcode/shared";

const openModalSelector = `[data-testid="${TID_V4_USER_INPUT_DIALOG}"], [role="dialog"][aria-modal="true"], [data-slot="dialog-content"][data-state="open"]`;

function usableFocusTarget(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element?.isConnected &&
    element.getClientRects().length > 0 &&
    !element.matches(':disabled, [aria-disabled="true"]') &&
    !element.closest("[inert]") &&
    (element.dataset.testid !== "v4-composer-input" ||
      element.getAttribute("contenteditable") === "true"),
  );
}

function firstUsable(selector: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find(usableFocusTarget) ?? null
  );
}

function returnFocusTarget(origin: HTMLElement | null): HTMLElement | null {
  if (usableFocusTarget(origin)) return origin;
  // Pi may settle an extension command with no run. The native composer then
  // becomes contenteditable=false; focus an available native control instead.
  return (
    firstUsable('[data-testid="v4-composer-input"]') ??
    firstUsable('[data-testid="chat-model-select-trigger"]') ??
    firstUsable('[data-testid="pi-tree-open"]')
  );
}

/** Keep one focus origin across a fixed Pi extension's consecutive UI prompts. */
export function usePiUserInputFocus(hasPendingInteraction: boolean) {
  const originRef = useRef<HTMLElement | null>(null);
  const restoreIntentRef = useRef(false);
  const interactionGenerationRef = useRef(0);
  const pendingRef = useRef(hasPendingInteraction);
  const capture = useCallback(() => {
    interactionGenerationRef.current += 1;
    restoreIntentRef.current = true;
    if (originRef.current?.isConnected) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !active.closest(`[data-testid="${TID_V4_USER_INPUT_DIALOG}"]`)
    ) {
      originRef.current = active;
      return;
    }
    originRef.current = firstUsable('[data-testid="v4-composer-input"]');
  }, []);
  const restore = useCallback(() => {
    if (!restoreIntentRef.current) return;
    const interactionGeneration = interactionGenerationRef.current;
    let frames = 0;
    const attempt = () => {
      if (!restoreIntentRef.current || interactionGenerationRef.current !== interactionGeneration) {
        return;
      }
      if (pendingRef.current) return;
      if (document.querySelector(openModalSelector)) {
        if (frames++ < 120) requestAnimationFrame(attempt);
        return;
      }
      const target = returnFocusTarget(originRef.current);
      if (!target) {
        if (frames++ < 120) requestAnimationFrame(attempt);
        return;
      }
      target.focus({ preventScroll: true });
      if (document.activeElement !== target) {
        if (frames++ < 120) requestAnimationFrame(attempt);
        return;
      }
      originRef.current = null;
      restoreIntentRef.current = false;
      // The final Pi snapshot can disable the composer shortly after the dialog
      // closes. Recover once if that rerender drops focus back to BODY. Never
      // override focus that the user moved to another control or a new dialog.
      window.setTimeout(() => {
        if (
          interactionGenerationRef.current !== interactionGeneration ||
          pendingRef.current ||
          document.activeElement !== document.body ||
          document.querySelector(openModalSelector)
        ) {
          return;
        }
        returnFocusTarget(null)?.focus({ preventScroll: true });
      }, 600);
    };
    requestAnimationFrame(attempt);
  }, []);
  useEffect(() => {
    pendingRef.current = hasPendingInteraction;
    if (!hasPendingInteraction) restore();
  }, [hasPendingInteraction, restore]);
  return { capture, restore };
}
