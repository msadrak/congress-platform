/**
 * Roving-focus keyboard model shared by SegmentedControl (radiogroup) and the RowActions menu.
 * Returns the index to move to, or null when the key is not a navigation key.
 *
 * - `horizontal` (segmented control): ArrowRight/ArrowLeft follow the visual order, so in RTL ArrowLeft
 *   moves to the next item; ArrowDown/ArrowUp always move next/previous.
 * - `vertical` (menu): only ArrowDown/ArrowUp.
 * Home/End jump to the first/last enabled item. Movement wraps and skips disabled items.
 */
export function rovingTarget({
  key,
  index,
  disabled,
  rtl = false,
  orientation = "horizontal",
}: {
  key: string;
  index: number;
  /** One flag per item. */
  disabled: readonly boolean[];
  rtl?: boolean;
  orientation?: "horizontal" | "vertical";
}): number | null {
  const count = disabled.length;
  if (count === 0) return null;
  let step: 1 | -1 | null = null;
  let from = index;
  switch (key) {
    case "ArrowDown":
      step = 1;
      break;
    case "ArrowUp":
      step = -1;
      break;
    case "ArrowRight":
      if (orientation === "horizontal") step = rtl ? -1 : 1;
      break;
    case "ArrowLeft":
      if (orientation === "horizontal") step = rtl ? 1 : -1;
      break;
    case "Home":
      step = 1;
      from = -1;
      break;
    case "End":
      step = -1;
      from = count;
      break;
  }
  if (step === null) return null;
  for (let i = 1; i <= count; i++) {
    const candidate = (((from + step * i) % count) + count) % count;
    if (!disabled[candidate]) return candidate;
  }
  return null;
}
