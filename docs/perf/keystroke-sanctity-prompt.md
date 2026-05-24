# Prompt — Keystroke Sanctity rewrite (next session)

_Pick this up cold. Don't assume context._

## What you're doing and why

Per-keystroke typing in the Virgil editor is laggy. A thorough audit found the cause: **8+ ProseMirror plugins and React hooks each subscribe independently to `editor.on('update' | 'transaction')` and respond by walking the whole document one or more times to re-derive their state.** A single keystroke in a doc with footnotes + linked anchors + marginalia + expex blocks triggers **6 to 12 full document traversals** before the next paint.

The full memo — with the architectural diagnosis, proposed design, per-consumer migration map, decoration-plugin pattern, the marginalia-anchor-guard question, and verification plan — is at:

**`docs/perf/keystroke-sanctity-findings.md`**

**Read it before doing anything else.** It is the brief; this prompt is just the wrapper.

## Required reading before coding

1. **`docs/perf/keystroke-sanctity-findings.md`** — the full memo. All sections.
2. **`AGENTS.md`** at repo root — Virgil's overall agent guide; flags that Next.js / TipTap / ProseMirror APIs may have breaking changes from training data and that you should consult `node_modules/next/dist/docs/` or the package source if anything feels uncertain.
3. **`docs/perf/cursor-selection-reactor-audit.md`** — prior audit of the selection-side reactors (already fixed). Same architectural family; gives you a sense of the codebase's reactor patterns and the prior fix pattern.
4. **`docs/perf/marginalia-overhaul-prompt.md` + `…-findings.md`** — the marginalia rewrite that's already landed. Read for tone, scope, and the kind of architectural rigor expected on this codebase.
5. **The files listed in the §1 inventory of the findings memo** — open them. Verify the file:line references still match before editing. The user said they've made changes since the audit; some line numbers may have drifted.

## This is architectural, not surgical

This is the user's standing preference and they reiterated it: **deep architectural changes over surgical patches.** Two specific consequences for this work:

- We are not adding throttles, debounces, or skip-flags to the existing watchers. We are **eliminating** their direct subscriptions to `editor.on('update' | 'transaction')` and replacing them with subscriptions to typed structural events.
- We are not building it in a way that lets the next developer write the wrong-shaped reactor again by mistake. The end state should make the right thing easy and the wrong thing visible. Encode the keystroke-sanctity invariant in `AGENTS.md` so future PRs get pushed back.

## The shape of the rewrite (interrogate before implementing)

From the memo:

1. New plugin `DocStructureObserver` (folder: `src/lib/tiptap/doc-structure/`) maintains an incrementally-updated structural index. Its `apply` does cheap step inspection — O(edit size), with fast-path O(1) bails on `!tr.docChanged` and on structurally-null edits.
2. The observer publishes typed events on an editor-attached `DocStructureBus`: `onUuidsAdded/Removed`, `onHeadingsChanged`, `onFootnotesRemoved`, `onAnchorsRemoved`, `onExamplesChanged`, `onLabelsChanged`, `onBlockContentChanged(uuid)`, etc.
3. Every existing red-and-amber-category reactor migrates to subscribe to typed events. The migration map is in §5 of the memo.
4. Decoration plugins (`latex-command`, `pgmark`, `uuid-attr`) move to the canonical `DecorationSet.map(tr.mapping)` + targeted-region-rescan pattern (§7 of the memo). Independent of the observer.
5. The marginalia anchor guard is **the architectural question**. §6 of the memo recommends embracing orphans and exposing an orphan tray. The user has not committed to that yet — surface the question explicitly in your first response and get a decision before coding it. If they defer, fall back to keeping the guard but rewriting it to consume the observer's diff.

## Open questions to resolve before coding

These need explicit answers, ideally from the user:

