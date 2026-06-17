# INV-5 — Retire shift-grab + inventory every (re)anchor path

Read-only investigation. All file:line citations verified against working tree at HEAD (main, commit 2fe534d). No source edited.

---

## TL;DR

- The **shift-grab drop-mode entry** lives in exactly ONE place in source: `src/components/FloatingPanel.tsx:432` (`if (e.shiftKey && cardKey && mode === "floating")` → `beginDropSession`). That `e.shiftKey` gate is the entire retirement surface in code. The controller (`beginDropSession`) it calls is shared with NON-shift entries (block grab handle, inline-atom grab, stack pull) and must STAY.
- **No other shift-gated drop/anchor gesture exists.** Every other `shiftKey` hit in the repo is unrelated (outline focus-expand, Cmd-W/Cmd-P/Cmd-/ keyboard guards, Enter-vs-Shift-Enter in popovers, and the inline-atom grab which *bails on* shiftKey). Leave them all alone.
- The new drop **button** should reuse the existing `beginDropSession` controller verbatim — the same SSOT the shift-grab, the block grab handle (`TextObjectGrabHandle`), the inline-atom grab, and the stack pull all already funnel through. This is the deep-architectural win: delete one modifier branch, add a button that calls the *identical* entry. Per-kind behavior is already fully data-driven via `CARD_REGISTRY[kind].dropSpec` + the `DropSpec.allowedPlacements` facet — no per-kind switch needs to be written.
- **Requirement (6) is NOT satisfied by today's hit-test.** `hitTest()` gates on `editor.view.posAtCoords({left:x, top:y})` and `return null` when it's null (`hit-test.ts:54,58`). In the editor's left/right margin (outside the prose glyphs) `posAtCoords` returns null, so a paragraph-side drop does NOT currently resolve from the horizontal band — only from over the text column. This is the one genuine code change the feature needs beyond UI.

---

## (A) RETIREMENT LIST — shift-grab

### A1. Code — the ONLY behavioral retirement

**`src/components/FloatingPanel.tsx:419-441`** — `onHeaderMouseDown`. The shift gate is:

```
428    // Shift+mousedown on the grab bar → drop-mode session. Only for
429    // popped-out cards/blocks (have a cardKey). The controller no-ops
...
432    if (e.shiftKey && cardKey && mode === "floating") {
433      const started = beginDropSession({
434        cardKey,
435        origin: { x: e.clientX, y: e.clientY },
436      });
437      if (started) {
438        e.preventDefault();
439        return;
440      }
441    }
```

This is the **primary thing being replaced**. Requirement (7) = remove this `e.shiftKey` branch. The `beginDropSession` import at `FloatingPanel.tsx:20` becomes unused IF the new button lives in a different component; if the button lives in the float chrome that FloatingPanel renders, the import may stay. (Verify at implementation time — the import is currently used only by this branch.)

Note the prop docstring that documents the gesture: `FloatingPanel.tsx:51-53` (`cardKey` … "Required to start a drop-mode session on shift+mousedown"). Update the doc-comment.

### A2. Code comments that NARRATE "shift-drag"/"shift+mousedown" (no behavior, but stale after retirement)

These are comments only; they describe the retired gesture and should be reworded to "drop button":

- `src/components/drop-mode/controller.ts:3` — module docstring: "from 'shift-mousedown on FloatingPanel header' to drop or cancel".
- `src/components/drop-mode/controller.ts:12` — `beginDropSession` doc: "called from FloatingPanel header on shift-mousedown".
- `src/components/drop-mode/types.ts:2-7` — `DropSpec`/`DropSession` module docstring: 'Drop mode is the "shift + grab a popped-out item\'s grab bar" gesture'.
- `src/components/Editor.tsx:504` — "drop-mode (float-header shift-drag)".
- `src/components/Editor.tsx:1856` — "so shift-drag hit-testing can find this editor".
- `src/components/RichTextField.tsx:464` — "so shift-drag can target card bodies".
- `src/app/globals.css:3209` — drop-mode section header: '"Shift + grab a popped-out item\'s grab bar" gesture'.
- `src/app/globals.css:3263` — "The shift+drag drop-mode bar … keeps its smooth glide".
- `src/text-objects/text-object-floatable.tsx` / `src/text-objects/types.ts:185` — generic "popout/drop-mode" mentions (already generic; only touch if they say "shift").

None of these are load-bearing; they're a documentation-consistency cleanup that should ride the same change so the SSOT comments don't lie.

### A3. Docs — MUST be updated (all three named docs reference shift-to-drop)

