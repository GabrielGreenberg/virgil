"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import katex from "katex";
import { Kbd } from "./Kbd";

interface Props {
  kind: "inline" | "display";
  latex: string;
  anchorRect: DOMRect;
  onSave: (newLatex: string) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 320;

export default function MathPopover({
  kind,
  latex,
  anchorRect,
  onSave,
  onClose,
}: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(latex);
  const committedRef = useRef(false);

  // Position: below the anchor, horizontally centered, clamped to viewport
  let left = anchorRect.left + anchorRect.width / 2 - POPOVER_WIDTH / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_WIDTH - 8));
  let top = anchorRect.bottom + 6;
  // Estimate height ~200px for the flip-above decision
  if (top + 220 > window.innerHeight) {
    top = Math.max(8, anchorRect.top - 6 - 220);
  }

  // Live preview re-render whenever value changes
  useLayoutEffect(() => {
    const target = previewRef.current;
    if (!target) return;
    target.innerHTML = "";
    if (!value.trim()) {
      const ph = document.createElement("span");
      ph.className = "math-popover-preview-placeholder";
      ph.textContent = "(empty)";
      target.appendChild(ph);
      return;
    }
    try {
      katex.render(value, target, {
        throwOnError: false,
        displayMode: kind === "display",
        errorColor: "#cc0000",
        output: "html",
      });
    } catch {
      target.textContent = value;
    }
  }, [value, kind]);

  // Auto-focus + select the textarea on mount
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
    if (value !== latex) onSave(value);
    onClose();
  };

  const cancel = () => {
    committedRef.current = true;
    onClose();
  };

  // Close on click outside (commit)
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

  // Close on Escape (cancel)
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

  return (
    <div
      ref={popoverRef}
      className={`math-popover math-popover-${kind}`}
      style={{
        position: "fixed",
        top,
        left,
        width: POPOVER_WIDTH,
        zIndex: 1000,
      }}
    >
      <div
        ref={previewRef}
        className={`math-popover-preview math-popover-preview-${kind}`}
      />
      <textarea
        ref={inputRef}
        className="math-popover-input"
        value={value}
        spellCheck={false}
        rows={kind === "display" ? 4 : 1}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={kind === "display" ? "LaTeX (display math)" : "LaTeX"}
      />
      <div className="math-popover-hint">
        <Kbd keys="Enter" /> to save · <Kbd keys="Esc" /> to cancel
        {kind === "display" && (
          <>
            {" "}· <Kbd keys="Shift+Enter" /> for newline
          </>
        )}
      </div>
    </div>
  );
}
