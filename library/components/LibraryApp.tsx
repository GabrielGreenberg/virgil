"use client";

// Top-level shim for the Library tab. Mounts the FSA state machine
// (handle picker → permission gate → view) and renders the appropriate
// child. Equivalent to virgil-library/src/components/App.tsx.

import type { ReactNode } from "react";
import { useLibraryHandle } from "@library/hooks/useLibraryHandle";
import type { UseLibraryTabsOptions } from "@library/hooks/useLibraryTabs";
import LibraryFolderGate from "./LibraryFolderGate";
import LibraryView from "./LibraryView";

interface Props {
  /** Optional scope/seed for the inner `useLibraryTabs`. Passed through
   *  by library outer tabs so each one has its own panel state. */
  tabsOptions?: UseLibraryTabsOptions;
  /** Forward to LibraryView. Defaults to true; tear-out outer-tab callers
   *  pass false to render the focused 2-column layout. */
  showNavigator?: boolean;
  /** Slot rendered as a sibling pod beneath the LibrariesNavigator. */
  belowNavigator?: ReactNode;
}

export default function LibraryApp({
  tabsOptions,
  showNavigator,
  belowNavigator,
}: Props = {}) {
  const lib = useLibraryHandle();
  const { lastSync, syncError, resyncSkills, dismissSyncError, reset } = lib;

  return (
    <LibraryFolderGate lib={lib}>
      {(handle) => (
        <LibraryView
          handle={handle}
          onReset={reset}
          lastSync={lastSync}
          syncError={syncError}
          onResync={resyncSkills}
          onDismissSyncError={dismissSyncError}
          tabsOptions={tabsOptions}
          showNavigator={showNavigator}
          belowNavigator={belowNavigator}
        />
      )}
    </LibraryFolderGate>
  );
}
