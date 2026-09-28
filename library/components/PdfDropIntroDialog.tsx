"use client";

import { useId, useState } from "react";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "@/components/system-dialog";

interface Props {
  /** Names of the files that were just imported (for the confirmation copy). */
  fileNames: string[];
  /**
   * Close the notice. `dontShowAgain` reflects the checkbox at dismiss time —
   * when true the caller persists the "never show again" flag. Fired for every
   * dismiss path (button, Escape, backdrop) so the checkbox is always honored.
   */
  onClose: (dontShowAgain: boolean) => void;
}

/**
 * First-time informational notice shown after a successful drag-and-drop file
 * import into the Library. Explains that the source landed in `unsorted/` and
 * will be indexed, and offers a "Don't show again" opt-out.
 *
 * Mounted on `SystemDialog` (task 820) — the shell owns the portal, scrim,
 * Escape, backdrop, radius tier and focus return, exactly as for every other
 * modal. A dismissal costs nothing here (`dismissIsFree`): the only state is
 * the checkbox, and every path reports it — the shell's dismissals call the
 * same `close` the button does.
 */
export default function PdfDropIntroDialog({ fileNames, onClose }: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const titleId = useId();
  // Every path reports the checkbox AT dismiss time: the shell re-reads
  // `onClose` after each commit, so this closure is always the latest render's.
  const close = () => onClose(dontShowAgain);

  const count = fileNames.length;
  const label =
    count === 1 ? fileNames[0] : `${count} files`;

  return (
    <SystemDialog
      open
      onClose={close}
      size="lg"
      labelledBy={titleId}
      dismissIsFree
    >
      <SystemDialogHeader titleId={titleId} title="Added to your library" />
      <SystemDialogBody className="flex flex-col gap-3.5">
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
      </SystemDialogBody>
      <SystemDialogFooter>
        <SystemDialogButton variant="primary" onClick={close} autoFocus>
          Got it
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}
