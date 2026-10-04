/**
 * Chrome configuration for the EditorLayout / Editor surface.
 *
 * The shape lets a host (the main app, the Library Reader, or any future
 * embedding) selectively suppress UI surfaces while keeping the full
 * panel/marginalia/popout machinery live. The default `FULL_CHROME`
 * preserves the existing main-app behavior; `READER_CHROME` is the
 * Library Reader's preset (read-with-Note-only).
 *
 * When adding a new gate, prefer turning OFF a single named element
 * rather than introducing inverse "hide" flags — readability stays
 * cleaner and the FULL_CHROME default reads as "everything on".
 */

import type { CardKind, PanelKind } from "@/panels/_shared/types";
import { projectViewPrefs } from "@/lib/view-prefs/projection";
import {
  cardMutationWritable,
  READER_EDITABLE_CARD_KINDS,
  writableSidecarsFor,
} from "@/lib/host-writability";

export interface EditorChromeConfig {
  /**
   * Whether the MenuBar exposes its edit-mutating items (Fonts dialog,
   * margins-mode toggle, etc.). View toggles (margins, marginalia,
   * dividers, highlights) always render.
   */
  showMenuBarEditItems: boolean;
  /** Heading float — keep label-edit input. */
  showHeadingFloatLabelEdit: boolean;
  /** Paragraph float — keep editable title `<input>`. */
  showParagraphFloatTitleEdit: boolean;
  /**
   * Whitelist of panels visible in the left/right strips. `undefined` =
   * all panels (default). When set, the strip filters PANEL_REGISTRY to
   * only these kinds; placements that resolve to hidden kinds are
   * elided.
   */
  visiblePanelKinds?: PanelKind[];
  /**
   * Whitelist of card kinds whose content can be edited (rich-text
   * editors inside the cards stay live for these kinds; for others the
   * card editor mounts as read-only). `undefined` = all editable
   * (default). Reader uses `READER_EDITABLE_CARD_KINDS` (`["note"]`) so
   * users can write inside note cards without enabling the rest.
   *
   * Naming a whitelist makes the host READ-MOSTLY on DISK as well: the set
   * of sidecars such a host may persist is DERIVED from these kinds (task
   * 556, `@/lib/host-writability`) and read by BOTH the UI-layer permit
   * (`isSidecarWriteAllowed`) and the storage funnels — so a read-mostly
   * host persists exactly the card sidecars it lets the user edit, and its
   * view state / settings sidecars stay session-only by construction.
   */
  editableCardKinds?: readonly CardKind[];
  /**
   * The active EditorPane's MenuBar view-toggle bundle, threaded through
   * so DOM-portaled float popouts (which live outside `.editor-pane-column`)
   * can re-derive the same view-toggle ancestor classes the column carries
   * (dividers, hide-par-titles, etc.) via `viewToggleClasses`. `undefined`
   * for hosts without a MenuBar (e.g. the Library Reader) → no classes.
   * Type-only inline import keeps this tiny config module out of any
   * runtime import cycle with the (large) EditorPane module.
   */
  menuBar?: import("../EditorPane").EditorPaneMenuBarBundle;
  /**
   * Whether this host's MAIN TEXT is editable. RUNTIME-INJECTED, like
   * `menuBar`: `EditorPane` writes its own `editable` prop here when it
   * provides the chrome context, so there is ONE source for the fact (the
   * prop) and deep components read it without prop-drilling. Never set it in
   * a preset. `undefined` (outside an `EditorPane`) reads as editable.
   *
   * Task 710: a panel must not infer "I may offer this edit" from the mere
   * PRESENCE of a handler — the Library Reader satisfies
   * `EditorMutationHandlers` in full with no-ops, so presence is always true
   * there. Read {@link mainTextEditable} instead.
   */
  mainTextEditable?: boolean;
}

/**
 * Is the host's main text editable? The ONE reader of
 * `EditorChromeConfig.mainTextEditable` (`undefined` → editable, so the main
 * app and any context-less mount are unchanged).
 */
export function mainTextEditable(chrome: EditorChromeConfig): boolean {
  return chrome.mainTextEditable !== false;
}

/**
 * Build the view-toggle class tokens that gate divider / hide-* / width /
 * card-outline CSS. Every REGISTRY-declared projection comes from the one
 * applier (`projectViewPrefs`, task 927 — no per-key `if` here); the only
 * hand-built tokens are `.show-dividers-N`, because they are not a function of
 * the prefs alone (`activeDividerLevels` is the pref ∩ the levels the doc has).
 *
 * Consumed by the `editor-pane-column`, every float body, and the drag ghost
 * (`.lifted-text-overlay`) — and, through `viewPrefProjection`, by the
 * instance's own roots (`.editor-pane-root` and its `FloatingPanel`s). Returns
 * `""` when there is no menu bundle at all. Single source so the surfaces
 * can't drift.
 */
export function viewToggleClasses(
  menuBar: import("../EditorPane").EditorPaneMenuBarBundle | undefined,
): string {
  if (!menuBar) return "";
  const tokens: string[] = [...projectViewPrefs(menuBar.prefs).classes];
  for (const lvl of menuBar.activeDividerLevels) tokens.push(`show-dividers-${lvl}`);
  return tokens.join(" ");
}

/**
 * The FULL projection of one view-prefs instance onto a root it owns (task
 * 927): the class string above plus the registry's attribute projections
 * (the native `spellcheck` switch). Both halves are PRIMITIVE strings so a
 * consumer can memoise on them — `attrsFromKey` rebuilds the attribute map.
 */
export interface ViewPrefRootProjection {
  readonly className: string;
  /** `name=value` pairs joined by `;` (`""` = no attributes). */
  readonly attrKey: string;
}

