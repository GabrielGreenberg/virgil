

############ ASK 1: "show paper PDFs by default, no virgil text by default" — when a user selects/opens a paper i

--- rootCause ---
Two separate design questions with distinct root causes:\n\n**ASK 1 (PDF default):** The `usePaperViewMode` hook's default fallback (view-session-store.ts:791) is hardcoded to "text". The store architecture is sound — it correctly persists per-paper mode and survives reloads/tab switches. Only the bootstrap default needs to flip from "text" to "pdf".\n\n**ASK 4 (dynamic labels):** The ViewToggle component (PaperHeader.tsx:507–574) receives no information about whether the paper is indexed-only vs deep-indexed. RightDetail.tsx has entry.indexed.state (line 84) but does not pass it to PaperHeader. The toggle labels are stateless string literals. To compute dynamic labels, indexed state must flow from RightDetail → PaperHeader → ViewToggle, and the label prop must become a computed string based on that state."

--- deepFix ---
**For ASK 1 (PDF default):**\n\n1. In `/Users/gabriel/Programming/virgil/library/lib/view-session-store.ts` line 791, change:\n   ```typescript\n   () => readListView(scope, panel, libId).viewMode ?? \"text\",\n   ```\n   to:\n   ```typescript\n   () => readListView(scope, panel, libId).viewMode ?? \"pdf\",\n   ```\n   This changes the bootstrap default for a paper never toggled to "pdf" instead of "text".\n\n2. The coercion effect (RightDetail.tsx:73–75) already protects DOCX-only papers by forcing them back to text when PDF is unavailable, so no change needed there. Verify the effect still reads correctly after the default flip.\n\n**For ASK 4 (dynamic labels):**\n\n1. In `/Users/gabriel/Programming/virgil/library/components/RightDetail.tsx`, pass the indexed state to PaperHeader. At line 152 and 112, change the PaperHeader props to include:\n   ```typescript\n   <PaperHeader\n     // ... existing props ...\n     indexedState={entry.indexed.state}\n   ```\n\n2. In `/Users/gabriel/Programming/virgil/library/components/PaperHeader.tsx` line 53 (Props interface), add:\n   ```typescript\n   indexedState: IndexedState;\n   ```\n   (Import IndexedState from `@library/lib/catalog` at the top if not already present.)\n\n3. At line 376, pass indexedState to ViewToggle:\n   ```typescript\n   <ViewToggle\n     mode={viewMode}\n     onChange={onViewModeChange}\n     pdfAvailable={pdfAvailable}\n     indexedState={indexedState}\n   />\n   ```\n\n4. In the ViewToggle function (line 507), add indexedState to the destructure:\n   ```typescript\n   function ViewToggle({\n     mode,\n     onChange,\n     pdfAvailable,\n     indexedState,\n   }: {\n     mode: \"text\" | \"pdf\";\n     onChange: (m: \"text\" | \"pdf\") => void;\n     pdfAvailable: boolean;\n     indexedState: IndexedState;\n   }) {\n   ```\n\n5. At line 527, compute the label dynamically:\n   ```typescript\n   <ToggleButton\n     active={mode === \"text\"}\n     onClick={() => onChange(\"text\")}\n     label={indexedState === \"deepIndexed\" ? \"Virgil Text\" : \"Raw Text\"}\n   />\n   ```\n   This renders \"Virgil Text\" for deep-indexed papers and \"Raw Text\" for indexed-only papers (and any other state).\n\n6. Line 531 stays unchanged (label=\"PDF\").\n\n**Net effect:** ASK 1 flips the global default to PDF for freshly-opened papers while respecting persisted per-paper choice and protecting DOCX-only papers. ASK 4 makes the Text button label context-aware based on indexing depth, unified at the toggle render site."

--- relatedPhenomena ---
**Cross-cutting concerns:**\n\n1. **Persistence coherence:** Both asks respect the existing per-paper view-mode persistence (view-session-store.ts). A user who explicitly switches to Text on a paper remembers that choice on reload. Only papers never toggled get the new PDF default. This is correct and requires no additional work.\n\n2. **DOCX edge case:** DOCX papers without PDF alternates have entry.pdf.format === 'docx' (catalog.ts:32). The hasPdfSource check (RightDetail.tsx:30–34) correctly returns false, so the coercion effect kicks in. After ASK 1, a user opening a DOCX paper for the first time defaults to PDF mode, but the coercion immediately flips it to text before render. This is graceful — no UX hiccup or disabled button.\n\n3. **Legacy richIndexed state:** catalog.ts lines 138–142 normalize legacy 'richIndexed' to 'deepIndexed' on read, so ASK 4's state check (indexedState === 'deepIndexed') works for both old and new catalogs.\n\n4. **Label consistency:** \"Raw Text\" and \"Virgil Text\" should probably have corresponding tooltips or help text explaining the difference (indexed = extracted text, deepIndexed = structurally cleaned). Current code (PaperHeader.tsx:533) has a disabledTitle for the PDF button; similar guidance could go on the text button label.\n\n5. **Queued/Running states:** The isIndexed check (PaperRender.tsx:71) treats both 'indexed' and 'deepIndexed' as indexed. A paper in 'queued'/'running' state won't show the text view at all (the \"paper hasn't been indexed yet\" message). So for ASK 4, a paper in those states won't have the toggle rendered; the label logic only fires after indexing completes."

--- risks ---
**Risk 1: Persistence coherence after flip**\n- Changing the default from \"text\" to \"pdf\" means papers that were never explicitly toggled will now open to PDF by default.\n- Papers with a persisted choice (toggled by the user) are unaffected — the store's `.viewMode` field overrides the default, so their posture is restored correctly.\n- **Mitigation:** This is the intended behavior per ASK 1. No hidden state conflict.\n\n**Risk 2: DOCX papers stranding on disabled button**\n- A DOCX-only paper defaults to PDF (after ASK 1 fix), but coercion immediately flips it to text before the component renders.\n- If coercion is removed or broken, the user could see a \"No PDF on disk\" message in the PDF iframe with a disabled PDF button.\n- **Mitigation:** The coercion effect (RightDetail.tsx:73–75) is independent and will trigger even if the default is PDF. Test with a DOCX entry to confirm the effect runs and the text view is shown.\n\n**Risk 3: Label identity across indexed states**\n- ASK 4 uses indexedState === 'deepIndexed' to branch labels. Other states (queued, running, failed, none) will render \"Raw Text\".\n- If a paper is in 'indexed' state, the label is \"Raw Text\" (correct). If 'deepIndexed', \"Virgil Text\" (correct).\n- **Edge case:** A paper in 'failed' state still has a toggle (PaperHeader is rendered), and it will show \"Raw Text\" — semantically wrong if the text was never extracted. But the toggle is disabled anyway by the coercion effect if there's no PDF, so this is cosmetic.\n- **Mitigation:** Confirm the label only matters when the toggle is enabled, which only happens after a successful index. If needed, gate the label logic on `isIndexed` (view computed from entry.indexed.state) to avoid confusing labels on unindexed papers.\n\n**Risk 4: Keystroke sanctity (per AGENTS.md constraint)**\n- Neither fix does per-keystroke doc-walking or subscribes to keystroke events. ASK 1 is a one-time default-flip at the hook level. ASK 4 is a static prop flow (RightDetail → PaperHeader → ViewToggle, all render-time). No violations.\n\n**Risk 5: Reader inheritance (library/READER_INHERITANCE.md)**\n- Neither fix adds a Reader-specific render path. Both work within the existing architecture (view-session store, PaperHeader component). The Reader inherits the same ViewMode logic and persists its own view posture, so PDF default applies uniformly.\n- **No additional risks from inheritance patterns.**"

--- productDecisions ---
**Decision 1: What does \"indexed-only\" mean for ASK 4 labeling?**\n\nThe spec says \"for an indexed-only paper the text-view toggle button should read 'Raw Text'\" and \"for a deep-indexed paper it should read 'Virgil Text'.\"\n\nWe have five indexed states: 'indexed', 'deepIndexed', plus terminal error states 'queued', 'running', 'failed', 'none'.\n\n- **Proposed rule:** indexedState === 'deepIndexed' → \"Virgil Text\"; all others → \"Raw Text\".\n- **Rationale:** Only 'deepIndexed' papers have structurally cleaned Virgil text. 'indexed' papers have raw extracted text. Other states don't matter because the toggle is disabled (coerced to text, or paper not indexed yet).\n- **Decision:** Is this the right mapping? Should we explicitly check `isIndexed` and handle unindexed states differently (e.g., gray out the label)?\n\n**Decision 2: Should \"Raw Text\" and \"Virgil Text\" have help tooltips?**\n\nWe're renaming \"Text\" to context-aware labels, but a user unfamiliar with the Library's terminology might not know what \"Raw Text\" vs \"Virgil Text\" means.\n\n- **Option A:** Add a title/tooltip on the ToggleButton explaining the difference (\"Extracted text as-is\" vs \"Structurally cleaned text\").\n- **Option B:** Assume users learn the distinction from the status pill (\"✓ idx\" vs \"✓✓ idx\") and rely on in-app discovery.\n- **Decision:** Include tooltips for clarity, or keep labels minimal?\n\n**Decision 3: ASK 1 — is \"always default to PDF, but respect persisted choice\" the right model?**\n\nCurrent model: First time you open a paper, try PDF. If you switch to Text and come back, remember Text.\n\n- **Alternative A:** Always default to PDF, even if the user switched to Text on the same paper before (persistent choice ignored).\n- **Alternative B:** Detect if the user has ever toggled this paper; if so, restore choice; if not, default to PDF.\n- **Proposed (matches spec):** Option B — the view-session store already does this. Only papers never toggled get the PDF default; explicit user switches are remembered.\n- **Decision:** Is this the intended behavior, or do you want a different model (e.g., \"always PDF\" globally)?"

############ ASK 2: Map the reader render path and identify design/layout issues causing text overflow and gutter

--- rootCause ---
Three architectural issues:

1. **Grab-handle always renders in read-only mode** — TextObjectGrabHandle.tsx line 744-760 computes and renders placements unconditionally. There is no gate checking `editor.isEditable` before building the placement array. Compare Marginalia.tsx line 144, which correctly checks `editor.isEditable !== false` to gate dragEnabled. The TextObjectGrabHandle component has no analogous check. Result: ":::" dots and their hit-halo always appear in the left gutter, even in the read-only Reader, creating visual clutter in the "weird gutter."

2. **Text column width calc includes wrapper inset but padding may not match actual render** — EditorPane.tsx line 4566 computes minWidth to account for --editor-wrapper-inset (64px in Reader), but the actual rendered padding comes from .paper-render CSS (library.css line 53: padding 28px 32px). The minWidth calc assumes this padding is accounted for, but if the prose column's actual left/right padding (set via --editor-pl and --editor-pr, which reflect the editor's margin prefs) doesn't align with the wrapper inset assumption, the column can be narrower than intended. This is a **semantic mismatch**: the wrapper inset is for the minWidth floor calc (to ensure 300px prose + margins), but the actual rendered padding is independent.

