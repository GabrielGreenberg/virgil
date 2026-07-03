/**
 * Per-doc "the .tex preamble/postamble on disk changed out from under the
 * code pane" notification.
 *
 * The code pane's CodeMirror bridge tracks the doc's preamble/postamble in a
 * closure seeded once from disk (CodeEditor mount). Two write paths replace
 * those bytes WITHOUT going through the bridge: a style switch
 * (useDocumentStyle.setStyle → writeTex) and the external-change "Reload from
 * disk" (disk-watcher reloadFromDisk → useDocument.refetch). Each dispatches
 * this event after its write/reload settles; an open CodeEditor listens,
 * re-reads the disk delimiters, and resyncs the bridge via `setDelimiters`.
 * No code pane open → nobody listens → free no-op.
 *
 * Deliberately NOT dispatched by writeDocBundle itself: the autosave's
 * serialized .tex is derived FROM the bridge's own closure (or from the
 * delimiters it just persisted), so echoing it back would be a self-notify.
 */
export const TEX_DELIMITERS_CHANGED_EVENT = "virgil:tex-delimiters-changed";

export interface TexDelimitersChangedDetail {
  docId: string;
}

export function dispatchTexDelimitersChanged(docId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TexDelimitersChangedDetail>(TEX_DELIMITERS_CHANGED_EVENT, {
      detail: { docId },
    }),
  );
}

/**
 * Pre-write counterpart: "I'm ABOUT to replace the on-disk preamble —
 * commit anything you're still debouncing." Dispatched by
 * useDocumentStyle.setStyle BEFORE it reads/rewrites the .tex; an open
 * CodeEditor responds by flushing its bridge synchronously (firing the
 * pending code→TipTap debounce, and with it any un-persisted delimiter
 * edit), so the style path's drainDoc can land that write FIRST. Without
 * this, a code-pane preamble edit sitting in the bridge's 600 ms debounce
 * can fire MID-setStyle and its delimiters-override bundle write races the
 * style's writeTex — landing last would silently undo the style switch.
 * No code pane open → nobody listens → free no-op.
 */
export const TEX_DELIMITERS_WILL_CHANGE_EVENT =
  "virgil:tex-delimiters-will-change";

export function dispatchTexDelimitersWillChange(docId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TexDelimitersChangedDetail>(
      TEX_DELIMITERS_WILL_CHANGE_EVENT,
      { detail: { docId } },
    ),
  );
}