export const EMPTY_VIEW_PREF_PROJECTION: ViewPrefRootProjection = {
  className: "",
  attrKey: "",
};

export function viewPrefProjection(
  menuBar: import("../EditorPane").EditorPaneMenuBarBundle | undefined,
): ViewPrefRootProjection {
  if (!menuBar) return EMPTY_VIEW_PREF_PROJECTION;
  const { attrs } = projectViewPrefs(menuBar.prefs);
  return {
    className: viewToggleClasses(menuBar),
    attrKey: Object.entries(attrs)
      .map(([k, v]) => `${k}=${v}`)
      .join(";"),
  };
}

/** The attribute map an `attrKey` encodes — spread it onto the root. */
export function attrsFromKey(attrKey: string): Record<string, string> {
  if (!attrKey) return {};
  return Object.fromEntries(
    attrKey.split(";").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
}

export const FULL_CHROME: EditorChromeConfig = {
  showMenuBarEditItems: true,
  showHeadingFloatLabelEdit: true,
  showParagraphFloatTitleEdit: true,
  // visiblePanelKinds undefined → show all
  // editableCardKinds undefined → all editable
};

/**
 * Reader preset: read-only main text, MenuBar edit items hidden, the
 * reading-affordance panels are visible.
 * Mirrors the user's explicit list (outline / footnotes / examples /
 * citations / bibliography / notes) plus `search` (task 485 — a find-in-
 * document panel is a reading affordance if anything is, and the Search
 * panel writes nothing: it navigates and paints a TRANSIENT decoration).
 * Note cards stay editable so users can write inside them.
 *
 * A whitelist is a claim about what a HOST offers, so it is also what the
 * Search panel's SCOPE set derives from — `scopesForVisiblePanels`. Every
 * scope but `mainText` jumps to a panel, and a jump into a panel this host
 * hides docks a band the rail elides: a dead click. So the reader's search
 * offers main text / footnotes / notes / citations / bibliography and does
 * not offer todos / archive / cuts / reports / revisions.
 */
export const READER_CHROME: EditorChromeConfig = {
  showMenuBarEditItems: false,
  showHeadingFloatLabelEdit: false,
  showParagraphFloatTitleEdit: false,
  visiblePanelKinds: [
    "outline",
    "search",
    "footnotes",
    "examples",
    "citations",
    "bibliography",
    "notes",
  ],
  // The ONE declaration of the Reader's editable kinds — the storage funnels
  // derive "what may a `library-paper:` doc write?" from this same constant
  // (task 556), so a literal here would be a second, driftable answer.
  editableCardKinds: READER_EDITABLE_CARD_KINDS,
};

/**
 * Helper: filter a list of panel kinds against the chrome's whitelist.
 * Returns `kinds` unchanged when no whitelist is set.
 */
export function filterPanelKinds<K extends PanelKind>(
  chrome: EditorChromeConfig,
  kinds: readonly K[],
): K[] {
  if (!chrome.visiblePanelKinds) return [...kinds];
  const set = new Set(chrome.visiblePanelKinds);
  return kinds.filter((k) => set.has(k));
}

/**
 * The UI-layer permit for the sidecar write path: is a write to `filename`
 * allowed under this chrome? Asked by `usePersistentState.persist` before
 * every disk write.
 *
 * It is a READER of the one derivation in `@/lib/host-writability`
 * (`writableSidecarsFor(chrome.editableCardKinds)`), never a second copy:
 *
 * - `editableCardKinds` undefined (FULL_CHROME / main app) → everything is
 *   writable.
 * - a whitelist → ONLY the card sidecars those kinds live in. The Reader
 *   (`editableCardKinds: READER_EDITABLE_CARD_KINDS`) thus permits exactly
 *   `notes.json` (note + highlight share it): its note annotations LAND, and
 *   every other write is refused — other card sidecars AND non-card state
 *   (focus / document-settings / dictionary / view-ui), whose session-only
 *   posture `library/READER_INHERITANCE.md` records.
 *
 * RENEGOTIATED (task 556). This used to answer "always allowed" for a
 * non-card sidecar under a whitelist ("out of scope for this card guard"),
 * while the storage funnel one layer below refused EVERY write for a
 * `library-paper:` doc — including the `notes.json` this permit granted. The
 * two layers now read the same set, so the answer the user meets is the
 * answer this function gives. Reader writes exist solely so a user can
 * annotate while reading; that is the whole of the derived set.
 */
export function isSidecarWriteAllowed(
  chrome: EditorChromeConfig,
  filename: string,
): boolean {
  const writable = writableSidecarsFor(chrome.editableCardKinds);
  return writable === null || writable.has(filename);
}

/**
 * The UI-layer permit for a CARD MUTATION: may a change to a card of this kind
 * reach disk under this chrome? Asked by `EditableCard` before it offers a
 * DELETE affordance — the trash, the menu item and the shell's delete key.
 *
 * The companion of {@link isSidecarWriteAllowed}, over the same derivation and
 * for the same reason (task 637). That permit governed the *write*; the card
 * chrome governed the *editor*; nothing governed the *destructive control*, so
 * a Library Reader footnote card offered a live trash button that updated React
 * state, wrote nothing, said nothing, and had both the footnote and its card
 * back on the next reload. A control the host was never going to honour is not
 * a control — and hiding it is the answer `EditorPane` already gives for the
 * archive / restore-to-document verbs under the same chrome.
 *
 * `editableCardKinds` undefined (FULL_CHROME / main app) → every kind mutable,
 * so no card anywhere in the main app changes.
 */
export function isCardMutationAllowed(
  chrome: EditorChromeConfig,
  kind: CardKind,
): boolean {
  return cardMutationWritable(chrome.editableCardKinds, kind);
}
