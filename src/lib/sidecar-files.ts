// The set of `virgil/` sidecar files a document mount reads — one
// `usePersistentState` hook per file. Shared by both storage backends so the
// sidecar-bundle read (one directory acquire + a parallel batch) covers exactly
// the files the mount will request. A file missing from this list still works
// (the cache-first reader falls through to a direct disk read) — it just isn't
// coalesced.
//
// DERIVED since task 363, not hand-kept: this was a second array beside the
// value table, and the two had already drifted — the three files the Dropbox
// conflict storm was made of (`editor-state.json`, `virgil.json`, `collab.json`)
// were in NEITHER list, so nothing in the codebase named the complete set of
// files Virgil writes into `virgil/`. Declare a new sidecar in
// [sidecar-value.ts](sidecar-value.ts) with `mount: true` and it appears here.
export { MOUNT_SIDECAR_FILENAMES as ALL_SIDECAR_FILENAMES } from "@/lib/sidecar-value";
