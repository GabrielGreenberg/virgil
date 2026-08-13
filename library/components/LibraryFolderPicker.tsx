"use client";

import LibraryPaneFill from "./LibraryPaneFill";
import { FONT_MONO, FONT_SERIF } from "@/lib/font-stacks";

interface Props {
  onPick: () => void;
  /** Latest picker-flow error (e.g. Chrome's "file picker already
   *  active" lock). When non-null, surfaced as a small red message
   *  under the button so the user knows the click wasn't ignored. */
  pickerError?: string | null;
}

export default function LibraryFolderPicker({ onPick, pickerError }: Props) {
  return (
    <LibraryPaneFill center style={{ gap: 16, padding: 32 }}>
      <h1 style={{ fontFamily: FONT_SERIF, fontSize: 32, fontWeight: 500 }}>
        Virgil Library
      </h1>
      <p style={{ color: "var(--muted)", maxWidth: 480, textAlign: "center" }}>
        Pick a folder to use as your library root. The recommended location is{" "}
        <code style={{ fontFamily: FONT_MONO }}>~/Virgil-Library/</code>.
        Virgil Library will create <code>master.bib</code>, the <code>papers/</code> and
        {" "}<code>unsorted/</code> folders, plus hidden <code>.claude/</code> and
        {" "}<code>.virgil/</code> folders for skill commands and runtime state.
      </p>
      <button
        onClick={onPick}
        style={{
          background: "var(--accent)",
          color: "white",
          padding: "10px 18px",
          borderRadius: "var(--radius-md)",
          border: "none",
          fontSize: 14,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        Choose library folder…
      </button>
      {pickerError ? (
        <p
          role="alert"
          style={{
            color: "var(--danger-strong)",
            maxWidth: 480,
            textAlign: "center",
            fontSize: 13,
            lineHeight: 1.4,
            margin: 0,
          }}
        >
          {pickerError}
        </p>
      ) : null}
    </LibraryPaneFill>
  );
}
