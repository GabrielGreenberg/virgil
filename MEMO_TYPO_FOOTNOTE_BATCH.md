# BUG/FEATURE BATCH — typographic round-trip, menu cleanup, footnote squircle, refs/cites in footnotes

**Filed by:** bug-catcher session, 2026-06-21. Five items submitted together; sorted into 4 sections.
Per-item status markers below. A separate cleaning session implements from this.

| § | Item(s) | Title | Status |
|---|---|---|---|
| A | #1, #2 | LaTeX accents + en/em dashes, source-preserving | `IMPLEMENTED` 6c1b075b 2026-06-24 — owes live FSA feel-check |
| B | #3 | Remove obsolete "Current section" View-menu toggle (breadcrumb always-on) | `IMPLEMENTED` 5424f49a 2026-06-24 — owes live FSA feel-check |
| C | #4 | Footnote-header squircle too big | `IMPLEMENTED` 26b48b9c 2026-06-24 — owes live FSA feel-check |
| D | #5 | `\ref`/`\cite` Virgil commands inside footnotes | `IMPLEMENTED` 26b48b9c 2026-06-24 — owes live FSA feel-check |

---

## §A — LaTeX accents (#1) + en/em dashes (#2): one source-preserving typographic layer

### Symptom
- **#1:** `\'e`, `` \`a ``, `\^o`, `\"o`, `\~n`, `\c{c}`, `\={a}`, `\u{u}`, `\v{s}`, `\H{o}`, `\.{z}`, `\r{a}` etc. should
  render as composed glyphs (é à ô ö ñ ç ā ŭ š ő ż å) in the editor, with the `.tex` keeping the command. Today they
  fall through to the **unknown-`\command` branch** ([latex-parser.ts:589](src/lib/latex-parser.ts:589)) and render
  as grey monospace `latexCommand` marks — not glyphs.
- **#2:** `--` → en-dash (–), `---` → em-dash (—) in display, `.tex` keeps `--`/`---`. Today: **no handling** — they
  render literally as two/three hyphens.

### How the round-trip works (verified) — and the precedent that decides the design
Virgil renders `.tex` while preserving source via **canonical bidirectional normalization** — the doc stores the
Unicode glyph, and serialize reconstructs the LaTeX. **Smart quotes already do exactly this, with no mark:**
- Parse: `` `` `` → `“`, `''` → `”` (latex-parser ~:193).
- Serialize: [`escapeLatex()`](src/lib/latex-serializer.ts:140) maps `“`→`` `` ``, `”`→`''`, and straight `"` → smart pair.

**This is the seam to extend. The user's "as usual" = this canonical-normalization mechanism.** (The investigating
agent floated a heavier `latexGlyph`-mark-per-glyph scheme to preserve the exact original token like `\'e` vs `\'{e}`;
**reject it** — it's inconsistent with how quotes/ldots already work, adds mark-survival hazards across copy/paste/
undo/float-sync, and the user explicitly wants the *usual* behavior. Canonical normalization is the deep, consistent
choice.)

### Latent bug to fold in (same class)
The parser converts `\ldots`/`\dots` → `…` (U+2026) at [latex-parser.ts:554-562](src/lib/latex-parser.ts:554), but
`escapeLatex()` has **no reverse mapping**, so on save `…` is emitted as a literal ellipsis char — the source silently
loses `\ldots`. Same asymmetry the dashes/accents fix must close; fix all three in one table.

### Deep fix — one declarative `TYPOGRAPHIC` table, bidirectional
1. **Single source of truth:** a `TYPOGRAPHIC` map (new, e.g. `src/lib/latex-typography.ts`) with entries
   `{ latex, glyph }` for: the accent family (control-symbol `\' \` \^ \" \~ \= \.` and control-word
   `\u \v \c \H \r \b \d \t` over base letters → NFC-composed glyph), the special letters in scope (`\ss`→ß,
   `\o`→ø, `\O`→Ø, `\ae`→æ, `\AE`→Æ, `\aa`→å, `\AA`→Å, `\l`→ł, `\L`→Ł, `\i`→ı, `\j`→ȷ — decide scope), dashes
   (`--`→–, `---`→—), and ellipsis (`\ldots`/`\dots`→…). Each glyph has ONE canonical LaTeX form for serialize.
