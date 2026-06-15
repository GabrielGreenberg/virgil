# CHIP 8 live matrix — Lifecycle phase (archive + delete)

**Surface:** grab + lightning (shared `dispatch(action, ref)` — one drive covers both;
menu-wiring spot-check pending). **Method:** live preview on `doc_devtest`, in-page async
driver (`window.__sweep.runDestructive`), real `ConfirmDialog` click, observed in-memory
(`doc.childCount` + uuid presence) AND on-disk (`document.tex` `%!v:` markers + `archive.json`)
after the 1500 ms autosave. Remount sentinel clean throughout (no #29-worktree HMR interference observed).

## Result: 22 / 22 PASS-removed

| action | kind | uuid | atom / anchor | dialog | verdict |
|---|---|---|---|---|---|
| archive | paragraph | 1101 | footnote + anchored (notes/reports/revisions) | ✅ "Archive this paragraph?" | PASS |
| archive | blockquote | 2202 | citation + anchored (cutter) | ✅ "Archive this block quote?" | PASS |
| archive | paragraph | 3311 | **inlineMath + anchored (cutter)** — original bug canary | ✅ | **PASS** |
| archive | paragraph | 4403 | citation+footnote + anchored (revisions) | ✅ | PASS |
| archive | paragraph | 6607 | labelRef + anchored (revisions) | ✅ | PASS |
| archive | displayMath | a292 | block | ✅ "Archive this math block?" | PASS |
| archive | figureBlock | 48cc | block | ✅ "Archive this figure?" | PASS |
| archive | graphicsBlock | 289b | block | ✅ "Archive this graphic?" | PASS |
| archive | texBlock | 7e10 | block | ✅ "Archive this TeX block?" | PASS |
| archive | exampleBlock | ee01 | block | ✅ "Archive this example?" | PASS |
| archive | codeBlock | 6606 | block | ✅ "Archive this code block?" | PASS |
| archive | bulletList | 2205 | block (3 items) | ✅ "Archive this list?" | PASS |
| archive | orderedList | 6603 | block | ✅ "Archive this numbered list?" | PASS |
| archive | latexComment | 0c01 | block | ⚠️ **NO dialog** | PASS-removed (see finding F1) |
| archive | paragraph | 5503 | citation + anchored (notes) | ✅ | PASS |
| delete | paragraph | 2201 | footnote + anchored | ✅ "Delete this paragraph?" | PASS |
| delete | paragraph | 3301 | footnote + anchored | ✅ | PASS |
| delete | paragraph | 3312 | inlineMath | ✅ | PASS |
| delete | paragraph | 4402 | citation | ✅ | PASS |
| delete | paragraph | 5501 | citation + anchored (cutter/todos) | ✅ | PASS |
| delete | paragraph | 6601 | citation | ✅ | PASS |
| delete | paragraph | 3313 | footnote | ✅ | PASS |

**On-disk:** all 22 `%!v:<uuid>` markers removed from `document.tex` (0 leaks). `archive.json`
+15 (the 15 archives). 7 deletes correctly absent from `archive.json` (delete ≠ archive).

## Findings

- **F1 (candidate, low severity):** `archive` on a **latexComment** (`0c01`) surfaces **no
  destructive confirm** (deletes silently). Analogous to the gap `63ccace` just closed for
  math/`\ref`/figure/tex blocks. Verify against `resolveDestructiveConfirm` whether latexComment
  was intentionally excluded or overlooked. (Delete-on-latexComment not yet driven — add it.)

## Atom-only class (the 80170b3 / f4c830f / 63ccace fixes) — CONFIRMED WORKING

Constructed atom-only paragraphs (a paragraph whose ONLY child is one atom) and drove lifecycle:

| action | atom-only kind | confirm? | result |
|---|---|---|---|
| archive | inlineMath-only (`PM01`) | ✅ | removed cleanly |
| archive | labelRef-only (`PR01`) | ✅ | removed cleanly |
| archive | citation-only (`PC01`, real `cc01` id) | ✅ | removed cleanly |
| archive | footnote-only (`PF01`, real `f0ac` id) | ✅ | removed cleanly |
| delete | inlineMath-only (`DM01`) | ✅ | removed cleanly |
| delete | labelRef-only (`DR01`) | ✅ | removed cleanly |

The destructive confirm **surfaces** for atom-only lines (63ccace) and they **remove cleanly** (80170b3 — no silent no-op). **The recently-landed atom-only fixes hold.**

> **Methodology trap logged:** an atom-only fixture built with a **fake** citationId silently no-op'd
> on archive (the snippet/cleanup path aborts after the async confirm with no thrown error) and
> reusing a **real** atom id for a 2nd atom crashed the tab with 156 React duplicate-key errors
> (`float:card:footnote:f0ac`). Both are fixture artifacts of an impossible-in-real-usage state, NOT
> product bugs. **Construct atom-only citation/footnote fixtures only with valid, UNIQUE ids.**

## Duplicate × kinds — CONFIRMED WORKING (atom renumber correct)

| kind | uuid | Δblocks | atom delta | clone uuid |
|---|---|---|---|---|
| paragraph (footnote) | 1101 | +1 | +1 atom | fresh full-UUID |
| paragraph (citation+footnote ×6) | 4403 | +1 | +6 atoms | fresh full-UUID |
| paragraph (inlineMath ×2) | 3311 | +1 | +2 atoms | fresh full-UUID |
| displayMath | a292 | +1 | +0 | fresh full-UUID |
| figureBlock | 48cc | +1 | +0 | fresh full-UUID |

All clones got fresh block UUIDs and **fresh atom ids** — **zero console errors** (no duplicate-key),
confirming the registry-driven `duplicateSlice` renumbers atoms correctly. (Duplicate does NOT trigger
`MarginaliaAnchorGuard` — it inserts, never removes the source — consistent with the rootcause memo.)

## Findings from this phase
- **F2 (DATA-LOSS)** — delete/archive of a paragraph before a `graphicsBlock` also removes the
  graphicsBlock. See [FINDINGS.md](FINDINGS.md). **Dispatched to worktree agent ab777… (root-cause + fix).**
- Heading delete = correct **section-scope** removal ("Delete the entire section?", Δ = section size).

## Still owed for lifecycle (lower-risk tail)
- `delete` on non-paragraph container kinds (covered for archive; delete spot-checked) + `latexComment` delete (F1 confirm check).
- `archive`/`delete` on **titleField** / **maketitleMarker**, **listItem** / **exampleItem** (sub-block), **linkedRange** (mark).
- Menu-wiring spot-check: DragHandleMenu vs ActionsMenuPanel onClick build identical refs.
