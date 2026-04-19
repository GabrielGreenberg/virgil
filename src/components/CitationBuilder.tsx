"use client";

import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import type { BibEntry } from "@/lib/types";
import type { ParsedCiteKey } from "@/lib/bib-parser";
import { parseCiteCommand, serializeCiteCommand, formatMinimalCitation } from "@/lib/bib-parser";

/** Imperative handle exposed to parents — used to commit current state
 *  when dismissed by click-outside rather than a Save/Cancel button. */
export interface CitationBuilderHandle {
  /** Commit the current command via onSave if valid; no-op otherwise. */
  commit: () => void;
  /** Whether the current command differs from the initial command. */
  isDirty: () => boolean;
}

/* ── Command type options per package ─────────────────────────────── */

const NATBIB_TYPES = [
  { value: "citep", label: "\\citep", desc: "(Author, Year)" },
  { value: "citet", label: "\\citet", desc: "Author (Year)" },
  { value: "cite", label: "\\cite", desc: "Author (Year)" },
  { value: "citealt", label: "\\citealt", desc: "Author Year" },
  { value: "citealp", label: "\\citealp", desc: "Author, Year" },
  { value: "citeauthor", label: "\\citeauthor", desc: "Author" },
  { value: "citeyear", label: "\\citeyear", desc: "Year" },
  { value: "citeyearpar", label: "\\citeyearpar", desc: "(Year)" },
];

const BIBLATEX_TYPES = [
  { value: "autocite", label: "\\autocite", desc: "(Author, Year)" },
  { value: "textcite", label: "\\textcite", desc: "Author (Year)" },
  { value: "parencite", label: "\\parencite", desc: "(Author, Year)" },
  { value: "cite", label: "\\cite", desc: "Author Year" },
  { value: "footcite", label: "\\footcite", desc: "[fn: Author, Year]" },
  { value: "smartcite", label: "\\smartcite", desc: "(Author, Year)" },
  { value: "fullcite", label: "\\fullcite", desc: "Full bibliography entry" },
  { value: "footfullcite", label: "\\footfullcite", desc: "[fn: full entry]" },
  { value: "citeauthor", label: "\\citeauthor", desc: "Author" },
  { value: "citeyear", label: "\\citeyear", desc: "Year" },
  { value: "citetitle", label: "\\citetitle", desc: "Title" },
  { value: "citedate", label: "\\citedate", desc: "Date" },
  { value: "citeurl", label: "\\citeurl", desc: "URL" },
  { value: "nocite", label: "\\nocite", desc: "(no inline output)" },
];

/* ── Key search dropdown ──────────────────────────────────────────── */

