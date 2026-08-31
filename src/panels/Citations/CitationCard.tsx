"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BibEntry, CitationRef } from "@/lib/types";
import {
  bibFieldDisplay,
  citationCommandOrNull,
  derivePlural,
  parseCiteCommand,
  resolveCiteNoteRows,
  sanitizeInlineCitationHtml,
  serializeCiteCommand,
  type ParsedCiteKey,
} from "@/lib/bib-parser";
import {
  PanelCard,
  PANEL,
  CardMetaLabel,
  cardTitleStyle,
  usePanelCardTryDelete,
} from "@/components/panel-primitives";
import { Input, Select } from "@/components/field-primitives";
import { FONT_STACKS } from "@/lib/panel-typography";
// The `<cardKind>:<cardId>` grammar has one builder (task 202) — the panel
// card carries the same `data-link-card` token its in-editor marker does, and
// `parseLinkCardKey` consumers have to keep agreeing with both.
import { linkCardKey } from "@/links/link-dom-contract";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import BibEntryCard from "@/components/BibEntryCard";
import { MIME_CITATION, MIME_BIB_MERGE } from "@/lib/marginalia";
import { attachClampedDragGhost, buildTextDragGhost } from "@/lib/drag-ghost";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { useCardStore } from "@/links/_shared/anchored-card-store";
import { useLibraryEntryLookup } from "@/hooks/useLibrary";
import { OpenEntryLink } from "@/components/library/open-library-entry";
import { CitekeyPicker } from "./CitekeyPicker";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import { MenuToggleRow } from "@/components/menu/MenuToggleRow";
import { iconHint } from "@/components/Hint";

/* ── Command type options per package ─────────────────────────────── */

const NATBIB_TYPES = [
  { value: "cite", label: "\\cite" },
  { value: "citep", label: "\\citep" },
  { value: "citet", label: "\\citet" },
  { value: "citealt", label: "\\citealt" },
  { value: "citealp", label: "\\citealp" },
  { value: "citeauthor", label: "\\citeauthor" },
  { value: "citeyear", label: "\\citeyear" },
  { value: "citeyearpar", label: "\\citeyearpar" },
];

const BIBLATEX_TYPES = [
  { value: "cite", label: "\\cite" },
  { value: "cites", label: "\\cites" },
  { value: "autocite", label: "\\autocite" },
  { value: "autocites", label: "\\autocites" },
  { value: "textcite", label: "\\textcite" },
  { value: "textcites", label: "\\textcites" },
  { value: "parencite", label: "\\parencite" },
  { value: "parencites", label: "\\parencites" },
  { value: "footcite", label: "\\footcite" },
  { value: "footcites", label: "\\footcites" },
  { value: "smartcite", label: "\\smartcite" },
  { value: "smartcites", label: "\\smartcites" },
  { value: "fullcite", label: "\\fullcite" },
  { value: "footfullcite", label: "\\footfullcite" },
  { value: "citeauthor", label: "\\citeauthor" },
  { value: "citeyear", label: "\\citeyear" },
  { value: "citetitle", label: "\\citetitle" },
  { value: "citedate", label: "\\citedate" },
  { value: "citeurl", label: "\\citeurl" },
  { value: "nocite", label: "\\nocite" },
];

/** The PREVIEW row's intentional serif stack — the rendered citation text
 *  previews how it reads in the (serif) document, independent of the
 *  panel's body font. Reuses the curated override-first Source Serif 4
 *  entry so it can't drift from the document's effective serif face. */
const PREVIEW_SERIF_STACK = FONT_STACKS["Source Serif 4"];

/* ── Helpers ──────────────────────────────────────────────────────── */

function lastNameOf(author: string): string {
  const commaParts = author.split(",");
  if (commaParts.length >= 2) return commaParts[0].trim();
  const words = author.trim().split(/\s+/);
  return words[words.length - 1] || author.trim();
}

function firstThreeAuthorLastNames(authorField: string): string {
  const authors = authorField
    .split(" and ")
    .map((a) => a.trim())
    .filter(Boolean);
  if (authors.length === 0) return "";
  const names = authors.slice(0, 3).map(lastNameOf);
  if (authors.length === 1) return names[0];
  if (authors.length === 2) return `${names[0]} and ${names[1]}`;
  if (authors.length === 3)
    return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `${names[0]}, ${names[1]}, ${names[2]}, et al.`;
}

function fullAuthorsForRow(authorField: string): string {
  const authors = authorField
    .split(" and ")
    .map((a) => a.trim())
    .filter(Boolean);
  if (authors.length === 0) return "";
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  if (authors.length === 3)
    return `${authors[0]}, ${authors[1]}, and ${authors[2]}`;
  return `${authors[0]}, ${authors[1]}, ${authors[2]}, et al.`;
}

function venueForRow(entry: BibEntry | undefined): string {
  if (!entry) return "";
  // DISPLAY — every field through the bib-row door (task 409).
  const f = (name: string) => bibFieldDisplay(entry, name) || "";
  const journal = f("journal") || f("booktitle") || f("series");
  const volume = f("volume"), number = f("number");
  const bits: string[] = [];
  if (journal) bits.push(journal);
  if (volume) bits.push(`vol. ${volume}${number ? `, no. ${number}` : ""}`);
  else if (number) bits.push(`no. ${number}`);
  if (f("pages")) bits.push(`pp. ${f("pages")}`);
  if (f("publisher")) bits.push(f("publisher"));
  return bits.join(", ");
}

let _rowIdCounter = 0;
const nextRowId = () => `row_${++_rowIdCounter}`;

interface UiRow {
  id: string;
  key: string;
  prenote?: string;
  postnote?: string;
}

function inferTypeFromBare(command: string): {
  type: string;
  starred: boolean;
  capitalized: boolean;
} | null {
  const m = command.match(/^\\([A-Za-z]+)(\*?)$/);
  if (!m) return null;
  let name = m[1];
  const isUpper = name[0] >= "A" && name[0] <= "Z";
  if (isUpper) name = name[0].toLowerCase() + name.slice(1);
  return { type: name, starred: m[2] === "*", capitalized: isUpper };
}

