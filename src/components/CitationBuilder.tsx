"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { BibEntry } from "@/lib/types";
import { formatMinimalCitation } from "@/lib/bib-parser";

/* ── Command definitions per package ──────────────────────────────── */

const NATBIB_COMMANDS = [
  { value: "citep", label: "\\citep", desc: "Parenthetical: (Author, Year)" },
  { value: "citet", label: "\\citet", desc: "Textual: Author (Year)" },
  { value: "cite", label: "\\cite", desc: "Default: Author (Year)" },
  { value: "citealt", label: "\\citealt", desc: "No parens: Author Year" },
  { value: "citealp", label: "\\citealp", desc: "No parens: Author, Year" },
  { value: "citeauthor", label: "\\citeauthor", desc: "Author name only" },
  { value: "citeyear", label: "\\citeyear", desc: "Year only" },
  { value: "citeyearpar", label: "\\citeyearpar", desc: "(Year)" },
];

const BIBLATEX_COMMANDS = [
  { value: "parencite", label: "\\parencite", desc: "Parenthetical: (Author, Year)" },
  { value: "textcite", label: "\\textcite", desc: "Textual: Author (Year)" },
  { value: "cite", label: "\\cite", desc: "Default citation" },
  { value: "autocite", label: "\\autocite", desc: "Context-sensitive" },
  { value: "footcite", label: "\\footcite", desc: "Footnote citation" },
  { value: "citeauthor", label: "\\citeauthor", desc: "Author name only" },
  { value: "citeyear", label: "\\citeyear", desc: "Year only" },
];

/** Map bare command names from pendingCreate (e.g. "\\citep") to a command value */
function parsePartialCommand(partial: string): { cmd: string; starred: boolean; capitalized: boolean } | null {
  const m = partial.match(/^\\([A-Za-z]+)(\*?)$/);
  if (!m) return null;
  let cmd = m[1];
  const starred = m[2] === "*";
  const capitalized = cmd[0] >= "A" && cmd[0] <= "Z";
  if (capitalized) cmd = cmd[0].toLowerCase() + cmd.slice(1);
  return { cmd, starred, capitalized };
}

/* ── Props ────────────────────────────────────────────────────────── */

interface CitationBuilderProps {
  bibEntries: BibEntry[];
  bibPackage: string;
  pendingCreate: string;
  getDisplayText: (command: string) => string;
  onSubmit: (command: string) => void;
  onCancel: () => void;
}

/* ── Component ────────────────────────────────────────────────────── */

