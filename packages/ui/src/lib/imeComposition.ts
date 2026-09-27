export function isImeComposingKeyEvent(event: {
  compositionActive?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
  key?: string;
  keyCode?: number;
  compositionEndAt?: number | null;
  timeStamp?: number;
}): boolean {
  if (
    event.compositionActive ||
    event.isComposing ||
    event.nativeEvent?.isComposing ||
    event.keyCode === 229 ||
    event.key === "Process" ||
    event.key === "Dead"
  ) {
    return true;
  }
  // Some Windows IMEs report the candidate-confirmation Enter after compositionend,
  // with isComposing already false. Swallow only that immediate Enter; a second
  // deliberate press and cursor/navigation keys remain available.
  return (
    event.key === "Enter" &&
    event.compositionEndAt != null &&
    event.timeStamp != null &&
    event.timeStamp >= event.compositionEndAt &&
    event.timeStamp - event.compositionEndAt <= 75
  );
}
