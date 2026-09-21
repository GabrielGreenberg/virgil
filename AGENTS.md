<!-- last-verified: 340f8456 2026-09-21 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization -->
<!-- covers-code: src/lib/tiptap/doc-structure, src/hooks/useStructuralRevisions.ts, src/hooks/useInTextPositions.ts -->

# Agent guide to Virgil

Virgil is a browser-based visual LaTeX editor for academic writing, designed to cowork with AI agents. It runs fully client-side (File System Access API for disk, IndexedDB for prefs); its RENDERING never compiles — the editor is driven by the parse/serialize round trip, which preserves the source — while an optional in-browser SwiftLaTeX pdfTeX compile produces a PDF on demand (`src/lib/compile/`, offline core bundle in `public/swiftlatex/`). Agents interact with the user's paper by reading the same `.tex`/`.bib` files and writing JSON sidecars into the paper's `virgil/` folder.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Codebase guide

Deeper docs in `docs/agents/`. Load them on demand when their topic comes up — they aren't auto-transcluded, so this index stays lean:

- **[docs/architecture/VIRGIL.md](docs/architecture/VIRGIL.md)** — **the canonical "what Virgil is" source of truth** (the rooted architecture spine; the `docs/agents/*` docs below derive from it). Read first for the conceptual account.
- **[docs/agents/overview.md](docs/agents/overview.md)** — What Virgil is, tech stack, `src/` map, core concepts. Read first in a new session.
- **[docs/agents/glossary.md](docs/agents/glossary.md)** — User terminology → code names + file paths. Consult whenever the user uses a term (panel, Virgil bar, marginalia, jump-to button, can-I-request button, etc.) you don't recognize.
- **[docs/agents/ui-chrome.md](docs/agents/ui-chrome.md)** — Panels, tool strips, the Virgil bar strip and the MenuBar menu pod that docks inside it, actions/formatting toolbars, floating panels and cards.
- **[docs/agents/main-text.md](docs/agents/main-text.md)** — TipTap editor, block/inline nodes, paragraph UUIDs, link architecture, marginalia, citations, LaTeX round-trip.
- **[docs/agents/architecture.md](docs/agents/architecture.md)** — Registries, key hooks, persistence, sidecars, drag/drop MIME map, per-panel overrides.
- **[docs/agents/laws/](docs/agents/laws/)** — One file per load-bearing LAW (keystroke sanctity, the write path, capture/schema symmetry, …), each with every "half" of its doctrine and its CI guards. Indexed under **Laws** below.
- **[library/AGENTS.md](library/AGENTS.md)** — The Library subsystem (catalog, multi-tab libraries, skill cowork, Python pipeline). Self-contained under `library/`; load on demand for any work touching the Library tab.
- **[editor/AGENTS.md](editor/AGENTS.md)** — The editor-side skill set (`/editor/review` umbrella + per-kind subskills, AI-request bridge, paragraph-context helper scripts). Self-contained under `editor/`; load on demand for any work touching AI requests, sidecar skills, or the cowork plumbing in `src/lib/ai-request-bridge.ts`.

## Glossary protocol

If the user uses a term that doesn't resolve cleanly to a code name, append it to the **Pending terminology** section at the bottom of `docs/agents/glossary.md` with your best-guess code referent and today's date. The cleanup skill consolidates these on the next merge cycle.

Each sub-doc begins with `<!-- last-verified: 7c252262 2026-09-19 -->`. If the hash is far behind `HEAD` and something feels stale, verify against the current code before relying on the doc.

## Laws

Each law below is a load-bearing rule with a CI guard. The full doctrine — every "half", its rules, measurements, residuals — lives in its own file under [docs/agents/laws/](docs/agents/laws/). **Load a law's doc when its topic comes up** (search there for a cited "The X half").

> **This file is an always-loaded INDEX and has a hard size budget** ([agents-md-budget.test.ts](src/__tests__/agents-md-budget.test.ts)). A task's new doctrine note goes into its law's file in `docs/agents/laws/`, never here. `AGENTS.md` changes only to index a NEW law in a few lines.

### Keystroke sanctity