- **`docs/agents/main-text.md:167-173`** — the entire **"## Drop mode"** section. Line 169 verbatim: *"Shift-grabbing a popped float's grab bar puts the app into **drop mode**…"*. Line 171: *"Entry: `beginDropSession({ cardKey })` … called by `FloatingPanel`'s shift-drag and by `StackThumbnail`"*. Rewrite the entry description to "the per-card drop button" (the StackThumbnail entry stays — it's not shift).
- **`docs/agents/main-text.md:13`** — "The only surviving text-move paths are drag-to-pop-out … and drop-mode (shift-drag on a float header)." Reword "shift-drag on a float header" → "the drop button on a card / float header".
- **`docs/agents/ui-chrome.md:190`** — "The float header is the only drag/redock affordance now (shift-drag → drop-mode)" and "drop-mode (shift-drag on a float header)". Two mentions in one bullet.
- **`docs/agents/glossary.md:149`** — the "Text drag handle" removed-row note ends "…drop-mode (shift-drag on a float header)."
- (Not in the named-three but same family — flag for the doc sweep) — the keystroke-sanctity / other docs do not mention shift-to-drop; only these four lines across the three named docs do.

Per the project's **Glossary protocol**, if "drop button" / "double-chevron drop glyph" become user terms, append them to the Pending terminology section of `docs/agents/glossary.md`.

---

## (B) INVENTORY — every (re)anchor path, with subsume-vs-coexist verdict

The drop-mode controller is a true SSOT: FOUR distinct gestures already call `beginDropSession` (`FloatingPanel.tsx:433`, `TextObjectGrabHandle.tsx:868`, `inline-atom-grab.ts:145`, `StackThumbnail.tsx:36`), and dispatch is fully data-driven through `lookupSpec(cardKey)` → `CARD_REGISTRY[kind].dropSpec` (`registry.ts:49-63`) + `DropSpec.allowedPlacements`.

### Per-kind dropSpec → placement matrix (the SSOT the new button inherits for free)

Registrations: `src/cards/drop-specs/index.ts:33-45`.

| Card kind | dropSpec | placement (where it drops) | req-5 verdict |
|---|---|---|---|
| `note` | `noteDropSpec` (`Notes/drop-spec.ts:14`) | **paragraph-side** (margin) | margin-only ✓ |
| `highlight` | `highlightDropSpec` (`Notes/drop-spec.ts:19`) | **paragraph-side** | margin-only ✓ |
| `todo` | `todoDropSpec` (`Todo/drop-spec.ts`) | **paragraph-side** | margin-only ✓ |
| `archive` | `archiveDropSpec` | **paragraph-side** | margin-only ✓ |
| `cutter-comment` / `cutter-suggestion` | `cutter*DropSpec` | **paragraph-side** | margin-only ✓ |
| `revision-comment` / `revision-suggestion` | `revisionDropSpec` (shared) | **paragraph-side** | margin-only ✓ |
| `report` / `report-request` | `report*DropSpec` | **paragraph-side** | margin-only ✓ |
| `footnote` | `footnoteDropSpec` = `inlineAtomMoveSpec({nodeName:"footnote"})` | **inline-cursor** (the `\footnote` atom) | in-text ✓ |
| `citation` | `citationDropSpec` = `inlineAtomMoveSpec({nodeName:"citation"})` | **inline-cursor** (the `\cite` atom) | in-text ✓ |
| `example` | `exampleDropSpec` = `blockMoveSpec` | **between-blocks** | block move (in-text-ish) |
| `bib` | `null` (`card-registry.tsx:287` "intentional: bib entries don't anchor to text") | — | **the req-1 bib exception is already encoded** ✓ |
| `ai` / `error` | `null` | — | no anchor |

The per-kind judgement calls Gabriel asks for in req-5 are **already made and shipped** as the `allowedPlacements` facet: `["paragraph-side"]` (margin) via `text-object-side-reanchor.ts:32`; `["inline-cursor"]` (in-text atom) via `inline-atom-move.ts:66`; `["between-blocks"]` via `block-move.ts:28`. The new button simply needs `card.kind`'s spec to exist (gate the button on `CARD_REGISTRY[kind].dropSpec != null` — that also auto-hides it on bib/ai/error, satisfying "bib is the likely exception").

### The four existing `beginDropSession` gesture entries

1. **Float-header shift-grab** — `FloatingPanel.tsx:433`. **→ RETIRE & SUBSUME.** This IS the thing the button replaces (B's verdict = the button calls the same `beginDropSession(cardKey)`, minus the `e.shiftKey` gate, plus mousedown-drag immediacy per req-3).

2. **Block grab handle** — `TextObjectGrabHandle.tsx:868` (`beginDropSession({cardKey, inPlace:true, externalCommit:true})`). Gesture starts on a **plain** `mousedown` (button 0, no shift; `TextObjectGrabHandle.tsx:685`). This is the in-text **6-dot lift** in the editor margin for paragraph / heading / figure / list / example blocks — ghost-vs-popout dual mode. **→ COEXIST.** Different affordance (grabbing a block IN the doc via its gutter handle), different payload (block move, not card re-anchor). Not shift-gated, so untouched by req-7.

3. **Inline-atom grab** — `inline-atom-grab.ts:145` (`beginDropSession({cardKey:'atom-grab:...', inPlace:true, externalCommit:true})`). **Explicitly BAILS on `event.shiftKey`** at `inline-atom-grab.ts:204-211` (also meta/ctrl/alt). This is the direct in-prose drag of the `footnote`/`citation`/`\ref`/`inlineMath` atom (the atom is its own handle). **→ COEXIST.** It is the *non-shift in-doc atom drag* — a different affordance from the card's drop button. Note: footnote/citation get TWO anchor routes — (a) this in-text atom grab, and (b) the card's new drop button (via `inlineAtomMoveSpec` by-id resolver) which lands at the same `inline-cursor` placement. Both are intended; the card button is the "re-anchor from the panel/float" path, the atom grab is the "grab the marker in the prose" path.

4. **Stack pull** — `StackThumbnail.tsx:36` (`beginDropSession({cardKey:'stack-pull:<id>'})`), plain `onMouseDown` (`StackThumbnail.tsx:28`), no shift. **→ COEXIST.** Pulls an item OUT of the Stack into the doc (paste-as-new); entirely separate from re-anchoring an existing card. Documented at `ui-chrome.md:220`.

### Other (re)anchor mechanisms NOT routed through the controller

5. **Marginalia gutter-marker drag** — `src/components/Marginalia.tsx`. Uses **native HTML5 drag-and-drop** (`onDragStart`/`dragover`/`drop` at `Marginalia.tsx:493-516, 360-369`), NOT `beginDropSession`. On drop it reads `MIME_MARGINALIA_MOVE` and dispatches `virgil-marginalia-reanchor` (`Marginalia.tsx:262-274`). It ALSO handles panel→gutter anchor drops for note/todo/cut/report/archive via their MIME types + custom events (`Marginalia.tsx:277-357`). This is the **in-canvas** re-anchor: drag the marker icon in the margin to a new paragraph. **→ COEXIST (DESIGN-CALL — see C).** It overlaps functionally with the new drop button (both re-anchor a margin card to a paragraph), but it's an in-canvas alternative the user may want to keep. It is a *parallel mechanism* (different drag system, MIME-based, custom-event dispatch) — the deep-architectural ideal would eventually fold it onto the controller, but that's a larger move than req-5 scopes.

6. **`reanchorByText`** — `src/links/links.ts:910`. NOT a user gesture. A best-effort **load-time recovery** that re-stamps a `linkedAnchor` mark by searching the doc for the saved `textSnapshot` when the mark was lost across a parse. Invoked by `Editor.tsx:1646` (`applyLinkedAnchors`) on doc load. **→ COEXIST / IRRELEVANT to this feature.** (Documented `main-text.md:120-122`.) Do not touch.

7. **`/editor/move-card` skill + `apply_response` `move` op** — `editor/skills/move-card.md`. The **AI-agent-side** re-anchor: rewrites `links[*].anchor.textObjectIds` in the sidecar atomically under the pen; handles Mode-A paragraph-anchored cards only, DEFERS atom-bearing footnote/citation. **→ COEXIST.** This is the agent equivalent of the human's drop button; both mutate the same anchor SSOT (the card's `links` array) but via different surfaces (mouse gesture vs sidecar write). No conflict.

8. **`links.ts` anchor primitives** — `createLink`/`deleteLink`/`createAnchorLink`/`removeLinkedAnchor`/`removeLinkedAnchorMark` (`links.ts:262, 628, 321, ~680, 703`). These are the low-level mutators the `text-object-side-reanchor` spec already calls (`removeLinkedAnchor` at `text-object-side-reanchor.ts:16,71`). **→ SUBSUME (already shared).** The drop button reuses them transitively via the spec — no new path.

---

## Requirement (6) — the one real hit-test gap

`hitTest()` (`src/components/drop-mode/hit-test.ts:40-113`):

```
46    const editor = findEditorAtPoint(x, y);    // elementsFromPoint → .ProseMirror (target-registry.ts:45-60)
...
53    posResult = editor.view.posAtCoords({ left: x, top: y });
...
58    if (!posResult) return null;               // ← BAILS in the margin
...
96    const blockRect = block.dom.getBoundingClientRect();
97    const inText = y >= blockRect.top && y <= blockRect.bottom;   // vertical band OK
98    const inGap  = !inText;
...
108   if (kind === "paragraph-side") {
109     return makeParagraphSidePlacement(editor, block, x);
```

- `findEditorAtPoint` DOES find the editor when the cursor is over the `.ProseMirror` root's horizontal **padding** (`px-20`), because `elementsFromPoint` hits the `.ProseMirror` element there (`target-registry.ts:47-52`).
- BUT `posAtCoords` returns null once x is outside the actual text glyphs (left/right margin), so the function `return null`s at line 58 **before** it can resolve a paragraph-side placement. The vertical band check (`inText` on `y` only, line 97) is already band-correct; it's the `x`→`posResult` gate that's too narrow.
- **Implication for the plan:** to satisfy req-6 ("anywhere in the paragraph's horizontal band, including the margins, is sufficient for a margin drop"), the hit-test needs a fallback when `posAtCoords` is null but the cursor is vertically within a block's rect — resolve the block by Y against the editor's child blocks (the code at `hit-test.ts:168-184` already does exactly this Y-distance walk as a gap fallback; it can be reused). Only matters for `paragraph-side` specs; inline-cursor/between-blocks legitimately need a real position. This is the single load-bearing code change beyond UI + the shift-gate deletion.

---

## (C) USER-DESIGN-CALLS

1. **Marginalia gutter-marker drag (path 5): keep, retire, or fold onto the controller?** It re-anchors the SAME margin cards the new drop button will (note/todo/cut/report/archive/revision), so it becomes a redundant second mechanism. Options: (a) **keep as an in-canvas alternative** (lowest effort, two parallel systems persist); (b) **retire it** for one-true-path purity (but loses the "drag the marker itself" directness); (c) **fold it onto `beginDropSession`** (deepest, unifies the HTML5-DnD path with the controller — larger scope than req-5). The prompt itself flags this ("the gutter-marker drag may stay as an in-canvas alternative"). Recommend **(a) keep** for this feature, **(c) as a follow-up** consistent with the "capture the whole class" steer.

2. **Footnote/citation will have TWO in-text anchor routes** — the card's drop button (req-1) AND the existing in-prose atom grab (path 3). Confirm both are intended (they land at the same `inline-cursor` placement via the same `inlineAtomMoveSpec`). Likely yes — they're different entry surfaces — but worth an explicit nod since req-1 says "every card that has a text anchor," and footnote/citation cards qualify.

3. **Button placement when the card is NOT popped out (in-panel rows) vs popped-out floats.** Req-1 says "far-right corner … to the LEFT of the X." The X (close) is the *float/panel* close button. In-panel card rows may not show an X. Decide whether the drop button appears on in-panel card rows too, or only on popped-out floats / hovered rows. (The shift-grab it replaces only worked on popped-out floats — `FloatingPanel.tsx:432` gates on `mode === "floating"`. So a literal replacement is float-only; req-1's "every card" may widen the surface.)

4. **`example` (between-blocks) and any block-move card** — does the drop button appear on example cards too? Its spec is `blockMoveSpec` (`between-blocks`), which moves the whole example block, not a margin re-anchor. Req-5 says "make per-kind judgement calls"; example is a content block, so its drop button (if shown) means "move the block," semantically different from "re-anchor a margin card." Confirm whether example gets the button or is excluded like bib.

---

## Confidence notes / open verifications

- HIGH that `FloatingPanel.tsx:432` is the sole shift-gated drop entry: exhaustive `grep shiftKey` across `src/` returned only this + the unrelated outline/keyboard/popover uses, all classified above.
- HIGH on the per-kind dropSpec matrix: read directly from `cards/drop-specs/index.ts` + each `*/drop-spec.ts` + the util factories.
- HIGH on req-6 gap: traced `hitTest` and `findEditorAtPoint` directly; the `posAtCoords`-null bail is explicit. The exact margin geometry (does `.ProseMirror` padding always extend to the band edge the user expects?) is worth a quick live check at implementation, but the bail-at-line-58 logic is unambiguous.
- MEDIUM on whether removing the `beginDropSession` import from `FloatingPanel.tsx` is required — depends on where the new button component lives; flagged for implementation.
