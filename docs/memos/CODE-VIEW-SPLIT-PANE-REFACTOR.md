# Code View — Split-Pane Refactor (Session N+1)

**Status: shipped, ONE open followup.** The architectural work landed cleanly. The followup is a visual artifact at the top of the editor pod (initial-scroll only) that I could not fully diagnose before session end. See [§5](#5-open-followup-the-top-of-pod-gap-at-scroll0) for the open thread and the hypothesis ranking for next session.

Commit: `8b9659c` (10 files, +1195 / −196). Plan: [`/Users/gabriel/.claude/plans/sounds-good-plan-it-swift-piglet.md`](../../../../.claude/plans/sounds-good-plan-it-swift-piglet.md).

## 1. What the user asked for

Four things, fixed in one architectural sweep:

1. **Save bug**: Edits made in Code view didn't reliably persist.
2. **Terminology**: Drop "Visual mode" — make it a single "Code" on/off toggle.
3. **Split pane**: Code view should mount *alongside* `EditorPane`, not replace it. Vertical splitter; editor auto-shrinks gutters past natural width; past the compressed min, the splitter overlays/clips the editor's right edge rather than blocking.
4. **Selection sync**: Click a paragraph in either pane, the counterpart scrolls/selects.

User preference: deep architectural fixes over surgical patches.

## 2. Architectural decisions

- **In-memory source of truth: TipTap.** Code-view edits no longer write `.tex` directly. They parse through `parseLatex`, get pushed into TipTap via `setContent`, and TipTap's existing `useDocument` autosaver writes disk via `writeDocBundle` (which serializes back to `.tex` + updates the UUID-hint sidecar in one shot).
- **`.tex` was already canonical on disk.** Phase 1 of the plan (bundle-as-cache discipline) turned out unnecessary — `readDocBundle` already parses `.tex` on load and the bundle/sidecar are derived. The bug class (divergent `writeTex` / `writeDocBundle` paths) is eliminated purely by making CodeEditor stop calling `writeTex`.
- **Split-pane primitive.** New component `SplitWithCode` ([src/components/editor-layout/split-with-code.tsx](../../src/components/editor-layout/split-with-code.tsx)) — vertical splitter on top of the existing `useDragGap` hook. Editor wrapper has fixed pixel width when open; the editor's natural width is preserved inside, the wrapper visually clips past compressed min.
- **`overflow-x: clip` (not `hidden`)** on the editor wrapper. `clip` does not create a scroll container or a sticky-positioning ancestor — so EditorPane's 9 sticky chrome elements continue to anchor to the outer `[data-virgil-row-scroll]` exactly as before.
- **Code-pane ratio**: single global pref `viewPrefs.codePaneRatio` (default 0.55), persisted across docs and sessions.
- **No mirror-split coexistence yet** — the user can't have the existing TipTap+EditorMirror split AND code view open simultaneously. Not enforced in code yet (mutual-exclusion guard was in the plan but didn't ship; both can technically run, untested for that combination).
- **UI rename: labels only.** Identifiers (`codeView`, `toggleCodeView`, `switchToCodeView`, `switchToVisualView`) intentionally untouched — too much churn for a UX rename.
- **Deferred:** keyboard shortcut (`Cmd+Shift+E`), per-paragraph "open in code" gutter button, Code card panel. All discussed, all out of scope for v1.

## 3. Files in the commit

**New:**
- [`src/lib/code-pane-bridge.ts`](../../src/lib/code-pane-bridge.ts) — Bidirectional sync state machine. Owns the `syncing` flag (echo prevention), a `CodeMirror SYNC_ANNOTATION` for sync-originated dispatches, parse-error tracking, cursor-anchor capture/restore (paragraph UUID + intra-paragraph char offset), and selection sync (TipTap `selectionUpdate` ↔ CodeMirror `selectionSet`, RAF-throttled). Debounce: 600 ms code→TipTap (parse cost), 150 ms TipTap→code (cheap serialize).
- [`src/components/editor-layout/split-with-code.tsx`](../../src/components/editor-layout/split-with-code.tsx) — Vertical splitter. Owns clip math, ResizeObservers (container + editor natural width), gutter-compression decision, fade-gradient on clipped edge.
- [`src/components/editor-layout/CodePaneSplitContext.tsx`](../../src/components/editor-layout/CodePaneSplitContext.tsx) — React context publishing `{active, compressed, clippedPx}` to descendants. EditorPane reads it to know when to compress its `--editor-pl`/`--editor-pr` CSS vars.
- [`src/lib/__tests__/code-bridge-roundtrip.test.ts`](../../src/lib/__tests__/code-bridge-roundtrip.test.ts) — 7 tests asserting UUID preservation across `parseLatex(serializeToLatex(doc))` for every UUID-bearing node type, plus a fixed-point assertion. All green.