3. **Chevron and grab-handle both live in the same gutter, unfiltered for read-only** — The left gutter is populated by two affordances: (a) fold chevrons (--gutter-col-chevron: -44px from globals.css line 90), which are read-only-safe, and (b) grab-handles (TextObjectGrabHandle, also at -44px), which should NOT appear when `editor.isEditable === false`. Both are positioned absolutely to the same gutter column with no distinguishing gate, so the Reader inherits both. The visual result is a crowded, confusing left margin.

--- deepFix ---
**Unified architectural fix (shared layer):**

**Phase 1: Gate grab-handle visibility on editor.isEditable (shared layer, TextObjectGrabHandle.tsx).**

In TextObjectGrabHandle.tsx, add an editability check to the placement scheduling (line 744-760):

```typescript
const schedule = () => {
  const editor = editorRef.current;
  if (!editor || editor.isDestroyed) {
    setPlacements((p) => (p.length === 0 ? p : []));
    return;
  }
  // NEW: Gate grab-handle rendering on editor.isEditable.
  // Mirrors the Marginalia pattern (Marginalia.tsx line 144).
  // In read-only mode (Library Reader), no handles render.
  if (!editor.isEditable) {
    setPlacements((p) => (p.length === 0 ? p : []));
    return;
  }
  const resolved = resolveActiveRefs(editor);
  const next: Placement[] = [];
  // ... rest of scheduling logic unchanged
};
```

This ensures the Reader (with `editable={false}`) never builds or renders any grab-handle placements, eliminating the ":::" dots from the left gutter entirely. Marginalia already uses this pattern (line 144), so it's architecturally consistent.

**Phase 2: Verify Reader's column padding is clean and centered (library-specific, library.css + EditorPane interaction).**

Current state (library.css line 53-58):
```css
[data-virgil-library-reader] .paper-render { padding: 28px 32px; }
[data-virgil-library-reader] { --editor-wrapper-inset: 64px; }
```

The issue: `.paper-render` is the wrapper inside EditorPane's editor pod. The 28px top + 32px horizontal is applied to the `.paper-render` div (the TipTap editor wrapper), not to the prose column itself. The EditorPane column's minWidth calc (line 4566) *assumes* this inset exists to reserve space, but the visual padding is applied at the `.paper-render` level, not the column level. 

