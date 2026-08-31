/**
 * THE one answer to "which reader HOST am I, and what layout does it open
 * with?" — the reader-scope grammar plus a per-host default profile.
 *
 * ## Why this module exists (task 434)
 *
 * The Library reader is the real `<EditorPane>` on an EPHEMERAL `useViewPrefs`
 * (`reader-view-prefs.useReaderView`), and it is mounted from three different
 * HOSTS that want three different opening layouts:
 *
 *   - `inline` — the reader inside the Library tab's right detail pane. A quiet
 *     reading view: panel columns folded in, nothing docked.
 *   - `popped-paper` — a paper popped out of the Library into its own Virgil-bar
 *     tab (`PaperHeader` "Pop out"). Gabriel's ask: this should open like an
 *     editing session — the standard reading panels docked, omni view on.
 *   - `outer-library` — a torn-out *Library* tab. Its reader is still the inline
 *     reading view; only the Library chrome moved.
 *
 * Before this module the host was an UNNAMED positional boolean (`!isOuterTab`,
 * threaded into `useReaderView` as `foldGutters`) and the context itself was
 * re-derived by string prefix at two independent sites — `PaperRender` and
 * `RightDetail` — with BOTH matching `outer:<libId>` tear-outs as well as
 * papers. So `popped-paper` and `outer-library` were one thing, and adding two
 * more per-host defaults the same way would have tripled the fork. This is the
 * "stored-copy / two-spellers" shape the codebase keeps retiring one lane at a
 * time (205 margin side, 381 panel side, 369 anchor resolution).
 *
 * So: the scope is MINTED here and PARSED here, so the two halves cannot
 * disagree about the grammar; the host kind is named ONCE; and every per-host
 * default is a row in `READER_HOST_PROFILES` rather than another boolean
 * threaded through another parameter list.
 *
 * ## The profile is INTENT, compiled by the engines that own the invariants
 *
 * A profile does not spell a `ViewPrefs` fragment by hand. `dock` names PANELS,
 * never sides — the side a panel takes is `@/lib/panel-side`'s answer, derived
 * from the seed's own live `placements`, so a user who dragged Notes to the
 * left rail gets its band on the left (task 381: one side fact per panel). And
 * the insertion runs through `placeInStack`, the dock engine's insertion SSOT,
 * which owns the three invariants a hand-written `dockStack:` literal drops
 * silently: the sentinel clear, the cap + LRU eviction, and the MRU coupling
 * (task 273). A profile that spelled `dockStack` itself would be exactly the
 * "a helper only SOME siblings call is not an SSOT" defect, one host over.
 *
 * **Import-light by construction.** Types from `useViewPrefs`, the two pure
 * engines (`view-prefs-dock`, `panel-side`), and the tab-id prefix leaf
 * (`doc-index`). No React, no storage, no panel components — so the library
 * silo's `PaperRender` / `RightDetail` can take it as cheaply as the src-side
 * reader hook does.
 */

import type { PanelKind } from "@/panels/_shared/types";
import type { ViewPrefs } from "@/hooks/useViewPrefs";
import { placeInStack } from "@/hooks/view-prefs-dock";
import { panelSidesFromPlacements, resolvePanelSide } from "@/lib/panel-side";
import { OUTER_PAPER_PREFIX } from "@/lib/doc-index";

/** Prefix marking a view-session scope that belongs to an OUTER Virgil-bar tab
 *  (as opposed to the inline Library tab, whose scope is `""`). */
const OUTER_SCOPE_PREFIX = "outer:";

/** The view-session scope for a paper popped out into its own Virgil-bar tab.
 *  Composed from `OUTER_PAPER_PREFIX` — the same string the outer-tab id uses —
 *  so the scope grammar cannot drift from the tab vocabulary it names. */
export function paperReaderScope(citekey: string): string {
  return `${OUTER_SCOPE_PREFIX}${OUTER_PAPER_PREFIX}${citekey}`;
}

/** The view-session scope for a torn-out *Library* tab, keyed by its library
 *  id. Library ids are never `paper:`-prefixed, which is what keeps this
 *  disjoint from `paperReaderScope` by construction. */