function rowsFromCommand(command: string): UiRow[] {
  const parsed = parseCiteCommand(command);
  if (!parsed || parsed.entries.length === 0) return [{ id: nextRowId(), key: "" }];
  // The rows ARE the per-key view, so they read the model's ONE placement rule
  // rather than a second copy of it (task 403). What stood here mirrored
  // `entries[0]`'s note onto EVERY row under a comment that said "For natbib"
  // over code that ran always — so a biblatex `\cites[p. 1]{a}{b}` showed
  // "p. 1" on `b` and the next `persist()` wrote that invented page range into
  // the user's `.tex`.
  return resolveCiteNoteRows(parsed).map((r) => ({
    id: nextRowId(),
    key: r.key,
    prenote: r.prenote,
    postnote: r.postnote,
  }));
}

/* ── Card props ───────────────────────────────────────────────────── */

export interface CitationCardProps {
  citation: CitationRef;
  isSelected: boolean;
  bibEntries: BibEntry[];
  bibPackage: string;
  getDisplayText: (command: string) => string;
  onSelect: () => void;
  onJump: (sourceEl: HTMLElement | null) => void;
  onUpdateCitation: (id: string, command: string) => void;
  /** Add a library-only entry into the paper's references.bib. Used when
   *  the citekey picker locks onto an entry that doesn't yet exist in the
   *  local bib. */
  onAddBibEntry?: (entry: BibEntry) => void;
  /** Unused in the new layout (the inline BibEntryCard expansion is gone)
   *  but kept so the panel host can keep passing the callbacks for now. */
  getFormattedBib?: (entry: BibEntry) => string;
  getAnnotation?: (key: string) => string;
  setAnnotation?: (key: string, text: string) => void;
  onRequestReview?: (
    bibKey: string,
    type: "fields" | "notes",
    requestNotes?: string,
  ) => void;
  onCancelReview?: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus?: (
    bibKey: string,
    type: "fields" | "notes",
  ) => "none" | "pending" | "complete";
  onUpdateBibEntry?: (key: string, fields: Record<string, string>) => void;
  onUpdateBibKeyAndType?: (
    oldKey: string,
    newKey: string,
    newType: string,
  ) => void;
  isAnchored?: boolean;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  extraDataAttrs?: Record<string, string>;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  onDelete?: (id: string) => void;
  /** True when this card is a placeholder for a not-yet-created citation
   *  (rendered by the panel's "+ Add citation" flow). Forces expanded
   *  layout. */
  isDraft?: boolean;
}

