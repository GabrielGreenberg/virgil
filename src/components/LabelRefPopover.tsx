"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * A discoverable target for a `\ref`. Headings carry their own section
 * number and title; labels pulled out of raw-tex blocks (figure /
 * equation / table environments, or stray `\label{...}` occurrences)
 * only get a kind badge so they can at least be chosen from the popover
 * even though Virgil can't render the reference yet.
 */
export interface LabelInfo {
  label: string;
  kind: "heading" | "equation" | "figure" | "table" | "label" | "example";
  /** Short type badge, e.g. "Section 1.2", "Figure", "Equation", "Label", "Example (3b)". */
  typeLabel: string;
  /** Display title: heading text, example preview, or empty. */
  title: string;
}

export type RefCommand = "ref" | "getref" | "getfullref";

interface Props {
  /** The label key of the ref that was clicked (empty string = creating new ref) */
  label: string;
  /** Screen-space rect of the clicked ref node */
  anchorRect: DOMRect;
  /** All labels available in the document */
  labels: LabelInfo[];
  /** Current ref-command of the clicked labelRef (for the tri-toggle). */
  refCommand?: RefCommand;
  /** Called when the user picks a different label */
  onChangeLabel: (oldLabel: string, newLabel: string) => void;
  /** Called when the user clicks the target heading link */
  onJumpToLabel: (label: string) => void;
  /** Called when creating a new ref (via \ref command) — inserts a labelRef node */
  onInsertRef?: (label: string, refCommand?: RefCommand) => void;
  /** Called when the user flips the ref-command via the tri-toggle. */
  onChangeRefCommand?: (label: string, next: RefCommand) => void;
  /** Close the popover */
  onClose: () => void;
}

export default function LabelRefPopover({
  label,
  anchorRect,
  labels,
  refCommand = "ref",
  onChangeLabel,
  onJumpToLabel,
  onInsertRef,
  onChangeRefCommand,
  onClose,
}: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isCreateMode = label === "";
  const [editing, setEditing] = useState(isCreateMode);
  const [inputValue, setInputValue] = useState(label);
  const [dropdownOpen, setDropdownOpen] = useState(isCreateMode);

  // Resolve target info from label
  const target = labels.find((l) => l.label === label);

  // Position: below the anchor, horizontally centered, clamped to viewport
  const popoverWidth = 240;
  let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));
  let top = anchorRect.bottom + 6;
  if (top + 200 > window.innerHeight) {
    top = anchorRect.top - 6; // flip above if no room below
  }

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer to next tick so the opening click doesn't immediately close
    const id = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handler);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editing) {
          setEditing(false);
          setDropdownOpen(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, editing]);

  // Auto-focus input in create mode
  useEffect(() => {
    if (isCreateMode) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isCreateMode]);

  const startEditing = useCallback(() => {
    setEditing(true);
    setInputValue(label);
    setDropdownOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [label]);

  const commitLabel = useCallback(
    (newLabel: string) => {
      setEditing(false);
      setDropdownOpen(false);
      if (!newLabel) return;
      if (isCreateMode && onInsertRef) {
        onInsertRef(newLabel, refCommand);
        onClose();
      } else if (newLabel !== label) {
        onChangeLabel(label, newLabel);
      }
    },
    [label, isCreateMode, onChangeLabel, onInsertRef, refCommand, onClose],
  );

  // Filter labels for dropdown and split by kind.
  const filteredLabels = labels.filter(
    (l) => l.label.toLowerCase().includes(inputValue.toLowerCase()),
  );
  const filteredHeadings = filteredLabels.filter((l) => l.kind !== "example");
  const filteredExamples = filteredLabels.filter((l) => l.kind === "example");

  return (
    <div
      ref={popoverRef}
      className="label-ref-popover"
      style={{
        position: "fixed",
        top,
        left,
        width: popoverWidth,
        zIndex: 1000,
      }}
    >
      {/* Top pod: target heading */}
      <div
        className="label-ref-popover-pod label-ref-popover-target"
        onClick={() => {
          if (target) {
            onJumpToLabel(target.label);
            requestAnimationFrame(() => onClose());
          }
        }}
        style={{ cursor: target ? "pointer" : "default" }}
      >
        {target ? (
          <>
            <span className="label-ref-popover-type">{target.typeLabel}</span>
            {target.title && (
              <span className="label-ref-popover-title">{target.title}</span>
            )}
          </>
        ) : (
          <span className="label-ref-popover-unresolved">Unresolved reference</span>
        )}
      </div>

      {/* Ref-command tri-toggle: flip between \ref / \getref / \getfullref. */}
      {!isCreateMode && onChangeRefCommand && (
        <div className="label-ref-popover-pod label-ref-popover-refcmd">
          {(["ref", "getref", "getfullref"] as RefCommand[]).map((cmd) => (
            <button
              key={cmd}
              type="button"
              className={`label-ref-popover-refcmd-btn${cmd === refCommand ? " active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                if (cmd !== refCommand) onChangeRefCommand(label, cmd);
              }}
            >
              \{cmd}
            </button>
          ))}
        </div>
      )}

      {/* Bottom pod: label (click to edit) */}
      <div className="label-ref-popover-pod label-ref-popover-label">
        {editing ? (
          <div className="label-ref-popover-edit">
            <input
              ref={inputRef}
              className="label-ref-popover-input"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setDropdownOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitLabel(inputValue);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                  setDropdownOpen(false);
                }
              }}
              onBlur={() => {
                // Delay so dropdown click can register
                setTimeout(() => {
                  setEditing(false);
                  setDropdownOpen(false);
                }, 150);
              }}
              placeholder="label key"
              spellCheck={false}
            />
            {dropdownOpen && filteredLabels.length > 0 && (
              <div className="label-ref-popover-dropdown">
                {filteredHeadings.length > 0 && filteredExamples.length > 0 && (
                  <div className="label-ref-popover-group-heading">Sections</div>
                )}
                {filteredHeadings.map((l) => (
                  <div
                    key={`h-${l.label}`}
                    className={`label-ref-popover-option${l.label === label ? " current" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commitLabel(l.label);
                    }}
                  >
                    <span className="label-ref-option-label">{l.label}</span>
                    <span className="label-ref-option-info">{l.typeLabel}</span>
                  </div>
                ))}
                {filteredHeadings.length > 0 && filteredExamples.length > 0 && (
                  <div className="label-ref-popover-group-heading">Examples</div>
                )}
                {filteredExamples.map((l) => (
                  <div
                    key={`e-${l.label}`}
                    className={`label-ref-popover-option${l.label === label ? " current" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commitLabel(l.label);
                    }}
                  >
                    <span className="label-ref-option-label">{l.label}</span>
                    <span className="label-ref-option-info">{l.typeLabel}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="label-ref-popover-label-display" onClick={startEditing}>
            <span className="label-ref-popover-label-key">label:</span>
            <span className="label-ref-popover-label-value">{label}</span>
          </div>
        )}
      </div>
    </div>
  );
}
