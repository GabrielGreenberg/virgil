import { useEffect } from "react";

/**
 * `virgil-open-library` — dispatched by bibliography / citation UI when
 * the user clicks a library-status chip. Switches the current doc's
 * shadow tab into its Library pane. LibraryTabView has its own
 * listener on the same event for the scroll-into-view behaviour.
 */
export function useLibraryBridge(deps: {
  currentDocId: string | null;
  activateLibraryPane: (docId: string) => void;
}) {
  const { currentDocId, activateLibraryPane } = deps;
  useEffect(() => {
    const handler = () => {
      if (currentDocId) activateLibraryPane(currentDocId);
    };
    window.addEventListener("virgil-open-library", handler);
    return () => window.removeEventListener("virgil-open-library", handler);
  }, [currentDocId, activateLibraryPane]);
}
