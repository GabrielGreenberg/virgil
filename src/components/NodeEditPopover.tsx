"use client";

/**
 * NodeEditPopover — the one caret-anchored "edit this block node's LaTeX"
 * popover. Collapses the former `MathPopover` + `FigurePopover` twins onto a
 * single behavioral skeleton (task 033, dialog-primitive unification): one
 * commit-once guard, one click-outside-commits path, one Escape path, one
 * auto-focus, and one shared positioner. Positions via
 * {@link useFloatingMenuPosition} (below the anchor, centered, flips above when
 * it wouldn't fit) at {@link OPEN_CHROME_MENU_Z} — promoted off the old ad-hoc
 * `zIndex: 1000` so a popped card / lifted overlay never occludes it.
 *
 * The two families keep their distinct CHROME (math shows a live KaTeX preview
 * + a Cancel button; figure shows a kind label + an Esc-cancels hint) via a
 * per-family view branch, but the load-bearing DISMISSAL / COMMIT logic is now
 * shared. Per-family behavior forks that are preserved verbatim:
 *   - math   → Escape COMMITS (save-by-default; the visible Cancel button is
 *              the only revert), plain Enter (no Shift) commits.
 *   - figure → Escape CANCELS (revert), `graphicsBlock` (single-line) commits
 *              on plain Enter, `figureBlock` (multi-line body) commits only on
 *              Mod+Enter.
 *
 * The shared `valueRef` mirror (was math-only) means click-outside now commits
 * the LATEST edit for figures too — closing a latent `FigurePopover` bug where
 * the empty-dep click-outside listener captured a stale first-render `commit`
 * and silently discarded figure edits on click-away.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import katex from "katex";
import { Kbd } from "./Kbd";
import { useFloatingMenuPosition } from "@/hooks/useFloatingMenuPosition";
import { OPEN_CHROME_MENU_Z } from "@/floats/float-policy";

export type NodeEditFamily = "math" | "figure";

interface NodeEditPopoverProps {
  /** Which node family — selects preview, Escape semantics, sizing, chrome. */
  family: NodeEditFamily;
  /** Sub-kind within the family:
   *   math   → "inline" | "display"
   *   figure → "figureBlock" | "graphicsBlock" */
  kind: string;
  /** The verbatim text to edit (LaTeX math body, or the figure env body /
   *  `\includegraphics` command). */
  value: string;
  anchorRect: DOMRect;
  onSave: (next: string) => void;
  onClose: () => void;
}

/** Per-family popover width (px). Math is tighter; figure holds full commands. */
const WIDTH: Record<NodeEditFamily, number> = { math: 320, figure: 420 };

export default function NodeEditPopover({
  family,
  kind,
  value: initial,
  anchorRect,
  onSave,
  onClose,
}: NodeEditPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(initial);
  const committedRef = useRef(false);
  // Mirror `value` into a ref so the once-registered (mount-time, empty-dep)
  // Escape / click-outside listeners commit the LATEST text, not the stale
  // value captured when their closures were created.
  const valueRef = useRef(initial);
  valueRef.current = value;

  const isMath = family === "math";
  const isDisplay = kind === "display";
  const isFigure = kind === "figureBlock";

  // Position below the anchor, horizontally centered, flip above if it would
  // overflow the bottom. The hook measures the rendered element (no size
  // estimate) and clamps to the viewport.
  const { ref: positionRef, style: positionStyle } = useFloatingMenuPosition({
    anchorRect,
    placements: [
      { side: "below", align: "center" },
      { side: "above", align: "center" },
    ],
    gap: 6,
    margin: 8,
  });

  const setContainerRef = (el: HTMLDivElement | null) => {
    containerRef.current = el;
    positionRef(el);
  };

  // Live KaTeX preview (math only) — re-render whenever value changes.
  useLayoutEffect(() => {
    if (!isMath) return;
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
        displayMode: isDisplay,
        errorColor: "#cc0000",
        output: "html",
      });
    } catch {
      target.textContent = value;
    }
  }, [value, isMath, isDisplay]);

  // Auto-focus + select the textarea on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const next = valueRef.current;
    if (next !== initial) onSave(next);
    onClose();
  };

  const cancel = () => {
    committedRef.current = true;
    onClose();
  };

  // Click outside → commit (both families; reads the latest value via the ref).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
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

  // Escape → math COMMITS (save-by-default), figure CANCELS (revert).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (isMath) commit();
        else cancel();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (isMath) {
      // Plain Enter commits; Shift+Enter inserts a newline (display math).
      if (!e.shiftKey) {
        e.preventDefault();
        commit();
      }
      return;
    }
    // figure: single-line graphics commits on plain Enter; the multi-line
    // figure env body leaves Enter alone and commits on Mod+Enter.
    if (!e.shiftKey && !isFigure) {
      e.preventDefault();
      commit();
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      commit();
    }
  };

  const style = {
    ...positionStyle,
    width: WIDTH[family],
    zIndex: OPEN_CHROME_MENU_Z,
  };

  if (isMath) {
    return (
      <div
        ref={setContainerRef}
        className={`math-popover math-popover-${kind}`}
        style={style}
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
          rows={isDisplay ? 4 : 1}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={isDisplay ? "LaTeX (display math)" : "LaTeX"}
        />
        <div className="math-popover-footer">
          <div className="math-popover-hint">
            <Kbd keys="Enter" /> or <Kbd keys="Esc" /> to save
            {isDisplay && (
              <>
                {" "}
                · <Kbd keys="Shift+Enter" /> for newline
              </>
            )}
          </div>
          <button
            type="button"
            className="math-popover-cancel"
            // mousedown (not click) so it fires before the click-outside
            // commit handler, which is also a mousedown listener
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // figure family
  const label = isFigure ? "figure" : "graphics";
  const placeholder = isFigure
    ? "LaTeX inside \\begin{figure}...\\end{figure}"
    : "\\includegraphics[...]{...}";
  return (
    <div ref={setContainerRef} className="figure-popover" style={style}>
      <div className="figure-popover-label">{label}</div>
      <textarea
        ref={inputRef}
        className="figure-popover-input"
        value={value}
        spellCheck={false}
        rows={isFigure ? 8 : 2}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder={placeholder}
      />
      <div className="figure-popover-hint">
        <Kbd keys={isFigure ? "Mod+Enter" : "Enter"} /> to save ·{" "}
        <Kbd keys="Esc" /> to cancel
      </div>
    </div>
  );
}
