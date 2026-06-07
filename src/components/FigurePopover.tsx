"use client";

import { useEffect, useRef, useState } from "react";
import { Kbd } from "./Kbd";

interface Props {
  /** "figureBlock" or "graphicsBlock" — drives label + how we wrap text. */
  kind: string;
  /** The verbatim text to edit. For figureBlock this is the env body
   *  between `\begin{figure}` and `\end{figure}`. For graphicsBlock it's
   *  the full `\includegraphics[...]{...}` command. */
  raw: string;
  anchorRect: DOMRect;
  onSave: (newText: string) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 420;

export default function FigurePopover({ kind, raw, anchorRect, onSave, onClose }: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(raw);
  const committedRef = useRef(false);

  // Position below the anchor, clamped to viewport. Flip above if it
  // would overflow the bottom.
  let left = anchorRect.left + anchorRect.width / 2 - POPOVER_WIDTH / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_WIDTH - 8));
  let top = anchorRect.bottom + 6;
  if (top + 240 > window.innerHeight) {
    top = Math.max(8, anchorRect.top - 6 - 240);
  }

  useEffect(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
  }, []);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (value !== raw) onSave(value);
    onClose();
  };

  const cancel = () => {
    committedRef.current = true;
    onClose();
  };

  // Click outside → commit
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        commit();
      }
    };
    const id = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handler);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFigure = kind === "figureBlock";
  const label = isFigure ? "figure" : "graphics";
  const placeholder = isFigure
    ? "LaTeX inside \\begin{figure}...\\end{figure}"
    : "\\includegraphics[...]{...}";

  return (
    <div
      ref={popoverRef}
      className="figure-popover"
      style={{
        position: "fixed",
        top,
        left,
        width: POPOVER_WIDTH,
        zIndex: 1000,
      }}
    >
      <div className="figure-popover-label">
        {label}
      </div>
      <textarea
        ref={inputRef}
        className="figure-popover-input"
        value={value}
        spellCheck={false}
        rows={isFigure ? 8 : 2}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !isFigure) {
            // Single-line command — Enter commits. For figure envs the
            // body is multi-line so we leave Enter alone (need Cmd-Enter
            // to commit; see hint).
            e.preventDefault();
            commit();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={placeholder}
      />
      <div className="figure-popover-hint">
        <Kbd keys={isFigure ? "Mod+Enter" : "Enter"} /> to save · <Kbd keys="Esc" /> to cancel
      </div>
    </div>
  );
}