> **No plugin, hook, or React effect may do work proportional to document size on each keystroke.** Doc-walking work must be event-driven from the typed structural diff. Decoration plugins must use `DecorationSet.map(tr.mapping)` and re-scan only changed regions.

**Consume the diff. Don't walk the doc.** From `appendTransaction`: `readPendingDiff(newState)`; from React: `useDocStructure` / `useDocStructureBus` / `useDocStructureEvent`; from a long-lived hook: `getBus(editor)`. A new `editor.on("update"|"transaction"|"selectionUpdate", …)` subscriber must be added to the guardrail's allowlist AND the doc's permitted-subscriber list, with a `[cost: …]` justification covering the CALLBACK, not just the gate. Verify with `window.__virgilBusStats()` — typing must leave `emitCount` flat.

Doc: [docs/agents/laws/keystroke-sanctity.md](docs/agents/laws/keystroke-sanctity.md).
CI: `keystroke-subscriber-guardrail.test.ts`, `float-source-touch-gate.test.tsx`, `plugin-apply-guardrail.test.ts`, `container-granularity.test.ts`, `decoration-probe-cost.test.ts`, `latex-command-cmd-only.test.ts` ….

### Scroll-anchor stability

> **An overlay anchored to document content must not re-solve its position per scroll frame.** It must be either (a) **pod/host-relative** — living inside the scroll container so it moves with content by layout, with NO scroll listener (`top = elementRect.top − hostRect.top`); or (b) a **RAF-coalesced fixed portal** — `position:fixed`, recomputing `top` at most once per animation frame behind an equality bail (`placementsEqual` / `prev.top === next.top`). Never a raw `coordsAtPos`/`getBoundingClientRect` re-solve inside an `addEventListener('scroll')` / `onScroll` handler — that jitters and lags per frame.

Doc: [docs/agents/laws/scroll-anchor-stability.md](docs/agents/laws/scroll-anchor-stability.md).
CI: `scroll-reposition-guardrail.test.ts`.

### Refocus is not navigation

> **`focus()` is two commands wearing one name.** Besides taking DOM focus,
> TipTap's `focus()` schedules — inside a `requestAnimationFrame` — an
> `editor.commands.scrollIntoView()`, because its `scrollIntoView` option
> defaults to `true`. That deferred scroll targets whatever the SELECTION is by
> the time the frame runs. So a commit that edits **at a node** and leaves the
> caret alone does not "return focus": it NAVIGATES, to a stale caret. The door
> for "give the editor its focus back and leave the document where it is" is
> [`refocusEditor(editor)`](src/lib/tiptap/refocus-editor.ts).

Doc: [docs/agents/laws/refocus-is-not-navigation.md](docs/agents/laws/refocus-is-not-navigation.md).
CI: `refocus-no-scroll.test.ts`, `refocus-scroll-census.test.ts`.

### A NodeView owns its timers' lifetime

