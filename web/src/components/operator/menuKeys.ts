/**
 * Roving focus inside the operator ⋮ menu (WAI-ARIA menu button pattern): the item to focus after `key`, or null
 * when the key does not move focus. Vertical list, so the reading direction does not change the arrows.
 */
export function menuFocusIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
    case "PageUp":
      return 0;
    case "End":
    case "PageDown":
      return count - 1;
    default:
      return null;
  }
}
