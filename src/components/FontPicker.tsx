"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAIN_TEXT_FONTS } from "@/lib/preferences-tree";
import { resolvePreviewFontStack } from "@/lib/panel-typography";

interface FontPickerProps {
  value: string;
  onChange: (font: string) => void;
  /** Phrase rendered in each option's font, shown to the right of the name.
   *  Lets each category show context-appropriate sample text. */
  previewPhrase: string;
  /** When true, shows a "(matches body)" placeholder instead of the value
   *  and the trigger is disabled. */
  pinned?: boolean;
  pinnedLabel?: string;
}

export default function FontPicker({
  value,
  onChange,
  previewPhrase,
  pinned = false,
  pinnedLabel = "(matches body)",
}: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
    else setQuery("");
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MAIN_TEXT_FONTS;
    return MAIN_TEXT_FONTS
      .map((g) => ({ group: g.group, fonts: g.fonts.filter((f) => f.toLowerCase().includes(q)) }))
      .filter((g) => g.fonts.length > 0);
  }, [query]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={pinned}
        onClick={() => setOpen((p) => !p)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded border border-edge-subtle bg-surface text-left ${pinned ? "opacity-50 cursor-not-allowed" : "hover:border-edge-hover"}`}
      >
        <span
          className="text-sm text-ink-body truncate"
          style={{ fontFamily: pinned ? undefined : resolvePreviewFontStack(value) }}
        >
          {pinned ? pinnedLabel : value}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted shrink-0">
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>
      {open && !pinned && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-edge-subtle bg-surface shadow-lg overflow-hidden"
          style={{ maxHeight: 360 }}
        >
          <div className="p-2 border-b border-edge-subtle">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search fonts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-edge-subtle bg-surface text-sm text-ink-body focus:outline-none focus:ring-1 focus:ring-edge-hover focus:border-edge-hover"
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
            {groups.length === 0 && (
              <div className="px-3 py-4 text-xs text-ink-muted text-center">No matches</div>
            )}
            {groups.map((g) => (
              <div key={g.group}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-ink-muted uppercase tracking-wide">
                  {g.group}
                </div>
                {g.fonts.map((f) => {
                  const selected = f === value;
                  return (
                    <button
                      type="button"
                      key={f}
                      onClick={() => { onChange(f); setOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-3 hover:bg-[var(--accent-light)] ${selected ? "bg-[var(--accent-light)]" : ""}`}
                    >
                      <span
                        className="text-sm text-ink-body shrink-0"
                        style={{ fontFamily: resolvePreviewFontStack(f), minWidth: 140 }}
                      >
                        {f}
                      </span>
                      <span
                        className="text-xs text-ink-muted truncate flex-1 text-right"
                        style={{ fontFamily: resolvePreviewFontStack(f) }}
                      >
                        {previewPhrase}
                      </span>
                      {selected && (
                        <span className="text-[var(--accent)] text-sm shrink-0">✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