**Modified:**
- [`src/components/CodeEditor.tsx`](../../src/components/CodeEditor.tsx) — Rewrote save path. Drops `persist()`, `writeTex` import, unmount-save fallback, debounce timer. Takes required `editor: TipTapEditor` prop, constructs bridge in `useEffect` keyed on `[docId, editor, viewReady]`. Initial CM value is `serializeToLatex(editor.getJSON())` with preamble/postamble extracted from a one-time `readTex` on mount. Inline warning band for parse errors.
- [`src/components/EditorLayout.tsx`](../../src/components/EditorLayout.tsx) — Deleted the standalone `codeView && currentDocId` branch (lines 4758–4829 in the old file). The editor branch now wraps `<EditorPane>` in `<SplitWithCode>`. `switchToCodeView` no longer sets `editorInstance = null` — TipTap stays mounted across the toggle. Toggle button re-titled "Code" with `aria-pressed` state.
- [`src/components/EditorPane.tsx`](../../src/components/EditorPane.tsx) — Reads `useCodePaneSplit()` context. When `compressed`, overrides `effectiveLeftMargin` / `effectiveRightMargin` to `min(natural, COMPRESSED_GUTTER_PX = 16)`. This drops the editor's hard min-width from ~460 to ~334 px. Vertical margins unaffected.
- [`src/hooks/useViewPrefs.ts`](../../src/hooks/useViewPrefs.ts) + [`useViewPrefs.defaults.json`](../../src/hooks/useViewPrefs.defaults.json) + [`reader-view-prefs.ts`](../../src/components/editor-layout/reader-view-prefs.ts) — Added `codePaneRatio: number` (default 0.55, range 0.05–0.95, in `GLOBAL_PREF_KEYS`).

## 4. Mid-session fixes worth remembering

Two regressions surfaced during interactive verification and were fixed in the same session:

### 4a. Splitter mid-band oscillation

**Symptom:** When the splitter sat in the band where the editor wanted to compress, the editor flickered between natural and compressed gutters every frame. Did not stop when user released the mouse.

**Cause:** ResizeObserver feedback loop. I was measuring `editorNaturalWidth` continuously. When `compressed` flipped to true, gutters shrank → editor's `scrollWidth` shrank → became smaller than the wrapper width → `compressed` flipped to false → gutters expanded → `scrollWidth` grew → `compressed` flipped to true. Classic.

**Fix:** Added `compressedRef` that mirrors `compressed` synchronously each render. The ResizeObserver callback skips updating `editorNaturalWidth` while `compressedRef.current === true`. So the threshold stays pinned at its uncompressed value, no oscillation. See `useLayoutEffect` block in `split-with-code.tsx` ~line 90.

### 4b. Wrapper trapped scroll + reanchored sticky chrome

**Symptom:** Editor was no longer scrollable. Sticky pod cap and MenuBar "separated" from the editor as it scrolled. Present even when code view was closed.

**Cause:** My wrapper had `className="relative overflow-hidden"`. Per CSS spec, `overflow: hidden` creates both a scroll container (trapping wheel events with no visible scrollbar) AND a new "scrolling ancestor" for `position: sticky` descendants. EditorPane has 9 sticky elements (top pod cap, MenuBar, section lozenge, reading-frame mask, expand-all controls, top+bottom drag gaps, bottom pod cap, bottom reading-frame mask) that all reanchored to my wrapper instead of `[data-virgil-row-scroll]`.

