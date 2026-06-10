/**
 * Card spine — types. The single source of truth is `CARD_REGISTRY` in
 * `card-registry.tsx`; this is the type layer. Mirrors `src/text-objects/types.ts`
 * (`TextObjectMeta`).
 *
 * React-FREE: `Floatable` (and its `ReactNode`) is imported **type-only**, so the
 * React dependency is erased at compile time and quarantined in `src/floats/`.
 * Keep it that way — the JSX-building closures live in `card-registry.tsx`.
 */
import type { CARD_THEMES } from "@/components/panel-primitives";
import type { PanelKind } from "@/panels/_shared/types";
import type { MarkerType } from "@/lib/marginalia";
import type { DropSpec } from "@/components/drop-mode/types";
import type { Floatable } from "@/floats/types";
import type { CardFloatCtx } from "./card-float-ctx";

/**
 * The card-spine kind union — the single source of truth. `panels/_shared/types`
 * re-exports this (the canonical home moved here, mirroring `TextObjectKind`
 * living beside `TEXT_OBJECT_REGISTRY`).
 *
 * 16 symmetric kinds. The Revisions/Cutter comment+suggestion pairs are spelled
 * `revision-comment`/`revision-suggestion` and `cutter-comment`/`cutter-suggestion`.
 * **Bare `comment`/`suggestion` are NOT spine kinds** — they remain only as the
 * on-disk `RevisionCard`/`CutterCard.kind` *data discriminator* (untouched on
 * disk + in the Python skill layer; bridged to the spine by `resolveCardKind`).
 */
export type CardKind =
  | "note"
  | "highlight"
  | "footnote"
  | "citation"
  | "example"
  | "todo"
  | "archive"
  | "report"
  | "report-request"
  | "revision-comment"
  | "revision-suggestion"
  | "cutter-comment"
  | "cutter-suggestion"
  | "bib"
  | "ai"
  | "error";

/** `CARD_THEMES` key. Includes the system accents `aiRequest`/`error` (which are
 *  NOT in `DEFAULT_PANEL_COLORS`) — always reach themes via this, never via
 *  `keyof typeof DEFAULT_PANEL_COLORS`. */
export type ThemeKey = keyof typeof CARD_THEMES;

/** Creation provenance.
 *  - `user`    — has a "+" / action / drop creation path
 *  - `system`  — generated from a sidecar or the linter (`bib`, `ai`, `error`)
 *  - `derived` — mirrors a `TextObject` harvested from the doc (`example`) */
export type CardOrigin = "user" | "system" | "derived";

/** Declared lifecycle coverage. Booleans, not closures: the actual ops are
 *  per-doc hooks wired in `EditorPane`'s `CardLifecycleProvider`. The registry
 *  declares INTENT; a dev assertion checks the provider satisfies exactly the
 *  declared ops, so a gap is intentional-and-visible, never silent. */
export interface CardLifecycleCapability {
  clone: boolean;
  delete: boolean;
  /** Mode-B re-anchor after clone. */
  bindAnchor: boolean;
}

/** Per-`CardKind` SSOT. Mirrors `TextObjectMeta`. */
export interface CardMeta {
  /** Display label / uppercase overline (was `CARD_TYPE_LABELS`). */
  label: string;
  /** Auto-title prefix at creation, or `null` to opt out (was `CARD_TITLE_LABELS`). */
  titleLabel: string | null;
  /** Popout-key prefix (was `CARD_KEY_PREFIXES`). **Preserved byte-for-byte**
   *  from the legacy table — `popKey`/`cardPopKey`/omni-ids/persisted
   *  `poppedOutCards` keys must not change. The revision pair's split
   *  (`revision-comment` → `"revision"`, `revision-suggestion` →
   *  `"revision-suggestion"`) is intentional drift that AF's `float:` grammar
   *  normalizes; A0 does not touch persisted keys. */
  keyPrefix: string;
  /** `CARD_THEMES` key (was the scattered per-card `themeKey` lookups). */
  themeKey: ThemeKey;
  /** Owning panel (was `PANEL_REGISTRY.card` + `POLYMORPHIC_CARD_PANEL`). `null`
   *  only for the cross-panel `ai` kind (renders in multiple panels). */
  panel: PanelKind | null;
  /** Creation provenance. */
  origin: CardOrigin;
  /** Three-surface (text · margin · card) hover/anchor membership (was
   *  `ANCHORED_CARD_KINDS` / `EntityKind` / `MarginaliaMarker.entityKind`). A
   *  static capability flag — never computed by scanning the doc. */
  anchored: boolean;
  /** Gutter-marker namespace, or `null` for kinds with no marginalia icon
   *  (footnote/citation render in-text atoms; bib/ai unanchored; highlight = tint). */
  markerType: MarkerType | null;
  /** Declared lifecycle coverage (validated against the per-doc provider). */
  lifecycle: CardLifecycleCapability;
  /** In-document drop behavior, or `null` for kinds that don't re-anchor by drop. */
  dropSpec: DropSpec | null;
  /** The morph target for the polymorphic kind-chevron (A9), or `null` for the
   *  non-morphing kinds. When set, this kind can convert *in place* into
   *  `morph.to` (which always shares its panel — the chevron's options are
   *  `cardKindsForPanel(panel)`), preserving id/createdAt/anchor. `lossy: true`
   *  flags a conversion that drops fields the target shape can't hold (e.g.
   *  note→highlight discards the note body) so the UI can show a confirm. The
   *  actual data transform is registered out-of-band via `registerCardMorph`
   *  (a runtime-leaf indirection, mirroring `registerCardFloatable`), never
   *  imported into this card-UI-free module. A dev assertion checks every
   *  `morph !== null` kind has a registered converter and that `morph.to`
   *  shares the panel. */
  morph: { to: CardKind; lossy: boolean } | null;
  /** Whether this kind can serialize onto the Stack (was the hand-kept
   *  `StackCardKind` union). `bib` is stackable despite being `system`, so this
   *  cannot be derived from `origin`. `example` is declared stackable to mirror
   *  `StackCardKind` even though its float's `snapshotForStack` returns null for
   *  it today (no reachable `ExampleRef` sidecar — R2). */
  stackable: boolean;
  /** Whether this kind can pop out into a `Floatable` window. The single
   *  DECLARATIVE source of truth for poppability: `registerCardFloatable`
   *  refuses to install a builder for a non-poppable kind, and the
   *  `isPoppable` predicate (the docked one-click pop-out control) reads this.
   *  Only `error` is `false` (ratified not-poppable, §3.5). Decoupled from
   *  `toFloatable` so poppability is statically inspectable without depending
   *  on boot-time registration order. */
  poppable: boolean;
  /** AF integration point. Returns the shared `Floatable` presence, or `null`
   *  when this kind is not poppable (`error`). MUST be a pure per-id resolver —
   *  resolve one entity by id from `ctx`; NO full-doc descent (keystroke
   *  sanctity / AF §8). */
  toFloatable(id: string, ctx: CardFloatCtx): Floatable | null;
}
