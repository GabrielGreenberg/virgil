/**
 * Per-doc "the .tex preamble/postamble on disk changed out from under the
 * code pane" notification.
 *
 * The code pane's CodeMirror bridge tracks the doc's preamble/postamble in a
 * closure seeded once from disk (CodeEditor mount). Two write paths replace
 * those bytes WITHOUT going through the bridge: the out-of-band rewrite door
 * (`rewriteTexOutOfBand` — style switch, documentclass swap, compile's class
 * prompt) and the external-change "Reload from disk" (disk-watcher
 * reloadFromDisk → useDocument.refetch). Each dispatches
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

// There is deliberately no PRE-write counterpart (task 1501 retired
// "tex-delimiters-will-change"): the out-of-band door drains the doc first, and
// the drain runs the code pane's `settle` flusher (task 559), which IS the
// bridge flush that event used to request.