**Fix:** Replaced `overflow: hidden` with `overflowX: clip; overflowY: visible`. CSS Overflow L3's `clip` value does the same visual clipping without creating either context. Supported Chrome 90+ / Firefox 81+ / Safari 16+. Confirmed via live eval: 9 sticky elements pin to outer scroller; programmatic `scrollTop = 500` works.

## 5. Open followup: the top-of-pod gap at scroll=0

**Symptom (user-reported, multiple screenshots in session transcript):** When the user is at the top of the document (scroll=0), there's a visible beige gap between the sticky pod cap (which appears at the top of the viewport) and the first content of the pod (title, author, date). As the user scrolls *down*, the gap closes — eventually the title sits flush under the cap.

User believes the regression was introduced by this session's refactor ("small possibility it came through a different change").

### What I confirmed by live eval

At scroll=0 in the dev test doc, the layout reads:

```
scrollerTop (viewport y of [data-virgil-row-scroll]):    32
colViewportTop (column top):                             32
colOffsetTop (column offset in scroller):                 0
podOffsetTop (pod offset in column):                     24
podViewportTop (pod top in viewport):                    56
```

Column children at scroll=0 (filtered to relevant):

| idx | class | position | top | offsetTop | viewportTop | height |
|-----|-------|----------|-----|-----------|-------------|--------|
| 0 | (reading-frame mask) | sticky | 32px | 32 | 64 | 40 |
| 1 | (section indicator) | sticky | 0px | 0 | 32 | 0 |
| 2 | (MenuBar) | sticky | 0px | 0 | 32 | 24 |
| 3 | (pod cap, z:30) | sticky | 24px | 24 | 56 | 8 |
| 5 | (top drag-gap) | sticky | 40px | 40 | 72 | 4 |
| 6 | `editor-pane-pod` | relative | 0px | 24 | 56 | 6431 |

Pod CSS vars: `--editor-pt: 40px`, `--editor-pl: 88px`, `--editor-pr: 72px`, `--editor-pb: 40px`. The ProseMirror inside the pod has `padding-top: 40px`, putting its first child (title block) at `pod.top + 40 = 96` in viewport coords.

User-reported gap is **inside the pod itself** (they confirmed answer 3a on the diagnostic: gap is in `editor-pane-pod`, not a sibling). That suggests the gap is the pod's own 40 px `--editor-pt` padding-top, visually exposed at scroll=0 because the sticky chrome above ends at y=72 (top of drag-gap) but the prose doesn't start until y=96 — a 24 px slice of pod top *padding* is visible between them.

**But** I tested in the dev doc and didn't see anything wrong (the dev doc title was flush with the cap in my screenshot). The user says they DO see it in the dev doc. This is the contradiction I didn't get to resolve.

### Hypothesis ranking for next session

1. **(Most likely)** The reading-frame mask layout assumes content underneath it doesn't have its own top padding. The mask is a sticky 40 px beige strip at `top: 32`, height `40` — it covers viewport y=64 to y=104. The pod top is at y=56; the pod's `padding-top: 40px` puts prose content at y=96. So the mask covers y=64–104, prose starts at y=96, mask overlaps prose by 8 px. There's an 8 px slice (y=64 to y=72 ∪ y=96 to y=104) of the mask that's visible *over* pod padding. If sizes drifted (e.g. pod cap height changed, or some chrome above gained an extra pixel), the mask would no longer exactly mask the pod's top padding region and a beige strip would appear. Worth checking whether `--pod-gap` / pod-cap height / reading-frame-mask height changed recently in unrelated commits.

2. **(Second-most likely)** My SplitWithCode wrapper changes the *vertical* positioning of EditorPane subtly. The wrapper is `flex: 1 1 auto` (closed) or fixed pixel width (open), inside a flex-row container. Could `align-items: stretch` default behavior be giving EditorPane a slightly different bounding box than the old DocPipeline-direct mount? Verify by reading EditorPane's offsetParent and getBoundingClientRect with and without SplitWithCode in the tree. If different, my wrapper or SplitWithCode container needs explicit alignment.

3. **(Worth checking but lower probability)** The CodePaneSplit context might be firing `compressed: true` or `active: true` in the closed state momentarily during mount. Even though `splitState.compressed = open && compressed`, if there's a render where `open` flickers, EditorPane's gutters could blip. But this should be transient, not persistent at scroll=0.

