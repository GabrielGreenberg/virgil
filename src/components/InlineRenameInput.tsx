"use client";

/**
 * THE ONE INLINE-RENAME FIELD (task 1013).
 *
 * Three surfaces rename a thing in place — the editor's doc tab
 * (`editor-layout/TabStrip.tsx`), the Library's panel-tab strip
 * (`panel-tabs/PanelTabStrip.tsx`) and the Libraries navigator row
 * (`LibrariesNavigator.tsx`). Each had its own near-verbatim `<input>`: the
 * same focus+select on mount, the same Enter→commit / Escape→cancel, the same
 * `onBlur` commit — and each ended its edit BY HAND, through a render-closure
 * guard (`if (!editingId) return`, or no guard at all), rather than through
 * the session door every cancelling field takes (`useFieldEditSession`,
 * task 529). Their Escape was correct only because it UNMOUNTED the focused
 * input, and React dispatches no `focusout` for that; anything that delayed
 * the unmount (an exit animation) would have turned Escape into a rename.
 *
 * Here the ending is the door's: Escape is `session.cancel` (the blur it
 * dispatches skips the commit), Enter is `session.commitAndBlur` (one Enter,
 * one rename), a bare blur is `session.commit`. The field also OWNS its
 * draft, so an owner holds only "which id is being renamed" — the editor's
 * `EditorLayout` used to hold the draft and re-render on every keystroke of a
 * tab rename.
 *
 * The commit rule lives here, once:
 *   - the draft is trimmed;
 *   - an empty draft becomes `emptyValue` when the owner names one (the
 *     Library: "Untitled", the same rule its store applies), and is otherwise
 *     NO rename (the editor's doc tab);
 *   - a result equal to `initialValue` is NO rename (a commit that would change
 *     nothing must not happen — `field-draft.ts`, task 532).
 * `onClose` runs once, on whichever ending comes first; `onRename` only on a
 * real change.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useFieldEditSession } from "@/lib/field-edit-session";

export interface InlineRenameInputProps {
  /** The current name; seeds the draft and is the no-op baseline. */
  initialValue: string;
  /** Called with the normalized new name, only when it differs. */
  onRename: (next: string) => void;
  /** Called once on every ending — commit, no-op commit, or cancel. */
  onClose: () => void;
  /** What an empty draft means. Omitted → an empty draft renames nothing. */
  emptyValue?: string;
  /** `fill` takes the row's free width; `content` sizes to the draft. */
  fit?: "fill" | "content";
  /** `content` only: the floor of the `size` attribute, in characters. */
  minChars?: number;
  /** Merged over the bare (borderless, inheriting) base appearance. No
   *  `className`: the box exists only while it holds focus (it mounts focused
   *  and any blur ends it), so its caret is its focus indicator, and a class
   *  pass-through would make it a shell the focus-indicator census must
   *  police for nothing. */
  style?: CSSProperties;
  "aria-label"?: string;
}

const BARE: CSSProperties = {
  background: "transparent",
  border: "none",
  outline: "none",
  padding: 0,
  margin: 0,
  fontSize: 13,
  lineHeight: "16px",
  fontFamily: "inherit",
  color: "inherit",
};

/** The commit rule, exported for its unit test. `null` = no rename. */
export function normalizeRename(
  draft: string,
  initialValue: string,
  emptyValue?: string,
): string | null {
  const next = draft.trim() || emptyValue || "";
  if (!next || next === initialValue) return null;
  return next;
}

export function InlineRenameInput({
  initialValue,
  onRename,
  onClose,
  emptyValue,
  fit = "fill",
  minChars = 1,
  style,
  "aria-label": ariaLabel,
}: InlineRenameInputProps) {
  const [draft, setDraft] = useState(initialValue);
  const ref = useRef<HTMLInputElement | null>(null);
  const session = useFieldEditSession();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // One mount is one edit session — every owner unmounts the field on
  // `onClose` — so after its first ending the field is SPENT. The door bounds
  // the duplicate to the ending's own synchronous blur; this latch covers a
  // blur that arrives later, while an owner has not yet unmounted us (an
  // exit animation, a deferred state flush). Neither can rename twice, nor
  // rename after a cancel.
  const ended = useRef(false);
  const close = () => {
    if (ended.current) return;
    ended.current = true;
    onClose();
  };
  const finish = () => {
    if (ended.current) return;
    const next = normalizeRename(draft, initialValue, emptyValue);
    if (next !== null) onRename(next);
    close();
  };

  return (
    <input
      ref={ref}
      type="text"
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => session.commit(finish)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          e.preventDefault();
          session.commitAndBlur(e.currentTarget, finish);
        } else if (e.key === "Escape") {
          e.preventDefault();
          session.cancel(e.currentTarget, close);
        }
      }}
      // A click or double-click inside the box edits the text; it must not
      // reach the row/tab underneath (activate it, or — on a tab whose
      // double-click starts a rename — restart this one and drop the draft).
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      size={fit === "content" ? Math.max(draft.length + 1, minChars) : undefined}
      style={{ ...BARE, ...(fit === "fill" ? { flex: 1, minWidth: 0 } : null), ...style }}
    />
  );
}
