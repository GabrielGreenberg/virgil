import { useEffect } from "react";
import { OUTER_LIBRARY_ROOT_ID } from "@/lib/doc-index";

/**
 * `virgil-open-library` — dispatched by bibliography / citation UI when
 * the user clicks a library-status chip. Activates the singleton
 * Library outer tab pinned at index 0 of the Virgil bar. LibraryTabView
 * has its own listener on the same event for the scroll-into-view
 * behaviour.
 */
export function useLibraryBridge(deps: {
  activateLibraryOuterPane: (libId: string) => void;
}) {
  const { activateLibraryOuterPane } = deps;
  useEffect(() => {
    const handler = () => {
      activateLibraryOuterPane(OUTER_LIBRARY_ROOT_ID);
    };
    window.addEventListener("virgil-open-library", handler);
    return () => window.removeEventListener("virgil-open-library", handler);
  }, [activateLibraryOuterPane]);
}
