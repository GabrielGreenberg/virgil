# Virgil Reader inheritance — debugging guide for agents

**Read this first** if you're fixing a bug where a feature works in the main Virgil Editor but is broken (or missing) in the Virgil Reader (Library tab → indexed paper).

The goal of this doc is to **constrain the solution space**. The Reader is not a parallel implementation of the Editor; it's a thin wrapper around the same component, with a small set of declarative knobs. If you find yourself writing a Reader-only render path, stop.

---

## The architectural pattern: shared component + chrome config + shared view-state engine

The Reader and the main Editor mount **the same React component** — `<EditorPane>` at [src/components/EditorPane.tsx](src/components/EditorPane.tsx). Every TipTap extension, every panel, every marginalia chip, every keyboard handler is the same code in both surfaces.

What differs between the two is *only*:

1. **`chrome` config** — [src/components/editor-layout/chrome-config.ts](src/components/editor-layout/chrome-config.ts). Two values: `FULL_CHROME` (Editor) and `READER_CHROME` (Reader). Boolean flags + whitelists that suppress affordances the Reader doesn't want (e.g., `showFormattingToolbar: false`, `editableCardKinds: ["note"]`, `visiblePanelKinds: [...]`).
2. **`viewPrefs` bundle** — BOTH surfaces run the SAME `useViewPrefs()` engine and assemble the bundle through the SAME `buildEditorPaneViewPrefs(...)` builder ([src/components/editor-layout/build-editor-pane-view-prefs.ts](src/components/editor-layout/build-editor-pane-view-prefs.ts)). The Editor uses the persisted mode; the Reader runs `useReaderViewPrefs()` ([src/components/editor-layout/reader-view-prefs.ts](src/components/editor-layout/reader-view-prefs.ts)), which is the same engine in `"ephemeral"` mode — real, fully-functional view-state that lives in memory only (it never touches the user's persisted editor layout). So the panel rail, strip buttons, the panel↔text divider, dock stacking, card popouts, margins, omni toggles, and Outline click-to-scroll are all LIVE in the Reader (session-only). The ONLY delta is a single NAMED, type-checked `EditorMutationHandlers` set (`READER_NOOP_HANDLERS` in `reader-view-prefs.ts`): because the doc is read-only, most are no-ops — but `onScrollToHeading` (Outline click-to-scroll) is REAL.
3. **`menuBar` bundle** — Editor passes a full menuBar bundle. Reader passes nothing, so the docked MenuBar and detached toolbars stay dormant. (This is the one piece of editor chrome that's genuinely absent in the Reader.)

That's the entire delta. **There is no "Reader-specific render path"** inside `library/components/`. `PaperRender.tsx` is a thin mount: it parses LaTeX → JSON, then `<EditorPane editable={false} chrome={READER_CHROME} viewPrefs={readerViewPrefs} />`.

**The invariant:** view-state is shared and real (ephemeral in the Reader); only the named `EditorMutationHandlers` set is stubbed, and it's type-checked — a missing handler is a **compile error**, not a silent dead control.

If a feature works in Editor, the rendering code already exists and is already imported by Reader. A bug means one of three things has gone wrong — see below.

## The three legitimate places a fix can live

When triaging a Reader bug, the fix lives in exactly one of these three layers. Find which one and stay there.

### 1. The shared layer (most fixes belong here)

If the same bug exists in *both* Editor and Reader, the fix lives in the shared component — `EditorPane.tsx`, `Editor.tsx`, a TipTap extension under `src/lib/tiptap/`, a panel under `src/panels/`, etc. Patch it once; both surfaces benefit.

Anti-pattern: implementing the fix only in `library/components/`.

### 2. `READER_CHROME` (when an Editor-only affordance is leaking)

If the Editor's chrome shows something the Reader shouldn't show (or vice versa), that's a chrome flag. Add or flip a flag in [chrome-config.ts](src/components/editor-layout/chrome-config.ts), then make the shared component honor it via `chrome.<flag>`.

Anti-pattern: hard-coding a Reader-only conditional inside `EditorPane.tsx` like `if (isLibraryReader) ...`.

### 3. `reader-view-prefs.ts` (the `READER_NOOP_HANDLERS` set + Reader view-derivations)

Most view-state already works in the Reader by construction — it runs the real `useViewPrefs` engine, so there's no per-field shim to wire. This layer is for the narrow remainder: the named `EditorMutationHandlers` (`READER_NOOP_HANDLERS`) and the Reader's `EditorPaneViewDerivations`. If a feature is broken because a Reader handler is a no-op that should be real (the way `onScrollToHeading` is real), promote it from `READER_NOOP_HANDLERS` to a live callback (threading in the editor if it needs one, the way `onScrollToHeading` does). The Reader's view-state itself is session-only (ephemeral) and doesn't persist across reloads; that's intentional.

Anti-pattern: re-introducing a stateful hand-rolled shim that re-implements `useViewPrefs`, forcing the Editor's persistence layer onto the Reader, or duplicating the `useViewPrefs` engine.

## Triage flow

Use this when reporting an issue, and have the agent walk through it before changing code.

1. **Does the same bug exist in the Editor?**
   - Yes → fix in the shared layer (location #1). Done.
   - No → continue.
2. **Is something rendering in Editor but missing/wrong in Reader?**
   - Yes → it's almost certainly a `READER_CHROME` flag (location #2) or a no-op'd `EditorMutationHandlers` entry (location #3). The shared `useViewPrefs` engine already feeds the Reader, so a *view-state* divergence is rare — check the chrome flag or the named handler set first. (If the missing piece is the MenuBar / detached toolbars, that's expected: the Reader passes no `menuBar` bundle.)
3. **Is the Reader rendering raw LaTeX where Editor renders styled output?**
   - That's a TipTap extension that isn't loaded in the Reader's mount, or a parser branch that's gated on something the Reader doesn't pass. Find the extension/branch and unify it.
4. **Is the bug ONLY in Reader, with no Editor parallel feature?**
   - Rare. Most "Reader-only" features (PageScrollStrip, citekey routing) are explicitly Library-scoped and live in `library/`. If you're adding behavior that has no Editor analog, double-check it shouldn't be promoted to the shared layer.

## Vocabulary

When briefing an agent on a Reader bug, prefer this language. It signals "use the shared architecture" without you having to repeat the constraint.

- **"Channel the fix through the shared `EditorPane` layer."** — Don't fork the render path.
- **"This should be controlled by a chrome flag."** — Reader and Editor diverge via flags, not branches.
- **"Promote the no-op handler to a real one."** — When a stubbed `EditorMutationHandlers` entry is causing the bug (the way `onScrollToHeading` is already real).
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
4. If the parser emits `citationNode` correctly but it still renders as text, check whether `citationNode`'s NodeView reads any `viewPrefs` field — but remember the Reader runs the real `useViewPrefs` engine, so its view-state is populated; a divergence here is far more likely a chrome flag or a stubbed `EditorMutationHandlers` entry than a missing view-pref field.

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
component layer, (b) READER_CHROME, or (c) the named
READER_NOOP_HANDLERS / view-derivations in reader-view-prefs.ts.
Do NOT add a Reader-specific render path under
library/components/. If you find yourself adding Reader-only rendering
logic for a feature that already exists in the Editor, stop and ask
me — there's almost certainly a chrome flag or a named editor-handler
you've missed.

Walk through the triage flow in the doc and tell me which layer the
fix belongs in before you start coding.
```
