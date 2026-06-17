"use client";

// Top-level shim for the Library tab. Mounts the FSA state machine
// (handle picker → permission gate → view) and renders the appropriate
// child. Equivalent to virgil-library/src/components/App.tsx.

import type { ReactNode } from "react";
import { useLibraryHandle } from "@library/hooks/useLibraryHandle";
import type { UseLibraryTabsOptions } from "@library/hooks/useLibraryTabs";
import LibraryFolderPicker from "./LibraryFolderPicker";
import LibraryPermissionGate from "./LibraryPermissionGate";
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

export default function LibraryApp({ tabsOptions, showNavigator, belowNavigator }: Props = {}) {
  const { state, pick, grant, reset, lastSync, pickerError, syncError, resyncSkills, dismissSyncError } =
    useLibraryHandle();

  if (state.kind === "loading") {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        Loading…
      </div>
    );
  }

  if (state.kind === "none") return <LibraryFolderPicker onPick={pick} pickerError={pickerError} />;

  if (state.kind === "needs-permission") {
    return <LibraryPermissionGate onGrant={grant} onReset={reset} pickerError={pickerError} />;
  }

  return (
    <LibraryView
      handle={state.handle}
      onReset={reset}
      lastSync={lastSync}
      syncError={syncError}
      onResync={resyncSkills}
      onDismissSyncError={dismissSyncError}
      tabsOptions={tabsOptions}
      showNavigator={showNavigator}
      belowNavigator={belowNavigator}
    />
  );
}
