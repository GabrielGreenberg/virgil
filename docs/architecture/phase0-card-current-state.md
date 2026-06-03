<!-- last-verified: 54ced55 2026-06-03 -->
<!-- derives-from: docs/architecture/VIRGIL.md#card-kind-taxonomy, docs/architecture/VIRGIL.md#public-type-registry, docs/architecture/VIRGIL.md#sidecar-and-panel-inventory -->
<!-- covers-code: src/panels/_shared/types.ts, src/panels/panel-registry.ts, src/components/panel-primitives.tsx, src/lib/types.ts, src/lib/storage-fsa.ts, src/panels, src/hooks/useReports.ts, src/lib/ai-request-bridge.ts, editor/scripts/apply_response.py, editor/scripts/create_card.py -->

# Phase 0 — current-state report (card layer)

> **Status: Phase 0 archaeology seed (card layer).** Exhaustive current-state extraction of the card / panel / sidecar / public-type surface that the [stable report](phase0-stable-current-state.md) deliberately deferred while a card-system refactor (Quotations → Reports) was in flight. The refactor has landed, so this slice is now safe to document. Seeds the future operational manifest's `cards.md` / `sidecars.md` / `structure.md`; the conceptual summary lives in [VIRGIL.md](VIRGIL.md). Retired once the manifest absorbs it.

