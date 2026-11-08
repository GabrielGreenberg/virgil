"use client";

/**
 * The bibliography's LIBRARY FLOW — add an entry from the central library,
 * resolve a citekey that already exists locally (the four-way conflict), and
 * file or dismiss an entry request. Lifted out of BibliographyPanel so the
 * panel and the tool gutter's bibliography list run ONE flow: the same
 * conflict rules, the same one-write "Replace", the same suffixed new key.
 *
 * `useBibLibraryFlow` owns the state and the handlers; the components render
 * its strips exactly as the panel always did.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BibEntry, BibEntryRequest } from "@/lib/types";
import type { SaveBibEntry } from "@/hooks/useCitations";
import type { RequestBibReview } from "@/hooks/useBibReview";
import { Button } from "@/components/panel-primitives";
import { Textarea } from "@/components/field-primitives";
import { NO_BIB_UID } from "@/lib/bib-uid";
import { bibKeyIndex, citekeyIdentity } from "@/lib/bib-address";
import { AMBER_ATTENTION_STRIP } from "@/panels/_shared/amber-attention";
import { LibraryEntryMenu, type RowState } from "@/components/library/LibraryEntryMenu";
import { useTabIndent } from "@/hooks/useTabIndent";
import { iconHint } from "@/components/Hint";
import { StatusDot } from "@/components/StatusDot";
import { isCancelEscape } from "@/lib/key-intent";
import { chordPress, FIELD_COMMIT_SHORTCUT } from "@/lib/portable-chord";
import { ICON_STROKE_SMALL } from "@/components/icons/icon-stroke";
import { formatWhen } from "@/lib/relative-time";

/** Why the Library search scope is unavailable. ONE string for both the
 *  disabled segment's hint (the only place a user can meet the reason while
 *  the segment is disabled) and the inline note shown if the library drops
 *  while the Library scope is already active (task 950). */
export const LIBRARY_NOT_CONNECTED_HINT =
  "Connect the central library to search master.bib.";

/** True when two bib entries describe the same record at field level —
 *  same `@type` and exact field/value pairs. `raw` differences (whitespace,
 *  field order) don't count as a conflict. */
export function bibEntryFieldsEqual(a: BibEntry, b: BibEntry): boolean {
  // bib-display-exempt: non-display — this compares stored BYTES to decide
  // whether two records conflict. A projection here would call `L{\'o}pez` and
  // `L{ó}pez` the same entry and silently swallow a real difference.
  if (a.type !== b.type) return false;
  const aKeys = Object.keys(a.fields);
  const bKeys = Object.keys(b.fields);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a.fields[k] !== b.fields[k]) return false;
  }
  return true;
}

/** Fallback formatter used when `entry.raw` isn't available (e.g. for an
 *  entry assembled in-memory). Produces a BibTeX-ish block suitable for
 *  embedding in `requestNotes`. */
export function formatBibEntryForNote(entry: BibEntry): string {
  // bib-display-exempt: non-display — this emits a BibTeX block into an AI
  // request note; it is source, not a rendering.
  const lines = [`@${entry.type}{${entry.key},`];
  for (const [field, value] of Object.entries(entry.fields)) {
    lines.push(`  ${field} = {${value}},`);
  }
  lines.push("}");
  return lines.join("\n");
}

export interface BibLibraryFlowOptions {
  bibEntries: readonly BibEntry[];
  onAddBibEntry?: (entry: BibEntry) => void;
  onSaveBibEntry: SaveBibEntry;
  onRequestReview: RequestBibReview;
  onAddEntryRequest: (description: string) => void;
  /** Select (and reveal) an entry by citekey. */
  select: (key: string) => void;
  /** After "Save under new citekey" adds `<key>-N`: the host leaves any
   *  search, widens its filter and reveals the new entry. */
  onAddedUnderNewKey: (key: string) => void;
}