export function CitationCard({
  citation: cit,
  isSelected,
  bibEntries,
  bibPackage,
  getDisplayText,
  onSelect,
  onJump,
  onUpdateCitation,
  onAddBibEntry,
  getFormattedBib,
  getAnnotation,
  setAnnotation,
  onRequestReview,
  onCancelReview,
  getReviewStatus,
  onUpdateBibEntry,
  onUpdateBibKeyAndType,
  isAnchored = true,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
  onTogglePopout,
  isPoppedOut,
  onDelete,
  isDraft = false,
}: CitationCardProps) {
  const theme = useCardKindTheme("citation");
  const bodyStyle = usePanelBodyStyle("citation");
  const popped = usePoppedCards();
  const cardKey = popKey("citations", cit.id);
  // Shared per-citekey library resolver — lets each cited reference offer the
  // same "open entry" affordance as the bibliography card (modular reuse).
  const lookupEntry = useLibraryEntryLookup();
  const ac = useAnchoredCard({ kind: "citation", id: cit.id });
  const cardStore = useCardStore();
  const isExpanded = isDraft || ac.expanded;
  const isHaloed = ac.selected || isSelected;
  const compressed = !isExpanded && !isPoppedOut;

  // CI-F7-01 / OMNI-F7-01: deleting a citation removes the in-text `\cite{}`
  // atom. Route the trash through the SAME content-aware confirm every other
  // PanelCard-direct kind uses — the shared `usePanelCardTryDelete` hook that
  // also serves the cutter/revision suggestion cards (CitationCard renders via
  // PanelCard, not EditableCard, so it bypassed `EditableCard.tryDelete` — that
  // bypass IS the bug class). A citation WITH keys confirms (its own referenced-
  // in-the-document prompt); a keyless draft deletes straight through.
  const { tryDelete, dialog: deleteConfirmDialog } = usePanelCardTryDelete(
    "citation",
    cit,
    cit.id,
    onDelete,
    { message: "This citation is referenced in the document. Delete it?" },
  );

  const bibEntryMap = useMemo(
    () => new Map(bibEntries.map((e) => [e.key, e])),
    [bibEntries],
  );

  /* ── Local UI state synced from cit.command ──────────────────────── */

  const [rows, setRows] = useState<UiRow[]>(() => rowsFromCommand(cit.command));
  const initialParsed = useMemo(
    () => parseCiteCommand(cit.command),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const initialBare = useMemo(
    () => (initialParsed ? null : inferTypeFromBare(cit.command)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [type, setType] = useState(
    initialParsed?.type || initialBare?.type || "cite",
  );
  const [starred, setStarred] = useState(
    initialParsed?.starred ?? initialBare?.starred ?? false,
  );
  const [capitalized, setCapitalized] = useState(
    initialParsed?.capitalized ?? initialBare?.capitalized ?? false,
  );

  /** Track the last command we wrote so we don't re-sync on our own
   *  writes (the panel echoes them back through cit.command). */
  const lastWrittenRef = useRef(cit.command);

  /** The single resync SSOT: rebuild every piece of local UI state
   *  (`rows` / `type` / `starred` / `capitalized`) from a command string and
   *  stamp `lastWrittenRef`. EVERY path that changes `cit.command` WITHOUT
   *  going through the row mutators must funnel through here — otherwise the
   *  local state drifts stale and the next `persist()` re-serializes from it,
   *  silently clobbering the change (task 078). The row mutators keep their own
   *  invariant ("setRows alongside persist"); this covers the two paths that
   *  bypass them: the external panel echo (the effect below) and the raw "Code"
   *  input commit. */
  const syncLocalFromCommand = useCallback((command: string) => {
    const fresh = parseCiteCommand(command);
    setRows(rowsFromCommand(command));
    setType(fresh?.type || "cite");
    setStarred(fresh?.starred ?? false);
    setCapitalized(fresh?.capitalized ?? false);
    lastWrittenRef.current = command;
  }, []);

  useEffect(() => {
    if (cit.command === lastWrittenRef.current) return;
    syncLocalFromCommand(cit.command);
  }, [cit.command, syncLocalFromCommand]);

  /** Serialize and emit. If validRows is empty, emit "" (won't survive
   *  in the parent store but the draft flow uses this to know it's empty). */
  const persist = useCallback(
    (overrides: {
      rows?: UiRow[];
      type?: string;
      starred?: boolean;
      capitalized?: boolean;
    }) => {
      const nextRows = overrides.rows ?? rows;
      const nextType = overrides.type ?? type;
      const nextStarred = overrides.starred ?? starred;
      const nextCapitalized = overrides.capitalized ?? capitalized;

      const validRows = nextRows.filter((r) => r.key.trim());
      if (validRows.length === 0) {
        if (cit.command !== "") {
          lastWrittenRef.current = "";
          onUpdateCitation(cit.id, "");
        }
        return;
      }
      const entries: ParsedCiteKey[] = validRows.map((r) => ({
        key: r.key.trim(),
        prenote: r.prenote || undefined,
        postnote: r.postnote || undefined,
      }));
      const command = serializeCiteCommand(
        {
          type: nextType,
          starred: nextStarred,
          capitalized: nextCapitalized,
          // Each row owns its own `[pre][post]` input, so the card always
          // speaks PER-KEY. The serializer flattens where the target package
          // cannot represent that — see `citeNotesDroppedByPackage`, which is
          // what the Package control asks before it lets the flip happen.
          noteScope: "per-key",
          entries,
        },
        bibPackage,
      );
      lastWrittenRef.current = command;
      onUpdateCitation(cit.id, command);
    },
    [
      rows,
      type,
      starred,
      capitalized,
      cit.command,
      cit.id,
      bibPackage,
      onUpdateCitation,
    ],
  );

  /** Re-derive the command shape when the DOCUMENT's bib package toggles
   *  (CI-F5-02 — biblatex↔natbib). A switch to natbib demotes a stranded
   *  `\cites` to a package-valid `\cite`; a switch to biblatex promotes a
   *  multi-key/distinct-postnote `\cite` to `\cites`. Gated on a ref so it
   *  only fires on an actual package change, never on mount or a plain
   *  re-render — and only persists when the derived type actually differs. */
  const lastBibPackageRef = useRef(bibPackage);
  useEffect(() => {
    if (lastBibPackageRef.current === bibPackage) return;
    lastBibPackageRef.current = bibPackage;
    const nextType = derivePlural(type, rows, bibPackage);
    if (nextType !== type) {
      setType(nextType);
      persist({ type: nextType });
    }
  }, [bibPackage, type, rows, persist]);

  /* ── Row mutations ───────────────────────────────────────────────── */

  // Each mutator computes `next` from the closure's current `rows`, calls
  // `setRows(next)`, then calls `persist({ rows: next })` — both at event
  // time. Calling `persist` from *inside* a `setRows` updater would invoke
  // `onUpdateCitation` (a parent setState) during React's reducer phase,
  // which React 18+ warns about as "Cannot update a component while
  // rendering a different component".
  const setRowKey = useCallback(
    (rowId: string, key: string) => {
      const next = rows.map((r) => (r.id === rowId ? { ...r, key } : r));
      // Re-derive: changing the keyed-row count crosses the ≥2-keys threshold
      // either way, so the command shape follows (T6-C16, two-way).
      const nextType = derivePlural(type, next, bibPackage);
      setRows(next);
      if (nextType !== type) setType(nextType);
      persist({ rows: next, type: nextType });
    },
    [rows, persist, bibPackage, type],
  );

  const setRowPostnote = useCallback(
    (rowId: string, postnote: string) => {
      const next = rows.map((r) => (r.id === rowId ? { ...r, postnote } : r));
      // Re-derive the canonical singular↔plural command shape for the new rows
      // (T6-C16 — two-way: promotes to `\xxxs` when ≥2 keys gain distinct
      // postnotes so each per-key range survives serialize, demotes back
      // otherwise so the command can never strand as `\cites` with one key).
      const nextType = derivePlural(type, next, bibPackage);
      setRows(next);
      if (nextType !== type) setType(nextType);
      persist({ rows: next, type: nextType });
    },
    [rows, persist, bibPackage, type],
  );

  const removeRow = useCallback(
    (rowId: string) => {
      const next =
        rows.length <= 1
          ? [{ id: nextRowId(), key: "" }]
          : rows.filter((r) => r.id !== rowId);
      // Re-derive: dropping a row back to one key (or losing the distinct-
      // postnote condition) DEMOTES `\cites` → `\cite` (CI-F5-01).
      const nextType = derivePlural(type, next, bibPackage);
      setRows(next);
      if (nextType !== type) setType(nextType);
      persist({ rows: next, type: nextType });
    },
    [rows, persist, bibPackage, type],
  );

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, { id: nextRowId(), key: "" }]);
  }, []);

  /* ── Picker ──────────────────────────────────────────────────────── */

  const [pickerRowId, setPickerRowId] = useState<string | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  /** When the picker is opened from the empty-row's merged search input,
   *  this is the live query text. The input is owned by `CitationKeyRow`;
   *  the value lives here so the picker can read it via `externalQuery`. */
  const [pickerExternalQuery, setPickerExternalQuery] = useState<string | null>(null);
  const [pickerExternalInputEl, setPickerExternalInputEl] = useState<HTMLInputElement | null>(null);
  const rowAnchorRefs = useRef<Map<string, HTMLElement>>(new Map());
  const openPickerFor = useCallback((rowId: string) => {
    setPickerRowId(rowId);
    setPickerAnchor(rowAnchorRefs.current.get(rowId) ?? null);
    // Reset the external-input plumbing — set by the empty-row input on focus.
    setPickerExternalQuery(null);
    setPickerExternalInputEl(null);
  }, []);
  /** Opened from the merged "Add from library…" input. The input itself
   *  drives the query; the picker dropdown anchors beneath it. */
  const openPickerForInput = useCallback(
    (rowId: string, inputEl: HTMLInputElement, initialQuery: string) => {
      setPickerRowId(rowId);
      setPickerAnchor(inputEl);
      setPickerExternalQuery(initialQuery);
      setPickerExternalInputEl(inputEl);
    },
    [],
  );
  const closePicker = useCallback(() => {
    setPickerRowId(null);
    setPickerAnchor(null);
    setPickerExternalQuery(null);
    setPickerExternalInputEl(null);
  }, []);

  /* ── Inline BibEntryCard expansion ───────────────────────────────── */

  const [expandedBibKey, setExpandedBibKey] = useState<string | null>(null);
  const toggleBibKey = useCallback((key: string) => {
    setExpandedBibKey((prev) => (prev === key ? null : key));
  }, []);
  // Clear the expansion when the row's key disappears (e.g. row removed
  // or citekey replaced via the picker).
  useEffect(() => {
    if (expandedBibKey && !rows.some((r) => r.key === expandedBibKey)) {
      setExpandedBibKey(null);
    }
  }, [expandedBibKey, rows]);

  /* ── Drag and drop (merge a dragged bib key into the card) ───────── */

  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const display = getDisplayText(cit.command);
      const plain = display.replace(/<[^>]+>/g, "");
      e.dataTransfer.setData("text/plain", cit.command);
      e.dataTransfer.setData(
        MIME_CITATION,
        JSON.stringify({ command: cit.command, citationId: cit.id }),
      );
      // "copyMove", not "copy": the editor drop surface shows a "move"
      // affordance (Editor.tsx dragover); the card merge target still takes
      // "copy".
      e.dataTransfer.effectAllowed = "copyMove";
      // Route through the clamped-ghost SSOT so the native OS drag image is
      // suppressed and the custom ghost stays viewport-clamped (never tears off
      // into the title bar). Cream palette via tokens — the citation family.
      attachClampedDragGhost({
        dragStartEvent: e,
        buildGhost: () =>
          buildTextDragGhost(plain, {
            maxChars: 80,
            bg: "var(--citation-ghost-bg, #fdf8e1)",
            border: "var(--citation-border-color, #e0d5a8)",
            ink: "var(--citation-color, #6b6245)",
          }),
        cursorOffsetX: 10,
        cursorOffsetY: 14,
      });
    },
    [cit, getDisplayText],
  );

  const handleCardDragOver = useCallback(
    (e: React.DragEvent) => {
      // Light the ring ONLY for a mergeable bib-entry drag — the `MIME_BIB_MERGE`
      // discriminator. A citation card's own atom-move drag carries `MIME_CITATION`
      // alone, so it no longer lights a "drop here" ring that `handleCardDrop`
      // would then silently reject.
      if (!e.dataTransfer.types.includes(MIME_BIB_MERGE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!isDropTarget) setIsDropTarget(true);
    },
    [isDropTarget],
  );

  const handleCardDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as Node).contains(next)) return;
    setIsDropTarget(false);
  }, []);

  const handleCardDrop = useCallback(
    (e: React.DragEvent) => {
      // The merge path accepts the bib-entry discriminator only (a `\cite` atom
      // move carries `MIME_CITATION` alone and is handled by the editor, never
      // merged onto a card).
      const data = e.dataTransfer.getData(MIME_BIB_MERGE);
      if (!data) return;
      let parsed: { bibKey?: string };
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const bibKey = parsed.bibKey;
      if (!bibKey) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDropTarget(false);
      // Compute `next` from the closure `rows` and call `setRows`/`setType`/
      // `persist` at EVENT time — never a parent setState (`persist` →
      // `onUpdateCitation`) from inside the `setRows` updater. Matches the
      // sibling mutators' discipline (`setRowKey`/`setRowPostnote`/`removeRow`).
      if (rows.some((r) => r.key === bibKey)) return; // already present — no-op
      // If the only row is empty, fill it instead of adding a new row.
      const allEmpty = rows.every((r) => !r.key.trim());
      const next = allEmpty
        ? [{ id: nextRowId(), key: bibKey }]
        : [...rows, { id: nextRowId(), key: bibKey }];
      // Re-derive the command shape for the merged row set (T6-C16).
      const nextType = derivePlural(type, next, bibPackage);
      setRows(next);
      if (nextType !== type) setType(nextType);
      persist({ rows: next, type: nextType });
    },
    [rows, persist, bibPackage, type],
  );

  /* ── Code line (raw LaTeX editor) ────────────────────────────────── */

  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const codeDraftRef = useRef<string | null>(null);
  const codeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const commitCodeDraft = useCallback(() => {
    const v = codeDraftRef.current;
    if (codeDebounceRef.current) {
      clearTimeout(codeDebounceRef.current);
      codeDebounceRef.current = null;
    }
    if (v !== null && v !== cit.command) {
      lastWrittenRef.current = v;
      onUpdateCitation(cit.id, v);
    }
    if (v !== null) {
      // The Code input bypasses the row mutators, so on commit it must resync
      // the local rows/type/flags from the committed command (task 078).
      // Without this the body state stays stale and the next control's
      // `persist()` re-serializes from it — silently dropping the code edit.
      // Safe even when no write fired above (the debounce already echoed the
      // same command): this is exactly what the stale-guard effect would have
      // done had the code path not stamped `lastWrittenRef`.
      syncLocalFromCommand(v);
    }
    codeDraftRef.current = null;
    setCodeDraft(null);
  }, [cit.command, cit.id, onUpdateCitation, syncLocalFromCommand]);

  const updateCodeDraft = useCallback(
    (v: string) => {
      codeDraftRef.current = v;
      setCodeDraft(v);
      if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current);
      codeDebounceRef.current = setTimeout(() => {
        codeDebounceRef.current = null;
        lastWrittenRef.current = v;
        onUpdateCitation(cit.id, v);
      }, 250);
    },
    [cit.id, onUpdateCitation],
  );

  /* ── Overflow popover (* and Aa) ─────────────────────────────────── */
  // Folded onto `<AnchoredMenu>` in task 181 — it had been an `absolute
  // right-0 top-full … z-50` surface with its own `document` mousedown closer,
  // no Escape, no flip and no clamp, in a card body that scrolls inside a panel
  // list. The open state, the anchor rect, the dismissal and the checkbox rows
  // all belong to the primitive now; what is left here is the two booleans.
  //
  // One dismissal semantic DID change, deliberately: the hand-rolled closer
  // exempted the whole CARD ("allow clicks inside the card; otherwise close"),
  // so clicking the Type <select> or the Code field left this popover hanging
  // open beside them. The primitive closes on any click outside the MENU, which
  // is both the house contract and the better behaviour.

  /* ── Header (matches the compressed view in both states) ─────────── */

  // TITLE dialect — design-system-fixed; the per-panel body-font picker
  // (`bodyStyle`) must never touch the header line (it styles the entry
  // rows in the body instead).
  const headerStyle: React.CSSProperties = cardTitleStyle(theme);
  const headerRowSources = rows.filter((r) => r.key.trim());
  const headerRowData = (headerRowSources.length > 0
    ? headerRowSources
    : [{ id: "h_fallback", key: cit.keys[0] || "" }]
  ).map((r) => {
    const key = r.key.trim();
    const entry = key ? bibEntryMap.get(key) : undefined;
    return {
      id: r.id,
      key,
      // DISPLAY — the name logic runs on PROJECTED text, which is safe because
      // the projection can neither create nor destroy the " and " separator or
      // a comma (task 409).
      author: entry
        ? firstThreeAuthorLastNames(bibFieldDisplay(entry, "author") || "")
        : "",
      year: bibFieldDisplay(entry, "year") || bibFieldDisplay(entry, "date") || "",
      title: bibFieldDisplay(entry, "title") || "",
    };
  });
  const hasAnyHeaderKey = headerRowData.some((r) => r.key);
  const headerContent = (
    <div
      className="leading-snug space-y-0.5"
      style={{
        ...headerStyle,
        overflowWrap: "anywhere",
      }}
      data-hint={
        hasAnyHeaderKey
          ? headerRowData
              .map((r) =>
                [r.author || r.key, r.year, r.title]
                  .filter(Boolean)
                  .join(" · "),
              )
              .join("\n")
          : "Citation"
      } aria-label={
                  hasAnyHeaderKey
                    ? headerRowData
                        .map((r) =>
                          [r.author || r.key, r.year, r.title]
                            .filter(Boolean)
                            .join(" · "),
                        )
                        .join("\n")
                    : "Citation"
                }
    >
      {hasAnyHeaderKey ? (
        headerRowData.map((r) => (
          <div key={r.id}>
            <span className="font-semibold">{r.author || r.key}</span>
            {r.year && (
              <>
                <span className="text-ink-body mx-1">&middot;</span>
                <span className="font-semibold">{r.year}</span>
              </>
            )}
            {r.title && (
              <>
                <span className="text-ink-body mx-1">&middot;</span>
                <span className="italic text-ink-body">{r.title}</span>
              </>
            )}
          </div>
        ))
      ) : (
        <span className="text-ink-faint italic">Citation</span>
      )}
    </div>
  );

  /* ── Visual state classes ────────────────────────────────────────── */

  // Task 316: the parked cue moved onto the `unanchored` prop (which carries
  // `cardKey`), so this slot keeps only the drop-target ring. The two used to
  // be exclusive arms of one ternary; they are different axes (a parked card
  // can also be hovered as a drop target), so they now compose.
  //
  // This is the one sanctioned `ring-*` shape (task 503): a DECORATIVE ring on
  // a card root that carries NO `.focus-ring` / `iconbtn-*` / `.topbarbtn`, and
  // reading a real token (`--ring-drag-target`) rather than a raw palette
  // value. `.focus-ring` is UNLAYERED and writes the same `box-shadow`, so a
  // focus indicator added here would silently delete this ring — a card
  // wrapper strips its focus ring anyway (themed selection IS the indicator;
  // STYLE_GUIDE "Interaction" → Focus). Censused, allowlist EMPTY.
  //
  // MEASURED AND NOT PAINTING TODAY, for a reason one mechanism over and
  // filed separately (`inbox/2026-08-31-from-worker-503-card-drop-target-ring-masked`):
  // `PanelCard`'s root carries `style={{ ...themedCardStyle(…) }}`, whose
  // `boxShadow: var(--card-shadow-ambient)` is INLINE and therefore beats
  // every stylesheet rule, this ring included, on every non-popped-out card.
  // The fix belongs to `PanelCard` — it owns that element's box-shadow and has
  // to COMPOSE the halo with the ambient lift — not to a second speller here.
  const stateClass = isDropTarget ? "ring-2 ring-drag-target ring-offset-0" : "";

  const onToggleFromCtx =
    onTogglePopout ??
    (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);

  const types = bibPackage === "natbib" ? NATBIB_TYPES : BIBLATEX_TYPES;

  /* ── Preview (rendered HTML) ─────────────────────────────────────── */

  const preview = useMemo(() => {
    if (!cit.command) return "";
    return getDisplayText(cit.command);
  }, [cit.command, getDisplayText]);

  /* ── Drop button enablement ──────────────────────────────────────────
   * The (re)anchor drop button is disabled while the card is an empty /
   * keyless draft: an unanchored citation with no real citekey can't
   * produce a `\cite{}` atom (no real citekey), so dropping it would plant a
   * keyless atom. The shared `citationCommandOrNull` predicate is the SSOT
   * for this test — the SAME one `useCitations.commandFor` and
   * `citationDropSpec.createAtom` consume, so the button is disabled iff the
   * spec would decline. The button is the upstream half, the spec the
   * downstream defense. An ANCHORED citation always has keys (it came from
   * the prose), so this only ever disables a draft. */
  const dropDisabled = useMemo(
    () => citationCommandOrNull(cit.command) === null,
    [cit.command],
  );

  /* ── Render ──────────────────────────────────────────────────────── */

  const card = (
    <PanelCard
      data-link-card={linkCardKey("citation", cit.id)}
      data-pristine-card-id={cit.id}
      data-card-key={cardKey}
      {...(extraDataAttrs || {})}
      theme={theme}
      selected={isHaloed}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      onTrashClick={!compressed && onDelete ? tryDelete : undefined}
      cardKey={cardKey}
      dropDisabled={dropDisabled}
      isCollapsed={compressed}
      onToggleExpanded={ac.onToggleExpanded}
      // Backlog #13: a draft forces `isExpanded` true (`isDraft || ac.expanded`),
      // so a header toggle would be silently broken — while drafting, the
      // header click SELECTS only and never flips the (pinned-open) body.
      onHeaderActivate={
        isDraft ? () => cardStore.select(ac.ref) : ac.onHeaderActivate
      }
      // Select-only activation must not advertise disclosure semantics
      // (aria-expanded/"Collapse card") for the pinned-open draft body.
      headerDisclosure={!isDraft}
      extraCardClass={`cursor-pointer cursor-grab active:cursor-grabbing ${stateClass}`}
      draggable={!isDraft && pickerRowId === null && codeDraft === null}
      onDragStart={handleDragStart}
      onDragOver={handleCardDragOver}
      onDragLeave={handleCardDragLeave}
      onDrop={handleCardDrop}
      className={wrapperClassName}
      style={wrapperStyle}
      onClick={(e) => {
        if (isDraft) return;
        const card = (e.currentTarget as HTMLElement).closest(
          "[data-card]",
        ) as HTMLElement | null;
        ac.onBodyActivate({
          onSelect,
          jump: isAnchored ? () => onJump(card) : undefined,
        });
      }}
      onMouseEnter={() => cardStore.setHover(ac.ref)}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id)
          cardStore.setHover(null);
      }}
      kind="citation"
      canJump={!isDraft}
      onJump={(e) =>
        onJump(
          (e.currentTarget as HTMLElement).closest(
            "[data-card]",
          ) as HTMLElement | null,
        )
      }
      // Task 316: one declaration for the parked look, its tooltip and the key
      // that makes the gesture reachable. `canAnchor` UNIFIES the two questions
      // that used to be asked separately — the tooltip was gated on `!isDraft`
      // and the button on `dropDisabled`, so a keyless UNANCHORED citation
      // (reachable without a draft: `persist()` with no valid rows writes an
      // empty command back to a real citation) promised a drag its own button
      // refused. Both facts now feed one answer, and the parked LOOK survives
      // either way, since a card that cannot anchor is the most parked of all.
      unanchored={
        !isAnchored
          ? { kind: "citation", cardKey, canAnchor: !isDraft && !dropDisabled }
          : undefined
      }
    >
      {compressed ? (
        <div className="px-3 py-1.5">{headerContent}</div>
      ) : (
        <>
          <div
            className={`${PANEL.cardBody} relative min-w-0${
              isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Entry rows are BODY CONTENT — the per-panel font picker
                (size stepper included) applies here, never to the header
                or the meta strip below. */}
            <ul
              data-panel-kind="citation"
              className="flex flex-col gap-2 list-none m-0 p-0"
              style={bodyStyle}
            >
              {rows.map((row) => (
                <CitationKeyRow
                  key={row.id}
                  row={row}
                  bibEntryMap={bibEntryMap}
                  canRemove={rows.length > 1 || row.key.trim().length > 0}
                  bibExpanded={
                    !!row.key.trim() && expandedBibKey === row.key.trim()
                  }
                  entryInLibrary={!!lookupEntry(row.key.trim())}
                  pickerOpenHere={pickerRowId === row.id && pickerExternalInputEl !== null}
                  pickerQuery={pickerRowId === row.id ? pickerExternalQuery : null}
                  onToggleBib={() => toggleBibKey(row.key.trim())}
                  onOpenPicker={() => openPickerFor(row.id)}
                  onOpenPickerForInput={(el, q) => openPickerForInput(row.id, el, q)}
                  onPickerQueryChange={(q) => setPickerExternalQuery(q)}
                  onChangePostnote={(p) => setRowPostnote(row.id, p)}
                  onRemove={() => removeRow(row.id)}
                  registerAnchor={(el) => {
                    if (el) rowAnchorRefs.current.set(row.id, el);
                    else rowAnchorRefs.current.delete(row.id);
                  }}
                />
              ))}
            </ul>

            {rows.some((r) => r.key.trim()) && (
              <button
                type="button"
                onClick={addRow}
                className="mt-2 inline-flex items-center gap-1 text-xs text-ink-subtle hover:text-ink-body transition-colors"
                data-hint="Add another reference"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add reference…
              </button>
            )}
          </div>

          <div
            className={`border-t transition-colors ${
              isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"
            }`}
            style={
              isSelected
                ? { borderTopColor: theme.separatorSelected }
                : undefined
            }
          />

          <div
            className="px-3 py-2 bg-surface-muted/30 space-y-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              <CardMetaLabel className="shrink-0">Type</CardMetaLabel>
              <Select
                value={type}
                onChange={(e) => {
                  // Honor the user's base-command choice, but let the plural/
                  // singular number follow the live rows (T6-C16): picking
                  // `\cites` with one key normalizes back to `\cite`, and the
                  // chosen base promotes if the rows warrant it.
                  const v = derivePlural(e.target.value, rows, bibPackage);
                  setType(v);
                  persist({ type: v });
                }}
                density="dense"
                className="text-xs card-mono px-1.5 py-0.5 min-w-0"
              >
                {types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <AnchoredMenu
                ariaLabel="More options"
                align="end"
                triggerHint="More options"
                triggerAriaLabel="More options"
                triggerClassName="iconbtn-sm text-ink-body"
                menuClassName="w-44"
                trigger={() => (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <circle cx="5" cy="12" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="19" cy="12" r="1.6" />
                  </svg>
                )}
              >
                {/* No `closeOnInsideClick`: these are toggles the user flips in
                    runs, and the shell's default is "the caller decides", so the
                    menu survives repeated activation exactly as the two bare
                    <label>s did. */}
                <MenuToggleRow
                  id="starred"
                  label="Full author list"
                  leading={<span className="font-mono" aria-hidden="true">*</span>}
                  checked={starred}
                  onToggle={() => {
                    const next = !starred;
                    setStarred(next);
                    persist({ starred: next });
                  }}
                />
                <MenuToggleRow
                  id="capitalized"
                  label="Sentence start"
                  leading={<span className="font-mono" aria-hidden="true">Aa</span>}
                  checked={capitalized}
                  onToggle={() => {
                    const next = !capitalized;
                    setCapitalized(next);
                    persist({ capitalized: next });
                  }}
                />
              </AnchoredMenu>
            </div>

            <div className="flex items-center gap-1.5 min-w-0">
              <CardMetaLabel className="shrink-0">Code</CardMetaLabel>
              {codeDraft !== null ? (
                <Input
                  ref={codeInputRef}
                  autoFocus
                  value={codeDraft}
                  onChange={(e) => updateCodeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") {
                      e.preventDefault();
                      commitCodeDraft();
                    }
                  }}
                  onBlur={commitCodeDraft}
                  spellCheck={false}
                  density="dense"
                  className="text-[10px] card-mono px-1 py-0 flex-1 min-w-0"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    codeDraftRef.current = cit.command;
                    setCodeDraft(cit.command);
                  }}
                  className="text-[10px] card-mono text-ink-body truncate flex-1 min-w-0 text-left bg-transparent border border-transparent rounded px-1 py-0 cursor-text hover:border-edge-hover hover:bg-surface transition-colors"
                  {...iconHint({ label: "Edit raw LaTeX" })}
                >
                  {cit.command || (
                    <span className="text-ink-body italic">
                      no command yet
                    </span>
                  )}
                </button>
              )}
            </div>

            {preview && (
              <div className="flex items-center gap-1.5 min-w-0">
                <CardMetaLabel className="shrink-0">Preview</CardMetaLabel>
                <span
                  className="card-content-row text-ink-body truncate"
                  style={{ fontFamily: PREVIEW_SERIF_STACK }}
                  // SECURITY (backlog #28): `preview` (formatInlineCitation)
                  // interpolates raw .bib field text; escape everything then
                  // restore only the formatter's known-safe <i>/<b> pairs.
                  dangerouslySetInnerHTML={{
                    __html: sanitizeInlineCitationHtml(preview),
                  }}
                />
              </div>
            )}
          </div>
        </>
      )}
    </PanelCard>
  );

  const expandedBibEntry = expandedBibKey
    ? bibEntryMap.get(expandedBibKey)
    : undefined;
  const canRenderBib =
    !!expandedBibEntry &&
    !!getFormattedBib &&
    !!getAnnotation &&
    !!setAnnotation &&
    !!onRequestReview &&
    !!onCancelReview &&
    !!getReviewStatus &&
    !!onUpdateBibEntry &&
    !!onUpdateBibKeyAndType;

  const bibInline = canRenderBib ? (
    <div
      className="ml-4 overflow-y-auto"
      style={
        isPoppedOut
          ? undefined
          : { maxHeight: "max(0px, calc(var(--dock-slot-frame-h, 80vh) - 160px))" }
      }
      onClick={(e) => e.stopPropagation()}
    >
      <BibEntryCard
        entry={expandedBibEntry!}
        isSelected={false}
        onClick={() => {}}
        getAnnotation={getAnnotation!}
        setAnnotation={setAnnotation!}
        onRequestReview={onRequestReview!}
        onCancelReview={onCancelReview!}
        getReviewStatus={getReviewStatus!}
        onUpdateBibEntry={onUpdateBibEntry!}
        onUpdateBibKeyAndType={onUpdateBibKeyAndType!}
        bibPackage={bibPackage}
        bibEntries={bibEntries}
        isCited
      />
    </div>
  ) : null;

  const cardEl = (
    <>
      {bibInline ? (
        <div className="space-y-2">
          {card}
          {bibInline}
        </div>
      ) : (
        card
      )}
      <CitekeyPicker
        open={pickerRowId !== null}
        anchorEl={pickerAnchor}
        onClose={closePicker}
        paperBibEntries={bibEntries}
        initialQuery={
          pickerRowId
            ? rows.find((r) => r.id === pickerRowId)?.key || ""
            : ""
        }
        onSelectKey={(k) => {
          if (pickerRowId) setRowKey(pickerRowId, k);
        }}
        onAddBibEntry={onAddBibEntry}
        externalQuery={pickerExternalQuery ?? undefined}
        externalInputEl={pickerExternalInputEl}
      />
      {deleteConfirmDialog}
    </>
  );

  return cardEl;
}

/* ── CitationKeyRow ──────────────────────────────────────────────── */

interface CitationKeyRowProps {
  row: UiRow;
  bibEntryMap: Map<string, BibEntry>;
  canRemove: boolean;
  bibExpanded: boolean;
  /** True when this row's citekey resolves to a Virgil Library entry — gates
   *  the shared "open entry" link. */
  entryInLibrary?: boolean;
  /** True iff the picker is currently open on this row's empty input. The
   *  card owns the open/close state; the row uses this to know whether
   *  its input is the live search field. */
  pickerOpenHere: boolean;
  pickerQuery: string | null;
  onToggleBib: () => void;
  /** Open the picker for a filled-row citekey button (jump-to-change). */
  onOpenPicker: () => void;
  /** Open the picker from this row's empty merged input. */
  onOpenPickerForInput: (inputEl: HTMLInputElement, initialQuery: string) => void;
  onPickerQueryChange: (q: string) => void;
  onChangePostnote: (postnote: string) => void;
  onRemove: () => void;
  registerAnchor: (el: HTMLElement | null) => void;
}

function CitationKeyRow({
  row,
  bibEntryMap,
  canRemove,
  bibExpanded,
  entryInLibrary,
  pickerOpenHere,
  pickerQuery,
  onToggleBib,
  onOpenPicker,
  onOpenPickerForInput,
  onPickerQueryChange,
  onChangePostnote,
  onRemove,
  registerAnchor,
}: CitationKeyRowProps) {
  const trimmed = row.key.trim();
  const entry = trimmed ? bibEntryMap.get(trimmed) : undefined;
  const [pgOpen, setPgOpen] = useState(!!row.postnote);
  const [pgDraft, setPgDraft] = useState(row.postnote || "");
  const pgInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPgDraft(row.postnote || "");
    if (row.postnote) setPgOpen(true);
  }, [row.postnote]);

  useEffect(() => {
    if (pgOpen && !row.postnote) {
      pgInputRef.current?.focus();
    }
  }, [pgOpen, row.postnote]);

  const commitPg = () => {
    if (pgDraft === (row.postnote || "")) return;
    onChangePostnote(pgDraft);
  };

  const copyCitekey = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trimmed) return;
    void navigator.clipboard.writeText(trimmed).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // The +range / postnote affordance trails the citation display line inline
  // (per key — this component renders exactly one key). Rendered at META tier
  // (10px, muted) so it reads as an apparatus control, distinct from the
  // body-font citation text it trails. When a postnote is set the input is
  // always visible (its value is the range); the empty "+range" prompt reveals
  // on row hover so an un-ranged citation stays clean.
  const pgControl = (
    <span className="ml-1.5 inline-flex items-center gap-1 align-baseline whitespace-nowrap text-[10px] text-[var(--muted)]">
      {pgOpen ? (
        <>
          <Input
            ref={pgInputRef}
            value={pgDraft}
            onChange={(e) => setPgDraft(e.target.value)}
            onBlur={commitPg}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitPg();
                pgInputRef.current?.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setPgDraft(row.postnote || "");
                setPgOpen(!!row.postnote);
                pgInputRef.current?.blur();
              }
            }}
            placeholder="range"
            density="dense"
            className="w-14 text-[10px] card-mono px-1 py-0"
          />
          {!row.postnote && pgDraft === "" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPgOpen(false);
              }}
              className="text-[var(--muted)] hover:text-ink-body p-0.5 focus-ring"
              {...iconHint({ label: "Close" })}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPgOpen(true);
          }}
          className="text-[10px] tracking-wide text-[var(--muted)] hover:text-ink-body px-1 py-0 rounded hover-on-light opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          data-hint="Add a page range or locator"
        >
          +range
        </button>
      )}
    </span>
  );

  return (
    <li className="group/row flex flex-col gap-0.5">
      {/* Top line: filled = formatted citation. Empty = search input. */}
      {/* Entry-row text sizes INHERIT from the card's body <ul> (the
          per-panel font picker / size stepper) — no local px pins. */}
      {trimmed ? (
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className="text-ink-body mt-[1px] select-none leading-none"
          >
            •
          </span>
          <div className="flex-1 min-w-0 leading-snug text-ink-body">
            {/* Citation display is inline so the trailing +range control
                flows at the END of the line (task 010). */}
            {entry ? (
              <>
                <span className="font-medium">
                  {fullAuthorsForRow(bibFieldDisplay(entry, "author") || "") ||
                    trimmed}
                </span>
                {(bibFieldDisplay(entry, "year") ||
                  bibFieldDisplay(entry, "date")) && (
                  <>
                    <span>. </span>
                    <span className="font-medium">
                      {bibFieldDisplay(entry, "year") ||
                        bibFieldDisplay(entry, "date")}
                    </span>
                  </>
                )}
                {bibFieldDisplay(entry, "title") && (
                  <>
                    <span>. </span>
                    <span className="italic">
                      “{bibFieldDisplay(entry, "title")}”
                    </span>
                  </>
                )}
                {venueForRow(entry) && (
                  <>
                    <span>. </span>
                    <span>
                      {venueForRow(entry)}
                      {/\.$/.test(venueForRow(entry)) ? "" : "."}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="text-danger">
                <span className="card-mono">{trimmed}</span> — not in your
                bibliography
              </span>
            )}
            {pgControl}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="text-ink-body select-none leading-none"
          >
            •
          </span>
          <EmptyRowSearchInput
            pickerOpenHere={pickerOpenHere}
            pickerQuery={pickerQuery}
            onOpenPickerForInput={onOpenPickerForInput}
            onPickerQueryChange={onPickerQueryChange}
            registerAnchor={registerAnchor}
          />
          {canRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ink-body hover:text-danger hover-on-light opacity-0 group-hover/row:opacity-100 focus-ring"
              {...iconHint({ label: "Remove this row" })}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Bottom line: citekey controls — META tier (10px, the one meta
          gray), fixed: the body-font picker never applies here. */}
      {trimmed && (
        <div className="pl-[14px] flex items-center gap-1.5 text-[10px] text-[var(--muted)] min-w-0">
          <button
            type="button"
            ref={(el) => registerAnchor(el)}
            onClick={(e) => {
              e.stopPropagation();
              onOpenPicker();
            }}
            className="card-mono text-[var(--muted)] hover:text-ink-body underline decoration-dotted decoration-edge-hover underline-offset-2 truncate min-w-0"
            data-hint="Click to change" aria-label="Click to change"
          >
            {trimmed}
          </button>
          <button
            type="button"
            onClick={copyCitekey}
            className="iconbtn-sm text-[var(--muted)] hover:text-ink-body"
            {...iconHint({ label: copied ? "Copied" : "Copy citekey" })}
          >
            {copied ? (
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-positive-ink"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          {entry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleBib();
              }}
              className={`text-[10px] uppercase tracking-wide px-1 py-0 rounded ${
                bibExpanded
                  ? "text-ink-body bg-edge-subtle"
                  : "text-[var(--muted)] hover:text-ink-body hover-on-light"
              }`}
              data-hint={bibExpanded ? "Hide bib entry" : "Show bib entry"}
            >
              Bib
            </button>
          )}
          {entryInLibrary && trimmed && (
            <OpenEntryLink
              citekey={trimmed}
              className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted)] hover:text-ink-body px-1 py-0 rounded hover-on-light"
            />
          )}
          {/* +range moved to trail the citation display line above (task 010). */}
          <div className="flex-1" aria-hidden />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-[var(--muted)] hover:text-danger hover-on-light opacity-0 group-hover/row:opacity-100 ${
              !canRemove ? "pointer-events-none" : ""
            } focus-ring`}
            {...iconHint({ label: "Remove this key" })}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </li>
  );
}