4. **(Background possibility)** Something about my `useLayoutEffect` ResizeObserver ordering is causing a layout cycle that resolves to a non-canonical state. Less likely since `editorNaturalWidth` doesn't directly affect EditorPane's vertical layout, but worth ruling out.

5. **(Pre-existing, not session-introduced)** The user's "small possibility it's a different change" — could be a regression from an earlier commit involving the reading-frame mask or pod cap geometry. `git log --oneline -- src/components/EditorPane.tsx` will show recent edits in this area; cross-reference against the recent grab-handle work in [GRAB-HANDLE-VISIBILITY-FOLLOWUP.md](GRAB-HANDLE-VISIBILITY-FOLLOWUP.md) (session 10) — that work added a sibling div for the portal mount inside `[data-editor-col="true"]`, which could subtly shift heights.

### Concrete first steps for next session

1. **Diff the column-child layout before and after this session's refactor.** Check out the commit before `8b9659c` (`35824df`), eval the same column-children query against the dev doc, and compare. Any new child, any height change, any offsetTop drift identifies the source.

2. **Inspect what's actually at pixel y=56–96 in the user's viewport at scroll=0.** Use `document.elementFromPoint(x, y)` along the viewport vertical centerline through the gap, every 4 px. Report the element chain. If it's `editor-pane-pod` the whole way, the gap is internal padding (then check why the reading-frame mask isn't covering it). If it's something else, that element is the culprit.

3. **Compare with the user's own doc, not just the dev doc.** They saw the gap on "Varieties of Representation." Open that doc, repeat the query, see if the offsets differ from the dev doc in a meaningful way.

4. **Read the reading-frame mask CSS in detail.** [EditorPane.tsx](../../src/components/EditorPane.tsx) ~line 3585. It's sticky at `top: menuBar ? 32 : 8`, height: 40. The comment says it's a "letterbox" to hide content scrolling behind. Confirm its top + height exactly covers the pod's `padding-top` region. If there's a sizing mismatch, that's the bug — and the fix is in the mask, not in my split-pane code.

### Tests pre-followup

- `npm test src/lib/__tests__/code-bridge-roundtrip.test.ts` — 7/7 green.
- `npm test src/lib/__tests__/` — 139/139 green (no regressions in existing lib tests).
- `npm run typecheck` — clean modulo the pre-existing unrelated `card-creation.ts` error.
- `npm run lint` on touched files — clean modulo pre-existing `any` warnings in untouched code.

## 6. What I would have done with another 30 minutes

- Run hypothesis 1 (the reading-frame mask geometry check) — it's the cheapest test and most likely cause.
- Verify hypothesis 2 by quickly stashing the refactor, observing the dev doc layout, and unstashing. Should take 5 minutes if no merge conflict.
- If neither pans out, ask the user to record a screen capture so I can see exactly when/how the gap appears (initial mount? after specific interaction? after CodeEditor toggle?).

## 7. Files that may have followups

- `split-with-code.tsx` — if hypothesis 2 is right, needs an explicit alignment policy.
- `EditorPane.tsx` — if hypothesis 1 is right, the reading-frame mask or pod-cap heights need a tweak. Probably a 1-line change.
- `CodePaneSplitContext.tsx` — unlikely to need changes but worth re-reading to confirm `splitState` is stable when `open=false`.

## 8. Cross-references

- Plan file: [`/Users/gabriel/.claude/plans/sounds-good-plan-it-swift-piglet.md`](../../../../.claude/plans/sounds-good-plan-it-swift-piglet.md) — full multi-phase plan with verification steps.
- Adjacent recent work: [GRAB-HANDLE-VISIBILITY-FOLLOWUP.md](GRAB-HANDLE-VISIBILITY-FOLLOWUP.md) (session 10) — touched the editor-pane-column structure, may interact with the gap hypothesis.
- AGENTS.md keystroke-sanctity note: the bridge's `editor.on('transaction')` and `editor.on('selectionUpdate')` listeners are within the rules (they fire on user action, debounce expensive work).