export interface BibLibraryFlow {
  conflictDecision: { libraryEntry: BibEntry; localEntry: BibEntry } | null;
  clearConflict: () => void;
  /** Add from a search result; `fromLibrary` routes an existing key into the
   *  conflict strip (a local result is already the paper's). */
  addEntry: (entry: BibEntry, fromLibrary: boolean) => void;
  pickFromLibrary: (entry: BibEntry) => RowState;
  libraryRowState: (entry: BibEntry) => RowState;
  replaceWithLibrary: () => void;
  saveUnderNewKey: () => void;
  requestMerge: () => void;
  libraryMenu: { open: boolean; anchor: DOMRect | null; openAt: (anchor: DOMRect | null) => void; close: () => void };
  request: {
    open: boolean;
    text: string;
    setText: (t: string) => void;
    show: () => void;
    hide: () => void;
    submit: () => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  };
}

export function useBibLibraryFlow(o: BibLibraryFlowOptions): BibLibraryFlow {
  // Citekey-conflict inline confirmation strip: shown when the user clicks
  // "Add" on a library result whose citekey already exists locally but with
  // different fields. Null means no conflict pending.
  const [conflictDecision, setConflictDecision] = useState<BibLibraryFlow["conflictDecision"]>(null);
  // Cross-library picker dropdown — opens from the add-menu's "Search
  // library…" item, anchored to the rect of the "+" trigger at click time so
  // the popover lands under the user's gesture even though the add-menu
  // closes immediately after.
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const [libraryMenuAnchor, setLibraryMenuAnchor] = useState<DOMRect | null>(null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestText, setRequestText] = useState("");

  // Case-folded (task 1325): a library `smith2020` beside a local `Smith2020`
  // is the SAME key to BibTeX and to `addBibEntry`'s dedupe, so it must take
  // the conflict / navigate paths below — an exact Map sent it straight to an
  // add the mutator silently refused, and the chip stayed "Add".
  const localEntryByKey = useMemo(() => bibKeyIndex(o.bibEntries as BibEntry[]), [o.bibEntries]);
  const { onAddBibEntry, onSaveBibEntry, onRequestReview, onAddEntryRequest, select, onAddedUnderNewKey } = o;

  const clearConflict = useCallback(() => setConflictDecision(null), []);

  const addEntry = useCallback(
    (entry: BibEntry, fromLibrary: boolean) => {
      // Library-scope: if the citekey already exists locally and the fields
      // differ, surface the four-option conflict strip instead of silently
      // double-adding.
      if (fromLibrary) {
        const local = localEntryByKey.get(entry.key);
        if (local) {
          if (bibEntryFieldsEqual(local, entry)) {
            // Byte-identical — silent no-op, navigate to it.
            select(local.key);
            return;
          }
          setConflictDecision({ libraryEntry: entry, localEntry: local });
          return;
        }
      }
      onAddBibEntry?.(entry);
      // Keep the entry in the results — the local index re-render flips the
      // chip from "Add" to "Added" so the list doesn't shift under the user.
    },
    [localEntryByKey, select, onAddBibEntry],
  );

  // Pick handler for the cross-library dropdown. Returns the row state the
  // menu should adopt afterward — "added" on a clean add, "conflict" when the
  // local citekey diverges and the conflict strip takes over.
  const pickFromLibrary = useCallback(
    (entry: BibEntry): RowState => {
      const local = localEntryByKey.get(entry.key);
      if (local) {
        if (bibEntryFieldsEqual(local, entry)) {
          select(local.key);
          return "added";
        }
        setConflictDecision({ libraryEntry: entry, localEntry: local });
        setLibraryMenuOpen(false);
        return "conflict";
      }
      onAddBibEntry?.(entry);
      return "added";
    },
    [localEntryByKey, select, onAddBibEntry],
  );

  const libraryRowState = useCallback(
    (entry: BibEntry): RowState => {
      const local = localEntryByKey.get(entry.key);
      if (!local) return "addable";
      return bibEntryFieldsEqual(local, entry) ? "added" : "conflict";
    },
    [localEntryByKey],
  );

  const replaceWithLibrary = useCallback(() => {
    if (!conflictDecision) return;
    const { libraryEntry, localEntry } = conflictDecision;
    // "Replace with library" is set-all (D3 / BIB-A3-02): the local entry's
    // fields become EXACTLY the library version's — a local-only field the
    // library lacks must be dropped, not merge-retained. ONE write (task 691).
    onSaveBibEntry(localEntry, { fields: libraryEntry.fields, type: libraryEntry.type });
    setConflictDecision(null);
    select(localEntry.key);
  }, [conflictDecision, onSaveBibEntry, select]);

  const saveUnderNewKey = useCallback(() => {
    if (!conflictDecision) return;
    const { libraryEntry } = conflictDecision;
    const existing = new Set(o.bibEntries.map((e) => citekeyIdentity(e.key)));
    let suffix = 2;
    let next = `${libraryEntry.key}-${suffix}`;
    while (existing.has(citekeyIdentity(next))) {
      suffix += 1;
      next = `${libraryEntry.key}-${suffix}`;
    }
    // Drop `raw` so the serializer rebuilds the block from fields and the new
    // citekey — keeping `raw` would re-emit the library's original
    // `@type{<originalKey>,…}` and the suffix would never reach disk. The uid
    // comes through as `NO_BIB_UID`, so `addBibEntry`'s door mints this new
    // entry's durable identity against the uids already held (task 693).
    onAddBibEntry?.({ ...libraryEntry, uid: NO_BIB_UID, key: next, raw: "" });
    setConflictDecision(null);
    // Surface the just-added entry (task 096, Member B): the host leaves the
    // search context, widens its filter (a new entry is uncited) and reveals it.
    onAddedUnderNewKey(next);
  }, [conflictDecision, o.bibEntries, onAddBibEntry, onAddedUnderNewKey]);

  const requestMerge = useCallback(() => {
    if (!conflictDecision) return;
    const { libraryEntry, localEntry } = conflictDecision;
    const libRaw = libraryEntry.raw?.trim() || formatBibEntryForNote(libraryEntry);
    const notes =
      `Merge with library entry ${libraryEntry.key}. The user's Virgil Library has an alternate version of this entry — please reconcile the two and verify against authoritative sources. ` +
      `\n\nLibrary version:\n${libRaw}`;
    onRequestReview(localEntry.key, "fields", notes);
    setConflictDecision(null);
    select(localEntry.key);
  }, [conflictDecision, onRequestReview, select]);

  const openAt = useCallback((anchor: DOMRect | null) => {
    setShowRequestForm(false);
    setConflictDecision(null);
    setLibraryMenuAnchor(anchor);
    setLibraryMenuOpen(true);
  }, []);
  const closeMenu = useCallback(() => setLibraryMenuOpen(false), []);

  const show = useCallback(() => {
    setShowRequestForm(true);
    setRequestText("");
  }, []);
  const hide = useCallback(() => {
    setShowRequestForm(false);
    setRequestText("");
  }, []);
  const submit = useCallback(() => {
    if (!requestText.trim()) return;
    onAddEntryRequest(requestText.trim());
    setShowRequestForm(false);
    setRequestText("");
  }, [requestText, onAddEntryRequest]);
  const onKeyDown = useTabIndent<HTMLTextAreaElement>((e) => {
    if (isCancelEscape(e)) hide();
    const press = chordPress(e, FIELD_COMMIT_SHORTCUT);
    if (!press) return;
    e.preventDefault();
    if (press === "held") return; // a held ⌘Enter files one request
    submit();
  });

  return {
    conflictDecision,
    clearConflict,
    addEntry,
    pickFromLibrary,
    libraryRowState,
    replaceWithLibrary,
    saveUnderNewKey,
    requestMerge,
    libraryMenu: { open: libraryMenuOpen, anchor: libraryMenuAnchor, openAt, close: closeMenu },
    request: {
      open: showRequestForm,
      text: requestText,
      setText: setRequestText,
      show,
      hide,
      submit,
      onKeyDown,
    },
  };
}

