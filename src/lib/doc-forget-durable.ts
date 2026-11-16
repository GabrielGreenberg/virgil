/**
 * DOC FORGET — the BROWSER-STORAGE half (task 1645).
 *
 * `registerDocForget` (doc-forget.ts) is registered at module scope, beside the
 * map it forgets, and that is sound for an IN-MEMORY map: a module never
 * imported this session holds nothing. It is NOT sound for a store whose state
 * lives in `localStorage` / `sessionStorage`: the state outlives the page, so a
 * page that never mounted the Outline panel still carries the discarded
 * paper's folds — and "Reset example", which re-seeds under the SAME fixed id
 * with the same seed block uuids, reopened the pristine paper with them.
 *
 * So `purgeDoc` loads THIS module before it runs the forgets. Importing it
 * imports every module whose browser-storage state is keyed by a document id,
 * and each one's own `registerDocForget` (beside its own reader and writer)
 * then runs whether or not its UI ever mounted. The import is dynamic, at
 * purge time, so `doc-index` takes on none of these modules' graphs (the view
 * prefs pull the panel registry) and no import cycle can form.
 *
 * Which modules belong here is not this list's say: `doc-forget-census.test.ts`
 * classifies EVERY production module that touches `localStorage` /
 * `sessionStorage` — listed here (and registering a forget), or excluded there
 * with the reason its storage is not per-document.
 */

import "@/panels/Outline/outline-prefs-store";
import "@/lib/collab-session";
import "@/hooks/useViewPrefs";

export {};