/* ── EmptyRowSearchInput ─────────────────────────────────────────── */

/** Merged "Add from library…" + search field. When the user focuses it,
 *  the card opens its picker with this input as the external search field
 *  (so the dropdown sprouts directly beneath, with no second input). */
function EmptyRowSearchInput({
  pickerOpenHere,
  pickerQuery,
  onOpenPickerForInput,
  onPickerQueryChange,
  registerAnchor,
}: {
  pickerOpenHere: boolean;
  pickerQuery: string | null;
  onOpenPickerForInput: (inputEl: HTMLInputElement, initialQuery: string) => void;
  onPickerQueryChange: (q: string) => void;
  registerAnchor: (el: HTMLElement | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The picker owns the query when open; we display whatever it has.
  const displayValue = pickerOpenHere ? pickerQuery ?? "" : "";

  return (
    <Input
      ref={(el) => {
        inputRef.current = el;
        registerAnchor(el);
      }}
      value={displayValue}
      placeholder="Add from library…"
      onFocus={(e) => {
        if (!pickerOpenHere) {
          onOpenPickerForInput(e.currentTarget, "");
        }
      }}
      onChange={(e) => {
        if (!pickerOpenHere) {
          onOpenPickerForInput(e.currentTarget, e.target.value);
        } else {
          onPickerQueryChange(e.target.value);
        }
      }}
      onClick={(e) => e.stopPropagation()}
      tone="transparent"
      density="dense"
      className="flex-1 min-w-0 px-2 py-1 border-dashed hover:border-edge-hover focus:border-solid"
    />
  );
}
