"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Names of the files that were just imported (for the confirmation copy). */
  fileNames: string[];
  /**
   * Close the notice. `dontShowAgain` reflects the checkbox at dismiss time —
   * when true the caller persists the "never show again" flag. Fired for every
   * dismiss path (button, ×, Escape, backdrop) so the checkbox is always honored.
   */
  onClose: (dontShowAgain: boolean) => void;
}

/**
 * First-time informational notice shown after a successful drag-and-drop file
 * import into the Library. Explains that the source landed in `unsorted/` and
 * will be indexed, and offers a "Don't show again" opt-out. Portaled to
 * document.body (fixed overlay) so it escapes the Library grid's overflow
 * clipping. Styling mirrors BibEditModal (the app's other Library modal).
 */
export default function PdfDropIntroDialog({ fileNames, onClose }: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Snapshot the checkbox in a ref so the Escape handler (bound once) reads the
  // live value at dismiss time without re-binding the listener each keystroke.
  const dontShowRef = useRef(dontShowAgain);
  dontShowRef.current = dontShowAgain;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(dontShowRef.current);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const count = fileNames.length;
  const label =
    count === 1 ? fileNames[0] : `${count} files`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="File added to your library"
      onClick={() => onClose(dontShowAgain)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "5vh 16px",
        zIndex: 200,
        overflow: "auto",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "var(--pod-border)",
          borderRadius: "var(--pod-radius)",
          boxShadow: "var(--pod-shadow)",
          width: "min(440px, 100%)",
          display: "flex",
          flexDirection: "column",
          outline: "none",
          padding: 20,
          gap: 14,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--foreground)",
            fontFamily: "var(--serif)",
          }}
        >
          Added to your library
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--muted)" }}>
          <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>
            {label}
          </strong>{" "}
          {count === 1 ? "was" : "were"} dropped into your library&rsquo;s
          intake. Virgil files new sources under <code>unsorted/</code> and
          indexes them shortly — they&rsquo;ll appear in the Central Library
          once processed.
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12.5,
            color: "var(--muted)",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          Don&rsquo;t show this again
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => onClose(dontShowAgain)}
            style={{
              padding: "6px 16px",
              borderRadius: "var(--radius-sm)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              color: "var(--surface)",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