2. **Parse** — extend `parseInlineContent` **before** the unknown-command branch ([:589](src/lib/latex-parser.ts:589),
   ideally beside the existing text-command block at [:554](src/lib/latex-parser.ts:554)):
   - Accents: match `\<accent>{<x>}`, `\<accent><x>`, and `\<accent> <x>` (control-word accents need a token break;
     control-symbol accents don't). Compose to NFC glyph. Handle nested special letters (`\v{s}`).
   - Dashes: match `---` before `--` (longest-first) in plain text runs → em/en glyph.
   - Ellipsis already handled — just ensure it's in the same table for the serialize side.
3. **Serialize** — extend [`escapeLatex()`](src/lib/latex-serializer.ts:140) with a reverse pass: for each glyph in
   the text, emit its canonical LaTeX. Precomposed chars: **NFD-decompose** (`é` → `e` + U+0301) and map the combining
   mark → accent command (`\'{e}`), so ALL base letters are covered without enumerating every precomposed code point.
   En/em dash glyph → `--`/`---`; `…` → `\ldots`.
4. **Idempotency:** `parse(serialize(parse(x))) === parse(x)` for the full table. One canonical form per glyph
   guarantees stabilization.

### Critical exclusions / hazards (must handle)
- **Raw-LaTeX spans:** the `latexCommand` mark path in [`serializeMarks`](src/lib/latex-serializer.ts:103) returns text
  as-is — the glyph reverse-map must run inside `escapeLatex` for normal text but **NOT** re-process raw-LaTeX-marked
  text (it's already source). Verify the new reverse pass lives where smart-quotes already runs (so it inherits the
  same gating).
- **`code`/`\texttt`/verbatim:** do NOT convert `--`/`---` (or accents) inside code/verbatim — `--` is literal there.
  Gate the dash transform out of the `code` mark.
- **Directly-typed Unicode:** if the user types a literal `é`/`—`, it serializes to `\'{e}`/`---` (recompilable,
  consistent with typed `“`→`` `` ``). No data loss; this is the intended "normalize on save" behavior.
- **Math mode** (`$…$`, KaTeX) is parsed separately — keep text-mode accents out of math spans (KaTeX renders math
  accents itself). Confirm the dash/accent pass doesn't touch math node text.

### Files
[latex-parser.ts:554-641](src/lib/latex-parser.ts:554) (parse; unknown-cmd branch at :589) ·
[latex-serializer.ts:93-155](src/lib/latex-serializer.ts:93) (`serializeMarks` :103 raw-LaTeX gate, `escapeLatex` :140) ·
new `src/lib/latex-typography.ts` (table) · `src/lib/tiptap/smart-quotes.ts` (sibling precedent).
**Tests:** golden round-trip table (every accent/dash/ellipsis: parse→glyph, serialize→canonical LaTeX, idempotency);
exclusions (code/verbatim/math); mixed Unicode+LaTeX input.

---

## §B — Remove the obsolete "Current section" View-menu toggle (#3)  ·  PLAN-READY

**✅ USER-CONFIRMED (2026-06-21): the target is the MenuBar / View-menu "Current section" toggle
(`showSectionIndicator`) — NOT the Outline panel's "Show current position" (that one stays).** The fix is to delete
the toggle and render the `SectionLozenge` breadcrumb **unconditionally**, retiring the pref end-to-end.

### Target & current wiring (verified)
- Pref: `showSectionIndicator` ([view-prefs/registry.ts:68](src/lib/view-prefs/registry.ts:68)) — global-scoped,
  persisted; menu row at [MenuBar.tsx:55](src/components/MenuBar.tsx:55) (id `section-indicator`).
- Gates the `SectionLozenge` breadcrumb, **still conditionally rendered** at
  [EditorPane.tsx:4770](src/components/EditorPane.tsx:4770) and
  [split-editor-panes.tsx:62,89](src/components/editor-layout/split-editor-panes.tsx:62). (So today it is gated, not
  literally always-on; the cleanup makes it unconditional per the user's intent.)

### Deep removal (end-to-end — retire the pref, don't just hide the row)
1. **Registry:** delete the `showSectionIndicator` entry at [registry.ts:68](src/lib/view-prefs/registry.ts:68) — its
   generated `ViewPrefs` / defaults / global-key fall out, and TypeScript then surfaces every dead consumer.
2. **MenuBar:** delete the menu row ([:55](src/components/MenuBar.tsx:55)), the two props
   ([:100-101](src/components/MenuBar.tsx:100)), the `Pick` union members ([:579](src/components/MenuBar.tsx:579)),
   the `displayChecked`/`displayToggle` entries ([:706,:712](src/components/MenuBar.tsx:706)), and the
   `ViewMenu`/`MenuBarContent` params + pass-through ([:553](src/components/MenuBar.tsx:553),
   [:828](src/components/MenuBar.tsx:828), [:862](src/components/MenuBar.tsx:862)).
3. **EditorLayout:** delete the read ([:921](src/components/EditorLayout.tsx:921)), the two MenuBar-props entries +
   dep ([:2543,:2555,:2575](src/components/EditorLayout.tsx:2543)), and drop `toggleSectionIndicator` from the
   `useViewPrefs` destructure.
4. **EditorPane:** drop the prop ([:486](src/components/EditorPane.tsx:486)) and the `showSectionIndicator={…}`
   pass-through ([:4818](src/components/EditorPane.tsx:4818)); **unwrap** the gate at
   [:4770](src/components/EditorPane.tsx:4770) so the lozenge renders whenever `ready && viewPrefs && editor`.
5. **split-editor-panes:** drop the param + type ([:24,:35](src/components/editor-layout/split-editor-panes.tsx:24))
   and **unwrap** both `showSectionIndicator &&` gates ([:62,:89](src/components/editor-layout/split-editor-panes.tsx:62)).
6. **Migration:** drop the stale `showSectionIndicator` key from the persisted global view-prefs bucket on load so it
   doesn't linger.

`SectionLozenge` already returns `null` on an empty path ([section-lozenge.tsx:22](src/components/editor-layout/section-lozenge.tsx:22)),
so "always render" still hides cleanly when there's no section. **Tests:** delete/repoint any test referencing
`showSectionIndicator` / `section-indicator`.

> Note for the cleaning session: the Outline panel's own "Show current position" toggle
> ([OutlinePanel.tsx:1769](src/panels/Outline/OutlinePanel.tsx:1769), pref `showPosition`) is a SEPARATE, live feature
> — **leave it alone.**

---

## §C — Footnote-header squircle too big (#4)  ·  PLAN-READY

### Diagnosis (verified)
The number badge is `BadgeLabel`, whose box is `BADGE_BASE` =
`"inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold shrink-0"`
([panel-primitives.tsx:293](src/components/panel-primitives.tsx:293)): a **20×20px** rounded square ("squircle") with
a **10px** number and a 1.5px border ([:298](src/components/panel-primitives.tsx:298)). At 20px around a 10px digit
it has ~5px padding per side → the oversized footprint. The 10px text is the canonical size (STYLE_GUIDE) and should
stay. **Scope:** `BadgeLabel` (hence `BADGE_BASE`) is consumed **only by FootnoteCard**
([FootnoteCard.tsx:114](src/panels/Footnotes/FootnoteCard.tsx:114)) today — so shrinking it is footnote-only in effect,
low blast radius.

### Deep fix
Shrink the box, keep the number: in `BADGE_BASE` change `w-5 h-5` (20px) → **`w-[18px] h-[18px]`** (~4px padding) or
**`w-4 h-4`** (16px, ~3px padding); keep `text-[10px] font-semibold`. Optionally drop the border 1.5px→1px at the
smaller size for visual balance. `items-center justify-center` keeps the digit centered; header height (flex
`items-center`) absorbs it with no knock-on.

### Watch-outs
- `BadgeOrphaned` is **separate** (10px, explicitly not `BADGE_BASE` — [:331](src/components/panel-primitives.tsx:331)) —
  don't touch it.
- `ErrorCard`'s badge is "sized to match BadgeLabel" ([ErrorCard.tsx:52](src/panels/Errors/ErrorCard.tsx:52)) — if it
  hardcodes 20px, update it in tandem so error/footnote badges stay consistent (or confirm it's intentionally
  independent).
- Test single- vs double-digit (`1` vs `99`) and the `thanks`→"A" label; check 150% zoom / Retina for clipping at 16px.
- **Decision:** 18px (recommended, safe) vs 16px (tighter). One-line pick.

---

## §D — `\ref`/`\cite` Virgil commands inside footnotes (#5)  ·  ROOT-CAUSE-FOUND

(Action-menu-for-footnotes is explicitly OUT OF SCOPE per the request — this is just the create-command path.)

### Diagnosis
The footnote body is a **nested TipTap editor** (RichTextField) whose schema **already includes** the Citation/inline-
atom nodes, and the **data model already supports** footnote-nested cites (DocStructureObserver tags them
`nestedInFootnoteId`). The gap is purely the **create/insert routing**: the `\cite`/`\ref` create flow
(`openAtomCreate` → `ATOM_CREATE_POPOVER_EVENT` → commit) **hard-targets the MAIN editor instance**, ignoring the
currently-focused nested footnote editor — so the atom lands in the main doc (or at the wrong pos-space), not the
footnote body.

### Deep fix — thread the owning editor through the atom-create flow (mirror the math/figure pattern)
The codebase already routes math/figure edits to their owning editor via `activeMath.editor` / `activeFigure.editor`.
Apply the same seam to atom-create:
1. **Dispatch:** `openAtomCreate` includes the initiating editor in the event detail → `{ kind, rect, pos, editor }`.
2. **Routing:** add `editor?: Editor` to `AtomCreateRequest`; store it when the event is consumed (marker-clicks.ts).
3. **Insert:** `commitCitationCreate` + the ref insert (`card-actions/ref.ts` / `useRefActions.handleInsertRef`) use
   `atomCreateRequest?.editor ?? editorRef.current?.getEditor()` and pass THAT editor to `insertInlineAtom` — so the
   atom inserts into the focused footnote editor in its own pos-space.

### Files
`src/lib/actions/atom-create.ts` · [EditorPane.tsx](src/components/EditorPane.tsx) ·
`src/components/ActionsMenuPanel.tsx` · `src/components/editor-layout/event-bridges/marker-clicks.ts` ·
[EditorLayout.tsx](src/components/EditorLayout.tsx) (`commitCitationCreate`) · `src/components/editor-layout/card-actions/ref.ts`.

### Hazards (verify during implementation)
- **Pos-space:** the captured `pos` is valid only in the editor that captured it — dispatch and insert MUST be the same
  instance (the fix guarantees this).
- **Nested serialization:** confirm a cite/ref atom inserted into the footnote's RichTextField **round-trips into the
  `\footnote{… \cite{} …}` body** in the main `.tex`, and that the citation/label registers globally (the
  `nestedInFootnoteId` machinery suggests reads already work; verify the WRITE/insert path + serialize).
- **Card creation:** `getEditorActionsHandle().runAction` for the cite/ref card should target the owning editor; check
  it doesn't assume the main editor context.
- **Open design choice:** thread `editor` explicitly in the event detail (consistent with math/figure) vs. reuse the
  `overrideEditor` context. Recommend explicit threading (matches the established precedent). **Tests:** slash `\cite`
  and `\ref` inside a focused footnote; typed `\cite{}`; nested cite appears in the Citations panel.
