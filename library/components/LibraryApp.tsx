"use client";

// Top-level shim for the Library tab. Mounts the FSA state machine
// (handle picker → permission gate → view) and renders the appropriate
// child. Equivalent to virgil-library/src/components/App.tsx.

import { useLibraryHandle } from "@library/hooks/useLibraryHandle";
import LibraryFolderPicker from "./LibraryFolderPicker";
import LibraryPermissionGate from "./LibraryPermissionGate";
import LibraryView from "./LibraryView";

export default function LibraryApp() {
  const { state, pick, grant, reset, lastSync } = useLibraryHandle();

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

  if (state.kind === "none") return <LibraryFolderPicker onPick={pick} />;

  if (state.kind === "needs-permission") {
    return <LibraryPermissionGate onGrant={grant} onReset={reset} />;
  }

  return <LibraryView handle={state.handle} onReset={reset} lastSync={lastSync} />;
}