- [ ] **Marginalia anchor guard:** Option A (orphan tray) or Option B (content-addressed anchors) or "keep guard, just rewrite cheaply"? See §6 of memo. **Surface this question in your first response.**
- [ ] **Legacy `Marginalia.tsx`:** §1 of memo flags it as probably-dead. Grep for consumers; confirm and delete if dead. If alive, fold its concerns into the new architecture.
- [ ] **Plugin ordering:** confirm the observer plugin loads before all other PM plugins that might need to read `tr.meta` from it. In practice this means it's the first item in the TipTap extension list. Verify.
- [ ] **Step inspection coverage:** `inspectSteps` must handle every step type ProseMirror produces in Virgil. List them by grepping for `dispatch` and `tr.replaceWith` / `tr.delete` / `tr.insert` / `tr.replaceSelectionWith` etc. Confirm coverage. Test with paste (multi-block slice), undo (`ReplaceStep` with structure on both sides), and drag-reorder if applicable.
- [ ] **Initial-state population:** when the editor first loads, the observer's `init` does one full doc walk to populate the index. That's fine (it's a load-time cost, not a keystroke cost). Confirm there's no race with consumers subscribing before init completes.
- [ ] **Bus identity across hot reloads:** in dev mode Next.js hot-reloads can re-create editors. Confirm the bus is associated with the editor instance (not a module-level singleton) so stale subscriptions don't leak.

## Implementation order

Do not start any of these until the memo has been read end-to-end and the open questions above are answered.

1. **Verify the inventory.** `rg "editor\.on\(['\"](update|transaction)" src/` and `rg "appendTransaction" src/`. Confirm against the memo's §1. Add anything missing.
2. **Build the observer + tests.** New folder, types, step inspector, structure index, plugin, bus, hook. Tests covering: typing inside a paragraph (empty diff), Enter to split, Backspace to merge, deleting a heading, pasting a multi-block slice, undo of each.
3. **Wire the observer into the editor extension list (first position).** Confirm `useDocStructure()` reads sensibly. Instrument `bus.emit` to log events; type a paragraph; confirm zero events fire while typing within an existing block.
4. **Migrate decoration plugins** (`latex-command`, `pgmark`, `uuid-attr`) to the canonical mapping pattern. Independent of observer; can land first.
5. **Migrate the orphan watchers** (footnote, linked-anchor, marginalia anchor guard). Per the §6 decision.
6. **Migrate the numbering plugins** (section numbers, expex numbers). Memoize on heading/example sets.
7. **Migrate the rest** (latex-comment auto-detector, label auto-generator, section-fold pruner, float-sync, in-text positions, marginalia registry structural sync, active text-object resolver).
8. **Sweep.** `rg "editor\.on\(['\"](update|transaction)" src/` again. Every remaining hit must be on the permitted list (observer, autosaver, presence bumper, plus any consciously-kept `appendTransaction`).
9. **Verify on the dev doc.** Refresh `virgil-data/doc_devtest` from `samples/annotation-history` (`rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest`). Type a long burst in the middle of a long paragraph. Section numbers, expex numbering, footnote orphan flow, anchor orphan flow, LaTeX command styling, page-mark rendering, float-panel sync: all visibly identical.
10. **Encode the invariant.** Add a "Keystroke sanctity" section to `AGENTS.md` with the rule, the permitted-subscriber list, and a pointer to the memo.

## Success criteria

Copied from §9 of the memo:

- Typing 100 characters inside a paragraph: **zero** events fire on `DocStructureBus`. (Instrument `bus.emit` with a counter to verify.)
- Pressing Enter to split a paragraph: exactly one event tick fires (`onUuidsAdded` with one UUID; possibly `onBlockContentChanged` for the predecessor).
- Frame-time on a 200-char burst on the long dev doc: no main-thread tasks > 8 ms attributable to plugin applies. (Compare against a pre-rewrite baseline you capture in step 1.)
- `rg "editor\.on\(['\"](update|transaction)" src/` returns at most the 3–5 permitted subscribers.
- Visual parity confirmed by manual smoke on the refreshed dev doc.
- No new `editor.on('update' | 'transaction')` subscription survives unless it's O(1) work or an explicitly-permitted `appendTransaction` plugin reading the observer's diff.

## Working conventions

A few Virgil-specific gotchas worth knowing cold:

- **`Co-Authored-By` lines** are not used by this user. Commit messages should focus on the why, not the what. Don't add `Co-Authored-By: Claude` lines unless asked.
- **End every response with "Done."** — explicit completion signal the user expects.
- **Check `src/STYLE_GUIDE.md` if you touch UI.** This rewrite shouldn't, with the possible exception of the orphan tray (if §6 Option A is chosen) — at which point yes, read the style guide and update it if you make a generalizable decision.
- **Dev preview gotcha:** the dev preview iframe needs the doc preloaded via `virgil-data/doc_devtest/` — the File System Access picker doesn't work inside the iframe. Refreshing it from the sample is the line in step 9. Also, the Turbopack watcher sometimes serves stale CSS after edits; restart the preview rather than fighting it.
- **No `cd && git ...` compound commands.** Each git command as its own Bash call. Prefer `git -C <path>` over `cd`.
- **No emojis in code or commits** unless the user asks for them.

## Out of scope for this session

Acknowledge and defer:

- Incremental word counter / LaTeX linter (currently debounced; not on the keystroke path).
- EditorMirror smart resyncs.
- Any new card kinds or UI affordances beyond what §6 demands.
- Anything in `library/` or `editor/` skill folders.

## After landing

1. Update `docs/perf/keystroke-sanctity-findings.md` with the actual measurements (event count, frame time) before/after.
2. Add the "Keystroke sanctity" section to `AGENTS.md` (per step 10 above).
3. Open a follow-up note about the §10 deferred items if any of them feel close enough to revisit soon.