/** The four-way conflict strip: Replace / Keep yours / New citekey / AI merge. */
export function BibConflictStrip({ flow }: { flow: BibLibraryFlow }) {
  const d = flow.conflictDecision;
  if (!d) return null;
  return (
    <div className={`${AMBER_ATTENTION_STRIP} border-b`}>
      <div className="text-2xs text-ink-body mb-1.5">
        <span className="font-mono text-ink-muted">{d.libraryEntry.key}</span> is already in your bib with
        different fields.
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="warm"
          size="sm"
          onClick={flow.replaceWithLibrary}
          data-hint="Overwrite local fields with the library version (citekey unchanged)"
        >
          Replace with library
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={flow.clearConflict}
          data-hint="Keep your existing local entry as-is"
        >
          Keep yours
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={flow.saveUnderNewKey}
          data-hint="Add the library entry alongside under an auto-suffixed citekey"
        >
          Save under new citekey
        </Button>
        <Button
          variant="warm"
          size="sm"
          onClick={flow.requestMerge}
          data-hint="File an AI bib-review request to merge both versions and authenticate"
        >
          Request AI merge &amp; authentication
        </Button>
      </div>
    </div>
  );
}

/** The "Request entry" form. */
export function BibRequestForm({ flow }: { flow: BibLibraryFlow }) {
  const r = flow.request;
  if (!r.open) return null;
  return <BibRequestFormOpen request={r} />;
}