This is the second and final half of Phase 0, the **sibling** of [phase0-stable-current-state.md](phase0-stable-current-state.md). Together they complete the archaeology: the stable report covers the unchanging substrate (UUID/markers, LaTeX round-trip, TipTap extensions, reserved names, as-shipped cowork plumbing); this one covers the **card layer** that was churning at the time. It is written at the **exhaustive altitude** described in [VIRGIL.md → Document discipline → Conceptual doc vs. operational manifest](VIRGIL.md#conceptual-doc-vs-operational-manifest--the-scope-boundary): the readable conceptual account lives in VIRGIL.md's three now-filled sections ([Card-kind taxonomy](VIRGIL.md#card-kind-taxonomy), [Public-type registry](VIRGIL.md#public-type-registry), [Sidecar and panel inventory](VIRGIL.md#sidecar-and-panel-inventory)); this report is the granular substrate they forward-point to, so the archaeology is **done once here, not re-walked** by the manifest. Like the stable report, it does **not** reproduce every JSON field — full per-field schemas are the (machine-generated) manifest's job.

Each section names the future manifest doc it seeds.

## Scope — the slice the stable report deferred

The [stable report's "Scope" section](phase0-stable-current-state.md#scope--and-what-is-deliberately-deferred) lists exactly what this report now extracts: the **Card-kind taxonomy**, the **Public-type registry**, and the **Sidecar & panel inventory**. Those were left as VIRGIL.md stubs because `src/lib/types.ts` and the panel/card surface were in the refactor's blast radius. The refactor landed (`CardKind` gained `report` / `report-request`, lost `quotation`; the Quotations panel became the [Reports panel](#16-the-reports-panel-the-freshest-piece); `quotations.json` → `reports.json`), so the surface is stable enough to certify.

**Covered here:** every `CardKind` and how it maps to a panel / sidecar / theme / lifecycle (§1); the 58 exported types in `src/lib/types.ts` (§2); every `virgil/` sidecar and every `PANEL_REGISTRY` panel (§3); the Python "shadow" registries and the rot-vector they create (§4).

**Still deferred** (separate domains, later chips — unchanged from the stable report):

- **User-actions surface** — keyboard shortcuts, toolbar buttons, the full drag/drop affordance matrix, context menus. Touched here only where a card's *identity* requires it (e.g. each card's drag MIME), not enumerated. Seeds the manifest's `actions.md`.
- **Existing-skill behavior audit** — what each `editor/` skill actually does vs. its prompt. The [Reports lifecycle](#16-the-reports-panel-the-freshest-piece) names `answer-report-request` because the card kind is meaningless without it, but the per-skill audit is its own chip.

---

## 1. Card-kind taxonomy
*Seeds the manifest's `cards.md`.*

### 1.1 The `CardKind` union — 17 kinds (SSOT: `src/panels/_shared/types.ts`)

`CardKind` ([src/panels/_shared/types.ts](../../src/panels/_shared/types.ts) ~32-49) is the canonical card vocabulary, defined to match the keys of `CARD_THEMES`. As shipped it is **17 kinds**:

```
note · highlight · footnote · archive · todo · bib · citation · comment ·
suggestion · cutter-comment · cutter-suggestion · revision-suggestion ·
report · report-request · example · ai · error
```

(Was 16 pre-refactor: `quotation` removed; `report` + `report-request` added — net +1.)

`CardKind` is the **theming / keying / labeling** vocabulary. It is the key space of five parallel registries, each its own SSOT:

| Registry | File | Maps `CardKind` → |
|---|---|---|
| `CARD_KEY_PREFIXES` | [panel-registry.ts](../../src/panels/panel-registry.ts) ~193 | popout-key prefix (`${prefix}:${id}`, persisted to localStorage) |
| `CARD_TYPE_LABELS` | [panel-registry.ts](../../src/panels/panel-registry.ts) ~222 | uppercase overline label (OmniView disambiguation) |
| `CARD_TITLE_LABELS` | [panel-registry.ts](../../src/panels/panel-registry.ts) ~251 | auto-title prefix, or `null` if the kind doesn't auto-title |
| `CARD_THEMES` | [panel-primitives.tsx](../../src/components/panel-primitives.tsx) ~175 | static accent theme (see [§1.7](#17-theme-resolution-card_themes-vs-the-panel-palette)) |
| `PANEL_REGISTRY[*].card` / `POLYMORPHIC_CARD_PANEL` | [panel-registry.ts](../../src/panels/panel-registry.ts) ~44, ~299 | the hosting `PanelKind` |

### 1.2 Two taxonomies: registry `CardKind` vs. the persisted discriminator

The single most important nuance of the card layer: **the registry `CardKind` is not the same vocabulary as the `kind` field stored on disk.**

- The **persisted discriminator** (`card.kind` in the sidecar JSON) exists *only on the four multi-kind panels'* cards, and uses a **coarser** set: `note` / `highlight` (Notes), `comment` / `suggestion` (both Cutter *and* Revisions), `report` / `report-request` (Reports). The other (single-kind) panels' records carry **no** `kind` field at all — the file they live in identifies the kind. (Three of those four — Notes, Cutter, Reports — are *registered* polymorphic with `card: null`; Revisions is registered single-card but its records still carry the `comment`/`suggestion` discriminator — see [§1.4](#14-the-polymorphic-panels).)
- The **registry `CardKind`** re-qualifies the coarse Cutter/Revisions discriminators by **panel context** into `cutter-comment` / `cutter-suggestion` / `revision-suggestion` for popout keys, themes, anchored-card identity, OmniView filters, and `data-*-entry` attributes.

The translation happens at the render/anchor/key layer, e.g. [src/components/EditorPane.tsx:1532](../../src/components/EditorPane.tsx) (`r.kind === "suggestion" ? "revision-suggestion" : "comment"`) and [:1560](../../src/components/EditorPane.tsx) (`c.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment"`); the Cutter cards call `cardPopKey("cutter-suggestion", …)` / `useAnchoredCard({ kind: "cutter-suggestion" })` while their on-disk `kind` stays `"suggestion"`. So `comment` (the registry `CardKind`) means specifically the *Revisions* comment; the Cutter comment is `cutter-comment` though both persist `kind: "comment"`.

A third, separate `kind` axis exists on the linkedRange highlight markers (`MARKER_KIND_TO_THEME_KEY`, [EditorLayout.tsx:80](../../src/components/EditorLayout.tsx)): `note` / `revision` / `cutter-comment` / `cutter-suggestion` / `report` — the marker-side palette key, distinct again from both the persisted `kind` and the registry `CardKind`. These three axes mostly overlap but are not interchangeable; a coherence check or refactor must not assume they are.

### 1.3 The exhaustive per-kind table

Grounded in `PANEL_REGISTRY` + `POLYMORPHIC_CARD_PANEL` + `CARD_KEY_PREFIXES` + `CARD_THEMES` + the card interfaces in `src/lib/types.ts`. "Linkage" uses the [Ontology](VIRGIL.md#ontology) vocabulary: **anchor** = a Card's one-way paragraph pointer (Mode A) or text-range `linkedRange` pointer (Mode B), carried in `links: Link[]`; **atom-link** = a bidirectional tie to an inline Atom.

| `CardKind` | Host panel | Persists to (file · key) | Persisted `kind` | Linkage | Lifecycle | Theme |
|---|---|---|---|---|---|---|
| `note` | Notes (poly) | `notes.json` · `cards` | `"note"` | anchor (A or B) | `aiRequest` flag → Task `note` | note |
| `highlight` | Notes (poly) | `notes.json` · `cards` | `"highlight"` | anchor (B only — exactly one text-range) | `aiRequest` flag | highlight (amber) |
| `footnote` | Footnotes | `footnotes.json` · `footnotes` | — (`FootnoteRef`, keyed by `id`) | **atom-link** to `\footnote{}`/`\thanks{}` (`footnoteId` ← `\vfid`); supports unanchored | none | footnote |
| `archive` | Archive | `archive.json` · `snippets` | — (`ArchivedSnippet`) | anchor (A; may pin many paragraphs) | none | archive |
| `todo` | Todo | `todos.json` · `items` | — (`TodoItem`) | anchor (A) | `done` bool; `aiRequest` flag → Task `todo` | todo |
| `bib` | Bibliography | the **`.bib` file** (`BibEntry`); support sidecars `bib-settings.json`, `annotations.json`, `bib-review-requests.json` | — | keyed by citekey; **atom-link** to every `\cite{}` via the citation layer | none | bib |
| `citation` | Citations | `citations.json` · `citations` | — (`CitationRef`) | **atom-link** to cite commands (`citationId` ← `\vcid`); `unanchored` flag for panel-created cards | none | citation |
| `comment` | Revisions | `revisions.json` · `cards` | `"comment"` (`RevisionCommentCard`) | anchor (A or B) | `aiRequest` flag → Task `suggestion` | revision |
| `suggestion` | *(none — homeless)* | stored as `cutter-`/`revision-suggestion` (see [§1.5](#15-homeless-kinds-suggestion-and-ai)) | `"suggestion"` | — | — | (via host) |
| `cutter-comment` | Cutter (poly) | `cutter.json` · `cards` | `"comment"` (`CutterCommentCard`) | anchor (A or B) | `aiRequest` flag → Task `suggestion` | cut |
| `cutter-suggestion` | Cutter (poly) | `cutter.json` · `cards` | `"suggestion"` (`CutterSuggestionCard`) | anchor (A or B) | `status` pending/accepted/rejected; `author`; **Accept enqueues an `AiRequest`** (editor never mutates the `.tex` on accept) | cut |
| `revision-suggestion` | Revisions | `revisions.json` · `cards` | `"suggestion"` (`RevisionSuggestionCard`) | anchor (A or B) | `status`; `author` | revision |
| `report` | Reports (poly) | `reports.json` · `cards` | `"report"` (`ReportCard`) | anchor (A or B); `MIME_REPORT` drag | `author` human/ai (byline) | report |
| `report-request` | Reports (poly) | `reports.json` · `cards` | `"report-request"` (`ReportRequestCard`) | anchor (A or B) | `aiRequest` flag → Task `report` | report |
| `example` | Examples | `examples.json` · `examples` (`ExampleRef`) | — | **the card IS a TextObject** (`exampleBlock` in the `.tex`, `\vexid`/`\vxid`); sidecar is a metadata *shadow* keyed by the `\vexid` uuid | none | example |
| `ai` | *(none — cross-cutting Inbox)* | `ai-requests.json` · `requests` (`AiRequest`) | — (carries `kind: AiRequestKind`, a different axis) | anchor via `paragraphIds`; may have anchor / atom-links / both / neither | the full Task `status` + `result` + `safetyLevel` machine | aiRequest (sky) |
| `error` | Errors | *(none — re-derived from the live LaTeX lint)* | — | maps to a `.tex` line / paragraph | ephemeral (re-derived each lint pass) | error (rust) |

Registry plumbing for the same 17 (the keying/labeling SSOTs, for completeness):

| `CardKind` | `CARD_KEY_PREFIXES` | `CARD_TYPE_LABELS` | `CARD_TITLE_LABELS` |
|---|---|---|---|
| `note` | `note` | Note | Note |
| `highlight` | `highlight` | Highlight | — (null) |
| `footnote` | `footnote` | Footnote | Footnote |
| `archive` | `archive` | Archive | Archive Text |
| `todo` | `todo` | Task | Task |
| `bib` | `bib` | Bibliography | — |
| `citation` | `citation` | Citation | — |
| `comment` | **`revision`** | Comment | — |
| `suggestion` | `suggestion` | Revision | — |
| `cutter-comment` | `cutter-comment` | Comment | — |
| `cutter-suggestion` | `cutter-suggestion` | Suggestion | — |
| `revision-suggestion` | `revision-suggestion` | Revision | — |
| `report` | `report` | Report | Report |
| `report-request` | `report-request` | Report Request | — (null) |
| `example` | `example` | Example | Example |
| `ai` | `ai` | AI Request | — |
| `error` | `error` | Error | — |

Note the deliberate mismatch: `comment`'s key prefix is `revision` (the Revisions panel's persisted popout keys predate the registry — the *"Don't rename them without a migration"* warning at `panel-registry.ts` ~12 applies).

### 1.4 The polymorphic panels

Three panels host **two** `CardKind`s each, registered with `card: null` in `PANEL_REGISTRY` and resolved via `POLYMORPHIC_CARD_PANEL` ([panel-registry.ts](../../src/panels/panel-registry.ts) ~299):

| Panel | Hosts | Shared theme | Notes |
|---|---|---|---|
| **Notes** | `note` + `highlight` | note / highlight (each its own accent) | Adding a note to a highlight spawns a **sibling** note sharing the anchor — no morph; both coexist in the one `cards` array (`NotesState`). |
| **Cutter** | `cutter-comment` + `cutter-suggestion` | `cut` (one accent for the panel) | Shared marker/theme/typography live under the **legacy `cut` key** (`MARKER_META["cut"]`, `CARD_THEMES.cut`). |
| **Reports** | `report` + `report-request` | `report` (one accent) | The freshest panel — see [§1.6](#16-the-reports-panel-the-freshest-piece). |

`getPanelByCardKind(kind)` resolves a kind to its panel by scanning `PANEL_REGISTRY[*].card.kind` first, then falling back to `POLYMORPHIC_CARD_PANEL`. Revisions is *not* registered polymorphic (its `card` is the single `comment` entry) but it nonetheless hosts `revision-suggestion`, which `POLYMORPHIC_CARD_PANEL` maps back to `revisions`.

### 1.5 Homeless kinds: `suggestion` and `ai`

Two `CardKind`s have **no hosting panel** (`getPanelByCardKind` returns `null`):

- **`suggestion`** — the *generic* "respond with a doc edit" kind. Its on-disk cards always live in `cutter.json` or `revisions.json` as `cutter-suggestion` / `revision-suggestion`; the bare `suggestion` kind is the **bridge's** Task kind (the AI-request bridge maps both `cutter → suggestion` and `revisions → suggestion`, [§3.1](#31-the-virgil-sidecar-inventory)). It exists in the registry so the keying/labeling tables are total, but it never names a panel.
- **`ai`** — cross-cutting by design. AI requests appear in *every* panel's inbox, so `CARD_KEY_PREFIXES` lists `ai` directly with the comment *"AI requests appear in multiple panels so they don't have a parent panel."* The `ai` card is the **Task** (`AiRequest` in `ai-requests.json`); the Inbox is its surfacing Panel (no `PanelKind` of its own yet).

### 1.6 The Reports panel (the freshest piece)

The Reports panel ([src/panels/Reports/](../../src/panels/Reports/)) replaced the Quotations panel in the card-system refactor. It is polymorphic over `report` + `report-request`, both persisting to `reports.json` (`ReportsState = { cards: ReportItem[] }`, [src/lib/types.ts](../../src/lib/types.ts) ~169-173) and themed `report`.

**The two kinds (`src/lib/types.ts` ~138-167):**

- **`ReportCard`** (`kind: "report"`) — an authored **content** card. Carries `author: "human" | "ai"`, a user-editable `title`, a rich-text `content` (+ plain-text `text` mirror), and a `selectedText` for Mode-B anchors. Renders an [`AuthorByline`](../../src/panels/Reports/AuthorByline.tsx) footer ("AI" / "Human" pill + timestamp; AI-authored reports read as **"AI"**, never "Claude").
- **`ReportRequestCard`** (`kind: "report-request"`) — the user's **ask**: a titleless card with an `aiRequest` flag and an `AiRequestCheckbox` footer; placeholder *"What should Claude report on?"*.

**The lifecycle (`src/hooks/useReports.ts`):**

1. The user creates a Report Request (`addReportRequest`, `aiRequest: false`) anchored to a paragraph or text range.
2. Toggling its `aiRequest` flag calls `setRequestAiRequest`, which bridges via `bridgeCardAiRequestFlag(docId, { panel: "reports", cardId }, …)` into `ai-requests.json` as a Task of kind **`report`** (`PANEL_TO_KIND.reports = "report"`, [ai-request-bridge.ts:42](../../src/lib/ai-request-bridge.ts); `report` is one of the eight `AiRequestKind`s).
3. The [`answer-report-request`](../../editor/skills/answer-report-request.md) skill researches + composes the report, then drafts a **new** `ReportCard` with `author: "ai"` into `reports.json` `cards[]` via `apply_response.py` (panel `reports`), anchored to the same paragraph — it **never mutates the source request in place**. A human can equivalently author a Report directly (`addReport` defaults `author: "human"`).

`useReports` reads `reports.json` through `usePersistentState` with a `migrateReports` migrator that normalizes legacy report records (rich-content normalization, `text` mirror backfill, link migration) and dispatches by `kind`. There is **no quotations→reports data migration** — the refactor was a *replacement*, so a pre-refactor paper's `quotations.json` is simply not read (acceptable at this dev stage). Both kinds drag with one MIME, **`MIME_REPORT`** (`application/x-virgil-report`, [src/lib/marginalia.ts:70](../../src/lib/marginalia.ts)), the kind embedded in the payload; both re-anchor through the single `ctx.reports` drop API ([drop-spec.ts](../../src/panels/Reports/drop-spec.ts)); both collapse to one "Reports" OmniView filter via `getPanelByCardKind`'s polymorphic map ([omni.tsx](../../src/panels/Reports/omni.tsx)).

### 1.7 Theme resolution: `CARD_THEMES` vs. the panel palette

A card's accent resolves through **two** layers:

- **`CARD_THEMES`** ([panel-primitives.tsx](../../src/components/panel-primitives.tsx) ~175) — the **static** default, keyed by `CardKind`-ish strings: `footnote`, `note`, `highlight`, `archive`, `todo`, `bib`, `citation`, `comment`, `aiRequest`, `error`, `cut`, `example`, `report` (13 keys). `error` (rust) and `aiRequest` (sky) are **system** accents, hardcoded so a user color-override on a content panel can't re-tint them.
- **the user-customizable panel palette** (`PanelThemeKey` / `DEFAULT_PANEL_COLORS`, [src/lib/panel-theme.ts](../../src/lib/panel-theme.ts)) — read at runtime via `useCardTheme(panelKey)`. Its keys differ slightly: it uses **`revision`** where `CARD_THEMES` uses **`comment`** (the same accent under two names). Revisions cards call `useCardTheme("revision")`; Cutter cards `useCardTheme("cut")`; Reports cards `useCardTheme("report")`.

`PANEL_REGISTRY[*].card.themeKey` points at a `CARD_THEMES` key (e.g. `revisions → "comment"`). The `comment` ⇄ `revision` aliasing is a small naming shadow between the two palettes — the same accent reachable by two keys — worth knowing before renaming either.

---

## 2. Public-type registry
*Seeds the manifest's `sidecars.md`.*

This is the target state for coherence **check 2** ([check-coherence.SKETCH.md](check-coherence.SKETCH.md#check-2--type-accounting)): every exported type in `src/lib/types.ts` is accounted for here or delegated to a named manifest doc. `src/lib/types.ts` exports **58** types (interfaces + type aliases; enumerated by `grep -E '^export (interface|type|enum) '`). All 58 are accounted for below; the **doc-of-record** column names where the concept is canonically described (`§n` = this report; `stable §n` = the [stable report](phase0-stable-current-state.md); the manifest's `sidecars.md` is the ultimate downstream for field-level schemas).

| # | Exported type | Concept | Doc-of-record |
|---|---|---|---|
| 1 | `ParagraphMeta` | paragraph title + content fingerprint (+ `collapsed`) | §3.1 (`virgil.json`), stable §1.4 |
| 2 | `VirgilSidecar` | `{ paragraphs }` — the `virgil.json` root | §3.1, stable §1.4 |
| 3 | `EditorStateData` | last paragraph + folded sections (`editor-state.json`) | §3.1 |
| 4 | `Suggestion` | legacy review suggestion item | §3.1 (legacy `suggestions.json`) |
| 5 | `SuggestionsState` | `{ suggestions, currentIndex, … }` (`suggestions.json`) | §3.1 (legacy) |
| 6 | `SessionState` | legacy review session counters | §3.1 (legacy; **no live consumer** — see [§6](#6-drift--discrepancies-found)) |
| 7 | `DocumentPayload` | `{ content, editorState }` doc transport shape | §3.1 (**no live consumer**) |
| 8 | `ReviewRequest` | legacy `{ proseText }` review input | §3.1 (legacy; **no live consumer**) |
| 9 | `ClaudeSuggestion` | legacy raw-suggestion shape | §3.1 (legacy; **no live consumer**) |
| 10 | `UserComment` | legacy inline comment item | §3.1 (legacy `comments.json`) |
| 11 | `CommentsState` | `{ comments }` (`comments.json`) | §3.1 (legacy) |
| 12 | `RevisionCommentCard` | Revisions comment card (`kind: "comment"`) | §1.3 (`comment`) |
| 13 | `RevisionSuggestionCard` | Revisions suggestion card (`kind: "suggestion"`) | §1.3 (`revision-suggestion`) |
| 14 | `RevisionCard` | union of the two above | §1.3, §3.1 (`revisions.json`) |
| 15 | `RevisionsTracker` | per-doc "revisions accepted" target | §3.1 (`revisions.json`) |
| 16 | `RevisionsState` | `{ cards, tracker }` (`revisions.json`) | §3.1 |
| 17 | `ReportCard` | authored report card (`kind: "report"`) | §1.6 (`report`) |
| 18 | `ReportRequestCard` | report-request card (`kind: "report-request"`) | §1.6 (`report-request`) |
| 19 | `ReportItem` | union of the two above | §1.6, §3.1 (`reports.json`) |
| 20 | `ReportsState` | `{ cards }` (`reports.json`) | §1.6, §3.1 |
| 21 | `ArchivedSnippet` | archived text snippet (`archive` card) | §1.3 (`archive`) |
| 22 | `ArchiveState` | `{ snippets }` (`archive.json`) | §3.1 |
| 23 | `TodoItem` | todo card | §1.3 (`todo`) |
| 24 | `TodoState` | `{ items }` (`todos.json`) | §3.1 |
| 25 | `AiRequestKind` | the 8 Task kinds (`footnote`…`style-merge`, incl. `report`) | stable §4, VIRGIL.md Cowork |
| 26 | `AiRequestPayload` | kind-specific Task payload (today: `style-merge`) | stable §4 |
| 27 | `AiRequestLink` | origin card of a bridged Task (`{ panel, cardId }`) | §3.1 (the bridge), stable §4.3 |
| 28 | `AiRequestStatus` | Task lifecycle enum (+ legacy `draft`/`submitted`) | stable §4, VIRGIL.md Cowork |
| 29 | `AiRequestResult` | Task outcome enum | stable §4, VIRGIL.md Cowork |
| 30 | `AiRequest` | a Task (`ai` card) | §1.5 (`ai`), stable §4 |
| 31 | `AiRequestsState` | `{ requests }` (`ai-requests.json`) | §3.1, stable §4 |
| 32 | `DocNotification` | one completion/failure inbox item | stable §4.4 (`notifications.json`) |
| 33 | `DocNotificationsInbox` | `{ items }` (`notifications.json`) | stable §4.4 |
| 34 | `BibEntry` | a `.bib` entry (`bib` card backing) | §1.3 (`bib`) |
| 35 | `CitationRef` | a `\cite{}` citation card | §1.3 (`citation`) |
| 36 | `CitationsState` | `{ citations, bibPath, citationStyle, bibPackage }` | §3.1 (`citations.json`) |
| 37 | `CitationInfo` | live in-text citation descriptor (search-sources) | §1.3 (`citation`) |
| 38 | `FootnoteRef` | a footnote card | §1.3 (`footnote`) |
| 39 | `FootnotesState` | `{ footnotes }` (`footnotes.json`) | §3.1 |
| 40 | `ExampleRef` | sidecar shadow of an `exampleBlock` (`\vexid` uuid) | §1.3 (`example`) |
| 41 | `ExamplesState` | `{ examples }` (`examples.json`) | §3.1 |
| 42 | `OriginalAnchor` | drop-mode Mode-B→A re-anchor record (note/highlight) | §1.3 (linkage) |
| 43 | `UserNote` | note card (`kind: "note"`) | §1.3 (`note`) |
| 44 | `HighlightCard` | highlight card (`kind: "highlight"`) | §1.3 (`highlight`) |
| 45 | `NoteCardItem` | union of note + highlight | §1.4 (Notes), §3.1 (`notes.json`) |
| 46 | `NotesState` | `{ cards }` (`notes.json`) | §3.1 |
| 47 | `CutterCommentCard` | Cutter comment (`kind: "comment"`) | §1.3 (`cutter-comment`) |
| 48 | `CutterSuggestionCard` | Cutter suggestion (`kind: "suggestion"`) | §1.3 (`cutter-suggestion`) |
| 49 | `CutterCard` | union of the two above | §1.4 (Cutter), §3.1 (`cutter.json`) |
| 50 | `CutterGoal` | per-doc word-count cut goal | §3.1 (`cutter.json`) |
| 51 | `CutterState` | `{ cards, goal }` (`cutter.json`) | §3.1 |
| 52 | `CutItemLegacy` | pre-refactor cut shape (migration only) | §3.1 (`cutter.json`, legacy) |
| 53 | `AnnotationsState` | bibKey → annotation text (`annotations.json`) | §3.1 |
| 54 | `BibReviewRequest` | one bib-review request (`fields`/`notes`) | §3.1 (`bib-review-requests.json`) |
| 55 | `BibReviewState` | `{ requests }` (`bib-review-requests.json`) | §3.1 |
| 56 | `BibEntryRequest` | "find me a citation" request | §3.1 (`bib-settings.json`) |
| 57 | `BibSettings` | `{ generalBibPath (deprecated), entryRequests }` | §3.1 (`bib-settings.json`) |
| 58 | `OrphanedFootnote` | footnote whose `\footnote` marker vanished | §1.3 (`footnote` recovery) |

**Coverage: 58/58 accounted for.** Four (`SessionState`, `DocumentPayload`, `ReviewRequest`, `ClaudeSuggestion`) have **no live consumer** under `src/` — the dead pre-card review pipeline; accounted for here but flagged as pruning candidates ([§6](#6-drift--discrepancies-found)). When VIRGIL.md's [Public-type registry](VIRGIL.md#public-type-registry) stub is filled (this chip), coherence check 2 graduates from warn-only to per-type error.

---

## 3. Sidecar & panel inventory
*Seeds the manifest's `sidecars.md` / `structure.md`.*

### 3.1 The `virgil/` sidecar inventory

This **confirms and corrects** the stable report's provisional list ([phase0-stable §5.4](phase0-stable-current-state.md#54-reserved-file--folder-paths-ssot-srclibstorage-fsats)), which was stamped before the Reports merge. **Correction: `quotations.json` is gone; `reports.json` is in.** (`grep -rhoE '"[a-z-]+\.json"'` across `src/` confirms no `quotations.json` reference survives.) Disk boundary + path constants are `src/lib/storage-fsa.ts` (`VIRGIL_SUBDIR = "virgil"`, `FIGURES_CACHE_DIR = "figures-cache"`, `FIGURE_INDEX_FILE = "index.json"`, `HISTORY_DIR = ".history"`).

**Infrastructure sidecars (stable — non-card):**

| File · key | Purpose | Consuming surface |
|---|---|---|
| `virgil.json` · `paragraphs` | paragraph titles + content fingerprints (`VirgilSidecar`) | serializer `extractSidecarData`, `mergeSidecarTitles` |
| `editor-state.json` | last cursor paragraph + folded sections (`EditorStateData`) | `useEditorUIState` |
| `ai-requests.json` · `requests` | the Task store (`AiRequestsState`) | the bridge, `apply_response.py`, `list_requests.py` |
| `notifications.json` · `items` | skill-completion toasts (`DocNotificationsInbox`) | `useDocNotificationStream` |
| `collab.json` | pen / turn-taking (`COLLAB_SIDECAR_FILE`) | `useCollab` (stable §4.5) |
| `document-settings.json` | preamble style id | `useDocumentStyle` / `document-settings.ts` |
| `version.txt` | monotonic write counter (not JSON) | `apply_response.py`, pollers |

**Card / card-adjacent sidecars (now certified):**

| File · key | Backs `CardKind`(s) | Consuming hook |
|---|---|---|
| `notes.json` · `cards` | `note`, `highlight` (`NotesState`) | `useNotes` |
| `todos.json` · `items` | `todo` (`TodoState`) | `useTodos` |
| `footnotes.json` · `footnotes` | `footnote` (`FootnotesState`) | `useFootnotes` |
| `citations.json` · `citations` | `citation` (`CitationsState`) | `useCitations` |
| `cutter.json` · `cards` | `cutter-comment`, `cutter-suggestion` (`CutterState`) | `useCutter` |
| `revisions.json` · `cards` | `comment`, `revision-suggestion` (`RevisionsState`) | `useRevisions` |
| `reports.json` · `cards` | `report`, `report-request` (`ReportsState`) | `useReports` |
| `examples.json` · `examples` | `example` (`ExamplesState`) | `useExamples` |
| `archive.json` · `snippets` | `archive` (`ArchiveState`) | `useArchive` |
| `bib-review-requests.json` · `requests` | `bib` review flags (`BibReviewState`) | `useBibReview` |
| `bib-settings.json` | `bib` entry-requests + (deprecated) general bib path (`BibSettings`) | `useBibSettings` |
| `annotations.json` | bibKey → annotation text (`AnnotationsState`) | `useAnnotations` |

**Legacy / superseded sidecars (still read, not the live card path):**

| File | Type | Status |
|---|---|---|
| `suggestions.json` | `SuggestionsState` | pre-Revisions inline-review suggestions; `useSuggestions` still mounts it |
| `comments.json` | `CommentsState` | pre-card inline comments; `useComments` |
| `focus.json` | (focus-mode state) | `useFocusMode` — not a card sidecar |
| `library-overlay.json` | library overlay for a paper | `useLibraryOverlay` (Library subsystem) |

**Non-sidecars that look like one (excluded):** `index.json` is the figures-cache index (`FIGURE_INDEX_FILE`, under `virgil/figures-cache/`), not a top-level sidecar; `test.json` is a fixture; `pending-reviews.json` is a **Library** queue file (`.virgil/`-side), not a paper sidecar. `.history/<ts>/` holds shadow snapshots of `virgil.json` + `editor-state.json` (`HISTORY_DIR`).

### 3.2 The panel inventory (SSOT: `PANEL_REGISTRY`)

`PANEL_REGISTRY` ([panel-registry.ts](../../src/panels/panel-registry.ts) ~44) declares **15** `PanelKind`s. Each entry: `kind`, `label`, `folder`, `card: CardLink | null`, `omniEligible`, `omniSide`, `defaultStripSide`.

| `PanelKind` | Label | Card kind(s) hosted | Omni | Default strip |
|---|---|---|---|---|
| `notes` | Notes | `note` + `highlight` (poly, `card: null`) | ✓ right | right |
| `footnotes` | Footnotes | `footnote` | ✓ left | left |
| `citations` | Citations | `citation` | ✓ left | left |
| `bibliography` | Bibliography | `bib` | ✗ | left |
| `reports` | Reports | `report` + `report-request` (poly, `card: null`) | ✓ left | left |
| `examples` | Examples | `example` | ✓ left | left |
| `todo` | Todo List | `todo` | ✓ right | right |
| `archive` | Archived Text | `archive` | ✓ right | right |
| `revisions` | Revisions | `comment` (+ `revision-suggestion` via poly map) | ✓ right | right |
| `cutter` | Cutter | `cutter-comment` + `cutter-suggestion` (poly, `card: null`) | ✓ right | right |
| `outline` | Outline | — (`card: null`) | ✗ | left |
| `search` | Search | — | ✗ | left |
| `wordcount` | Word Count | — | ✗ | right |
| `errors` | Errors | `error` | ✓ right | right |
| `omni` | Omni-view | — (the aggregate surface itself) | ✗ | — |

Note the panel-name vs. `PanelKind` mismatch that matters for [§4](#4-the-python-shadow-registries-the-rot-vector): the `PanelKind` is `todo` (singular, folder `src/panels/Todo`), but the **AI-request panel name** for the same panel is `todos` (plural) — `AiRequestLink.panel` and `PANEL_TO_SIDECAR` both key it `todos`. These are two different identifier spaces that happen to mostly overlap.

---

## 4. The Python shadow registries (the rot-vector)
*Seeds the manifest's `sidecars.md` / `cards.md` discipline notes; designs coherence check 5.*

The `editor/scripts/` Python helpers run **outside** the app and cannot import the TypeScript registries, so they **hand-duplicate** two slices of the TS card vocabulary. These copies are **Python shadows** of the TS SSOTs — and like any duplicated knowledge, they rot. The card-refactor merge is the cautionary example: it had to **hand-reconcile** one shadow and **left the other stale**.

### 4.1 `PANEL_TO_SIDECAR` — shadow of the panel→sidecar map (`apply_response.py`)

`apply_response.py` ~96 hard-codes the panel → `(filename, list-key)` map that the TS side derives from `PANEL_REGISTRY` (panel names) + each panel's hook (the sidecar filename + list-key):

```python
PANEL_TO_SIDECAR = {
    "notes":     ("notes.json", "cards"),
    "todos":     ("todos.json", "items"),
    "cutter":    ("cutter.json", "cards"),
    "revisions": ("revisions.json", "cards"),
    "footnotes": ("footnotes.json", "footnotes"),
    "citations": ("citations.json", "citations"),
    "reports":   ("reports.json", "cards"),
}
```

The merge **had to hand-edit this**: the pre-refactor map keyed `quotations → ("quotations.json", …)`; reconciling it to `reports` was a manual TS-follows-Python edit with no mechanical check that it matched. A latent-bug footgun lives in the same map's history — the `notes` list-key was once wrongly `"notes"` (a dead key the browser never reads); it was fixed to `"cards"` only when the footnote slice's Level-2 sibling-comment path exercised it (see the comment at `apply_response.py` ~92-95). Both are symptoms of the same disease: a hand-maintained copy with no coherence guard.

Note this shadow is **not** a clean mirror of a single TS constant — its keys are the *AI-request panel-name* space (`todos`, not `todo`; a subset that adds `footnotes`/`citations` and omits the no-card panels), and the filename+list-key half lives only in the per-panel hooks, never in `PANEL_REGISTRY`. A coherence check therefore reconciles it against an **assembled** TS truth, not one symbol (see [§4.3](#43-the-coherence-check-design-only)).

### 4.2 `ALL_KINDS` — shadow of the create-able `CardKind`s (`create_card.py`) — **STALE**

`create_card.py` ~52 hard-codes the kinds `create-card` claims to support:

```python
ALL_KINDS = {"footnote", "note", "todo", "citation", "quotation", "example", "annotation"}
IMPLEMENTED_KINDS = {"footnote"}
```

This is **stale against the current `CardKind`**: it lists the **removed `quotation`** and the **never-real `annotation`** (never a `CardKind` — `annotations.json` is bibKey→text, not a card), and it **omits `report` / `report-request`** (the new kinds, which a future `answer-report-request`-style direct-create would want). It is the un-reconciled twin of `PANEL_TO_SIDECAR`: the merge fixed the writeback shadow and missed the create-card shadow.

**This chip does NOT fix `ALL_KINDS`** (doc + discipline only). It is flagged as a tracked item for the **create-card fan-out chip**, which will set `ALL_KINDS` to the kinds it actually implements (and decide whether `report`/`report-request` are create-able). Recorded in [§6](#6-drift--discrepancies-found).

### 4.3 The coherence check (design only)

A new check is added to [check-coherence.SKETCH.md](check-coherence.SKETCH.md) (this chip): **check 5 — Python card/panel vocabulary agrees with the TS registry.** It asserts `PANEL_TO_SIDECAR`'s keys and `create_card.ALL_KINDS` reconcile against `PANEL_REGISTRY` / `CardKind` (modulo the documented `todo`/`todos` aliasing and the create-able subset). The full design — what it parses, how it handles the panel-name aliasing, and its staging — lives in the sketch; this is the report's record that the discipline exists to stop these shadows drifting silently.

---

## 5. SSOTs touched (quick index)

| Fact | Single source |
|---|---|
| the `CardKind` union (17) | `src/panels/_shared/types.ts` |
| the `PanelKind` union (15) | `src/panels/_shared/types.ts` |
| panel ↔ card taxonomy, polymorphic map | `PANEL_REGISTRY` / `POLYMORPHIC_CARD_PANEL` (`src/panels/panel-registry.ts`) |
| popout-key prefix per kind | `CARD_KEY_PREFIXES` (`src/panels/panel-registry.ts`) |
| type / title labels per kind | `CARD_TYPE_LABELS` / `CARD_TITLE_LABELS` (`src/panels/panel-registry.ts`) |
| static card accents | `CARD_THEMES` (`src/components/panel-primitives.tsx`) |
| user-customizable palette | `DEFAULT_PANEL_COLORS` / `PanelThemeKey` (`src/lib/panel-theme.ts`) |
| card / sidecar interfaces | `src/lib/types.ts` |
| disk paths + sidecar boundary | `src/lib/storage-fsa.ts` |
| card-flag → Task bridge + `PANEL_TO_KIND` | `src/lib/ai-request-bridge.ts` |
| Reports panel + lifecycle | `src/panels/Reports/`, `src/hooks/useReports.ts` |
| writeback panel→sidecar shadow | `PANEL_TO_SIDECAR` (`editor/scripts/apply_response.py`) |
| create-able kinds shadow | `ALL_KINDS` (`editor/scripts/create_card.py`) |

---

## 6. Drift & discrepancies found

Surfaced per the doc-graph discipline. **[fixed]** = corrected by this chip (in VIRGIL.md, the root, or this report's sibling); the rest are flagged for a future `/cleanup-virgil` (this chip does **not** re-stamp the `docs/agents/*` derivatives).

1. **[fixed] VIRGIL.md's three card-layer stubs are filled.** The [Card-kind taxonomy](VIRGIL.md#card-kind-taxonomy), [Public-type registry](VIRGIL.md#public-type-registry), and [Sidecar and panel inventory](VIRGIL.md#sidecar-and-panel-inventory) sections carried `<!-- STUB: pending Phase 0 -->`; this chip wrote their conceptual accounts (forward-pointing here) and removed the markers. Phase 0 is now complete — **zero** live STUB section markers remain.

2. **[fixed] VIRGIL.md's stub prose was itself stale.** The Card-kind stub described *"16 kinds"* and listed `quotation`; the Public-type stub cited the non-existent `QuotationGroup`. Both were replaced wholesale by the filled sections.

3. **[fixed] VIRGIL.md's Ontology bullet listed `quotations`** as an example Card kind (`docs/architecture/VIRGIL.md` ~137: *"notes, highlights, todos, footnotes, citations, quotations, …"*). Corrected to `reports` to match the landed surface.

4. **[fixed] The stable report's provisional sidecar list named `quotations.json`.** [phase0-stable §5.4](phase0-stable-current-state.md#54-reserved-file--folder-paths-ssot-srclibstorage-fsats) and its Scope section were updated: `quotations.json` → `reports.json`, and the deferred-section now points here.

5. **`create_card.ALL_KINDS` is stale** (lists removed `quotation` + never-real `annotation`; omits `report`/`report-request`). **Not fixed** — flagged for the create-card fan-out chip ([§4.2](#42-all_kinds--shadow-of-the-create-able-cardkinds-create_cardpy--stale)).

6. **Four exported types have no live consumer under `src/`:** `SessionState`, `DocumentPayload`, `ReviewRequest`, `ClaudeSuggestion` (the dead pre-card review pipeline). **Not fixed** — accounted for in §2, flagged as pruning candidates for a future cleanup (out of scope: this chip touches no functional code).

7. **The stable report's §4.3 `PANEL_TO_KIND` is one entry short.** It lists `notes→note, todos→todo, cutter→suggestion, revisions→suggestion`; the Reports merge added `reports→report` ([ai-request-bridge.ts:42](../../src/lib/ai-request-bridge.ts)). Expected staleness (that section is stamped `c315113`, pre-merge, and the card surface was explicitly provisional there). **Not re-stamped** — noted for the stable report's next verification.

8. **The `docs/agents/*` derivatives and design-system docs still reference `quotation(s)`** (`docs/agents/main-text.md`, `ui-chrome.md`, `audit-action-button.md`; `docs/virgil-design-system/05-cards-and-themes.md`, `08-modals-and-drag.md`, `09-editor-and-marginalia.md`, `11-style-guide.md`, `migration-feedback.md`; `docs/workspace/INDEX.md`; `docs/memos/ACTION-MENU-DIAGNOSIS.md`; `docs/card-refactor/AF-floatable-audit.md`). **Not fixed** (this chip does not re-verify the derivatives). Flagged for the next `/cleanup-virgil`.

9. **`editor/skills/*.md` + `apply_response.py`'s docstring reference `quotation` / `draft-quotation`** (`answer-note-request.md`, `answer-todo-request.md`, `find-citation.md`, `create-card.md`, `iterate-virgil-editor.md`; `apply_response.py` legacy-surface comment). These are skill-behavior surface — the existing-skill audit is a deferred domain ([Scope](#scope--the-slice-the-stable-report-deferred)). **Not fixed** — flagged for the skill-audit chip.

---

## 7. Related documents

- **[VIRGIL.md](VIRGIL.md)** — the canonical conceptual spine; this report is the exhaustive seed its three now-filled card-layer sections forward-point to. With this chip, VIRGIL.md's Phase 0 is **complete** (no deferred stubs).
- **[phase0-stable-current-state.md](phase0-stable-current-state.md)** — the sibling Phase-0 seed (stable subsystems). Its Scope + §5.4 now cross-link here.
- **[check-coherence.SKETCH.md](check-coherence.SKETCH.md)** — the CI guard design; extended by this chip with check 5 (Python shadow ↔ TS registry).
- **[docs/agents/architecture.md](../agents/architecture.md)** — the registries/hooks/persistence/sidecars how-to-work derivative (carries lingering `quotation` drift, flagged in §6).
- **[docs/agents/ui-chrome.md](../agents/ui-chrome.md)** / **[main-text.md](../agents/main-text.md)** — panel/card UI + content-model derivatives (same flag).
- **[editor/skills/answer-report-request.md](../../editor/skills/answer-report-request.md)** — the skill that produces a `report` card from a `report-request` (the Reports lifecycle, §1.6).