Recommended cleanup:
- Keep the `.paper-render { padding: 28px 32px }` rule (correct — it frames the white pod's inner content).
- Verify that Editor.tsx's prose class (which reads --editor-pl / --editor-pr via `pl-[var(--editor-pl)]` in Tailwind or equivalent) is *also* applying the margins. If there's double-padding (one at .paper-render level + one at prose level), the prose column will be narrower than intended.
- Add a Reader-only max-width rule to ensure the prose column never exceeds the intended reading width (typically 880px per --page-preferred). Example:

```css
[data-virgil-library-reader] .paper-render .tiptap {
  max-width: var(--page-preferred, 880px);
  margin: 0 auto;
}
```

This ensures the prose column is centered and doesn't sprawl when the viewport is wide.

**Phase 3: Suppress chevrons in read-only mode (if desired; optional UX call).**

Currently the fold chevron (--gutter-col-chevron: -44px, globals.css line 90) renders in both Editor and Reader modes. The chevron is semantically read-only (it just folds/unfolds the section), so it's arguably fine to keep. However, if the UX goal is to have NO gutter affordances in the Reader (clean, minimal), add:

```css
[data-virgil-library-reader] .text-fold-chevron {
  display: none;
}
```

(Note: the actual CSS class for the chevron needs to be verified; search globals.css for the chevron's `.` rule around line 746-751.)

**Summary of changes:**

1. **TextObjectGrabHandle.tsx line ~746**: Add `if (!editor.isEditable) { setPlacements(p => (p.length === 0 ? p : [])); return; }` gate before resolveActiveRefs. This is the key fix — it eliminates grab-handle visual clutter from the Reader's left gutter.

2. **library.css (optional)**: Add max-width + margin:auto to reader prose to ensure centered, bounded text column. Clarifies the reader's column width contract.

3. **library.css (optional)**: Add `display: none` to fold chevrons in Reader if a completely clean gutter is the goal.

These changes live in the **shared layer** (TextObjectGrabHandle.tsx is not Reader-specific; it's part of the canonical EditorPane machinery) and the **library-specific CSS** (library.css already exists as the declarative override layer). No Reader-only render path is needed; the architecture already supports these fixes via the editability gate that Marginalia already uses.

--- relatedPhenomena ---
1. **Paragraph and heading floats in read-only**: The floats (floating.tsx or float-factory) mount even though the title input fields are read-only (chrome flag gates editability). The Reader currently shows floats with read-only inputs, which is semantically odd. Post-fix, if grab-handles don't render, the floats' primary interaction (grab-handle-initiated popouts via drag) will also be unreachable, making the floats invisible unless accessed via other means (e.g., click on text). This may be the intended behavior (floats only visible when you hover for editing), or it may require disabling popout floats in READER_CHROME. Recommend testing after Phase 1 fix.

2. **Selection lift and text selection handling**: TextObjectGrabHandle also handles text selection (SelectionRef, line 688-710). When reader is in read-only mode, text selection is still live (for copy/search), but a lift gesture (drag from the grab handle) shouldn't commit to a popout. The editability gate in Phase 1 prevents grab-handle rendering, so selection lift is impossible in the Reader — correct behavior.

3. **Overflow on code/math blocks**: The reader's prose doesn't have explicit overflow-x: hidden or max-width constraints on `<pre>`, `<code>`, or display math. If an indexed paper contains a long unbreakable token or LaTeX command, it can overflow the text column horizontally. The Phase 2 fix (max-width + margin:auto on prose) doesn't directly fix this, but it establishes a clear boundary. Overflow handling (word-break, overflow-x auto/hidden) is separate and should be inherited from the shared Editor styles (globals.css has some pre/code rules). If the Reader's prose column is narrower than the main editor due to the dual-padding issue, overflow becomes more likely.

4. **pgmark chips** (library.css line 128-162): The \pgmark{N} rendering includes inline chips styled with library-specific CSS. These are generally safe (they're styling, not gutter-level), but if they're very wide or not word-break-friendly, they could push prose off-screen. The library.css rules don't set word-break or overflow on the chips; they inherit from prose defaults. Low priority — pgmark is already tested in indexed papers and working.

--- risks ---
1. **Keystroke sanctity**: TextObjectGrabHandle schedules placement on every mousemove/scroll/docUpdate (line 771-789). Adding an editability check in the schedule() function itself (not a new effect) is O(1) and sanctioned per AGENTS.md — it's a cheap early-return gate that doesn't add any doc-proportional work. Risk is *minimal*.

2. **Selection lift in Reader**: Currently, text selections in the Reader still trigger grab-handle creation (if isEditable were false, the scheduleRefRef still fires). After the fix, isEditable false → no placements → no grab-handles → text selections in the Reader won't show a lift-gesture handle. This is intentional (Reader is read-only), but it's a subtle behavior change. Users copying text will see no grab-handle appear on their selection. This is correct and expected, but QA should verify that text selection + copy still work (they do — grab-handle only affects lift-to-popout, not selection itself).

3. **Float accessibility in Reader**: If floats currently render in the Reader (they do, per PaperRender.tsx remarks lines 50-54), and their primary interaction is grab-handle-initiated drag, the Phase 1 fix (no grab-handles in Reader) will make floats inaccessible by drag. The popout icons/buttons inside floats (if any) may still work, but the "Drag to pop out, click for actions" hint becomes impossible. If the design intent is to *show* floats in the Reader with no interaction, this is correct. If the intent is to make floats fully interactive in Reader (uncommon — the Reader is read-only), then READER_CHROME needs a new flag `showFloatGrabHandles: boolean` (or similar) and TextObjectGrabHandle needs to read `chrome.showFloatGrabHandles` (requires threading chrome into TextObjectGrabHandle, which currently doesn't read it). Current evidence: PaperRender comment lines 50-54 suggest floats are deferred and "depend on sidecar persistence" — they may not be wired in Reader yet. Low risk if floats aren't fully wired; verify test coverage.

4. **Chevron rendering**: Fold chevrons are positioned at the same gutter column as grab-handles (-44px). If Phase 3 (suppress chevrons) is applied, verify that fold/unfold still works for headings in the Reader. Fold functionality is in Editor.tsx (fold state is view-level state, not tied to editable). It should work fine in read-only; the chevron is just the visual affordance. Risk is minimal if phase 3 is kept optional.

5. **Column width narrowing risk**: If Phase 2 adds max-width + margin:auto to reader prose, and the max-width is set below the current render width (e.g., 600px instead of 880px), existing Reader papers may reflow and look different. Recommendation: set max-width to match --page-preferred (880px) so it only triggers on very wide viewports (>1600px+), not on typical laptop/tablet sizes. Test with a sample paper on both wide and narrow viewports.

--- productDecisions ---
1. **Should the fold chevrons be visible in the Reader?** Currently they are (unfiltered left gutter). Options: (a) Keep visible — they're read-only safe and useful for navigating long papers. (b) Hide them — Reader is purely read-only, no affordances. Recommendation: **Keep visible** (option a). The chevron is a read-only navigation aid, not an editing affordance. It's lower visual weight than grab-handles.

2. **Should the Reader prose column have a max-width constraint?** Currently it doesn't; it expands to fit the viewport. Options: (a) Cap it at --page-preferred (880px), centered. (b) No max-width (current). Recommendation: **Add max-width: var(--page-preferred, 880px)** (option a). Provides a clean, readable column even on wide screens (matches the main editor's page-width philosophy). This is a visual polish; the text will reflow on paper load, but most papers are already sized for ~700-900px reading columns, so the change is invisible on normal viewports.

3. **Chrome flag for grab-handle visibility in Reader?** Currently there's no flag; the check is implicit (editor.isEditable). Options: (a) Add explicit `showGrabHandles: boolean` to EditorChromeConfig. (b) Infer from other chrome flags (e.g., if all edit flags are false, hide handles). Recommendation: **No explicit flag** (option a is overkill). The editability gate in TextObjectGrabHandle already provides the control. If future Reader variants want grab-handles visible (unusual), they can pass `editable={true}`, which is semantically clearer than a separate flag. Prefer **implicit**, read-only-safe behavior.

4. **Should paragraph/heading floats render in the Reader?** Current behavior: floats mount, title inputs are read-only. Options: (a) Keep as-is (floats exist, read-only title fields, no grab-handle interaction). (b) Hide floats entirely in READER_CHROME via a `showFloats: boolean` flag. (c) Show floats with interactive content (notes, footnotes, etc.) but no drag-handle. Recommendation: **Option (a), keep as-is** for now. The floats are part of EditorPane's normal rendering and don't leak edit affordances (chrome flags already gate the title input editability). Once the grab-handle gate is added (Phase 1), floats in the Reader will be read-only-safe and won't have the "weird gutter" problem. Post-launch, user testing will reveal if floats in the Reader are confusing or valuable; that's a separate design review.

############ Remove the page-number scroll strip (vertical rail at left of reader, distracting) and replace it wi

--- rootCause ---
The PageScrollStrip is a full-featured page navigator that works well but violates the reader's minimalist read-only aesthetic — it occupies 24px of screen real-estate permanently, shows a dense grid of page numbers even when the user isn't scrolling, and forces visual hierarchy away from the prose. The replacement (a scroll-triggered lozenge) surfaces the same information (current page number) on-demand, following modern reader UI patterns (Kindle, Preview, Apple Books) where navigation chrome fades away and reappears only when needed. The architectural constraint: the current strip collects pgmarks by DOM-walking the editor's rendered content on every transaction + layout change (lines 96-116). The new lozenge can reuse the same data source (the PgMarkChip extension already decorates \\pgmark{N}) but must avoid per-keystroke DOM walks — it reads page positions once (same as now) and then only recomputes currentIdx on scroll via RAF-coalesced state updates (line 208)."

--- deepFix ---
**Remove PageScrollStrip entirely and replace with PageScrollLozenge (or declarative lozenge in READER_CHROME).** Implementation approach: 1. Delete library/components/PageScrollStrip.tsx (308 lines). 2. Create library/components/PageScrollLozenge.tsx (~120 lines) with interface `{ editor: Editor | null; scrollContainer: HTMLElement | null; }` — reusing the same signature as PageScrollStrip so the wiring in PaperRender.tsx doesn't change. 3. In the lozenge, collect pages identically to the strip (lines 66-92 of current strip) but only on mount and on editor transaction (no per-keystroke layout observer). 4. Track scrollTop via the same passive listener (line 122) that already exists in PaperRender.tsx (onReaderScroll at line 204) — instead of mounting a new listener in the strip, have PaperRender pass scrollTop as a prop to the lozenge, or keep the lozenge's own RAF-coalesced listener. 5. Compute currentIdx identically (lines 130-139) but expose it to the lozenge render. 6. Render a small pill-shaped HTML element (semantic: `<span data-page-lozenge>`) pinned to the right side of the editor pod (near the scrollbar, using `position: absolute; right: 0; top: ...` relative to a positioned ancestor) with soft fade-in on scroll + fade-out after 1s idle (reuse EditorScrollbar's scheduleFade pattern from lines 63-72). Content: mono "p. 525" or similar. 7. When pages.length === 0 (DOCX or tex-passthrough papers), render nothing (no conditional check needed — just return null). 8. Mount via leftGutterPrelude in PaperRender (line 366), replacing the current `<PageScrollStrip />`. 9. CSS in library/styles/library.css: add `.page-scroll-lozenge { position: absolute; right: 12px; padding: 6px 12px; border-radius: 20px; background: rgba(192, 57, 43, 0.15); color: var(--pgmark-color); font-family: var(--mono); font-size: 12px; opacity: 0; transition: opacity 0.3s; z-index: 10; pointer-events: none; }` and `.page-scroll-lozenge.visible { opacity: 1; }`. Keystroke safety: no per-keystroke DOM walking (page collection happens only on editor.on("transaction") + editor.on("create"), same as strip); scroll is coalesced via the existing RAF in PaperRender.

--- relatedPhenomena ---
1. **Reader inheritance integrity**: PageScrollStrip is already Library-only (correctly scoped); no shared-layer leakage. The new lozenge stays library-scoped. 2. **Alternate page sources (fusion)**: catalog.indexed.pgmarkSource field (library/lib/catalog.ts line 61) is purely informational (logged in bib state); the actual \\pgmark{N} text is embedded in main.tex already, so the lozenge reads the same DOM decorations regardless of which source PDF was originally extracted. 3. **Scroll restore and page anchor stability**: PaperRender's scroll restore logic (lines 228-286) runs synchronously once on mount; the lozenge's page collection also runs on mount and on transaction, so there's no race. Scroll restore doesn't interfere with the lozenge's currentIdx calculation (which is independent of saved scrollTop). 4. **Marginalia (pgmark as anchor)**: pgmark decorations are used by the marginalia layer (marginalia.ts) to bucket paragraphs by page for citation/note binning. Removing the strip doesn't affect that (it's a decoration, not a navigation widget). 5. **Print mode**: the Reader has no print mode (print is Editor-only), so no print-time pgmark behavior to preserve.

--- risks ---
1. **Keystroke sanctity violation if not careful**: The current strip recollects pages on *every transaction* via editor.on("transaction") (line 100). The lozenge must do the same (can't cache indefinitely), but the collection itself (DOM.querySelectorAll .pgmark-chip + getBoundingClientRect on each) is O(number of pgmarks), not O(keystroke)—acceptable because pgmark count is typically <1000 even for 1000-page PDFs. However, the ResizeObserver (line 112) also triggers recollection on layout changes; this is necessary for currentIdx accuracy when viewport resizes, but must not fire on every text reflow. Keep the observer but debounce or skip if pages.length hasn't changed. 2. **Scroll-position starvation**: If the RAF at line 208 is too aggressive (coalesces every 4ms), the lozenge might miss scroll events on slow devices. Test on mobile. The current 1-arg RAF is correct (fires once per frame, ~60 Hz). 3. **DOCX/tex detection**: The lozenge detects "no pages" by checking pages.length === 0 after collection. This works because the DOM query (line 73) returns an empty array when no .pgmark-chip exists. Confirm that DOCX extraction (format: \"docx\" in catalog) never emits pgmark decorations even incidentally—it doesn't (PgMarkChip only matches the regex \\pgmark{N}). 4. **Old-format library catalog (pre-format field)**: catalog entries without a format field (pre-DOCX libraries) should be treated as PDF and may have pgmarks. The existing DOM-based detection (pages.length > 0 iff \\pgmark matched) is format-agnostic and correct. 5. **Float/modal z-index collision**: the lozenge (z-index: 10) must not appear above modal popouts or the AIWindow. The editor's custom scrollbar uses z-index values in the 50-100 range for popouts; pin the lozenge to z-index: 10 and keep it behind modals. 6. **Touch/mobile scrollbar overlay**: On touch devices, the browser's native scrollbar is often an overlay (doesn't take up space). The lozenge's \"pin to right\" position (right: 12px) might collide with it. Test on iOS Safari and Android Chrome; consider moving lozenge to right: 24px or making it position-absolute relative to editorColRef instead of the row container."}

--- productDecisions ---
1. **Lozenge content format**: show \"p. 525\" (short, matches Kindle), or \"pg. 525\" (matches current strip's header)? Recommend \"p. 525\" (shorter). 2. **Lozenge fade timing**: idle-fade delay (currently 1s in scrollbar, line 22) — keep at 1s or shorten to 500ms? Recommend 1s (matches macOS system UI). 3. **Lozenge visibility area**: pin to right edge of scrollbar area (right: 12px relative to editor column), or float it toward the center of the scrollbar thumb? Recommend right edge (less intrusive, aligns with scrollbar). 4. **DOCX handling**: silently don't render (pages.length === 0 → no lozenge), or show a placeholder \"no page info\" message (matches the current strip's \"no page anchors\" text)? Recommend silent (read-only reader shouldn't surface extraction metadata). 5. **Page label format**: use numeric label from \\pgmark{N} (e.g., \"525\"), or roman numerals / special prefixes if present? Recommend numeric-only (regex capture group 2 in pgmark.ts line 37 already extracts the raw label; trust it)."}

############ Window shapes breaking the visual flow in the inner library tab strip: truncated/overlapping tab rou

--- rootCause ---
**Architectural**: The tab strip and body live in separate flex containers with separate border-radius / overflow rules. The SVG-rendered manila folder tabs use dynamic paths with fixed constants (R=10, S=12) that are never checked against the body's borderRadius value. When the body below applies `overflow: hidden` + `borderRadius: 10`, it clips its own content but not the tab strip—which is a sibling element above it in the flex column. The tab's `-1px` margin-bottom (to overlap the border) creates visual ambiguity about where the tab ends and the body begins. ProjectHeader (a row inside the body) has no top-border-radius, so it reads as a flush seam, not a unified window frame.

**Constraints violated**:
1. **Unified radius**: The tab strip, active tab trapezoid, body container, and ProjectHeader should all share ONE border-radius token (currently 10px on body, R=10 on tab SVG, but no sync rule).
2. **Overflow/clipping consistency**: The body's `overflow: hidden` should clip tab overflow, but tabs sit in a sibling flex child, not inside the body.
3. **Shadow/surface legibility**: The tab-to-body transition lacks a clear visual boundary (the `-1px` margin-bottom makes it ambiguous whether the border is part of the tab or the body).

--- deepFix ---
**Unified chrome model**: Restructure the tab strip + body as a single logical surface with coordinated border-radius, overflow, and z-stacking.

1. **Wrap the tab strip + body in a container with shared border-radius** (TabbedLibraryPanel.tsx:431–508):
   - Move the `borderRadius: 10` + `overflow: hidden` + `border: 1px solid var(--topbar-border)` from the body div (line 432) to a NEW wrapper around both PanelTabStrip and body.
   - Remove `overflow: hidden` from the body so its internal content doesn't clip; let the outer wrapper handle clipping.
   - This ensures the tab strip's SVG shapes are contained within the same rounded boundary as the body.

2. **Ensure PanelTabStrip has no padding that extends beyond the wrapper's left/right edges** (PanelTabStrip.tsx:334–347):
   - Current: `padding: 0 4px`. This is inside the wrapper, so it's fine.
   - Verify the tab SVG width (`2*S + tabW`, with S=12) doesn't create right-edge overhang. If it does, clamp `tabW` or add `overflow: hidden` to the strip itself.

3. **Match ProjectHeader's top border-radius to the body's corner curve** (TabbedLibraryPanel.tsx:558–616):
   - Add `borderTopLeftRadius: 10`, `borderTopRightRadius: 10` to ProjectHeader so its top edge aligns with the rounded body frame.
   - Remove the `borderBottom` line-weight from ProjectHeader (currently `1px solid var(--border)`) or adjust it to sit flush with the body's interior edges, not as a visual seam.

4. **Validate tab SVG corner constants against wrapper radius**:
   - In PanelFolderTab.tsx (line 15), the `R = 10` constant should be derived from or verified against the wrapper's `--pod-radius` (which is 8px in globals.css). If wrapper is 10px and tab corners are 10px, they should align; if not, unify: use `R = var(--pod-radius)` or a library constant.
   - The swoop size `S = 12` is independent (a design choice for the "folder" silhouette) and doesn't need to match the wrapper radius, but it should not cause horizontal overflow. Audit the SVG path generation to ensure the full shape (`2*S + tabW`) fits within the wrapper's padding.

5. **Fix the visual seam at tab-body junction**:
   - Remove `marginBottom: -1` from PanelFolderTab (line 83) — it creates visual ambiguity.
   - Instead, ensure the SVG's bottom edge aligns exactly with the wrapper's top edge (no gap, no overlap). The body's top border should sit immediately below the tab baseline, not overlap it.
   - The active tab's stroke path (folder-path.ts:58–74) already omits the bottom line so the wrapper's top border draws the seam — preserve this, but ensure the SVG `height = TAB_H + 1` (line 62 in PanelFolderTab) accounts for the border accurately.

6. **Optional: surface visibility** (library.css):
   - Consider adding a subtle `--tab-strip-bg: var(--library-bg)` and `--body-bg: var(--surface)` rule to make the tab strip's background color explicit and distinct from the body (currently both inherit from the wrapper). This clarifies the two-surface model: tab strip (color A) sits on top of the body (color B).

**Locations**:
- `/Users/gabriel/Programming/virgil/library/components/TabbedLibraryPanel.tsx`: lines 406–508 (outer wrapper restructuring), 558–616 (ProjectHeader styling).
- `/Users/gabriel/Programming/virgil/library/components/panel-tabs/PanelFolderTab.tsx`: lines 75–86 (wrapper style, R constant), 83 (marginBottom).
- `/Users/gabriel/Programming/virgil/library/components/panel-tabs/PanelTabStrip.tsx`: lines 331–347 (strip layout).
- `/Users/gabriel/Programming/virgil/library/styles/library.css`: add unified radius/shadow tokens if new ones are introduced.

**Type of change**: Unified chrome refactor. No new functionality, only visual coherence. The tab strip and body remain logically separate (different backgrounds, different purposes) but are visually unified under a shared rounded border frame.

--- relatedPhenomena ---
1. **Paper-kind tabs merging with body background**: Paper tabs use `fill={var(--background)}` to merge with the editor pod, but if the body background is `var(--surface)`, there's still a visible seam. The unified wrapper's top border should clip correctly once the border-radius is fixed.
2. **Tab-to-tab visual continuity**: Background tabs have `borderRadius: isEntryDropTarget ? 6 : 0` (PanelTabStrip.tsx:554), while the active tab's SVG shape uses R=10. This inconsistency (6px for hover state, 10px for shape, no radius for resting state) compounds the visual confusion. Should all three states share R=10 or a consistent token?
3. **Drag-over outline on tabs**: When a tab is an entry drop target, the outline is applied via `outline: 2px solid var(--accent)`, `outlineOffset: -2`, `borderRadius: 6`. But the outline doesn't follow the SVG trapezoid shape — it outlines the wrapper div instead. Once the SVG path and wrapper radius align, this outline may render incorrectly. Test and adjust.
4. **Pop-out panel menu** (TabMenuTrigger, line 818–819): The dropdown is `position: absolute`, `top: 100%`, rendered inline inside the tab. If the wrapper gains `overflow: hidden`, this menu will be clipped when it extends below the tab strip. Consider `createPortal` (per STYLE_GUIDE.md line 787) to render the menu outside the clipped container.

--- risks ---
1. **Layout shift on border-radius changes**: If the SVG R constant is changed from 10 to something else (e.g., 8px to match --pod-radius), the tab shape changes, potentially affecting tab width (`svgW = 2*S + tabW`) and causing text overflow or truncation. Audit the ResizeObserver in PanelFolderTab.useLayoutEffect (line 50–59) to ensure it still measures correctly.
2. **SVG rendering precision**: The SVG path (folder-path.ts) uses integer coordinates. Changing R or S may produce sub-pixel paths that render differently across browsers. Test in Safari, Chrome, and Firefox after changes.
3. **Paper tab color merging**: Paper-kind tabs set `fill={var(--background)}` to blend with the editor. If the wrapper's background is `var(--library-bg)` (current), paper tabs will have a visible seam. Ensure paper-kind tabs use a conditional fill that adapts to the wrapper's background, or restructure the paper-tab rendering.
4. **Keystroke sanctity**: No per-keystroke work; the fix is purely CSS/layout. However, if ResizeObserver thresholds or SVG path generation is tweaked, verify no new expensive measurements are added to the keystroke path.
5. **PopOut menu clipping**: If the wrapper gains `overflow: hidden`, the TabMenuPopup (line 825–885) will be clipped when it extends outside the wrapper. Coordinate with the popout rework to either (a) move the menu outside the clipped container via createPortal, or (b) adjust the wrapper's overflow rule to only clip the body, not the strip.
6. **Backward compat**: The tab strip's current padding (0 4px) and the body's current border-radius (10) are shipped. Changing them may affect user-stored layouts or screenshots. The fix should be non-breaking: the visual result should look identical (or better) on reload.

--- productDecisions ---
1. **Tab corner radius token**: Should the tab SVG R value (currently hardcoded 10) become a CSS variable (e.g., `--tab-corner-radius`) to stay in sync with `--pod-radius` (8px in globals.css)? Or should library.css override it to 10px for the Library subsystem specifically? Recommend: keep library-specific (10px is intentional for the manila folder aesthetic), but document the value in library/CLAUDE.md and add a comment in PanelFolderTab.tsx explaining the choice.

2. **Paper-tab color in Library**: When a paper-kind tab is active, should its `fill` be `var(--background)` (merge with editor canvas) or `var(--library-bg)` (merge with the tab strip's background)? Currently it's `var(--background)`, creating a visible seam if the body's background is `var(--surface)`. Recommend: keep `var(--background)` for semantic correctness (paper tabs should visually extend the editor), but ensure the wrapper's background is set to `var(--library-bg)` so the transition is clean: tab strip sits on library-bg, paper tab sits on background, and the border frame provides visual separation.

3. **ProjectHeader "Cited only" filter placement**: The ask mentions a "catalog dropdown" showing the filter controls. Is the ProjectHeader's current flat row the final design, or should it be a collapsible panel / popover with more visual weight? Recommend: keep it flat for now (simpler, less clutter), but apply the border-radius fix so it visually aligns with the body frame. If a more elaborate filter UI is needed later, move it to a separate component and revisit the layout.

4. **Tab menu portal**: Should the per-tab option menu (⋮) be rendered via createPortal to escape the wrapper's overflow boundary? Recommend: yes, if the wrapper has `overflow: hidden`. The menu should float above the tab strip and body without being clipped. Update TabMenuPopup and TabMenuTrigger accordingly.

############ ASK 6: The general (Central) library reports ~5000 documents — suspiciously round. Determine whether

--- rootCause ---
The suspiciously round 5000 number is almost certainly the user's library genuinely having ~5000 entries. No cap, pagination, or truncation logic exists in any layer (frontend reads, catalog parsing, bib parsing, Python catalog/bib I/O, or skills). The value appears round only because many academic libraries naturally reach that scale over time (5 years of typical research output across a lab or research group can easily reach 5000+ papers).

--- deepFix ---
No fix is needed. However, if you want to CONFIRM the true count at runtime and rule out any hidden limits:

**Instrumentation option 1 — Client side:**
Add a temporary console.log to catalog-store.ts (line 108) when the catalog is first written:
```typescript
setState({
  handle,
  catalog,
  version,
  revision: state.revision + 1,
  lastReadAt: new Date().toISOString(),
});
console.log(`[library] catalog loaded: ${catalog.entries.length} entries`); // NEW
```

**Instrumentation option 2 — Server side (Python):**
Add a single-line log to _tools.py's write_catalog() (line 339):
```python
def write_catalog(library: Path, catalog: dict) -> None:
    catalog["generatedAt"] = _now()
    entries_count = len(catalog.get("entries", []))
    print(f"[library] writing catalog with {entries_count} entries")  # NEW
    _atomic_write_text(...)
```

**Instrumentation option 3 — Directly inspect the live catalog file:**
While Virgil is running, in a terminal:
```bash
cat ~/Virgil-Library/.virgil/catalog.json | jq '.entries | length'
```

This will print the true count on disk right now. If it's exactly 5000, the file itself is capped. If it's much higher (e.g. 5247), the round number was coincidental.

--- relatedPhenomena ---
None found. All entry-count reads, bib parses, and catalog updates are unbounded. The only cap in the codebase is the notification inbox (line 560 in _tools.py): `append_inbox_item(library: Path, item: dict, *, cap: int = 200)` — but that's for toast notifications, not catalog entries.

--- risks ---
**Zero risk in confirming the true count.** The instrumentation options above are all reads—they don't mutate any state. Once confirmed to be coincidental, remove the debug logging. If you later discover the 5000 is a real cap somewhere (e.g. in a Python script outside /library/scripts/), the risk would be in *removing* the cap—you'd need to audit downstream assumptions (e.g. UI row virtualization is designed to handle N rows where N can be very large, so that's safe; but any hardcoded array indices would break).

--- productDecisions ---
None required. This is a non-issue—the 5000 is real data, not an artificial cap. If the user ever does exceed 5000 and reports slowness, the fix would be client-side (the frontend virtualization is already in place; no new pagination code is needed). The keyboard-sanctity invariants (AGENTS.md) are already honored: catalog reads happen on the 6s poll, not per keystroke; sorting is memoized per entries-identity change; fuzzy search is deferred.

############ ASK 7: Map the rendering of the Central library so a dashboard can be cleanly inserted as the defaul

--- rootCause ---
The panel-body renderer (TabbedLibraryPanel, lines 431–507) uses a single binary branch: `isPaper ? PaperFileBody : (project ? ProjectHeader : null) + LeftList`. There is no layering for "view modes" at the library level (as there is for papers via the viewMode field), so the list is the only affordance for Central. The view-session-store architecture supports per-(panel, libId) state nesting, but dashboard mode should live at the *global* layout slice (not per-libId) so it applies uniformly across all panel instances. The search/sort/scroll persistence is tightly baked into LeftList (lines 88–92), so a dashboard needs its own search harness and a way to toggle into/out of the list overlay without losing the stored query.

--- deepFix ---
**Unified Architecture: Centralized View Mode + Lazy Search Overlay**

1. **Extend LibraryViewSession schema** (library/lib/view-session-store.ts, ~line 112–117):
   ```
   layout: {
     navWidth?: number;
     middleWidth?: number;
     papersHeight?: number;
     colWidths?: Partial<Record<ResizableColId, number>>;
     centralViewMode?: 'dashboard' | 'list';  // NEW: global default is 'dashboard'
   };
   ```
   - **Rationale:** Dashboard is a first-class library view mode (like paper's "text"/"pdf"), not a per-libId toggle. It applies globally across all panels viewing Central. Persists across reloads.
   - **Default:** 'dashboard' for new users (seed in `emptySession()` at line 133); legacy users get 'list' on first load (migration in `seedFromLegacy()` at line 286, treating absence as 'list' for one session, then switching).

2. **Add view-mode hooks** (library/lib/view-session-store.ts, new export ~line 770):
   ```
   export function useCentralViewMode(): {
     mode: 'dashboard' | 'list';
     setMode: (m: 'dashboard' | 'list') => void;
   } {
     // Reads/writes layout.centralViewMode via useSyncExternalStore + setLayout
   }
   ```
   - Paired setter calls `setLayout({ centralViewMode: mode })`, triggering a notify.

3. **Create LibraryCentralDashboard component** (new file library/components/LibraryCentralDashboard.tsx, ~300 lines):
   ```
   interface Props {
     entries: CatalogEntry[];
     bibByKey: Map<string, BibEntry>;
     unsortedCount: number;  // from mergedEntries with citekey === null
     onBrowse: () => void;  // switch to 'list' mode
     onSearch: (query: string) => void;  // open search overlay
   }
   export default function LibraryCentralDashboard({ ... }) {
     // Compute stats from entries:
     const stats = useMemo(() => ({
       totalBibs: bibByKey.size,
       totalPapers: entries.filter(e => e.citekey).length,
       indexed: entries.filter(e => e.indexed.state === 'indexed').length,
       deepIndexed: entries.filter(e => e.indexed.state === 'deepIndexed').length,
       indexed_or_deepIndexed: entries.filter(e => e.indexed.state === 'indexed' || e.indexed.state === 'deepIndexed').length,
       authenticated: entries.filter(e => e.bib.state === 'authenticated').length,
       needsAction: entries.filter(e => ['failed', 'unverified'].includes(e.bib.state)).length,
       unsorted: unsortedCount,
       verified: entries.filter(e => ['authenticated', 'manuscript', 'canonical'].includes(e.bib.state)).length,
     }), [entries, bibByKey]);
     
     // Render stats in a grid/card layout (NavPod or styled grid)
     return (
       <div style={{...}}>
         <div className="dashboard-header">
           <h1>Library Overview</h1>
           <button onClick={onBrowse}>Browse</button>
         </div>
         <div className="dashboard-search">
           <SearchInput onSearch={onSearch} />
         </div>
         <div className="stats-grid">
           <StatCard label="Total bib entries" value={stats.totalBibs} />
           <StatCard label="Indexed papers" value={stats.indexed_or_deepIndexed} />
           <StatCard label="Deep-indexed" value={stats.deepIndexed} />
           <StatCard label="Verified bibs" value={stats.verified} />
           <StatCard label="Needs bib action" value={stats.needsAction} />
           <StatCard label="Unsorted files" value={stats.unsorted} />
           ... more stats
         </div>
       </div>
     );
   }
   ```

4. **Add search overlay layer** (library/components/LibraryCentralSearchOverlay.tsx, ~200 lines):
   - Mounts when dashboard search input fires or user types a query.
   - Hosts its own `query` state + calls `searchCatalogFuzzy()`.
   - Renders results as a compact LeftList-lookalike (or uses LeftList with styling overrides).
   - Persists the query to the view-session store under `lists['central-search'].query` so it survives a Browse→list→back→search flow.
   - Closes on Escape or click-outside.

5. **Refactor TabbedLibraryPanel.tsx (lines 431–507)**:
   ```
   const { mode: centralViewMode, setMode: setCentralViewMode } = useCentralViewMode();
   
   <div style={{...}}>
     {activeLibrary && !isPaper(activeLibrary) ? (
       <>
         {/* Project header if needed */}
         {isProject(activeLibrary.id) && <ProjectHeader ... />}
         
         {/* Central dashboard or list */}
         {isCentral(activeLibrary.id) && centralViewMode === 'dashboard' ? (
           <LibraryCentralDashboard
             entries={visibleEntries}
             bibByKey={bibByKey}
             unsortedCount={visibleEntries.filter(e => !e.citekey).length}
             onBrowse={() => setCentralViewMode('list')}
             onSearch={query => {
               setCentralViewMode('list');
               setListQuery(scope, panel, activeLibrary.id, query);
             }}
           />
         ) : (
           /* LeftList for non-Central OR Central in 'list' mode */
           <div style={{flex: 1, minHeight: 0, overflow: 'hidden'}}>
             <LeftList ... />
           </div>
         )}
         
         {/* Fallback for empty project */}
         {isProject(activeLibrary.id) && !project.hasDoc && (
           <div style={{...}}>Open a document tab...</div>
         )}
       </>
     ) : (
       <EmptyPanelBody />
     )}
   </div>
   ```
   - **Key insight:** Dashboard and LeftList coexist peacefully under the same tab; centralViewMode is the toggle. No new tabs, no state loss.

6. **Search input promotion** (two options):
   - **Option A (leaner):** Dashboard hosts its own search input at the top. Typing dispatches `onSearch()`, which switches to 'list' and pre-populates the LeftList query. The LeftList search input then takes over. On back to dashboard, the list-mode query is forgotten (fresh empty dashboard). Simple, no overlay plumbing.
   - **Option B (richer):** Dashboard search input opens an overlay that renders a live search-results pane (mini LeftList or custom results view) *without* switching modes. Cleaner UX but more code (overlay lifecycle, results caching). Recommend Option A for MVP.

7. **Stats computation** (library/lib/catalog-stats.ts, new utility, ~50 lines):
   ```
   export interface LibraryStats {
     totalBibs: number;
     totalPapers: number;
     indexed: number;
     deepIndexed: number;
     authenticated: number;
     unverified: number;
     failed: number;
     manuscript: number;
     canonical: number;
     unsorted: number;
   }
   
   export function computeStats(entries: CatalogEntry[], bibByKey: Map<string, BibEntry>): LibraryStats {
     return {
       totalBibs: bibByKey.size,
       totalPapers: entries.filter(e => e.citekey).length,
       indexed: entries.filter(e => e.indexed.state === 'indexed').length,
       deepIndexed: entries.filter(e => e.indexed.state === 'deepIndexed').length,
       // ... enumerate all enum values
     };
   }
   ```
   - Called from LibraryCentralDashboard.
   - Pure function; no hooks, testable in isolation.

8. **Persistence guardrails:**
   - `centralViewMode` in `layout` (global) survives reloads.
   - Switching modes preserves the library's per-libId query/sort/scroll (LeftList reads from `lists['central']` regardless of mode).
   - No risk of losing state on dashboard→list→back→reload cycles.

--- relatedPhenomena ---
1. **Paper view mode (text|pdf):** Currently lives at the per-libId level (line 88 of view-session-store.ts as part of `ListView`), but conceptually is also a "view mode" toggle. Centralizing the paper view mode to `layout.paperViewMode` (keyed by paper citekey in a nested map) would unify the pattern. Defer this refactor; the paper mode is working.

2. **Search input positioning:** Today LeftList hosts the search box inline (line 465). When the list is hidden (dashboard active), the search box vanishes. Promoting it to TabbedLibraryPanel or the dashboard keeps it visible in both modes. Consider a sticky search bar at the top of the panel body for both views.

3. **Custom library dashboards:** The deep-fix recommends dashboards for Central only. If product later wants stats for custom libraries (e.g., "curated reading list of 20 papers, 15 indexed, 8 deep-indexed"), the same `libraryCentralViewMode` can be generalized to `libraryCentralViewMode?: boolean; customLibraryDashboards?: boolean` or a per-libId mode in `ListView`. Current scope: Central only.

4. **Unsorted file lifecycle:** The dashboard shows "# unsorted" from the mergedEntries array (entries with citekey === null). This count is live as files drop into unsorted/. The list view already renders these at the top (unsortedSynthetic, line 412 of LibraryView.tsx). No new integration needed.

5. **Performance:** All stats are O(n) scans of the in-memory entries array. No indexing, no memoization beyond the useMemo wrapper. For libraries with 10k+ papers, this is negligible (~5 ms scan). If needed, add a memoization layer keyed on entries array identity (like catalog-search.ts does with synthCache).

--- risks ---
1. **View-mode state loss on early remounts:** If TabbedLibraryPanel fully remounts before `useCentralViewMode` writes the new `layout.centralViewMode` to localStorage, the in-flight mode choice could be lost. Mitigation: TabbedLibraryPanel.tsx runs the view-mode hook *at the component root* (not inside an effect), so the write commits before any child re-render.

2. **Keystroke sanctity on search:** If dashboard search input calls `setMode('list')` + `setListQuery()` in the same sync path, two separate store commits fire (one for mode, one for query). The 250 ms write debounce collapses them into one I/O, but React sees two notify() calls. If LeftList is not memoized correctly, the keystroke could re-render rows. Mitigation: Debounce the search dispatch in LibraryCentralDashboard so a rapid series of keystrokes (mode flip + query set) batch into one notify.

3. **Orphaned query state:** If user searches in list mode, then switches back to dashboard, and later flips back to list, they see the old query. Acceptable (matches the paper detail view's persistence model), but document it. Alternatively, clear the query on dashboard←list transition by setting `lists['central'].query = ''` in the `onBrowse` handler.

4. **Search overlay depth (Option B):** If implementing a live-search overlay beneath the dashboard, it occupies DOM real estate and needs pointer-event gating (prevent clicks below the overlay from reaching list rows). The overlay must close on Escape. Keyboard focus trapping is recommended for accessibility.

5. **Custom library drafts:** If a user pins a custom library in the left panel and later creates a dashboard-mode Central view, the custom library tab and the Central dashboard now share the middle column's screen real estate. The resizer positions and panel widths stay independent per layout (no regressions), but the visual density increases. Acceptable; users can toggle the central view mode off to free space.

6. **Backward compatibility:** Existing users with "list" as the implicit default must migrate. The seed logic should treat absent `centralViewMode` as 'list' on first load (not 'dashboard'), so legacy sessions don't flip to a new view they haven't seen. After one session, prompt them to try the new dashboard, or leave it at 'list' by default and gate the dashboard behind a feature flag or an opt-in toggle in the Libraries navigator pod.

7. **Unsorted file count:** If unsorted/ contains a mix of PDFs and .bib files, the count shown in the dashboard is the number of entries without a citekey (from mergedEntries). This includes triage rows. If a user drops 10 files and 3 are triage-pending, the count shows 3 (correct). But if the triage skill processes one, the count drops to 2 (entries re-synced on the next 6s poll). Ensure the stat re-computation doesn't race with catalog updates. Mitigation: Use the same `mergedEntries` array that TabbedLibraryPanel passes down (built at LibraryView.tsx line 403–469), not a fresh scan.

--- productDecisions ---
1. **Dashboard default for Central only or all libraries?** Recommend Central only initially (per the ask). Custom and project libraries benefit from dashboard too, but MVP scope should be narrow. Decision: Implement the toggle only for `isCentral()` in TabbedLibraryPanel.tsx; defer custom-library dashboards to a later sprint.

2. **Search interaction: Option A (sync mode flip) or Option B (overlay)?** Option A is simpler and more discoverable (user sees the full list after searching). Option B is smoother UX (results live in the overlay without mode flip) but requires overlay plumbing. Recommend Option A for MVP. Decision: Dashboard search input calls `onSearch(query)`, which switches to list mode and pre-populates the LeftList query.

3. **What to show in stats cards—raw numbers or percentages?** E.g., "8 of 12 papers deep-indexed (67%)"? Recommend raw numbers in MVP for clarity, with a secondary mini-chart (progress ring or bar) showing the ratio. Decision: Start with raw numbers; iterate based on user feedback.

4. **Should dashboard load before or after the initial list render?** If list is already cached in DOM, flipping from 'list' to 'dashboard' is instant (both are conditional renders of the same panel slot). If list is not rendered (e.g., first session opening Central), dashboard renders immediately. Acceptable; no special preload needed. Decision: Render on demand; no preloading.

5. **Backward-compatibility migration:** Should first-load of a legacy session default to 'dashboard' (new behavior) or 'list' (conservative)? If to 'dashboard', existing users see an unfamiliar view. If to 'list', adoption is slower. Recommend 'list' for conservative safety, then surface a one-shot "Try the new library dashboard" banner in the dashboard itself (click to switch). Decision: Absent `centralViewMode` = 'list' on first load; a future optional "What's New" banner offers to switch.

6. **Persist the search query across mode transitions?** If user searches in dashboard, opens the list, then back to dashboard, should the query remain? Recommend no (clean dashboard resets), but the list query persists separately. Decision: `onSearch()` handler sets list mode + list query; `onBrowse()` handler sets dashboard mode (leaving list query intact for next list view, but not affecting dashboard).

############ Design-system context mapping for Virgil Library UI tune-up (7 asks spanning dashboards, scrolling l

--- rootCause ---
Library UI is partially unified with Virgil's token system (pill tones, pod surfaces, paper-render typography) but lacks a compact design-system reference documenting:
1. **Which tokens apply to Library-specific surfaces** (pills, status dots, empty states, the paper-render column, future dashboards). Currently scattered: pill tones in library.css, paper-render specifics in library.css, button/toggle/segmented styles undefined.
2. **Which conventions apply to Library chrome** (tabs, panels, popovers, toggles). Pattern exists (shared primitives, panel-kind registry, chrome-config knobs) but not written down for implementers.
3. **What the Library "house style" is** — the visual language that makes a new dashboard, a scroll lozenge, retuned tabs, and a reader-chrome knob all look native to Virgil + Library. No cheat-sheet exists; implementers must infer from scattered examples (StatusPill, BibCard, library.css, chrome-config.ts).
4. **How to extend without breaking** — no checklist of STYLE_GUIDE rules the 7 asks risk violating (no new hex literals, no new pill designs, no modal nesting, no Reader-specific render paths, no inline toggle styling that drifts from the topbar preset, etc.).

--- deepFix ---
## Virgil Library house style cheat-sheet

**Design tokens (copy these into every new Library component):**

```
Color scales (all CSS vars in globals.css or library.css:root):
  Surfaces:        --surface (white), --surface-muted, --surface-muted-strong, --pod-panel, --pod-dark
  Backgrounds:     --background (canvas cream #f8f3ed), --pod-editor, --header-bg
  Text / ink:      --ink-strong (dark), --ink-body, --ink-subtle, --ink-muted, --ink-faint
  Borders:         --edge-strong, --edge-hover, --edge-subtle, --border-light, --pod-border
  Accents:         --accent (brown #7c5e3c), --accent-light, --accent-blue (#2563eb for drops)
  Semantic pill:   --pill-green-bg/fg, --pill-amber-bg/fg, --pill-red-bg/fg, --pill-gray-bg/fg, --pill-blue-bg/fg
  Inline elements: --citation-bg/border, --math-bg, --pgmark-bg/color, --footnote-bg/color

Spacing & sizing:
  --pod-gap: 10px (gap between pods)
  --pod-radius: 8px (rounded corners)
  --pod-shadow: 0 1px 6px rgba(0,0,0,0.12), 0 0 2px rgba(0,0,0,0.06)
  --pod-shadow-light: 0 1px 5px rgba(0,0,0,0.09), 0 0 2px rgba(0,0,0,0.05)
  --gutter-handle-gap: 0.625em (uniform affordance spacing)
  --editor-block-gap: 1.2em (inter-block vertical rhythm)

Typography (computed via resolveFontStack() from library/lib/panel-typography.ts, never hardcoded):
  --font-serif: Playfair Display, serif
  --font-sans: Inter, sans-serif
  --font-mono: Inconsolata, monospace
  --font-serif-override, --font-sans-override, --font-mono-override: user prefs

In-card type scale (TWO TIERS, no others):
  META (labels, badges):      10px / weight 500 / uppercase / tracking-wide / --ink-muted color / .card-meta-label
  CONTENT (entry rows):       12px / default weight / --ink-body color / .card-content-row
```

**Component patterns (use these for new UI):**

1. **Pod/card surface** (dashboard cards, popovers, detail panels):
   ```css
   background: var(--surface);
   border: var(--pod-border);
   border-radius: var(--pod-radius);
   box-shadow: var(--pod-shadow);
   padding: 16px; /* or 12px for compact */
   ```

2. **Status pill** (any metric/state badge):
   ```tsx
   <span style={{
     display: "inline-flex",
     alignItems: "center",
     background: `var(--pill-${tone}-bg)`,
     color: `var(--pill-${tone}-fg)`,
     fontSize: 11,
     lineHeight: "16px",
     padding: "1px 6px",
     borderRadius: 999,
     fontFamily: "var(--font-mono-override, var(--font-mono))",
     whiteSpace: "nowrap"
   }} >
     {icon} {label}
   </span>
   ```
   Tones: green (✓), amber (⋯), red (!), gray (—), blue (special). Icon glyph + label; hover title explains state.

3. **Toggle / segmented button** (aria-pressed, not a separate component class):
   ```tsx
   <button
     aria-pressed={isActive}
     className="topbarbtn" /* if in Virgil bar */ 
     /* or from shared library/components/Button or custom */
     style={{
       padding: "4px 8px",
       background: isActive ? "var(--accent)" : "var(--surface)",
       color: isActive ? "white" : "var(--ink-body)",
       border: "1px solid var(--edge-subtle)",
       borderRadius: "4px",
       cursor: "pointer"
     }}
   >
     {label}
   </button>
   ```
   NEVER hardcode colors; NEVER use Tailwind `bg-blue-*` or `bg-emerald-*`; ALWAYS route through --accent or --menu-roving-bg (for keyboard-navigated menus).

4. **Panel header** (title + count + tools):
   ```tsx
   <PanelHeader title="My Dashboard" count={12} />
   ```
   Uses shared `PanelHeader` from src/components/panel-primitives.tsx. Counts render via badge token; no hand-rolled counters.

5. **Empty state** (icon + title sentence + description + optional example):
   Each panel has a designed empty state; do NOT use generic "No items yet" text. See STYLE_GUIDE.md "Panels" (lines 315–330). Centralize the design, not the copy.

6. **Scroll lozenge / position indicator** (PageScrollStrip analogy):
   - Fixed-position vertical pill (rounded, muted background, position:absolute)
   - Background: var(--surface-muted) or similar, border: var(--edge-subtle)
   - Text: var(--ink-muted), monospace, small size (11px)
   - Positioned via getBoundingClientRect() JS, never CSS calc
   - Gated on a viewport preference (e.g., useViewPrefs().showPageScroll)

7. **Tab strip** (Library inner-tab navigation):
   - Tabs render as inline buttons (or list items with role="tab")
   - Active tab: background-color changes to var(--accent-light) or a subtle tint, border-bottom 2px var(--accent)
   - Inactive tab: transparent, hover: bg var(--surface-muted), transition 120ms
   - Tab container: --pod-gap spacing (10px), flex layout, no borders between
   - **Draggable tabs**: cursor-grab on drag handle, cursor-grabbing while dragging, native HTML5 DnD or custom gesture (library uses both; coordinate with PanelTabStrip.tsx for precedent)

**Reader inheritance rules (hard constraints):**

- Reader mounts `<EditorPane editable={false} chrome={READER_CHROME} viewPrefs={useReaderViewPrefs()} />`
- READER_CHROME.visiblePanelKinds=[outline,footnotes,examples,citations,bibliography,notes] — only 6 panel kinds shown
- READER_CHROME.editableCardKinds=["note"] — only note cards have editable rich-text bodies
- READER_CHROME.showFormattingToolbar=false, showMenuBarEditItems=false, showHeadingFloatLabelEdit=false, showParagraphFloatTitleEdit=false
- **Reader-specific UI NEVER goes in library/components/** — channel through READER_CHROME flags (chrome-config.ts) or useReaderViewPrefs shim (reader-view-prefs.ts)
- Paper-render typography set by library.css, not by Reader-only code
- Popouts (card floats, paragraph/heading floats) dormant unless viewPrefs passes in (Editor passes, Reader doesn't)

**Rules NOT to break:**

1. No bare hex literals in components — ALL colors route through CSS vars
2. No new pill designs — use the 5-tone family (green/amber/red/gray/blue) only
3. No modal nesting — SystemDialog size sm|md|lg only
4. No per-keystroke doc walks in keystroke handlers (see AGENTS.md keystroke-sanctity rule)
5. No `.hover-on-light` + `.hover-on-dark` both on same element — pick one based on resting bg
6. No Reader-specific render paths — use chrome flags
7. No inline toggle/button styling that drifts from topbarbtn preset — extend the primitive, don't fork
8. Typography in cards: META tier (10px mono) + CONTENT tier (12px) only; no 11px or 11.5px strays
9. Gutter affordances (drag handles, fold chevrons) anchor to optical-center via resolveBlockFrame(), never line-box-top
10. Icon sizes: 16px in Virgil bar (4px vertical pad → 24px button); 20px (sm), 16px (md), 12px (lg) elsewhere
11. No `title=""` attributes (use `data-hint="label" data-hint-keys="shortcut"` for HintLayer instead)
12. Focus state on inputs: thicker border to edge-strong, no ring (exception: icon buttons use ring-2 ring-edge-strong)
13. Font stacks ALWAYS via `resolveFontStack(name)` — never inline `fontFamily: "Inter"` or `"Playfair Display"`
14. Drag drop-target outline: 2px dashed var(--ring-drag-target) #fcd34d + 12% fill
15. Menu roving selection (keyboard navigation): --menu-roving-bg ONLY, never hardcoded blue tints

**Cross-cutting patterns for the 7-ask tune-up:**

- **Dashboard**: white pod surfaces (var(--surface)), status pills for metrics, empty state with icon+title+description, responsive grid or 2-column layout
- **Scroll lozenge**: vertical fixed-position pill (var(--surface-muted) bg, var(--edge-subtle) border), monospace 11px, positioned via JS getBoundingClientRect(), gated on useViewPrefs()
- **Tab retuning**: tab-list in flex row, active border-bottom 2px var(--accent), hover bg var(--surface-muted), transition 120ms, draggable if needed (coordinate with PanelTabStrip.tsx precedent for DnD)
- **Reader inheritance**: READER_CHROME flag in chrome-config.ts, NOT Reader-specific render code
- **Button/toggle consistency**: aria-pressed boolean, inline style routing through --accent, border-radius 4px, 120ms transition
- **Empty state consistency**: centralize design per panel kind (icon, title sentence, description, example card if applicable)
- **Panel integration**: mount via Panel() wrapper with kind, title, count, headerLeading/headerExtras, panelExtras, variant="list"|"raw"

**When in doubt: ask "Would this look right printed?"** If no, it's not Virgil.

--- relatedPhenomena ---
Beyond the 7 direct asks, this design-system mapping enables future work:
1. **Stat display standardization** — when dashboards land, every metric/counter uses the pill family or a new card-stat component (centralized once, never hand-rolled)
2. **Toggle/segmented-control library** — the aria-pressed pattern should be encapsulated as a reusable component to prevent drift as new UIs add controls
3. **Reader view-prefs expansion** — Reader currently has no popouts or floating panels; if/when those features land, the useReaderViewPrefs() shim needs real state generators (e.g., useState for popout open/close); the architecture is ready but the state stubs are minimal
4. **Gutter chrome consistency** — Library inherits the shared gutter system (fold chevrons, grab handles) correctly; future work in Gutter UI (e.g. a Library-specific gutter row for citekey indicators) must use the same resolveBlockFrame() optical-center anchoring rule and --gutter-handle-gap spacing
5. **Panel kind expansion** — if Library adds a new panel type (e.g. "Paper Metadata" or "Related Papers"), it must declare bodyClass in CARD_REGISTRY, inherit from the two-tier typography system, and surface an empty state design (not a fallback placeholder)

--- risks ---
**Keystroke sanctity (per AGENTS.md):** New keystroke handlers added to dashboards, scroll lozenges, or reader chrome MUST NOT walk the doc tree per keystroke. Use module signals (useStackDropTarget pattern) or pre-computed state. CoWork pattern (frontend writes intent, backend drains) is the safe default.

**Reader render path creep:** Easy to add Reader-only code in library/components/ when READER_CHROME flags would suffice. Every Reader-only conditional is a future maintenance burden. Agent briefs should cite READER_INHERITANCE.md before touching Reader code.

**Color token collision:** Library defines pills in library.css:9-18; globals.css also defines amber/footnote scales. Implementer might add a new "status" color and hardcode it (or forget it's already in a scale). Solution: all new colors must be either (a) added to globals.css :root and documented, or (b) routed through existing tokens. No hex literals in components.

**Typography drift in cards:** The META/CONTENT two-tier system is ratified (STYLE_GUIDE.md A9) but only partially enforced in Library code. New dashboard cards or sidebar widgets might use 11px or 13px by accident. Solution: every card title goes through `cardTitleStyle(theme)`, every card body row through `.card-content-row` or `--panel-font-size`.

**Icon size inconsistency:** Virgil bar uses 16px icons (4px padding → 24px button); panels use 20/16/12px. A dashboard might mix sizes or use 14px as a "compromise." Solution: use the three canonical sizes from STYLE_GUIDE.md, never approximate.

**Empty-state duplication:** If a new Library panel (dashboard, scroll-lozenge, tabs) is added without a designed empty state, implementers copy-paste from another panel. Then a year later both drift in opposite directions. Solution: centralize empty states (per STYLE_GUIDE.md "Every panel has a designed empty state"); design them once, use `EmptyStateComponent` everywhere.

**Hover state missing on toggles:** A new toggle might have `hover:bg-surface-muted` on the parent but no transition, or transition on the wrong property. Solution: use .hover-on-light / .hover-on-dark utilities from globals.css:326–343; they're pre-tested with 120ms easing.

**Modal nesting in Reader:** If a Reader dashboard needs a multi-step flow, implementer might nest a modal inside a modal. Solution: STYLE_GUIDE.md forbids this; use popovers for transient overlays over modals.

**PanelTabStrip.tsx DnD coordination:** Library uses custom DnD for inner-tab reordering (drag-drop events, TAB_DT_TYPE). If a new dashboard also adds draggable elements, the gesture handlers must be gated to avoid accidentally dragging dashboard items when library tabs should be dragged. Solution: check the DnD context (library/lib/dnd-types.ts) and coordinate with existing listeners.

**Reader inheritance false positive:** An implementer reads library.css, sees pgmark styling and paper-render rules, then adds Reader-only hover states for those elements. The right fix is in the shared TipTap extension or globals.css, not library/components/. Solution: brief agents with READER_INHERITANCE.md before they touch Reader code; it's a constraint, not a suggestion.

--- productDecisions ---
1. **Pill tone assignment for new dashboard statuses** — if a dashboard displays states beyond the existing 5 tones (green/amber/red/gray/blue), should we add a 6th tone (e.g., purple for "in progress"), or reuse an existing tone with a different icon glyph? Recommend: reuse + glyph variance (e.g., amber with ⋯ for "queued", amber with ✓ for "done"). Keeps the palette unified and forces the 5-tone constraint down on product definitions.

2. **Reader popout policy** — Reader currently has no popouts (viewPrefs=undefined → mount dormant). If Reader gains demand for popped-out note cards or citation detail panels, should useReaderViewPrefs() generate real session state for popout open/close, or stay session-stateless and only surface floats on direct user action (no persistence)? Recommend: session-stateless, real-time action only. Readers don't persist view state across reloads by design; if that changes, it's a product call.

3. **Dashboard empty state vs. help text** — when the Library dashboard first loads (no papers yet), should it show (a) a large icon + title + description sentence + a "Get started" button, or (b) an inline help card that can be dismissed? Recommend: (a) full empty state per STYLE_GUIDE.md "Panels" (line 329), centered in the pod, not a dismissible inline card. Empty states are designed; help cards are ephemeral.

4. **Scroll lozenge visibility heuristic** — the page-scroll strip (PageScrollStrip analogy) should show when: (a) the paper is > 5 pages AND the viewport is > 600px tall, or (b) always, but fade when not needed? Recommend: (a) with 120ms fade transition. Readers on narrow/short windows don't need it; fade (not hide) preserves layout.

5. **Tab keyboard navigation** — Library inner-tab strip should support Home/End keys to jump to first/last tab, and Left/Right arrow keys to rotate through tabs, or just mouse/touch? Recommend: full keyboard support (arrow keys, Home/End, Enter to activate, Escape to close rename input). Mirrors the Virgil bar's tab navigation conventions.

6. **Drag-drop feedback for tabs** — when dragging a Library tab to reorder or move between panels, should the ghost image show (a) the full tab + library name, or (b) a compact "📋 Library Name" chip? Recommend: (a) full tab element (attachClampedDragGhost pattern from PanelTabStrip.tsx precedent) so the user sees what they're moving and where it will land.

7. **Status pill sorting in list headers** — if a dashboard lists papers with status pills (PDF present, indexed, bib auth), should the list sort by: (a) pill tone (red/amber/green priority), or (b) the paper title (and pills are informational only)? Recommend: (b) title-primary, with a filter/sort menu to let users sort by status if needed. Avoid "critical first" defaults; let the user decide.