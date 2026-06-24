// The complete set of `virgil/` sidecar files a document mount reads — one
// `usePersistentState` hook per file. Shared by both storage backends so the
// sidecar-bundle read (one directory acquire + a parallel batch) covers exactly
// the files the mount will request. A file missing from this list still works
// (the cache-first reader falls through to a direct disk read) — it just isn't
// coalesced, so keep this in sync when adding a sidecar-backed panel.
export const ALL_SIDECAR_FILENAMES: readonly string[] = [
  "ai-requests.json",
  "annotations.json",
  "archive.json",
  "bib-review-requests.json",
  "bib-settings.json",
  "citations.json",
  "cutter.json",
  "document-settings.json",
  "examples.json",
  "focus.json",
  "footnotes.json",
  "notes.json",
  "orphaned-footnotes.json",
  "reports.json",
  "revisions.json",
  "suggestions.json",
  "todos.json",
];