export function libraryReaderScope(libId: string): string {
  return `${OUTER_SCOPE_PREFIX}${libId}`;
}

/** Which reader host a view-session scope belongs to. */
export type ReaderHostKind = "inline" | "popped-paper" | "outer-library";

/**
 * Parse a view-session scope back to its host. The INVERSE of the two minters
 * above — stated beside them so a change to either grammar moves both.
 *
 * Anything that is not an outer scope is `inline`: the Library tab's reader
 * passes a bare panel scope (`""` today), and an unrecognised string is safest
 * read as the quiet reading view rather than as the editing profile.
 */
export function readerHostKind(scope: string): ReaderHostKind {
  if (!scope.startsWith(OUTER_SCOPE_PREFIX)) return "inline";
  const tail = scope.slice(OUTER_SCOPE_PREFIX.length);
  return tail.startsWith(OUTER_PAPER_PREFIX) ? "popped-paper" : "outer-library";
}

/**
 * A host's OPENING layout, declared as intent rather than as a `ViewPrefs`
 * fragment. Session-only: `useReaderView` seeds it once per fresh reader mount
 * and the user is free to change everything from the rail afterwards.
 */
export interface ReaderHostProfile {
  /** Seed the panel columns ("gutters") folded IN. A clean reading view. */
  guttersFolded: boolean;
  /** Omni view ON (⇔ `omniHideAllCards` false) on BOTH sides. When false the
   *  shipped default stands (`{left:true, right:false}`). */
  omniOn: boolean;
  /** Panels docked at mount, in order. Each lands on ITS OWN live side
   *  (`resolvePanelSide` over the seed's placements) — a profile names panels,
   *  never sides. Every entry must be inside `READER_CHROME.visiblePanelKinds`
   *  or the rail elides its icon and the band is unreachable. */
  dock: readonly PanelKind[];
}

/**
 * The per-host defaults. Gabriel, 2026-08-31: a popped-out paper opens with
 * Outline + Notes docked, omni view on both sides, gutters out; the inline
 * reader and a torn-out Library tab keep the quiet reading defaults.
 *
 * `outer-library` and `inline` are byte-identical TODAY and are deliberately
 * separate rows: they are different hosts, and the whole point of naming the
 * kind is that the next per-host default has somewhere to go that is not
 * another positional boolean.
 */
export const READER_HOST_PROFILES: Readonly<
  Record<ReaderHostKind, ReaderHostProfile>
> = {
  inline: { guttersFolded: true, omniOn: false, dock: [] },
  "outer-library": { guttersFolded: true, omniOn: false, dock: [] },
  "popped-paper": {
    guttersFolded: false,
    omniOn: true,
    dock: ["outline", "notes"],
  },
};

/**
 * Compile a host profile onto an ephemeral seed. The ONE consumer is
 * `useReaderView`, which hands it to `useViewPrefs`'s ephemeral-only
 * `initialSeed` door.
 *
 * Pure, and expressed through the engines rather than by hand:
 *  - the fold flags are plain field state;
 *  - `omniOn` writes `omniHideAllCards` (the read `getOmniHideAll` derives
 *    from, and what the "Omni view" toggle flips);
 *  - every dock entry goes through `placeInStack` on its own resolved side,
 *    so the sentinel clear / cap / MRU invariants hold by construction (and
 *    the fold flags are written FIRST, so a docked side's clear wins — a
 *    docked band's portal target does not exist in a collapsed column).
 */
export function applyReaderHostProfile(
  seed: ViewPrefs,
  host: ReaderHostKind,
): ViewPrefs {
  const profile = READER_HOST_PROFILES[host];
  let next: ViewPrefs = {
    ...seed,
    collapsedLeft: profile.guttersFolded,
    collapsedRight: profile.guttersFolded,
  };
  if (profile.omniOn) {
    next = { ...next, omniHideAllCards: { left: false, right: false } };
  }
  if (profile.dock.length > 0) {
    const sides = panelSidesFromPlacements(next.placements);
    for (const panel of profile.dock) {
      next = placeInStack(next, panel, resolvePanelSide(panel, sides));
    }
  }
  return next;
}
