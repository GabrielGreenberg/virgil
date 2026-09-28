"use client";

import LibraryPaneFill from "./LibraryPaneFill";
import { Button } from "@/components/Button";
import { FONT_SERIF } from "@/lib/font-stacks";

interface Props {
  onGrant: () => void;
  onReset: () => void;
  /** Latest picker-flow error (e.g. Chrome's "permission prompt
   *  already active" lock). Surfaced under the buttons. */
  pickerError?: string | null;
}

export default function LibraryPermissionGate({ onGrant, onReset, pickerError }: Props) {
  return (
    <LibraryPaneFill center style={{ gap: 12, padding: 32 }}>
      <h2 style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 500 }}>
        Permission needed
      </h2>
      <p style={{ color: "var(--muted)", maxWidth: 460, textAlign: "center" }}>
        Browsers reset File System Access permissions on every reload. Click below
        to re-grant access to your library folder.
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <Button variant="primary" onClick={onGrant}>
          Grant access
        </Button>
        <Button variant="secondary" onClick={onReset}>
          Pick a different folder
        </Button>
      </div>
      {pickerError ? (
        <p
          role="alert"
          style={{
            color: "var(--danger-strong)",
            maxWidth: 460,
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
