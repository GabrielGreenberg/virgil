"use client";

/**
 * DOM-attribute sync for the STANDING (non-attention) chrome of `anchor`-kind
 * links — Mode-B `.linked-anchor` spans. Given the per-kind visibility set
 * and the archived-anchor set, this hook:
 *
 *   - Sets `data-show-hl-<kind>="true"` on the editor scroll root for
 *     each kind whose persistent highlight is enabled — CSS scopes the
 *     subtle background per-kind by matching `data-link-card^="<kind>:"`.
 *   - Turns OFF all anchor chrome on the passage of every ARCHIVED card
 *     (task 497) through a per-pane stylesheet rule that selects those
 *     anchors' spans by id (task 1331) — see `archived-anchor-chrome.ts` for
 *     why the key is the anchorId rather than the card id.
 *
 * HOVER / SELECTION are NOT here (task 1148). They are attention state, and
 * their one painter is the pane's `useAnchorHighlightReconciler`, which stamps
 * `data-card-hovered` / `data-card-selected` on the span from the pane's own
 * card store. This hook used to paint a second channel (`data-link-highlight`)
 * from a shell-level copy of the same state; the reconciler's later CSS rule
 * always won the background, so the second channel was dead paint plus a
 * second DOM sweep per hover.
 *
 * HOST: `EditorPane`, once per pane (task 1316). It used to be mounted in
 * EditorLayout's shell, so a pane with no shell around it — the Library
 * Reader — got no washes and every Highlights toggle in its View menu was
 * inert. The pane owns both inputs anyway: its editor, its `archivedAnchorIds`
 * authority, and the view prefs its host hands it.
 */

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { DATA_LINK_ID } from "../link-dom-contract";
import {
  ALL_HIGHLIGHT_TYPES,
  type HighlightType,
} from "@/lib/view-prefs/highlight-types";

/**
 * Every kind that carries a `data-show-hl-<kind>` root toggle — DERIVED from
 * the Highlights-menu SSOT (`ALL_HIGHLIGHT_TYPES`) plus `"archive"`, whose
 * wash is not menu-togglable and rides the master switch alone (task 1316).
 * Never hand-listed: a kind added to the SSOT gets its menu row AND its root
 * attribute from the same edit.
 */
export const LINK_ANCHOR_KINDS = [...ALL_HIGHLIGHT_TYPES, "archive"] as const;
export type LinkAnchorKind = (typeof LINK_ANCHOR_KINDS)[number];

/**
 * The ONE rule from the two highlight prefs to the kinds whose persistent
 * wash is on: nothing when the master switch is off; otherwise every
 * menu kind not hidden, plus `"archive"`. Pure — the pane (which mounts the
 * hook) and the shell (which gates the revisions text highlight on
 * `"comment"`) both read it, so neither restates it.
 */
export function visibleHighlightKinds(prefs: {
  showHighlights: boolean;
  hiddenHighlightTypes: readonly HighlightType[];
}): ReadonlySet<LinkAnchorKind> {
  const out = new Set<LinkAnchorKind>();
  if (!prefs.showHighlights) return out;
  for (const t of ALL_HIGHLIGHT_TYPES) {
    if (!prefs.hiddenHighlightTypes.includes(t)) out.add(t);
  }
  out.add("archive");
  return out;
}

const dataAttrFor = (kind: LinkAnchorKind) => `data-show-hl-${kind}`;

export interface UseLinkHighlightArgs {
  editor: Editor | null;
  /** Card kinds whose persistent linked-anchor highlight is currently
   *  enabled. Empty set hides all. */
  visibleHighlightKinds: ReadonlySet<LinkAnchorKind>;
  /**
   * Mode-B `linkedAnchor` anchor ids owned by an ARCHIVED card, from the one
   * authority (`archivedAnchorIds`, projected in EditorPane — the hook's one
   * host, task 1316). REQUIRED, deliberately: an optional prop with an empty-set
   * default would let a host silently restore the pre-497 behaviour — archived
   * notes leaving their wash standing in the prose — with no type error and no
   * test failure. A host that genuinely has no cards says so by passing an
   * empty set; that is a decision, not an inherited default.
   * (AGENTS.md: "A defaulted argument is a decision nobody made.")
   */
  archivedAnchorIds: ReadonlySet<string>;
}

