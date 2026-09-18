"use client";

/**
 * "Report a bug" window — a dev tool for filing bug reports into the
 * ~/virgil-tasks pipeline FROM ANY MACHINE. Plain text + pasted screenshots
 * are written as new files into a once-per-machine FSA-picked folder (a
 * Dropbox-synced inbox); a scheduled task-catcher heartbeat on the home
 * machine drains complete drops. Gated behind localStorage
 * `virgil:bug-report` = "1" (see EditorLayout's bugReportEnabled).
 *
 * Shell: scrimless draggable SystemDialog, the PreferencesModal shape — but
 * mounted ALWAYS with an `open` prop (the PrintDialog pattern), because
 * SystemDialog closes on Esc/outside-mousedown and a conditional mount
 * would destroy a half-written report on a stray click. All draft state
 * lives above the SystemDialog; hiding never resets it. The text draft
 * additionally mirrors to localStorage through `useMirroredDraft` — the door
 * that FLUSHES its debounce on teardown instead of cancelling it, so a reload
 * inside the debounce window keeps the prose too, and that refuses a peer
 * window's re-read while this buffer holds an unmirrored edit (task 629).
 * Pasted images are session-only — stated limitation.
 *
 * That always-mounted shape hands ONE lifetime to two groups, so the window
 * says which is which: the DURABLE group (draft, images, machine label) is what
 * `dismissIsFree` promises to keep, and the TRANSIENT group (`phase`, `error`,
 * the last send's folder name, and the folder hook's `pickerError`) is cleared
 * on the closing edge by `useClearedOnDismiss` — see the split beside the state
 * below (task 631).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import SystemDialog, {
  SystemDialogButton,
  useClearedOnDismiss,
  useSystemDialogDrag,
} from "./system-dialog";
import { Input, Textarea } from "./field-primitives";
import { iconHint } from "@/components/Hint";
import { enqueueWrite } from "@/lib/write-queue";
import { extFromMime, writeBugReport } from "@/lib/bug-report";
import { imagesFromClipboard } from "@/lib/transfer-files";
import { useBugReportFolder } from "@/hooks/useBugReportFolder";
import { ensureReadWritePermission } from "@library/lib/library-folder";
import { useMirroredDraft } from "@/lib/cross-window-storage";

const DRAFT_KEY = "virgil:bug-report-draft";
const MACHINE_KEY = "virgil:bug-report-machine";
/** Soft warning threshold — catches a paste loop, blocks nothing. */
const MANY_SHOTS = 20;

interface PastedImage {
  id: string;
  blob: Blob;
  ext: string;
  url: string;
}

interface BugReportWindowProps {
  open: boolean;
  onClose: () => void;
  appVersion: string;
  currentDocName: string | null;
}

function describeError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

// ── Header (drag handle) — rendered as a child of SystemDialog so it sits
// inside the dialog's provider and can grab the drag handler. ──────────────

function BugReportHeader({ onClose }: { onClose: () => void }) {
  const { onMouseDown, dragging } = useSystemDialogDrag();
  return (
    <div
      className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] select-none shrink-0"
      onMouseDown={onMouseDown}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
    >
      <h2 id="bug-report-title" className="text-sm font-semibold text-ink-body">
        Report a bug
      </h2>
      <button
        onClick={onClose}
        onMouseDown={(e) => e.stopPropagation()}
        className="iconbtn-md"
        {...iconHint({ label: "Close" })}
      >
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}

// ── Main window ─────────────────────────────────────────────────────────────