export default function CitationBuilder({
  bibEntries,
  bibPackage,
  pendingCreate,
  getDisplayText,
  onSubmit,
  onCancel,
}: CitationBuilderProps) {
  /* ── Mode: builder vs raw ─────────────────────────────────────── */
  const [mode, setMode] = useState<"builder" | "raw">("builder");

  /* ── Raw mode state ───────────────────────────────────────────── */
  const [rawCmd, setRawCmd] = useState(pendingCreate);
  const rawRef = useRef<HTMLInputElement>(null);

  /* ── Builder mode state ───────────────────────────────────────── */
  const commands = bibPackage === "natbib" ? NATBIB_COMMANDS : BIBLATEX_COMMANDS;
  const defaultCmd = bibPackage === "natbib" ? "citep" : "parencite";

  // Parse pendingCreate to pre-fill builder
  const initial = useMemo(() => parsePartialCommand(pendingCreate), [pendingCreate]);

  const [cmdType, setCmdType] = useState(
    initial && commands.some((c) => c.value === initial.cmd) ? initial.cmd : defaultCmd
  );
  const [starred, setStarred] = useState(initial?.starred ?? false);
  const [capitalized, setCapitalized] = useState(initial?.capitalized ?? false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [prenote, setPrenote] = useState("");
  const [postnote, setPostnote] = useState("");

  /* ── Key autocomplete state ───────────────────────────────────── */
  const [keySearch, setKeySearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filter bib entries by search term, excluding already-selected keys
  const filteredEntries = useMemo(() => {
    const q = keySearch.toLowerCase().trim();
    const selected = new Set(selectedKeys);
    const pool = bibEntries.filter((e) => !selected.has(e.key));
    if (!q) return pool.slice(0, 20);
    return pool
      .filter((e) => {
        const hay = `${e.key} ${e.fields.author || ""} ${e.fields.title || ""} ${e.fields.year || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 20);
  }, [keySearch, bibEntries, selectedKeys]);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [filteredEntries.length]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Auto-focus the key search field on mount in builder mode
  useEffect(() => {
    if (mode === "builder") {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [mode]);

  // Auto-focus raw input when switching to raw mode
  useEffect(() => {
    if (mode === "raw") {
      setTimeout(() => rawRef.current?.focus(), 50);
    }
  }, [mode]);

  /* ── Command composition ──────────────────────────────────────── */
  const composedCommand = useMemo(() => {
    if (selectedKeys.length === 0) return "";

    // Build command name
    let name = cmdType;
    if (capitalized) name = name[0].toUpperCase() + name.slice(1);
    let cmd = `\\${name}`;
    if (starred) cmd += "*";

    // Optional notes
    if (prenote && postnote) {
      cmd += `[${prenote}][${postnote}]`;
    } else if (postnote) {
      cmd += `[${postnote}]`;
    } else if (prenote) {
      // prenote without postnote: need both brackets
      cmd += `[${prenote}][]`;
    }

    // Keys — biblatex multi-cite commands use separate braces
    const isMultiCite = /^(cites|textcites|parencites|autocites|footcites)$/.test(cmdType);
    if (isMultiCite) {
      cmd += selectedKeys.map((k) => `{${k}}`).join("");
    } else {
      cmd += `{${selectedKeys.join(",")}}`;
    }

    return cmd;
  }, [cmdType, starred, capitalized, selectedKeys, prenote, postnote]);

  const preview = useMemo(() => {
    if (!composedCommand) return "";
    return getDisplayText(composedCommand);
  }, [composedCommand, getDisplayText]);

  /* ── Handlers ─────────────────────────────────────────────────── */

  const addKey = useCallback((key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setKeySearch("");
    setDropdownOpen(false);
    setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  const removeKey = useCallback((key: string) => {
    setSelectedKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  const handleKeyInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (dropdownOpen) {
        setDropdownOpen(false);
        e.stopPropagation();
      } else {
        onCancel();
      }
      return;
    }
    if (e.key === "Backspace" && keySearch === "" && selectedKeys.length > 0) {
      removeKey(selectedKeys[selectedKeys.length - 1]);
      return;
    }
    if (!dropdownOpen || filteredEntries.length === 0) {
      if (e.key === "Enter" && composedCommand) {
        onSubmit(composedCommand);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filteredEntries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      addKey(filteredEntries[highlightIdx].key);
    }
  };

  const handleBuilderSubmit = () => {
    if (composedCommand) onSubmit(composedCommand);
  };

  const handleRawSubmit = () => {
    const cmd = rawCmd.trim();
    if (!cmd) return;
    const full = cmd.includes("{") ? cmd : cmd + "{}";
    onSubmit(full);
  };

  /* ── Scroll highlighted dropdown item into view ───────────────── */
  useEffect(() => {
    if (!dropdownOpen || !dropdownRef.current) return;
    const item = dropdownRef.current.children[highlightIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, dropdownOpen]);

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="mx-2 mt-2 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3">
      {/* Header with mode tabs */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-stone-500">New citation</div>
        <div className="flex rounded-md border border-stone-200 overflow-hidden">
          <button
            onClick={() => setMode("builder")}
            className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
              mode === "builder"
                ? "bg-stone-700 text-white"
                : "bg-white text-stone-500 hover:bg-stone-50"
            }`}
          >
            Builder
          </button>
          <button
            onClick={() => setMode("raw")}
            className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
              mode === "raw"
                ? "bg-stone-700 text-white"
                : "bg-white text-stone-500 hover:bg-stone-50"
            }`}
          >
            Raw
          </button>
        </div>
      </div>

      {mode === "raw" ? (
        /* ── Raw mode ─────────────────────────────────────────────── */
        <div>
          <div className="flex gap-1.5">
            <input
              ref={rawRef}
              type="text"
              value={rawCmd}
              onChange={(e) => setRawCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRawSubmit();
                if (e.key === "Escape") onCancel();
              }}
              placeholder="\citep{key}"
              className="flex-1 text-xs font-mono border border-stone-300 rounded px-2 py-1 bg-white"
            />
            <button
              onClick={handleRawSubmit}
              className="text-xs px-2 py-1 bg-stone-700 text-white rounded hover:bg-stone-800"
            >
              Add
            </button>
          </div>
          {rawCmd && getDisplayText(rawCmd) !== rawCmd && (
            <div className="mt-1 text-xs text-stone-500">
              Preview: <span className="citation-preview">{getDisplayText(rawCmd)}</span>
            </div>
          )}
        </div>
      ) : (
        /* ── Builder mode ─────────────────────────────────────────── */
        <div className="space-y-2">
          {/* Row 1: Command type + star + capitalize */}
          <div className="flex items-center gap-2">
            <select
              value={cmdType}
              onChange={(e) => setCmdType(e.target.value)}
              className="text-xs font-mono border border-stone-300 rounded px-1.5 py-1 bg-white text-stone-700 flex-1 min-w-0"
            >
              {commands.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-stone-500 cursor-pointer whitespace-nowrap select-none">
              <input
                type="checkbox"
                checked={starred}
                onChange={(e) => setStarred(e.target.checked)}
                className="rounded border-stone-300 text-amber-600 focus:ring-amber-500 w-3 h-3"
              />
              *
            </label>
            <label className="flex items-center gap-1 text-[11px] text-stone-500 cursor-pointer whitespace-nowrap select-none">
              <input
                type="checkbox"
                checked={capitalized}
                onChange={(e) => setCapitalized(e.target.checked)}
                className="rounded border-stone-300 text-amber-600 focus:ring-amber-500 w-3 h-3"
              />
              Capitalize
            </label>
          </div>

          {/* Command description */}
          <div className="text-[10px] text-stone-400 -mt-1">
            {commands.find((c) => c.value === cmdType)?.desc}
          </div>

          {/* Row 2: Key autocomplete */}
          <div className="relative">
            <div className="text-[10px] font-medium text-stone-400 uppercase tracking-wider mb-0.5">Keys</div>
            {/* Selected key chips */}
            {selectedKeys.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {selectedKeys.map((key) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 border border-amber-200 text-[11px] text-stone-700 font-mono"
                  >
                    {key}
                    <button
                      onClick={() => removeKey(key)}
                      className="ml-0.5 text-stone-400 hover:text-stone-600 leading-none"
                      title="Remove key"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              ref={searchRef}
              type="text"
              value={keySearch}
              onChange={(e) => {
                setKeySearch(e.target.value);
                setDropdownOpen(true);
              }}
              onFocus={() => setDropdownOpen(true)}
              onKeyDown={handleKeyInputKeyDown}
              placeholder={selectedKeys.length > 0 ? "Add another key\u2026" : "Search by key, author, title, year\u2026"}
              className="w-full text-xs font-mono border border-stone-300 rounded px-2 py-1 bg-white"
            />
            {/* Autocomplete dropdown */}
            {dropdownOpen && filteredEntries.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute left-0 right-0 mt-0.5 bg-white border border-stone-200 rounded-md shadow-lg max-h-40 overflow-y-auto z-50"
              >
                {filteredEntries.map((entry, i) => (
                  <button
                    key={entry.key}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addKey(entry.key);
                    }}
                    className={`w-full text-left px-2 py-1.5 text-xs flex items-baseline gap-2 ${
                      i === highlightIdx
                        ? "bg-amber-50 text-stone-800"
                        : "text-stone-600 hover:bg-stone-50"
                    }`}
                  >
                    <span className="font-mono font-medium text-stone-700 shrink-0">{entry.key}</span>
                    <span className="text-stone-400 truncate">
                      {formatMinimalCitation(entry.key, bibEntries)}
                      {entry.fields.title && (
                        <> &mdash; <span className="italic">{truncate(entry.fields.title, 50)}</span></>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {dropdownOpen && keySearch && filteredEntries.length === 0 && (
              <div className="absolute left-0 right-0 mt-0.5 bg-white border border-stone-200 rounded-md shadow-lg z-50 px-3 py-2 text-xs text-stone-400">
                No matching entries
              </div>
            )}
          </div>

          {/* Row 3: Prenote / Postnote */}
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="text-[10px] font-medium text-stone-400 uppercase tracking-wider mb-0.5">Prenote</div>
              <input
                type="text"
                value={prenote}
                onChange={(e) => setPrenote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && composedCommand) handleBuilderSubmit();
                  if (e.key === "Escape") onCancel();
                }}
                placeholder="e.g. see"
                className="w-full text-xs border border-stone-300 rounded px-2 py-1 bg-white"
              />
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-medium text-stone-400 uppercase tracking-wider mb-0.5">Postnote</div>
              <input
                type="text"
                value={postnote}
                onChange={(e) => setPostnote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && composedCommand) handleBuilderSubmit();
                  if (e.key === "Escape") onCancel();
                }}
                placeholder="e.g. p.~42"
                className="w-full text-xs border border-stone-300 rounded px-2 py-1 bg-white"
              />
            </div>
          </div>

          {/* Preview */}
          {composedCommand && (
            <div className="rounded border border-stone-200 bg-white px-2 py-1.5">
              <div className="text-[10px] text-stone-400 mb-0.5">Preview</div>
              <div className="text-xs text-stone-600 font-mono break-all">{composedCommand}</div>
              {preview && preview !== composedCommand && (
                <div className="text-xs text-stone-500 mt-0.5 citation-preview">{preview}</div>
              )}
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end">
            <button
              onClick={handleBuilderSubmit}
              disabled={!composedCommand}
              className="text-xs px-3 py-1 bg-stone-700 text-white rounded hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add citation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\u2026" : s;
}
