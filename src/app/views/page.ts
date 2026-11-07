/** Shared list pagination, independent of any entity view. */

/**
 * The `offset`-th window of `items`; `total` counts the whole list and `next_offset` names the offset just past the
 * window, or `null` once it reaches the end. A zero limit returns no items and names the same offset again.
 */
export const page = <T>(items: T[], offset: number, limit: number) => ({ items: items.slice(offset, offset + limit), total: items.length, next_offset: offset + limit < items.length ? offset + limit : null })
