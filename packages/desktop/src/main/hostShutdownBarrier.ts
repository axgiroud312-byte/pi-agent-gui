/** Main has no ownership proof for Host's Pi grandchildren. Timeout is diagnostic
 * only: the app-quit barrier must wait for Host's actual exit. */
export function waitForHostOwnerExit(
  child: { once(event: 'exit', listener: () => void): unknown; pid?: number },
  label: string,
  waitTimeoutMs: number,
  warn: (message: string) => void,
): Promise<void> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    child.once('exit', () => {
      if (timer) clearTimeout(timer);
      resolve();
    });
    if (waitTimeoutMs > 0) {
      timer = setTimeout(() => warn(
        `[disposeHostProcessAndWait] host process exit wait exceeded budget (${label}), pid=${child.pid ?? 'unknown'}; refusing to abandon owner`,
      ), waitTimeoutMs);
      timer.unref?.();
    }
  });
}
