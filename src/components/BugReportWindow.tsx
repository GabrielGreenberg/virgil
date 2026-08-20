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
 * additionally mirrors to localStorage so a reload keeps the prose
 * (pasted images are session-only — stated limitation).
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
  useSystemDialogDrag,
} from "./system-dialog";
import { Input, Textarea } from "./field-primitives";
import { iconHint } from "@/components/Hint";
import { enqueueWrite } from "@/lib/write-queue";
import { extFromMime, writeBugReport } from "@/lib/bug-report";
import { useBugReportFolder } from "@/hooks/useBugReportFolder";
import { ensureReadWritePermission } from "@library/lib/library-folder";

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

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
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
  const [draftText, setDraftText] = useState(() => readLocal(DRAFT_KEY));
  const [images, setImages] = useState<PastedImage[]>([]);
  const [machineLabel, setMachineLabel] = useState(() => readLocal(MACHINE_KEY));
  const [error, setError] = useState<string | null>(null);
  const [sentFolderName, setSentFolderName] = useState("");
  const sendingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Mirror of `images` for the unmount-only object-URL cleanup.
  const imagesRef = useRef<PastedImage[]>([]);
  imagesRef.current = images;

  // Debounced draft mirror — a reload keeps the prose.
  useEffect(() => {
    const t = setTimeout(() => writeLocal(DRAFT_KEY, draftText), 400);
    return () => clearTimeout(t);
  }, [draftText]);

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
      const files: File[] = [];
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      // Finder "Copy" puts the file on clipboardData.files instead.
      for (const file of Array.from(e.clipboardData.files)) {
        if (file.type.startsWith("image/") && !files.includes(file)) {
          files.push(file);
        }
      }
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
    writeLocal(DRAFT_KEY, "");
    setImages((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.url);
      return [];
    });
  }, []);

  const handleMachineLabelChange = useCallback((value: string) => {
    setMachineLabel(value);
    writeLocal(MACHINE_KEY, value);
  }, []);

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
        void folder.refresh(); // flips to the needs-permission pane
      } else {
        setError(`Couldn't write the report: ${describeError(err)}`);
      }
    } finally {
      sendingRef.current = false;
    }
  }, [folder, draftText, images, machineLabel, appVersion, currentDocName, resetDraft]);

  if (!open) return null;

  const state = folder.state;
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
      labelledBy="bug-report-title"
      frameClassName="w-full max-w-[560px] max-h-[85vh] flex flex-col"
    >
      <BugReportHeader onClose={onClose} />

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
              onChange={(e) => handleMachineLabelChange(e.target.value)}
              placeholder="e.g. office-imac"
              className="text-xs px-2 py-1.5 w-40"
            />
          </div>
          <div className="flex justify-end">
            <SystemDialogButton variant="primary" onClick={() => void folder.pick()}>
              Choose inbox folder…
            </SystemDialogButton>
          </div>
          {folder.pickerError && (
            <p className="text-xs text-danger">{folder.pickerError}</p>
          )}
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
          {folder.pickerError && (
            <p className="text-xs text-danger">{folder.pickerError}</p>
          )}
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

          {error && <p className="text-xs text-danger shrink-0">{error}</p>}

          <div className="flex items-center justify-between gap-3 pt-2 pb-1 border-t border-[var(--border)] shrink-0">
            <div className="flex items-center gap-2 min-w-0 text-[10px] text-ink-muted">
              <span className="whitespace-nowrap">From:</span>
              <Input
                value={machineLabel}
                onChange={(e) => handleMachineLabelChange(e.target.value)}
                disabled={sending}
                placeholder="machine"
                density="dense"
                className="text-[10px] px-1.5 py-0.5 w-24"
              />
              {currentDocName && (
                <span className="truncate">about: {currentDocName}</span>
              )}
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