export function useLinkHighlight({
  editor,
  visibleHighlightKinds,
  archivedAnchorIds,
}: UseLinkHighlightArgs): void {
  // Preference sync — set/clear a per-kind attr on the editor scroll
  // root. CSS scopes the persistent tint per kind by combining the
  // root attr with `data-link-card^="<kind>:"` on the span.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    for (const kind of LINK_ANCHOR_KINDS) {
      if (visibleHighlightKinds.has(kind)) {
        root.setAttribute(dataAttrFor(kind), "true");
      } else {
        root.removeAttribute(dataAttrFor(kind));
      }
    }
    return () => {
      for (const kind of LINK_ANCHOR_KINDS) root.removeAttribute(dataAttrFor(kind));
    };
  }, [editor, visibleHighlightKinds]);

  // ── Archived-chrome sync (task 497; a STYLESHEET since task 1331) ──────
  //
  // An archived card draws no anchor chrome. The three CSS paths that paint a
  // Mode-B span — the per-kind 18% wash, the `!important` tint band, and the
  // hover / selection washes — are all keyed on attributes the MARK emits from
  // `renderHTML`, which knows nothing about card state.
  //
  // Keyed on the ANCHOR id (the span's `data-link-id`), never the card id: a
  // reload-restored span carries `data-link-card="note:"` with the card id
  // deliberately empty (`applyLinkedAnchors`), so a card-keyed rule would work
  // in-session and die on every reload. See `archived-anchor-chrome.ts`.
  //
  // CARRIER: one `<style>` element per pane whose rule SELECTS the archived
  // anchors' spans by id, scoped to this editor's root. It used to be an
  // imperative `setAttribute` on each PM-owned `.linked-anchor` span, re-swept
  // on `onAnyChange`; but PM re-mints that span on any redraw, and a MARK SPLIT
  // (bolding one word of the passage) is a redraw that wakes no structural
  // watcher, so the fresh fragments came back unstamped and the archived
  // note's wash reappeared (task 1331). A selector matches whatever span PM
  // renders — a split fragment, a re-stamped mark, a `setContent` rebuild, an
  // undo that brings the passage back — so every redraw shape is covered by
  // construction, with no list of shapes to keep current, and nothing is ever
  // written onto PM-owned DOM. (A decoration cannot carry it: its wrapper lands
  // INSIDE the mark span, and reaching the span from there needs `:has()`,
  // which globals.css bans — `css-invalidation-guardrail.test.ts`.)
  //
  // Cost: the sheet is rewritten only when the archived set's CONTENTS change
  // (the host re-derives the set on every card-collection change, a keystroke
  // in a card body included, so the effect keys on contents, not identity).
  // No doc walk, no bus subscription, nothing per keystroke.
  const archivedKey = [...archivedAnchorIds].sort().join("\u0000");
  const archivedRef = useRef(archivedAnchorIds);
  archivedRef.current = archivedAnchorIds;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const root = editor.view.dom;
    const css = archivedAnchorCss(nextArchivedScope(root), archivedRef.current);
    if (!css) return;
    const style = root.ownerDocument.createElement("style");
    style.setAttribute(DATA_ARCHIVED_ANCHOR_STYLE, "");
    style.textContent = css;
    root.ownerDocument.head.appendChild(style);
    return () => style.remove();
  }, [editor, archivedKey]);
}

/** Root attribute that scopes a pane's archived rule to its own editor — N
 *  panes are mounted at once (multi-doc keep-alive), and an anchor id archived
 *  in one paper says nothing about a span in another. The root is the one
 *  element ProseMirror never recreates (the per-kind attrs above live there
 *  for the same reason). */
export const DATA_ARCHIVED_ANCHOR_SCOPE = "data-archived-anchor-scope";
/** Marks the pane's `<style>` element (inspection / test door). */
export const DATA_ARCHIVED_ANCHOR_STYLE = "data-archived-anchor-style";

let archivedScopeSeq = 0;
/** The root's scope token, minted once per root and kept for its lifetime. */
function nextArchivedScope(root: HTMLElement): string {
  const have = root.getAttribute(DATA_ARCHIVED_ANCHOR_SCOPE);
  if (have) return have;
  const token = `a${++archivedScopeSeq}`;
  root.setAttribute(DATA_ARCHIVED_ANCHOR_SCOPE, token);
  return token;
}

/** A CSS string literal's body: backslash, quote and control characters
 *  escaped, so an anchor id can never close the selector it sits in. */
function cssString(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code === 0x5c || code === 0x22) out += `\\${ch}`; // backslash, double quote
    else if (code < 0x20 || code === 0x7f) out += `\\${code.toString(16)} `;
    else out += ch;
  }
  return out;
}

/**
 * The ONE rule that turns an archived card's anchor chrome off, for every id in
 * `archivedAnchorIds`, scoped to the editor root carrying `scope`. Null when
 * nothing is archived (no sheet at all).
 *
 * The declarations are what the global rule carried before task 1331:
 *  - zero `--link-anchor-color`, and every `color-mix(… var(--link-anchor-color)
 *    …)` background collapses to transparent — the per-kind 18% wash and the
 *    Mode-B hover/selection wash + selection ring in one line;
 *  - `background: none !important` is REQUIRED, not stylistic: the persistent
 *    tint band (`.linked-anchor[data-tint-color]`) carries an `!important` of
 *    its own and paints from `--tint-color`, not `--link-anchor-color`. That
 *    band is an archived HIGHLIGHT card's entire in-text identity, so without
 *    this line archiving one removed nothing visible. The scope attribute
 *    gives this selector MORE specificity than the band's, so the win no longer
 *    depends on source order — which a `<style>` appended at runtime could not
 *    promise against a stylesheet the bundler injects.
 * Every declaration is `!important` for that same order-independence.
 */
export function archivedAnchorCss(
  scope: string,
  archivedAnchorIds: ReadonlySet<string>,
): string | null {
  const selectors: string[] = [];
  for (const id of archivedAnchorIds) {
    if (!id) continue;
    selectors.push(
      `[${DATA_ARCHIVED_ANCHOR_SCOPE}="${cssString(scope)}"] .linked-anchor[${DATA_LINK_ID}="${cssString(id)}"]`,
    );
  }
  if (selectors.length === 0) return null;
  return `${selectors.join(",\n")} {\n  --link-anchor-color: transparent !important;\n  background: none !important;\n  box-shadow: none !important;\n}\n`;
}
