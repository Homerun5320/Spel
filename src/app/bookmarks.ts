// The bookmarks as the Dev panel and the test hooks reach them (M08): the page that owns the globe connects its handler, the Dev panel
// modes (`registerAppModes`) call `goToBookmark`. Without a page (or before the globe exists) a bookmark does nothing.
import type { BookmarkName } from '../render/views';

export type BookmarkHandler = (name: BookmarkName) => boolean;

let handler: BookmarkHandler | null = null;

/** The scene connects (and, when it stops, disconnects with null) the function that flies to a bookmark. */
export function setBookmarkHandler(fn: BookmarkHandler | null): void {
  handler = fn;
}

/** Flies to a bookmark; false when no scene is connected or the bookmark has no place yet (`capital` before the match exists). */
export function goToBookmark(name: BookmarkName): boolean {
  return handler === null ? false : handler(name);
}
