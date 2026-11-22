/**
 * Pure sibling-list helpers for Outliner drag-and-drop.
 * Keeps index math out of the React component so it can be unit-tested.
 */

/** Final 0-based index after moving `fromIndex` to before/after `targetIndex`. */
export function dropIndexForSibling(
  fromIndex: number,
  targetIndex: number,
  place: "before" | "after",
): number {
  let to = place === "before" ? targetIndex : targetIndex + 1;
  if (fromIndex < to) to -= 1;
  return to;
}

/** Returns a new array with the item at `fromIndex` moved to `toIndex`. */
export function applySiblingReorder<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items.slice();
  }
  const next = items.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}
