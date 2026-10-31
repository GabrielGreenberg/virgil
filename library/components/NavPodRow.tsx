"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { activatableProps } from "@/lib/activatable-props";
import { withFocusIndicator } from "@/components/focus-indicator";

/**
 * THE row of a `NavPod` — and its empty hint. Both stacked pods of the
 * leftmost library column (`LibrariesNavigator`, `MyPapersPod`) render
 * this, so their rows cannot drift apart (task 1380: two hand copies had
 * already split on right padding + gap, so the kebabs of the two pods sat
 * at different x, and BOTH were a `div onClick` a keyboard user could not
 * reach).
 *
 * One row: 28 px, label ellipsis, a 3 px accent bar + `--accent-light`
 * fill when active, the neutral `.hover-on-light` hover (a class — no JS
 * hover state), and a `trailing` slot for the ⋮ `RowMenu`. A row that
 * activates is a keyboard-operable control through `activatableProps`
 * (it stays a `<div>` because it holds the kebab button) with the one
 * focus ring (`withFocusIndicator`).
 *
 * Per-pod extras ride as props: `editing` swaps the label for a rename
 * input and drops the control contract while it is up; `dropOver` paints
 * the drop-target halo; any other div attribute (drag handlers,
 * `onDoubleClick`) is forwarded.
 */
interface NavPodRowProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onClick" | "role" | "tabIndex"> {
  label: string;
  active: boolean;
  /** Row activation (click / Enter / Space). Ignored while `editing`. */
  onActivate: () => void;
  /** When set, replaces the label (inline rename) and the row is not a
   *  control until it is cleared. */
  editing?: ReactNode;
  /** Paint the drop-target halo (the row is accepting a drag). */
  dropOver?: boolean;
  /** Right-aligned slot: status dot, ⋮ menu. */
  trailing?: ReactNode;
}

const ROW_STYLE: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 8px 0 14px",
  height: 28,
};

const ACCENT_BAR_STYLE: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 4,
  bottom: 4,
  width: 3,
  background: "var(--accent)",
  borderRadius: "var(--radius-xs)",
  pointerEvents: "none",
};

export function NavPodRow({
  label,
  active,
  onActivate,
  editing,
  dropOver = false,
  trailing,
  className,
  style,
  ...rest
}: NavPodRowProps) {
  const isEditing = editing != null && editing !== false;
  return (
    <div
      {...rest}
      {...(isEditing ? {} : activatableProps(() => onActivate()))}
      aria-current={active ? "true" : undefined}
      className={withFocusIndicator(className ? `hover-on-light ${className}` : "hover-on-light")}
      style={{
        ...ROW_STYLE,
        cursor: isEditing ? "text" : "pointer",
        // Only the active / drop states write a fill inline — a resting
        // inline `transparent` would pin the background and kill the
        // class hover.
        ...(dropOver
          ? {
              background: "var(--accent-light)",
              outline: "2px solid var(--accent)",
              outlineOffset: -2,
              borderRadius: "var(--radius-sm)",
            }
          : active
            ? { background: "var(--accent-light)" }
            : null),
        ...style,
      }}
    >
      {active && <div style={ACCENT_BAR_STYLE} />}
      {isEditing ? (
        editing
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            lineHeight: "16px",
            color: "var(--foreground)",
            fontWeight: active ? 500 : 400,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          data-hint={label}
        >
          {label}
        </span>
      )}
      {trailing}
    </div>
  );
}

/** The italic muted line a `NavPod` section shows when it has no rows. */
export function NavPodEmptyHint({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "2px 14px 6px",
        fontSize: 12,
        color: "var(--muted)",
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}
