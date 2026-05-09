# Virgil Reader inheritance — debugging guide for agents

**Read this first** if you're fixing a bug where a feature works in the main Virgil Editor but is broken (or missing) in the Virgil Reader (Library tab → indexed paper).

The goal of this doc is to **constrain the solution space**. The Reader is not a parallel implementation of the Editor; it's a thin wrapper around the same component, with a small set of declarative knobs. If you find yourself writing a Reader-only render path, stop.

---

## The architectural pattern: shared component + chrome config + state shim

The Reader and the main Editor mount **the same React component** — `<EditorPane>` at [src/components/EditorPane.tsx](src/components/EditorPane.tsx). Every TipTap extension, every panel, every marginalia chip, every keyboard handler is the same code in both surfaces.

What differs between the two is *only*:

1. **`chrome` config** — [src/components/editor-layout/chrome-config.ts](src/components/editor-layout/chrome-config.ts). Two values: `FULL_CHROME` (Editor) and `READER_CHROME` (Reader). Boolean flags + whitelists that suppress affordances the Reader doesn't want (e.g., `showFormattingToolbar: false`, `editableCardKinds: ["note"]`, `visiblePanelKinds: [...]`).
2. **`viewPrefs` bundle** — Editor passes `editorPaneViewPrefs` from `useViewPrefs()` (persisted, full-featured). Reader passes the result of `useReaderViewPrefs()` at [src/components/editor-layout/reader-view-prefs.ts](src/components/editor-layout/reader-view-prefs.ts) — session-only state with stub callbacks for things the Reader doesn't need.
3. **`menuBar` bundle** — Editor passes a full menuBar bundle. Reader passes nothing, so the docked MenuBar and detached toolbars stay dormant.

That's the entire delta. **There is no "Reader-specific render path"** inside `library/components/`. `PaperRender.tsx` is a thin mount: it parses LaTeX → JSON, then `<EditorPane editable={false} chrome={READER_CHROME} viewPrefs={readerViewPrefs} />`.

If a feature works in Editor, the rendering code already exists and is already imported by Reader. A bug means one of three things has gone wrong — see below.

## The three legitimate places a fix can live

When triaging a Reader bug, the fix lives in exactly one of these three layers. Find which one and stay there.

### 1. The shared layer (most fixes belong here)

If the same bug exists in *both* Editor and Reader, the fix lives in the shared component — `EditorPane.tsx`, `Editor.tsx`, a TipTap extension under `src/lib/tiptap/`, a panel under `src/panels/`, etc. Patch it once; both surfaces benefit.

Anti-pattern: implementing the fix only in `library/components/`.

### 2. `READER_CHROME` (when an Editor-only affordance is leaking)

If the Editor's chrome shows something the Reader shouldn't show (or vice versa), that's a chrome flag. Add or flip a flag in [chrome-config.ts](src/components/editor-layout/chrome-config.ts), then make the shared component honor it via `chrome.<flag>`.

Anti-pattern: hard-coding a Reader-only conditional inside `EditorPane.tsx` like `if (isLibraryReader) ...`.

### 3. `useReaderViewPrefs()` (when a stateful interaction needs a shim)

If a feature works in Editor because it depends on a `viewPrefs` field/setter that the Reader stubs as a no-op, the fix is to give the Reader real state for that field — usually `useState`-backed and session-only. The Reader doesn't persist most of its state across reloads; that's intentional.

Anti-pattern: forcing the Editor's persistence layer onto the Reader, or duplicating the Editor's `useViewPrefs` hook.

## Triage flow

Use this when reporting an issue, and have the agent walk through it before changing code.

1. **Does the same bug exist in the Editor?**
   - Yes → fix in the shared layer (location #1). Done.
   - No → continue.
2. **Is something rendering in Editor but missing/wrong in Reader?**
   - Yes → it's almost certainly a `READER_CHROME` flag (location #2) or a no-op'd `viewPrefs` field (location #3). Find which extension/component reads the flag or the prefs field, and verify the Reader's value.
3. **Is the Reader rendering raw LaTeX where Editor renders styled output?**
   - That's a TipTap extension that isn't loaded in the Reader's mount, or a parser branch that's gated on something the Reader doesn't pass. Find the extension/branch and unify it.
4. **Is the bug ONLY in Reader, with no Editor parallel feature?**
   - Rare. Most "Reader-only" features (PageScrollStrip, citekey routing) are explicitly Library-scoped and live in `library/`. If you're adding behavior that has no Editor analog, double-check it shouldn't be promoted to the shared layer.

## Vocabulary

When briefing an agent on a Reader bug, prefer this language. It signals "use the shared architecture" without you having to repeat the constraint.

- **"Channel the fix through the shared `EditorPane` layer."** — Don't fork the render path.
- **"This should be controlled by a chrome flag."** — Reader and Editor diverge via flags, not branches.
- **"The view-prefs shim should provide real state for X."** — When a no-op stub is causing the bug.
- **"Find the single source of truth."** — There's exactly one canonical implementation; both surfaces read from it.
- **"Don't add a Reader-specific render path."** — `library/components/` should stay a thin mount, not a parallel renderer.
- **"Honor inheritance."** — Catch-all term for "trust the shared component; configure, don't reimplement."

## Worked example: citations rendering as raw `\citet{...}` in Reader

**Symptom**: a paper opened in the Library Reader shows `\citet{slights2001}` as plain text where the Editor would show a styled citation chip.

**Wrong fix** (do not do this):
- Add a regex pre-processor in `library/components/PaperRender.tsx` that converts `\citet{...}` to a styled span before mounting.
- Write a Library-only citation component.
- Special-case the Reader inside the citation extension with `if (chrome === READER_CHROME)`.

**Right triage** (per the flow above):
1. Does Editor have the same bug? → No, Editor renders the chip correctly. So it's not a shared-layer parser bug.
2. Is the citation TipTap extension loaded in the Reader's mount? → Check the extension list passed to `<EditorPane>`. If the extension is in `src/lib/tiptap/` and is part of the unified extension set, it should already be loaded.
3. If yes, is the LaTeX→JSON conversion in `PaperRender.tsx` recognizing the `\citet` command and emitting a `citationNode`? → If the parser is dropping it as plain text, the bug is in the LaTeX parser at `src/lib/latex-parser.ts` (shared) or in PaperRender's parse step. Patch the shared parser.
4. If the parser emits `citationNode` correctly but it still renders as text, check whether `citationNode`'s NodeView reads any `viewPrefs` field that the Reader's shim no-ops.

**Fix location**: shared layer (the LaTeX parser) or the Reader's parse/mount path in `PaperRender.tsx` — never a Reader-only citation renderer.

## Reporting template

Copy-paste this when asking an agent to fix a Reader regression:

```
Read library/READER_INHERITANCE.md before doing anything else.

Issue: <one-sentence description>
Expected (works in Editor): <what should happen>
Actual (in Reader): <what happens>
Where I see it: <citekey + section, or screenshot>

Per the inheritance guide, the fix must live in (a) the shared
component layer, (b) READER_CHROME, or (c) useReaderViewPrefs's
session-state shim. Do NOT add a Reader-specific render path under
library/components/. If you find yourself adding Reader-only rendering
logic for a feature that already exists in the Editor, stop and ask
me — there's almost certainly a chrome flag or shim wiring you've
missed.

Walk through the triage flow in the doc and tell me which layer the
fix belongs in before you start coding.
```