function BibRequestFormOpen({ request: r }: { request: BibLibraryFlow["request"] }) {
  // The field takes focus when the form opens.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className={`${AMBER_ATTENTION_STRIP} border-b`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="section-caption">Request entry</span>
        <button
          onClick={r.hide}
          type="button"
          className="iconbtn-xs iconbtn-on-dark ml-auto"
          {...iconHint({ label: "Cancel" })}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE_SMALL} strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <Textarea
        ref={inputRef}
        value={r.text}
        onChange={(e) => r.setText(e.target.value)}
        onKeyDown={r.onKeyDown}
        placeholder="Describe the bibliography entry you need..."
        density="dense"
        className="w-full text-xs px-2 py-1.5 resize-none"
        rows={3}
      />
      <div className="flex justify-end gap-1.5 mt-1.5">
        <Button variant="ghost" size="sm" onClick={r.hide}>
          Cancel
        </Button>
        <Button variant="warm" size="sm" onClick={r.submit} disabled={!r.text.trim()}>
          Submit
        </Button>
      </div>
    </div>
  );
}

/** The pending entry requests, each dismissable. */
export function BibPendingRequests({
  requests,
  onRemove,
}: {
  requests: readonly BibEntryRequest[];
  onRemove: (id: string) => void;
}) {
  // Dates only ("today", "3 Nov"), so the mount's clock is close enough.
  const [now] = useState(() => Date.now());
  if (requests.length === 0) return null;
  return (
    <div className="mt-2 pt-2 border-t border-edge-subtle">
      <div className="section-caption px-2 mb-1.5">Pending requests ({requests.length})</div>
      {requests.map((req) => (
        <div key={req.id} className={`${AMBER_ATTENTION_STRIP} border rounded-md mx-1 mb-1.5`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-ink-body whitespace-pre-wrap">{req.description}</p>
            <button
              type="button"
              onClick={() => onRemove(req.id)}
              className="iconbtn-xs iconbtn-on-dark"
              {...iconHint({ label: "Dismiss", pos: "above" })}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE_SMALL} strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="text-2xs text-ink-muted mt-1">
            {formatWhen(req.createdAt, now, { dateOnly: true })}
            {req.status === "pending" && (
              <span className="ml-1.5 inline-flex items-center gap-1">
                <StatusDot tone="pending" size="sm" motion="pulse" />
                Pending
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The cross-library picker, opened from "+ Search library…". */
export function BibLibraryPicker({ flow }: { flow: BibLibraryFlow }) {
  return (
    <LibraryEntryMenu
      open={flow.libraryMenu.open}
      anchorRect={flow.libraryMenu.anchor}
      onClose={flow.libraryMenu.close}
      onPick={flow.pickFromLibrary}
      getRowState={flow.libraryRowState}
      placeholder="Search library…"
    />
  );
}
