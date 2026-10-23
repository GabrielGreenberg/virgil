/**
 * Pane-originated "show me this card" clicks NAME THEIR ORIGIN (task 1093).
 *
 * Two window events carry a click from inside an `EditorPane` up to the
 * shell's one bridge (`editor-layout/event-bridges/marker-clicks.ts`):
 *
 *   - `virgil-linked-anchor-click` — a margin-marker click (EditorPane's
 *     marker builder) or an in-text Mode-B `.linked-anchor` click
 *     (`useTextHoverBridge`);
 *   - `virgil-error-marker-click` — an error margin-marker click;
 *   - `virgil-footnote-click` / `virgil-citation-click` — an inline-atom
 *     marker click (the Footnote / Citation NodeViews; task 1252 finished
 *     1093's conversion for these two).
 *
 * The bridge is mounted ONCE, by EditorLayout, and its own routing env is the
 * EDITOR's: the editor's open paper's card store and the editor's persisted
 * view prefs. But `EditorPane` is mounted by more than the editor — the Library
 * Reader is the real `<EditorPane>` on EPHEMERAL reader prefs, with its own
 * omni and docked panels. Before this module the events carried no doc
 * identity, so a Reader click selected in the editor's store and opened/docked
 * panels in the editor's (hidden) layout — persisting that — while the Reader's
 * own card never opened. The per-doc-services law's ladder, applied to events:
 * "the current doc" is not a fact a window event may assume.
 *
 * So:
 *  1. The ONLY doors that dispatch these events are the typed dispatchers
 *     below, and their detail REQUIRES the origin pane's `docId`
 *     (`pane-click-origin-census.test.ts` pins that no raw dispatch exists).
 *  2. A pane that can route its own clicks registers a `PaneClickHost` keyed
 *     by its docId — a REGISTRY keyed by owner, never a single slot, and a
 *     departing pane removes only its OWN entry.
 *  3. The bridge routes by origin: the editor's current doc takes the shell's
 *     path; any other origin takes its own pane's host; an origin with no host
 *     is dropped (the pane already selected locally).
 *
 * Import-light: types only, plus a Map. Safe from `src/links` and the shell.
 */

import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import type { OmniCategory } from "@/panels/Omni";
import type { CardStore } from "@/links/_shared/anchored-card-store";
import type { EntityKind } from "@/links/_shared/entity-hover";

export const LINKED_ANCHOR_CLICK_EVENT = "virgil-linked-anchor-click";
export const ERROR_MARKER_CLICK_EVENT = "virgil-error-marker-click";
export const FOOTNOTE_CLICK_EVENT = "virgil-footnote-click";
export const CITATION_CLICK_EVENT = "virgil-citation-click";

export interface LinkedAnchorClickDetail {
  /** The ORIGIN pane's document. */
  docId: string;
  entityId: string;
  kind: EntityKind;
  /** Viewport Y the clicked marker/span sits at — the omni card is pinned there. */
  clickY?: number;
  /** The clicked marker's anchor pid, for a multi-anchor card's `…@<pid>` row. */
  anchorPid?: string;
}

export interface ErrorMarkerClickDetail {
  /** The ORIGIN pane's document. */
  docId: string;
  errorId: string;
  /** The post-toggle state (the pane owns the toggle). */
  selected: boolean;
  clickY?: number;
}

/** An inline-atom marker click. `docId` is the owning editor's doc, read from
 *  the extension's `docIdRef` at click time; a surface with no doc identity
 *  (a card / float body built with no `docIdRef`) passes `null`, which the
 *  bridge treats as the editor's own (the pre-1093 path) — the field is still
 *  REQUIRED, so a NodeView cannot simply forget it. */
export interface FootnoteClickDetail {
  docId: string | null;
  footnoteId: string;
  clickY?: number;
}

export interface CitationClickDetail {
  docId: string | null;
  citationId: string;
  clickY?: number;
  /** Doc position of THIS citation instance in the owning editor — the
   *  clicked one of several `\cite`s of the same card (task 840 pins it live). */
  clickedPos?: number;
}

export function dispatchFootnoteClick(detail: FootnoteClickDetail): void {
  window.dispatchEvent(new CustomEvent(FOOTNOTE_CLICK_EVENT, { detail }));
}

export function dispatchCitationClick(detail: CitationClickDetail): void {
  window.dispatchEvent(new CustomEvent(CITATION_CLICK_EVENT, { detail }));
}

export function dispatchLinkedAnchorClick(detail: LinkedAnchorClickDetail): void {
  window.dispatchEvent(new CustomEvent(LINKED_ANCHOR_CLICK_EVENT, { detail }));
}

export function dispatchErrorMarkerClick(detail: ErrorMarkerClickDetail): void {
  window.dispatchEvent(new CustomEvent(ERROR_MARKER_CLICK_EVENT, { detail }));
}

/** What the bridge needs from a pane to route a click INTO that pane: its own
 *  interaction store and its own view prefs + setters. Prefs are read through
 *  a getter so the registration never holds a stale snapshot. */
export interface PaneClickHost {
  cardStore: CardStore;
  getPrefs: () => ViewPrefs;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  getOmniEnabled: (side: "left" | "right") => Set<OmniCategory>;
  setSelectedErrorId: (id: string | null) => void;
}

const hosts = new Map<string, PaneClickHost>();

/** Register `host` as the router for clicks originating in `docId`'s pane.
 *  Returns the unregister, which removes the entry only while it is still THIS
 *  host's (a successor pane for the same doc that registered in between keeps
 *  its own). */
export function registerPaneClickHost(docId: string, host: PaneClickHost): () => void {
  hosts.set(docId, host);
  return () => {
    if (hosts.get(docId) === host) hosts.delete(docId);
  };
}

export function getPaneClickHost(docId: string): PaneClickHost | null {
  return hosts.get(docId) ?? null;
}

/** The answer the bridge acts on: the shell's own path, a foreign pane's host,
 *  or nothing to route. A detail with NO docId (a pre-1093 shape — nothing in
 *  `src` dispatches one any more) keeps the shell path. */
export type ClickOrigin =
  | { route: "shell" }
  | { route: "pane"; host: PaneClickHost }
  | { route: "drop" };

export function resolveClickOrigin(
  docId: unknown,
  activeDocId: string | null,
): ClickOrigin {
  if (typeof docId !== "string" || docId === activeDocId) return { route: "shell" };
  const host = getPaneClickHost(docId);
  return host ? { route: "pane", host } : { route: "drop" };
}
