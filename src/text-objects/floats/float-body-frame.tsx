"use client";

/**
 * The ONE frame every prose-family float body renders through (task 1346).
 *
 * Before, each body hand-pasted the same three things: the status strips
 * (`SourceMissingBanner` → `WriteRefusedBanner`), the scroll body's wrapper
 * className, and its sub-editor's `editorProps.attributes.class`. The
 * wrapper had drifted into two variants — one carrying a `heading-float-body`
 * class that no CSS rule ever read, copied by paste into list / example /
 * figure floats — and the editor class string sat verbatim in nine files.
 * This module states each once:
 *
 *   - `FloatBodyFrame` — the strips, in their one order, then the scroll
 *     body. A body passes what it KNOWS (is the source missing, what kind is
 *     it, did the last write refuse) and its editor as children; how those
 *     facts look is the frame's.
 *   - `FLOAT_PROSE_EDITOR_CLASS` — the float sub-editor's root class.
 *   - `useRegistryHeaderLabel` — the chrome's header label, read from the
 *     kind's `computeLabel` in `TEXT_OBJECT_REGISTRY`: the same function the
 *     lifted overlay's popout-mode header reads, so the overlay and the
 *     released float cannot disagree at handoff.
 *
 * The census `float-body-frame-census.test.ts` forbids a float body from
 * spelling the wrapper or the editor class literally again.
 */

import { type CSSProperties, type ReactNode, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { viewToggleClasses } from "@/components/editor-layout/chrome-config";
import { TEXT_FLOAT_BODY_PAD_CLASS } from "@/floats/float-policy";
import {
  type FloatSourceKind,
  SourceMissingBanner,
  WriteRefusedBanner,
} from "@/lib/float-sync";
import { TEXT_OBJECT_REGISTRY } from "../text-object-registry";
import type { TextObjectKind } from "../types";

/** Root class of every float body's TipTap sub-editor — the main editor's
 *  prose styling minus its page geometry (the float body owns the padding). */
export const FLOAT_PROSE_EDITOR_CLASS =
  "tiptap ProseMirror prose prose-stone max-w-none focus:outline-none";

/**
 * Class of the float's scroll body. `par-float-body` is the hook globals.css
 * scopes float-only rules under (first-child leading trim, heading labels).
 * `relative` makes the scroll body the containing block for anything
 * absolutely positioned inside it, so such chrome scrolls with the content
 * and clips at the body instead of anchoring to the float window.
 */
const FLOAT_BODY_CLASS = `par-float-body flex-1 overflow-auto ${TEXT_FLOAT_BODY_PAD_CLASS} relative`;

export function FloatBodyFrame({
  cardKey,
  sourceKind,
  sourceMissing,
  writeRefusal = null,
  notice = null,
  style,
  children,
}: {
  /** The popped-card key — the source-missing strip's Close closes it. */
  cardKey: string;
  /** Names what went missing in the source-missing strip. */
  sourceKind: FloatSourceKind;
  sourceMissing: boolean;
  /** The last write-back's refusal (task 1170), if any. */
  writeRefusal?: string | null;
  /** A standing notice for a present source (a `FloatStatusStrip`) — not
   *  shown while the source is missing, which already says the float is
   *  disconnected. */
  notice?: ReactNode;
  /** Per-kind layout vars on the scroll body (e.g. expex column widths). */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  return (
    <>
      {sourceMissing ? (
        <SourceMissingBanner
          kind={sourceKind}
          onClose={() => popped?.close(cardKey)}
        />
      ) : (
        notice
      )}
      <WriteRefusedBanner message={writeRefusal} />
      <div
        className={`${FLOAT_BODY_CLASS} ${viewToggleClasses(chrome.menuBar)}`}
        style={style}
      >
        {children}
      </div>
    </>
  );
}

/**
 * Push the kind's registry label up to the float chrome (re-run when the
 * main editor resolves); clear it on unmount so the chrome falls back to the
 * static `meta.label`. A `null` from `computeLabel` (source not found) also
 * leaves the static label standing.
 */
export function useRegistryHeaderLabel(
  kind: TextObjectKind,
  id: string,
  mainEditor: Editor | null,
  setHeaderLabel: (label: string | null) => void,
): void {
  useEffect(() => {
    const label = mainEditor
      ? (TEXT_OBJECT_REGISTRY[kind].computeLabel?.(mainEditor, { kind, id }) ??
        null)
      : null;
    setHeaderLabel(label);
    return () => setHeaderLabel(null);
  }, [kind, id, mainEditor, setHeaderLabel]);
}