> **Every timer a vanilla NodeView arms is scheduled through its ONE
> [`ViewLifetime`](src/lib/tiptap/view-lifetime.ts), and `destroy()` disposes
> it — so no timer can outlive the view.** A wall-clock bound is still allowed
> (the heading label's refocus keeper still expires at 250 ms), but the view's
> teardown is the OUTER bound, and a scheduling call made after disposal arms
> nothing. **A React component owns its timers the same way** — the same scope,
> mounted by [`useViewLifetime`](src/hooks/useViewLifetime.ts), disposed on
> UNMOUNT; and because React dispatches no `blur` on unmount, the disposal is
> also where an uncommitted draft's edit session ENDS (as a cancel, through the
> field's own `FieldEditSession`), or it ends zero times (task 686's "React
> half"). Same defect when an element is RE-MINTED rather than unmounted: a
> sub-editor keyed by a value it edits is destroyed by its own edit.

Doc: [docs/agents/laws/a-nodeview-owns-its-timers-lifetime.md](docs/agents/laws/a-nodeview-owns-its-timers-lifetime.md).
CI: `nodeview-timer-lifetime.test.ts`, `view-lifetime.test.ts`, `use-view-lifetime.test.tsx`, `citation-card-timer-lifetime.test.tsx`, `par-title-edit-session.test.ts`, `test-mount-lifetime.test.tsx`.

### Pane-drag stability

> **Every pane/divider resize gesture runs on the ONE engine at [src/lib/pane-resize/](src/lib/pane-resize/)** (`usePaneResizeHandle`): pointer capture on the handle, element-scoped move/up/cancel/lostpointercapture, `button===0` start gate, `(buttons & 1)===0` missed-release failsafe (the primary-button BIT test, not `buttons===0` — releasing the drag button while a second is chorded fires only a pointermove with an updated mask, never a pointerup), Escape restore, a drag shield over iframes, RAF-coalesced equality-bailed imperative `apply()` (CSS-var writes; grid templates own hard clamps via `minmax()`/`clamp()`), and `commit()` exactly once on release. **Never** a bespoke `window`/`document` `pointermove` handler, and **never** per-frame React state, store notifies, or localStorage from a continuous gesture. Per-frame React state inside an engine consumer is sanctioned ONLY when a render-derived layout decision needs the live value (current sole case: `SplitWithCode`'s `liveRatio` — the compressed-gutter flip + clip fade derive from it in render), and only as LOCAL state driven from the engine's RAF-coalesced `apply()` (≤1 set per frame) with child subtrees bailing on element identity and persistence still commit-once; anything else is the per-frame-commit bug class this section exists to kill.

Doc: [docs/agents/laws/pane-drag-stability.md](docs/agents/laws/pane-drag-stability.md).
CI: `float-move-gesture-cost.test.tsx`, `floating-panel-edge-resize.test.tsx`, `content-drag-move-cost.test.ts`, `bespoke-gesture-missed-release.test.tsx`, `pane-drag-guardrail.test.ts`, `lift-overlay-motion-cost.test.tsx` ….

### Layout-gesture stability

> **A continuous layout gesture — a pane-divider drag, an OS window resize, OR a content drag (drop-mode session) — costs O(1) settles, not O(frames) recomputes.** Every geometry follower either **PARKS** (`parkDuringLayoutGesture`: stash the call, replay exactly once on the gesture's end edge) or **SUPPRESSES** (`useLayoutGestureActive` / `isLayoutGestureActive` / `onLayoutGestureChange`: hide for the gesture, restore on the end edge). Nothing re-solves per frame.

Doc: [docs/agents/laws/layout-gesture-stability.md](docs/agents/laws/layout-gesture-stability.md).
CI: `content-drag-guardrail.test.ts`, `pane-drag-guardrail.test.ts`, `use-pane-resize-handle.test.tsx`, `window-resize-guardrail.test.ts`, `scroll-listener-guardrail.test.ts`, `gesture-scroll-parking.test.tsx`.

### Bar occupancy: several occupants, ONE priority rule

> **Where several elements share a fixed-width strip, they do not position
> themselves against each other — the strip RESOLVES a priority ladder, once,
> from measured natural widths, and the lowest tier yields.** The ladder for the
> Virgil bar is stated in
> [src/components/editor-layout/bar-occupancy.ts](src/components/editor-layout/bar-occupancy.ts)
> (protected status > tabs > collapsible tools; `STYLE_GUIDE.md` → "Occupancy
> priority") and resolved by `useBarOccupancy` from ONE ResizeObserver over three
> boxes. When tier 2 still does not fit after tier 3 has yielded, it DEGRADES in
> a stated order rather than clipping — compress, then scroll (task 561, "The
> overflow half" below). Under it sits a structural FLOOR: the tab row lives in
> a scroll container, which clips, so an overlap is unrepresentable rather than
> merely avoided.

Doc: [docs/agents/laws/bar-occupancy.md](docs/agents/laws/bar-occupancy.md).
CI: `bar-occupancy.test.tsx`, `tab-strip-occupancy.test.tsx`, `tab-strip-scroll.test.tsx`.

### Editor geometry ("where is it on screen?")

> **Per-block screen geometry has ONE owner per editor: the EditorGeometry service** ([src/lib/editor-geometry/](src/lib/editor-geometry/service.ts), perf Wave 2 — the marginalia registry's engine evolved editor-attached, the `getBus`/`getDocProducts` precedent). IO near-zone culling (viewport ±800 px), one per-editor RO, a sparse uuid-keyed metrics cache with ε bails and parked (positioned-but-unpainted) twins, a RAF-coalesced gesture-parked measure pass. A consumer that needs a block's Y asks `getGeometry(editor)` (`blocksAtY`, `getMetrics`) or derives from the DocStructure snapshot (`computeSectionPathAt` — the breadcrumb: ONE `posAtCoords` at the reference line + binary search over pos-sorted headings ∪ `BlockEntry.parTitled` blocks) — it does not walk the doc calling `coordsAtPos` per block, and it does not `querySelectorAll` + rect-read per candidate. The pre-service scans survive only as automatic fallbacks (service null) behind kill-switches (`virgil:geom-breadcrumb`, `virgil:geom-hover` — any OFF spelling reverts; declared in [src/lib/feature-flags.ts](src/lib/feature-flags.ts)). `useMarginaliaRegistry` is a thin adapter over the service; its suites are the engine's parity gate. The service also owns the **viewport frame** (wave-2b C7): text edges / pod rect / scroll band / portal context, measured ONCE per editor by the engine's single RO (the editor element + its scroll container ride the same observer as the near-zone blocks) + window-resize + gesture park, equality-bailed, read through `useViewportFrame` ([src/lib/editor-geometry/use-viewport-frame.ts](src/lib/editor-geometry/use-viewport-frame.ts)) by the placement overlays (`SelectionActionsMenu`, `TextObjectGrabHandle`, `PendingChangePill`, `LiftHost`) — plus ONE non-placement reader that takes the channel directly rather than through the hook, `Marginalia`'s `useLaneCols`, because it needs a per-side COLUMN COUNT rather than a frame and subscribes with a primitive snapshot so an unchanged regime costs no render (see "The lane regime" below) — the per-consumer `useEditorViewportCache` (4 hook instances, 8 ROs + 4 resize listeners per pane measuring identical geometry) is DELETED. Caret line boxes on the placement path go through `coordsAtPosCached` (per-frame + per-doc memo on the service; service-less editors fall back to a direct read). Same inversion for the active-paragraph nav history (wave-2b C6): `computeActiveParagraphId` ([src/lib/editor-geometry/active-block.ts](src/lib/editor-geometry/active-block.ts)) — hidden-pane bail, `__DOC_TOP__` sentinel, ONE `posAtCoords` at the viewport top edge + snapshot binary search, legacy triple-walk retained as automatic fallback behind `virgil:geom-active-block`; its two wall-clock pollers (EditorLayout recorder, reader `useParaNavHistory`) gate on `document.hidden` + `isLayoutGestureActive()`. `useInTextPositions` (wave-2b C5) exact-reads only the scroll band and interpolates out-of-band anchors (`approxTopForPos`; scroll-idle refinement settles them exact) — with band membership decided on the anchor's document POSITION, never on the card's own last-committed top (see "The refinement gate" below). On the drop path, the per-move hit-test's block-rect read is THREADED into the placement builders (wave-2b C8) — one forced-layout read per move, with the builders' own read kept only as the fallback for rect-less callers. Probe: `window.__geometryStats()` (alias of `__marginaliaStats`; includes the `blocksAtY` hover-path counters). The wave-2 residual conversions (C5/C6/C7/C8) are all delivered.

Doc: [docs/agents/laws/editor-geometry.md](docs/agents/laws/editor-geometry.md).
CI: `useInTextPositions-pos-band-classification.test.tsx`, `viewport-probe.test.ts`, `marginalia-lane-regime.test.ts`, `unanchored-cards-chip.test.tsx`, `useInTextPositions-cascade-floor.test.tsx`, `omni-one-gutter-surface.test.tsx` ….

### Card presence tiers

> **A COLLAPSED card body mounts machinery proportional to its usefulness, not one live TipTap editor per card.** Tier model (per body; header/chrome always render): **T0** summary string → **T1** static HTML → **T2** read-only live editor → **T3** editable (the expand boundary, unchanged — an expanded card is never tier-gated). Behind the `virgil:card-tiers` flag (perf Wave 3; **default OFF until soak**; off = every switch site takes its legacy branch, byte-identical). Since task 660 every `virgil:` switch is DECLARED in one registry and read through one `readFlag` ([src/lib/feature-flags.ts](src/lib/feature-flags.ts)), which accepts `1/true/on/yes` and `0/false/off/no` in both directions — so a flag's spelling is no longer per-reader folklore.

Doc: [docs/agents/laws/card-presence-tiers.md](docs/agents/laws/card-presence-tiers.md).
CI: `borrowed-render.test.ts`, `card-presence-tiers.test.tsx`, `ExampleCardCollapsedProjection.test.tsx`.

### Editor-observer stability

> **No deep MutationObserver (`subtree`/`characterData`) over editor content, ever** — a characterData MO fires as a pre-paint microtask on EVERY keystroke, and one that reads layout (`scrollHeight`/`getBoundingClientRect`) forces a full-document layout right after the text mutation; one that then writes styles dirties layout AGAIN (measured ~30 ms per full-page relayout at ~320 blocks — the old editor-scrollbar MO paid this double-forced-layout per keystroke, the "typing feels sticky" class). Geometry belongs to **ResizeObservers** (post-layout delivery, ≤1/frame, only on real size change) and structure to the **DocStructureBus** — and an RO callback must be **read-before-write with equality bails** on every write (CSS var or React state), so it can't force mid-frame layout or feedback-loop on its own writes (var write → observed element resizes → RO fires → equal values → zero writes → stop).

Doc: [docs/agents/laws/editor-observer-stability.md](docs/agents/laws/editor-observer-stability.md).
CI: `editor-observer-guardrail.test.ts`.

### Per-doc services under multi-pane keep-alive

> **A module-level value that is per-DOCUMENT is a REGISTRY keyed by its owner, never a single slot — and a departing owner removes only its OWN entry.** N `EditorPane`s are mounted at once (multi-doc keep-alive, default ON at capacity 3; the Library Reader mounts the same component again, up to 4), one visible and the rest `display:none`. "The current doc" is therefore not a module-level fact. Where a caller has no owner in hand, resolve through the ONE ladder — `pickActiveByEditor` / `pickProbeEditor` ([src/lib/active-editor-probe.ts](src/lib/active-editor-probe.ts)): focused → visible (`offsetHeight > 0`, which is exactly what `display:none` falsifies) → sole → null. Never "whichever was written last".

Doc: [docs/agents/laws/per-doc-services-under-multi-pane-keep-alive.md](docs/agents/laws/per-doc-services-under-multi-pane-keep-alive.md).
CI: `dropctx-multipane-registry.test.tsx`, `pane-dom-multipane.test.tsx`, `pane-dom-census.test.ts`.

### Cross-window store stability

> **A store that caches a `localStorage` snapshot at module (or hook) scope MUST re-hydrate on the native `storage` event — through [src/lib/cross-window-storage.ts](src/lib/cross-window-storage.ts) (`subscribeToStorageKey`), never a hand-rolled listener.**

Doc: [docs/agents/laws/cross-window-store-stability.md](docs/agents/laws/cross-window-store-stability.md).
CI: `cross-window-storage-guardrail.test.ts`, `ai-requests-authority.test.ts`, `mutate-sidecar-primitive.test.ts`, `usePersistentState-inflight-dirty-guard.test.tsx`, `sidecar-watcher-wiring.test.tsx`, `bib-mutate-door.test.ts` ….

### Capture/schema symmetry — never delete what you cannot restore

> **A destructive action must never delete content its capture destination cannot represent.** A card body that holds a verbatim slice of the document declares `bodySchema: "excerpt"` in `CARD_REGISTRY` and mounts the FULL main-document vocabulary; anything that deletes-and-captures validates the capture against that schema (`canMountInCardBody`) **before** dispatching the delete, and aborts + notifies if it doesn't fit.

Doc: [docs/agents/laws/capture-schema-symmetry.md](docs/agents/laws/capture-schema-symmetry.md).
CI: `excerpt-schema.test.ts`, `card-body-capture.test.ts`, `archive-anchored-capture.test.tsx`, `archive-retarget-displaced-anchors.test.tsx`, `atom-card-api-coverage.test.ts`, `applied-splice-wiring-guardrail.test.ts` ….

### Escape means cancel

> **Escape ABANDONS — never the key that saves, never a synonym for what a click elsewhere would do.** Where a surface or field can END more than one way, the endings are separate CHANNELS: COMMIT (button/Return), DISMISS (click-away/blur), CANCEL (Escape, and any control whose label names Escape). Two may coincide; they may never be forced to by sharing one prop. `useMenuDismiss`/`MenuProvider` take an `onCancel` Escape ends through, defaulting to `onClose` so a menu that stages nothing is unchanged; a DEFERRED-COMMIT surface (`CitationCreatePopover`) supplies both.

Doc: [docs/agents/laws/escape-means-cancel.md](docs/agents/laws/escape-means-cancel.md).
CI: `escape-means-cancel-census.test.ts`, `useMenuDismiss.test.tsx`, `citation-create-popover-escape-cancel.test.tsx`, `citation-code-escape-cancel.test.tsx`, `field-edit-session.test.tsx`.

### Transient state is never document content

> **A view-only signal painted over the document — a search hit, a diagnostics error range, a hovered card's anchor, a quoted revision — is a ProseMirror DECORATION replaced by a meta-only transaction. Never a mark, never a node attribute the document carries.**

Doc: [docs/agents/laws/transient-state-is-never-document-content.md](docs/agents/laws/transient-state-is-never-document-content.md).
CI: `transient-highlight-guardrail.test.ts`, `transient-highlight.test.ts`.

### A preservation guard may not restore the removal itself

> **A guard that reverts a user's removal must never leave the document
> BYTE-IDENTICAL.** Where its remedy reproduces exactly what vanished, the guard
> has preserved nothing — it has VETOED the gesture, silently, permanently, with no
> feedback and no user-reachable escape. Ask the literal question
> (`removed.eq(replacement)`) rather than a proxy for it, and fail OPEN.

Doc: [docs/agents/laws/a-preservation-guard-may-not-restore-the-removal-itself.md](docs/agents/laws/a-preservation-guard-may-not-restore-the-removal-itself.md).
CI: `anchored-empty-block-keyboard-delete.test.ts`, `anchored-block-delete-reinsert.test.ts`, `list-item-boundary-backspace.test.ts`.

### Addressing the live document across an async gap

> **A surface that renders from a SNAPSHOT and writes on a later gesture names its target by durable IDENTITY, never by position.** The vocabulary is [src/lib/tiptap/block-address.ts](src/lib/tiptap/block-address.ts) — `BlockAddress` (`uuid` + a pre-hydration `index` fallback), `BlockSpanAddress` (+ `section`), resolved against the LIVE doc at apply time by `resolveBlockIndex` / `resolveBlockSpan`.

Doc: [docs/agents/laws/addressing-the-live-document-across-an-async-gap.md](docs/agents/laws/addressing-the-live-document-across-an-async-gap.md).
CI: `block-address.test.ts`, `outline-mutators-address-live-doc.test.tsx`, `focus-region-address.test.ts`, `outline-address-census.test.ts`, `strip-drop-identity.test.tsx`, `strip-button-drag-teardown.test.tsx` ….

### A registry earns its name by being read

> **A table that declares per-kind behaviour is an SSOT only if something READS it. A published export is alive only if something CALLS it — and a re-export is not a caller.**

Doc: [docs/agents/laws/a-registry-earns-its-name-by-being-read.md](docs/agents/laws/a-registry-earns-its-name-by-being-read.md).
CI: `link-surface-honesty.test.ts`, `margin-side-ssot.test.tsx`, `card-side-derivation.test.ts`, `view-prefs-side-migration.test.ts`, `float-accent-follows-override.test.tsx`, `bib-family-detection-authority.test.ts` ….

### The prose index: "which characters are prose, and where"

> **One question, one owner.** `src/lib/prose-index.ts` yields the PROSE
> character runs of a document with their ProseMirror positions — every
> carrier run, every markless block and every atom excluded — and the
> exclusion vocabulary is DERIVED from the SSOTs and from the live schema,
> never hand-listed.

Doc: [docs/agents/laws/the-prose-index.md](docs/agents/laws/the-prose-index.md).
CI: `prose-index.test.ts`, `search-prose-only.test.ts`, `spellcheck-policy.test.ts`, `spell-engine-recovery.test.tsx`, `prose-words.test.ts`, `spellcheck-decorator.test.ts` ….

### The write path: no automatic write may lose content

> **A write the user did not ask for is measured before it lands.** Virgil's
> `.tex` is the user's only copy, and every automatic path to it — the
> load-writeback, the 1500 ms autosave, an anchor-mint flush, a code-pane
> re-parse, the editor's own mount — can persist a model that represents the
> file less completely than the file does. Each of those doors MEASURES what it
> is about to commit against what the document was READ with, and a shortfall is
> a REFUSAL published to one channel that reaches the user and gates the door.

> **And a write that LANDS may not lose content either: a write is a SPLICE,
> never a rebuild.** Nothing re-emits a content file from a model that is a
> PROJECTION of it — an entry's new block replaces exactly its own span in the
> original `.bib` text, a field's new value exactly its own span in the original
> block ([src/lib/bib-source.ts](src/lib/bib-source.ts)), and what cannot be
> spliced safely is REFUSED on task 685's channel rather than guessed at.

Doc: [docs/agents/laws/the-write-path.md](docs/agents/laws/the-write-path.md).
CI: `conflict-resolution.test.ts`, `conflict-net.test.ts`, `external-change-badge.test.tsx`, `useDocument.autosave-pause.test.ts`, `emergency-mirror.test.ts`, `reload-door.test.ts`, `bib-write-splice.test.tsx` ….

### The compile path: downloaded work is DURABLE, and a slow compile SAYS SO

> **A compile that cannot finish inside one budget must still make PROGRESS, and
> every phase it spends minutes in must reach a pixel.** Virgil compiles in the
> browser: a first compile of a paper using tikz/pgf pulls 60–100 files from a
> third-party mirror over SERIAL SYNCHRONOUS XHR, one blocking round trip each.
> That is the app's single longest operation, and until task 454 it was also the
> only one with neither durability nor a voice.

Doc: [docs/agents/laws/the-compile-path.md](docs/agents/laws/the-compile-path.md).
CI: `compile-convergence.test.ts`, `worker-kpse-contract.test.ts`, `compile-pane-status.test.tsx`, `tex-bundle-integrity.test.ts`.

### Vendored viewers: the WRAPPER owns the defaults, and the dist gets a CENSUS

> **A vendored third-party viewer's own defaults are not Virgil's.** Every
> Virgil-side preference about how it BEHAVES is stated ONCE at the wrapper's own
> open door and applied PER OPEN — never patched into the dist. And the vendored
> tree carries a **patch census**, because its hand edits are otherwise held
> together by prose telling a human to re-apply them after the next `unzip -o`.

Doc: [docs/agents/laws/vendored-viewers.md](docs/agents/laws/vendored-viewers.md).
CI: `PdfView.viewerDefaults.test.ts`.

## Style

[src/STYLE_GUIDE.md](src/STYLE_GUIDE.md) is the design-system reference. Check it before building new UI. Update it when a UI decision feels generalizable.

## Sample paper for the dev doc

[samples/annotation-history/](samples/annotation-history/) is a frozen reference paper that exercises every card panel and most of the formatting vocabulary (footnotes, citations, bibliography, reports, examples with expex glosses, notes, todos, archive, cuts, revisions with multi-turn dialogue, suggestions, AI requests, bib reviews). The essay is on the history of annotation — self-referential, so the apparatus around the text mirrors what the text describes.

Use it to refresh `virgil-data/doc_devtest/` whenever it gets choppy from testing:

```
rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest
```

If the sample itself needs updating (new card kind, schema change), edit `virgil-data/doc_devtest/` live in the dev preview and copy back: `cp -R virgil-data/doc_devtest/. samples/annotation-history/`.