function KeySearchDropdown({
  value,
  onChange,
  bibEntries,
  placeholder,
}: {
  value: string;
  onChange: (key: string) => void;
  bibEntries: BibEntry[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setSearch(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (dropRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const update = () => {
      const r = inputRef.current!.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 2, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return bibEntries.slice(0, 20);
    return bibEntries.filter((e) =>
      e.key.toLowerCase().includes(q) ||
      (e.fields.author || "").toLowerCase().includes(q) ||
      (e.fields.title || "").toLowerCase().includes(q)
    ).slice(0, 20);
  }, [search, bibEntries]);

  return (
    <div className="relative flex-1" ref={dropRef}>
      <input
        ref={inputRef}
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onChange(search); setOpen(false); }
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => { setTimeout(() => { onChange(search); }, 150); }}
        placeholder={placeholder || "key"}
        className="w-full text-xs font-mono border border-edge-hover rounded px-2 py-1 bg-surface"
      />
      {open && filtered.length > 0 && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", left: pos.left, top: pos.top, minWidth: pos.width }}
          className="bg-surface border border-edge-subtle rounded-md shadow-lg z-50 max-h-64 overflow-y-auto w-max max-w-[32rem]"
        >
          {filtered.map((e) => (
            <button
              key={e.key}
              onMouseDown={(ev) => { ev.preventDefault(); onChange(e.key); setSearch(e.key); setOpen(false); }}
              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-surface-muted leading-snug line-clamp-2 whitespace-normal break-words"
            >
              <span className="font-mono text-ink-body">{e.key}</span>
              <span className="text-ink-muted">
                {"  "}
                {formatMinimalCitation(e.key, [e])}
                {e.fields.title ? ` \u2014 ${e.fields.title}` : ""}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ── Main builder ─────────────────────────────────────────────────── */

interface CitationBuilderProps {
  initialCommand?: string;
  bibPackage: string;
  bibEntries: BibEntry[];
  getDisplayText: (command: string) => string;
  onSave: (command: string) => void;
  onCancel: () => void;
  saveLabel?: string; // "Add citation" | "Save"
}

interface BuilderEntry {
  id: string;
  key: string;
  prenote: string;
  postnote: string;
}

let _entryIdCounter = 0;
function nextEntryId() { return `be_${++_entryIdCounter}`; }

const CitationBuilder = forwardRef<CitationBuilderHandle, CitationBuilderProps>(function CitationBuilder({
  initialCommand,
  bibPackage,
  bibEntries,
  getDisplayText,
  onSave,
  onCancel,
  saveLabel = "Add citation",
}, ref) {
  const types = bibPackage === "natbib" ? NATBIB_TYPES : BIBLATEX_TYPES;

  // Parse initial command (if editing)
  const initial = useMemo(() => {
    if (!initialCommand) return null;
    return parseCiteCommand(initialCommand);
  }, [initialCommand]);

  const [cmdType, setCmdType] = useState(() => {
    if (initial) {
      // Map plural back to singular for the dropdown
      let t = initial.type;
      if (t.endsWith("s") && !["cites"].includes(t)) {
        // textcites → textcite, parencites → parencite, etc.
        t = t.slice(0, -1);
      }
      if (t === "cites") t = "cite";
      return t;
    }
    return types[0].value;
  });

  const [starred, setStarred] = useState(initial?.starred ?? false);
  const [capitalized, setCapitalized] = useState(initial?.capitalized ?? false);

  const [entries, setEntries] = useState<BuilderEntry[]>(() => {
    if (initial && initial.entries.length > 0) {
      return initial.entries.map((e) => ({
        id: nextEntryId(),
        key: e.key,
        prenote: e.prenote || "",
        postnote: e.postnote || "",
      }));
    }
    return [{ id: nextEntryId(), key: "", prenote: "", postnote: "" }];
  });

  // Build the command string from current state
  const command = useMemo(() => {
    const parsedEntries: ParsedCiteKey[] = entries
      .filter((e) => e.key.trim())
      .map((e) => ({
        key: e.key.trim(),
        prenote: e.prenote || undefined,
        postnote: e.postnote || undefined,
      }));
    if (parsedEntries.length === 0) return "";
    return serializeCiteCommand(
      { type: cmdType, starred, capitalized, entries: parsedEntries },
      bibPackage
    );
  }, [cmdType, starred, capitalized, entries, bibPackage]);

  const preview = useMemo(() => {
    if (!command) return "";
    return getDisplayText(command);
  }, [command, getDisplayText]);

  const updateEntry = useCallback((id: string, patch: Partial<BuilderEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.length > 1 ? prev.filter((e) => e.id !== id) : prev);
  }, []);

  const addEntry = useCallback(() => {
    setEntries((prev) => [...prev, { id: nextEntryId(), key: "", prenote: "", postnote: "" }]);
  }, []);

  const handleSave = () => {
    if (command) onSave(command);
  };

  // Expose an imperative commit() so parents can save the current state
  // on click-outside (no Save/Cancel button press required). The handle
  // object is refreshed whenever `command` or `onSave` changes, so
  // `commit()` always reflects the latest builder state.
  useImperativeHandle(
    ref,
    () => ({
      commit: () => {
        if (command && command !== initialCommand) onSave(command);
      },
      isDirty: () => !!command && command !== initialCommand,
    }),
    [command, initialCommand, onSave],
  );

  const isNatbib = bibPackage === "natbib";

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3">
      {/* Command type row */}
      <div className="flex items-center gap-2 mb-2.5">
        <select
          value={cmdType}
          onChange={(e) => setCmdType(e.target.value)}
          className="text-xs font-mono border border-edge-hover rounded px-1.5 py-1 bg-surface"
        >
          {types.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <label
          className="flex items-center gap-1 text-xs text-ink-subtle cursor-pointer select-none"
          title="Full author list (e.g. \citet*)"
        >
          <input
            type="checkbox"
            checked={starred}
            onChange={(e) => setStarred(e.target.checked)}
            className="rounded border-edge-hover"
          />
          <span className="font-mono">*</span>
        </label>
        <label
          className="flex items-center gap-1 text-xs text-ink-subtle cursor-pointer select-none"
          title="Capitalize first letter for sentence start (e.g. \Citet)"
        >
          <input
            type="checkbox"
            checked={capitalized}
            onChange={(e) => setCapitalized(e.target.checked)}
            className="rounded border-edge-hover"
          />
          <span className="font-mono">Aa</span>
        </label>
      </div>

      {/* Key entries */}
      <div className="space-y-2 mb-2.5">
        {entries.map((entry, idx) => (
          <div key={entry.id} className="rounded-md border border-edge-subtle bg-surface p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <KeySearchDropdown
                value={entry.key}
                onChange={(k) => updateEntry(entry.id, { key: k })}
                bibEntries={bibEntries}
                placeholder="citation key"
              />
              {entries.length > 1 && (
                <button
                  onClick={() => removeEntry(entry.id)}
                  className="text-ink-muted hover:text-danger p-0.5 transition-colors"
                  title="Remove this reference"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            {/* Pre/post notes — per key for biblatex, shared (only on first) for natbib */}
            {(!isNatbib || idx === 0) && (
              <div className="flex gap-1.5 mt-1">
                <input
                  type="text"
                  value={entry.prenote}
                  onChange={(e) => {
                    if (isNatbib) {
                      // Natbib: apply same pre/post to all entries
                      setEntries((prev) => prev.map((en) => ({ ...en, prenote: e.target.value })));
                    } else {
                      updateEntry(entry.id, { prenote: e.target.value });
                    }
                  }}
                  placeholder="pre-note"
                  className="flex-1 text-xs border border-edge-subtle rounded px-1.5 py-0.5 bg-surface-muted/50 placeholder:text-ink-faint"
                />
                <input
                  type="text"
                  value={entry.postnote}
                  onChange={(e) => {
                    if (isNatbib) {
                      setEntries((prev) => prev.map((en) => ({ ...en, postnote: e.target.value })));
                    } else {
                      updateEntry(entry.id, { postnote: e.target.value });
                    }
                  }}
                  placeholder="post-note"
                  className="flex-1 text-xs border border-edge-subtle rounded px-1.5 py-0.5 bg-surface-muted/50 placeholder:text-ink-faint"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add reference button */}
      <button
        onClick={addEntry}
        className="text-xs text-ink-subtle hover:text-ink-body mb-2.5 flex items-center gap-1 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add reference
      </button>

      {/* Preview */}
      {preview && preview !== command && (
        <div className="text-xs text-ink-subtle mb-2.5 truncate">
          <span className="text-ink-muted">Preview:</span>{" "}
          <span className="citation-preview" dangerouslySetInnerHTML={{ __html: preview.replace(/<\/?(?!\/?[ib]>)[^>]+>/gi, "") }} />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={onCancel}
          className="text-xs text-ink-muted hover:text-ink-body transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!command}
          className="text-xs px-2.5 py-1 bg-stone-700 text-white rounded hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
});

export default CitationBuilder;
