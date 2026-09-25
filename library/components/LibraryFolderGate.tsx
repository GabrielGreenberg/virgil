"use client";

// The ONE renderer for the Library folder's non-ready states (task 764).
// Every surface that mounts `useLibraryHandle` — the Library tab
// (`LibraryApp`) and a popped-out paper (`PaperOuterView`) — routes its
// loading / picker / permission / error states through here, so a failure
// the hook reports (`pickerError`, the `error` state) reaches a pixel on
// every surface instead of being dropped by whichever caller forgot the prop.

import type { ReactNode } from "react";
import type { useLibraryHandle } from "@library/hooks/useLibraryHandle";
import { FONT_SERIF } from "@/lib/font-stacks";
import LibraryFolderPicker from "./LibraryFolderPicker";
import LibraryPaneFill from "./LibraryPaneFill";
import LibraryPermissionGate from "./LibraryPermissionGate";

type LibraryHandleApi = ReturnType<typeof useLibraryHandle>;

interface Props {
  lib: LibraryHandleApi;
  /** Rendered once the folder is ready. */
  children: (handle: FileSystemDirectoryHandle) => ReactNode;
}

export default function LibraryFolderGate({ lib, children }: Props) {
  const { state } = lib;
  if (state.kind === "loading") {
    return (
      <LibraryPaneFill center style={{ color: "var(--muted)" }}>
        Loading…
      </LibraryPaneFill>
    );
  }
  if (state.kind === "none") {
    return <LibraryFolderPicker onPick={lib.pick} pickerError={lib.pickerError} />;
  }
  if (state.kind === "needs-permission") {
    return (
      <LibraryPermissionGate onGrant={lib.grant} onReset={lib.reset} pickerError={lib.pickerError} />
    );
  }
  if (state.kind === "error") {
    return (
      <LibraryPaneFill center style={{ gap: 12, padding: 32 }}>
        <h2 style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 500 }}>
          Couldn&apos;t open your library
        </h2>
        <p
          role="alert"
          style={{ color: "var(--danger-strong)", maxWidth: 460, textAlign: "center", margin: 0 }}
        >
          {state.message}
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => void lib.retry()}
            style={{
              background: "var(--accent)",
              color: "white",
              padding: "8px 16px",
              borderRadius: "var(--radius-md)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          <button
            onClick={() => void lib.reset()}
            style={{
              background: "transparent",
              color: "var(--muted)",
              padding: "8px 16px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-light)",
              cursor: "pointer",
            }}
          >
            Pick a different folder
          </button>
        </div>
      </LibraryPaneFill>
    );
  }
  return <>{children(state.handle)}</>;
}
