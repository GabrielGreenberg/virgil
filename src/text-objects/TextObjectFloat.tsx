"use client";

/**
 * Unified float chrome for every TextObject popout.
 *
 * Five per-kind float components used to live in `src/components/`
 * (ParagraphFloat, HeadingFloat, ListFloat, TexBlockFloat — plus the
 * session-only SelectionFloat that Phase E retired), each
 * re-implementing the same chrome — FloatCard wrapper, 6-line header
 * with a kind label + jump-to button + X close, drop-mode
 * shift+mousedown on the header, mounting via the popped-cards
 * context. Phase D5 collapsed all of that into this one component.
 *
 * Body sync stays per-kind. Chrome owns:
 *  - FloatCard mounting / position
 *  - The 24px header row (label, jump-to, X close)
 *  - The kind label (from `meta.label`, with an optional `setHeaderLabel`
 *    callback the body can use to override per-instance — only headings
 *    need this today, to flip between "Chapter" / "Section" / "Subsection"
 *    based on the underlying node's level)
 *
 * Body owns:
 *  - Source-missing rendering (each body uses `useFloatMainSync` which
 *    returns `sourceMissing`; bodies render `SourceMissingBanner` directly
 *    so the chrome stays kind-agnostic)
 *  - All content rendering (TipTap embed, CodeMirror, slice render, etc.)
 *  - All main↔float sync (TipTap-on-TipTap, CodeMirror-on-string, …)
 *
 * Adding a new float-bearing kind = register a body via `registerFloatBody`
 * in the registry. No chrome edits required.
 */

import { type RefObject, useState, useCallback } from "react";
import type { ComponentType } from "react";
import { FloatCard } from "@/components/FloatingCards";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { PopoutButton } from "@/components/panel-primitives";
import type { EditorHandle } from "@/components/Editor";
import { TEXT_OBJECT_REGISTRY } from "./text-object-registry";
import type { TextObjectFloatBodyProps, TextObjectKind } from "./types";

export interface TextObjectFloatProps {
  cardKey: string;
  kind: TextObjectKind;
  id: string;
  editorRef: RefObject<EditorHandle | null>;
  /** Whether the body should configure embedded atom-block extensions in
   *  compact "card context" preview mode (today only `heading-body`
   *  flips this on internally; the prop here is for future overrides). */
  cardContext?: boolean;
}

export function TextObjectFloat({
  cardKey,
  kind,
  id,
  editorRef,
  cardContext = false,
}: TextObjectFloatProps) {
  const popped = usePoppedCards();
  const meta = TEXT_OBJECT_REGISTRY[kind];
  const Body = meta.floatBodyComponent as
    | ComponentType<TextObjectFloatBodyProps>
    | null;

  // `setHeaderLabel` lets the body override the static `meta.label` with a
  // per-instance label (e.g. headings emit "Chapter"/"Section"/"Subsection"
  // depending on level). Bodies that don't need it ignore the callback.
  const [labelOverride, setLabelOverride] = useState<string | null>(null);
  const setHeaderLabel = useCallback((next: string | null) => {
    setLabelOverride(next);
  }, []);
  const label = labelOverride ?? meta.label;

  if (!Body) {
    // Defensive — the dispatcher in floating-cards.tsx already guards on
    // `meta.floatBodyComponent` being non-null. Should never render.
    if (typeof console !== "undefined") {
      console.warn(
        `[TextObjectFloat] no body registered for kind "${kind}" — popout will be empty.`,
      );
    }
    return null;
  }

  const onJump = () => editorRef.current?.scrollToParagraphId(id);
  const onClose = () => popped?.close(cardKey);
  const labelNoun = label.toLowerCase();

  return (
    <FloatCard cardKey={cardKey} surface="card">
      <div className="flex-1 min-h-0 flex flex-col bg-surface overflow-hidden">
        <div className="flex items-center gap-1 px-2 h-6 border-b border-edge-subtle bg-[var(--surface-muted-strong)]">
          <span className="text-[10px] text-[var(--ink-muted)] uppercase tracking-wider font-medium truncate">
            {label}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onJump}
            className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light"
            title={`Jump to ${labelNoun}`}
            aria-label={`Jump to ${labelNoun}`}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
          <PopoutButton
            isPoppedOut
            variant="x"
            labelNoun={labelNoun}
            className="iconbtn-xs"
            onClick={onClose}
          />
        </div>
        <Body
          cardKey={cardKey}
          id={id}
          editorRef={editorRef}
          cardContext={cardContext}
          setHeaderLabel={setHeaderLabel}
        />
      </div>
    </FloatCard>
  );
}