export default function BugReportWindow({
  open,
  onClose,
  appVersion,
  currentDocName,
}: BugReportWindowProps) {
  const folder = useBugReportFolder(open);
  const [phase, setPhase] = useState<"compose" | "sending" | "sent">("compose");
  // Both mirrors ride the ONE door (task 629): it owns the debounce, FLUSHES
  // it on unmount / tab-hidden / pagehide rather than cancelling it, and
  // refuses a peer's re-read while this buffer holds an unmirrored edit. One
  // instance per key, so a peer's keystroke in "From:" can no longer reach the
  // report prose. The machine label writes through undebounced — a short field
  // typed once per machine has nothing to coalesce.
  const [draftText, setDraftText, flushDraft] = useMirroredDraft(DRAFT_KEY);
  const [images, setImages] = useState<PastedImage[]>([]);
  const [machineLabel, setMachineLabel] = useMirroredDraft(MACHINE_KEY, {
    debounceMs: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [sentFolderName, setSentFolderName] = useState("");
  const sendingRef = useRef(false);

  // The window's state is TWO groups with two lifetimes, and the always-mounted
  // shape gives both the same one unless it is said out loud (task 631):
  //
  //   DURABLE   — `draftText`, `images`, `machineLabel`. What `dismissIsFree`
  //               below promises to keep; the whole reason this window hides
  //               instead of unmounting. Never reset here.
  //   TRANSIENT — `phase`, `error`, `sentFolderName` (and, in the folder hook,
  //               its `pickerError`). Each REPORTS A PAST MOMENT — a send that
  //               finished, a write that failed, a picker that was busy — and a
  //               dismissal ends that moment. Kept, they are replayed as though
  //               current: before this, closing the window after a send and
  //               reopening it showed the previous report's "Report written"
  //               pane instead of a compose form.
  //
  // The door clears on the CLOSING edge, so this cannot race the focus effect
  // just below (which is keyed on `phase`).
  useClearedOnDismiss(open, () => {
    setPhase("compose");
    setError(null);
    setSentFolderName("");
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Mirror of `images` for the unmount-only object-URL cleanup.
  const imagesRef = useRef<PastedImage[]>([]);
  imagesRef.current = images;

  // Revoke every thumbnail URL on unmount (removals revoke their own).
  useEffect(() => {
    return () => {
      for (const img of imagesRef.current) URL.revokeObjectURL(img.url);
    };
  }, []);

  // Focus the textarea when the window opens on the compose pane.
  // SystemDialog's own rAF focuses the frame first; ours lands after
  // (the PresetBar 50ms-setTimeout precedent).
  useEffect(() => {
    if (open && phase === "compose" && folder.state.kind === "ready") {
      const t = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, phase, folder.state.kind]);

  const addImages = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setImages((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        blob: file as Blob,
        ext: extFromMime(file.type),
        url: URL.createObjectURL(file),
      })),
    ]);
  }, []);

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      if (phase !== "compose") return;
      // ONE door reads both clipboard views and dedupes by CONTENT, scoped to
      // this event — see `transfer-files.ts`. Reading them here and deduping
      // by object identity is what pasted every screenshot twice (task 419).
      const files = imagesFromClipboard(e.clipboardData);
      if (files.length > 0) {
        // An image paste is consumed whole; a text paste falls through
        // to the textarea untouched.
        e.preventDefault();
        addImages(files);
      }
    },
    [phase, addImages],
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const gone = prev.find((img) => img.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  const resetDraft = useCallback(() => {
    setDraftText("");
    flushDraft(); // a sent report clears the mirror NOW, not 400 ms from now
    setImages((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.url);
      return [];
    });
  }, [setDraftText, flushDraft]);

  const handleSend = useCallback(async () => {
    if (sendingRef.current) return;
    if (folder.state.kind !== "ready") return;
    const handle = folder.state.handle;
    const text = draftText;
    const sendImages = images;
    if (!text.trim() && sendImages.length === 0) return;
    sendingRef.current = true;
    setPhase("sending");
    setError(null);
    try {
      // First await: the permission re-request rides the click's activation.
      const perm = await ensureReadWritePermission(handle);
      if (perm !== "granted") {
        throw new DOMException("Folder access was not granted.", "NotAllowedError");
      }
      const { folderName } = await enqueueWrite("bugreport", () =>
        writeBugReport(handle, {
          text,
          images: sendImages.map(({ blob, ext }) => ({ blob, ext })),
          meta: {
            sentAt: new Date().toISOString(),
            machineLabel: machineLabel.trim() || "unknown",
            appVersion,
            userAgent: navigator.userAgent,
            docName: currentDocName,
          },
        }),
      );
      setSentFolderName(folderName);
      setPhase("sent");
      resetDraft();
    } catch (err) {
      setPhase("compose"); // draft intact
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError(
          "Virgil lost permission to the inbox folder — grant access and press Send again.",
        );
        // Flips the pane to `needs-permission` — which is exactly why the
        // message above renders in the window's own notice row and not in the
        // compose block this is about to unmount.
        void folder.refresh();
      } else {
        setError(`Couldn't write the report: ${describeError(err)}`);
      }
    } finally {
      sendingRef.current = false;
    }
  }, [folder, draftText, images, machineLabel, appVersion, currentDocName, resetDraft]);

  if (!open) return null;

  const state = folder.state;
  // ONE notice line for the whole window. `error` first: it reports what the
  // user's own last gesture did, and the picker's error is older by
  // construction (it can only have been set by an earlier click).
  const notice = error ?? folder.pickerError;
  const sending = phase === "sending";
  const canSend =
    state.kind === "ready" &&
    !sending &&
    (draftText.trim().length > 0 || images.length > 0);

  return (
    <SystemDialog
      open
      variant="draggable"
      onClose={onClose}
      ignoreOutsideSelector='[data-hint="Report a bug"]'
      /* A dismissal is FREE, deliberately and by construction, and that is a
         claim about BOTH groups above. The DURABLE one survives: EditorLayout
         mounts this window ALWAYS with an `open` prop precisely so "a
         conditional mount would destroy a half-written report on a stray
         click" — the comment at that mount is the prior art task 530
         generalized — and the text additionally mirrors to localStorage
         through a door that FLUSHES on teardown, so even a reload keeps it
         (task 629). The TRANSIENT one is cleared, by `useClearedOnDismiss`
         above (task 631); without that half, "free" quietly meant "and you get
         the last send's confirmation back instead of a compose form". */
      dismissIsFree
      labelledBy="bug-report-title"
      frameClassName="w-full max-w-[560px] max-h-[85vh] flex flex-col"
    >
      <BugReportHeader onClose={onClose} />

      {/* The notice belongs to the WINDOW, not to a pane. Task 631: the
          send-failure message used to render inside the compose block, and the
          failure it most often reports — a lost folder permission — is answered
          in the same breath by `folder.refresh()`, which flips the pane to
          `needs-permission` and unmounted the instruction before anyone could
          read it. The picker's own error joins it here for the matching reason:
          it was written out twice, once per pane that happened to be showing,
          and was unreadable from the third. */}
      {notice && (
        <p role="alert" className="px-5 pt-3 text-xs text-danger shrink-0">
          {notice}
        </p>
      )}

      {state.kind === "loading" && (
        <div className="px-5 py-6 text-xs text-ink-muted">Checking inbox folder…</div>
      )}

      {state.kind === "none" && (
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-ink-subtle leading-relaxed">
            Pick this machine&apos;s synced inbox folder (e.g.{" "}
            <span className="font-mono">Dropbox/Virgil-Inbox</span>). Reports are
            written there as plain files; the sync service carries them home.
            One-time setup per machine.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted whitespace-nowrap">This machine:</span>
            <Input
              value={machineLabel}
              onChange={(e) => setMachineLabel(e.target.value)}
              placeholder="e.g. office-imac"
              className="text-xs px-2 py-1.5 w-40"
            />
          </div>
          <div className="flex justify-end">
            <SystemDialogButton variant="primary" onClick={() => void folder.pick()}>
              Choose inbox folder…
            </SystemDialogButton>
          </div>
        </div>
      )}

      {state.kind === "needs-permission" && (
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-ink-subtle leading-relaxed">
            Virgil needs access to your bug-report inbox folder again.
          </p>
          <div className="flex justify-end">
            <SystemDialogButton variant="primary" onClick={() => void folder.grant()}>
              Grant access
            </SystemDialogButton>
          </div>
        </div>
      )}

      {state.kind === "ready" && phase !== "sent" && (
        <div
          className="flex-1 min-h-0 flex flex-col px-5 py-3 gap-3"
          onPaste={handlePaste}
        >
          <Textarea
            ref={textareaRef}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            disabled={sending}
            placeholder="What went wrong? Paste screenshots anywhere in this window."
            className="flex-1 min-h-[10rem] text-xs px-2.5 py-2 resize-none"
          />

          {images.length > 0 && (
            <div className="shrink-0">
              <div className="text-[10px] font-medium text-ink-muted uppercase tracking-wider mb-1">
                {images.length} screenshot{images.length === 1 ? "" : "s"}
              </div>
              <div className="flex gap-2 flex-wrap">
                {images.map((img, i) => (
                  <div key={img.id} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={`Screenshot ${i + 1}`}
                      className="h-16 w-auto max-w-28 object-cover rounded border border-edge-subtle"
                    />
                    <button
                      onClick={() => removeImage(img.id)}
                      disabled={sending}
                      className="focus-ring absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-[var(--surface)] border border-edge-subtle text-ink-muted hover:text-ink-body flex items-center justify-center"
                      {...iconHint({ label: `Remove screenshot ${i + 1}` })}
                    >
                      <svg width="8" height="8" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 3l8 8M11 3l-8 8" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              {images.length >= MANY_SHOTS && (
                <p className="text-[10px] text-ink-muted mt-1">
                  That&apos;s a lot of screenshots — was that a paste loop?
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2 pb-1 border-t border-[var(--border)] shrink-0">
            <div className="flex items-center gap-2 min-w-0 text-[10px] text-ink-muted">
              <span className="whitespace-nowrap">From:</span>
              <Input
                value={machineLabel}
                onChange={(e) => setMachineLabel(e.target.value)}
                disabled={sending}
                placeholder="machine"
                density="dense"
                className="text-[10px] px-1.5 py-0.5 w-24"
              />
              {currentDocName && (
                <span className="truncate">about: {currentDocName}</span>
              )}
              {/* The ONLY door back to the picker. `state.kind === "none"` —
                  the pane that owns "Choose inbox folder…" — is reachable only
                  while IDB holds no handle, so before this button a user who
                  picked the wrong Dropbox folder had no way to change it and
                  `folder.reset` was a published export with no caller. */}
              <button
                type="button"
                onClick={() => void folder.reset()}
                disabled={sending}
                className="focus-ring rounded-[var(--radius-xs)] whitespace-nowrap underline decoration-dotted underline-offset-2 hover:text-ink-body disabled:opacity-50"
              >
                Change folder…
              </button>
            </div>
            <SystemDialogButton
              variant="primary"
              onClick={() => void handleSend()}
              disabled={!canSend}
            >
              {sending ? "Sending…" : "Send"}
            </SystemDialogButton>
          </div>
        </div>
      )}

      {state.kind === "ready" && phase === "sent" && (
        <div className="px-5 py-6 space-y-3">
          <div className="flex items-center gap-2 text-sm text-ink-body">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--status-ok)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span className="font-medium">Report written</span>
          </div>
          <p className="text-xs text-ink-subtle">
            <span className="font-mono">{sentFolderName}</span> — the sync service
            will carry it home.
          </p>
          <div className="flex justify-end">
            <SystemDialogButton variant="secondary" onClick={() => setPhase("compose")}>
              Write another
            </SystemDialogButton>
          </div>
        </div>
      )}
    </SystemDialog>
  );
}
