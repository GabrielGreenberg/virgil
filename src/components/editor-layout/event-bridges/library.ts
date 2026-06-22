import { useEffect } from "react";
import { OUTER_LIBRARY_ROOT_ID } from "@/lib/doc-index";
import {
  OPEN_LIBRARY_EVENT,
  type OpenLibraryEventDetail,
} from "@/components/library/open-library-entry";

/**
 * `virgil-open-library` — dispatched by bibliography / citation UI to open a
 * library entry. Routes by `detail.target`:
 *
 *   - `"tab"`     → open the entry's paper as a NEW outer Virgil-bar tab
 *                   (`openPaperTab` → `PaperOuterView`), "as if opened from
 *                   the library tab".
 *   - `"library"` (default) → activate the singleton Library outer tab pinned
 *                   at index 0; `LibraryView` has its own listener on the same
 *                   event that selects + opens the entry inside the tab.
 */
export function useLibraryBridge(deps: {
  activateLibraryOuterPane: (libId: string) => void;
  openPaperTab: (citekey: string, dropIndex?: number) => void;
}) {
  const { activateLibraryOuterPane, openPaperTab } = deps;
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenLibraryEventDetail>).detail;
      if (detail?.target === "tab" && detail.citekey) {
        openPaperTab(detail.citekey);
        return;
      }
      activateLibraryOuterPane(OUTER_LIBRARY_ROOT_ID);
    };
    window.addEventListener(OPEN_LIBRARY_EVENT, handler);
    return () => window.removeEventListener(OPEN_LIBRARY_EVENT, handler);
  }, [activateLibraryOuterPane, openPaperTab]);
}
