# BUG DIAGNOSIS — Omni margin cards stack at the top of the gutter on load / after idle

**Status:** `IMPLEMENTED` (0cd533fe settle-aware omni cascade, 2026-06-24, prior drain) — owes live FSA feel-check · confidence **high** (live-reproduced)
**Filed by:** bug-catcher session, 2026-06-21
**Surface:** Omni margin view only (`useInTextPositions` cascade). Docked panels are unaffected.
**Class:** premature/stale in-text-position **measurement** with no guaranteed corrective re-measure — same *symptom* as the already-fixed "note cards stack while typing" bug, **different cause** (cold-load layout race, not typing-time stale `pos`).

---

## 1. Symptom (as reported)

Citation / note / footnote cards in the right-or-left **margin column** ("Omni" view) pile up in a tight
vertical stack at the **top** of the column instead of sitting next to their anchor paragraphs/examples.
Reported triggers:

- **Just opened the document** → stacked, **persists** until interaction.
- **Scrolled to cards "not viewed in a while"** → stacked, persists.
- **Briefly after reload** → stacked, but **sometimes self-resolves** with no interaction.
- **Clicking any one card snaps the whole deck to correct positions.**

Screenshot showed three EXAMPLE blocks each with a CITATION card piled near the top.

---

## 2. Where the cards live (surface map)

These cards are rendered by the **Omni view**, not a docked panel:

- [`OmniViewPanel.tsx:489`](src/panels/Omni/OmniViewPanel.tsx:489) calls
  `useInTextPositions(editor, inTextItems, true, "data-omni-entry-wrapper", pinned, resolvePos)`.
- Each card renders absolute-positioned with `transform: translateY(${top}px)` ([OmniViewPanel.tsx:545-587](src/panels/Omni/OmniViewPanel.tsx:545)).
- The `top` values come from [`useInTextPositions`](src/hooks/useInTextPositions.ts) — **the single positioning engine for every Omni card kind** (footnote, citation, note, todo, example, …).
- **Docked panels do NOT use this engine** — they use `CardListPanel` (simple vertical flow), which is why the bug is Omni-only. A fix in `useInTextPositions` therefore covers **all** affected cards on **both** sides at once.

---

## 3. Root cause (live-verified)

### 3a. The mechanism that produces the top-stack

`measure()` computes, per card:

```
naturalTop = coordsAtPos(pos).top - podRect.top      // useInTextPositions.ts:280
if (naturalTop < 0) naturalTop = 0                    // useInTextPositions.ts:284  ← LOSSY CLAMP
```

then `resolveCascade()` ([:127-176](src/hooks/useInTextPositions.ts:127)) sorts by `naturalTop` and runs a
forward overlap pass: `minTop = prev.top + prev.height + MIN_GAP`. **When many cards' `naturalTop` collapse
to `0`, the cascade deterministically spreads them into `0, 64, 128, 192…`** (height 60 `DEFAULT_ENTRY_HEIGHT`
+ 4 `MIN_GAP`). **That is exactly the tight top-stack in the screenshot.**

> **Live proof (repro agent):** overriding `coordsAtPos` to report the deep anchors ~50px *above* the pod top
> (simulating the un-laid-out editor) collapsed the live deck to `translateY = [0, 64, 128, 191, 255, 319]` —
> the reported stack. Restoring true coords + firing one re-measure snapped it back to
> `[2125, 2328, 2392, 2456, 2520, 2584]`.

### 3b. WHY `naturalTop` collapses to ≤0 on cold load

**The corrupting quantity is `coords.top` (the per-anchor editor coordinate), read *before the editor reaches
its final laid-out height*.** Before web fonts swap and before the React NodeViews (KaTeX math, `expex`
examples, figures/images) mount and size, the document is vertically compressed/shifted, so `coordsAtPos(pos)`
for a card's anchor returns a top that is too small — for anchors that land above the pod's top edge in that
transient, `coords.top - podRect.top` goes negative → clamped to `0` → cascade stack.

> **Refuted sub-hypothesis (important — don't chase it):** the lead guess was "pod height is still 0
> (`editorContentHeight` starts at 0) → `podRect.top` is wrong." The repro agent **disproved** this: setting the
> live pod's `minHeight=''` left `podRect.top` unchanged (32px) and naturals correct. The pod is
> `position: relative`; its top is fixed by the panel-column layout *above* it, not by its own `minHeight`.
> **So a fix that merely bootstraps `editorContentHeight` to nonzero will NOT work.** The fix must target
> *re-reading `coords.top` after layout settles*.

### 3c. WHY the bad measure persists (no corrective re-measure)

`measure()` runs **once**, synchronously, in `useLayoutEffect` ([:330](src/hooks/useInTextPositions.ts:330)),
racing async layout. After that, the **complete** set of re-measure triggers is
([:321-421](src/hooks/useInTextPositions.ts:321)):

| Trigger | Fires on cold-load settle? |
|---|---|
| `bus.onBlocksAdded` / `onBlocksRemoved` | **No** — `buildInitial()` emits no structural diff on load (`observer-plugin.ts` `state.init()` returns `pendingDiff: null`). Verified. |
| `window 'resize'` | No (no spontaneous resize). |
| `ResizeObserver(editor.view.dom)` | **Leaky** — fires when the doc's border-box height changes, but can fire *during* a transient and then go quiet, or settle in the window before the hook attaches. |
| `ResizeObserver(card wrappers)` | Only on a card **height** change (not a position change). |
| `focusout` | Only on user edit. |
| **plain scroll** | **No trigger at all.** |

There is **no subscription to "the editor's layout has settled"** (no `document.fonts.ready`, no
NodeView-mounted signal). So once the eager measure caches garbage, nothing re-measures until an incidental
`editor.view.dom` resize (→ "sometimes self-resolves") **or** a user gesture.

### 3d. WHY clicking one card heals the whole deck

A card click publishes a **pin**, but the pin alone re-runs `resolveCascade` against the **same stale
`naturalRef`** — it cannot heal. The actual healer is the side effect: selection →
[`usePlacement`](src/links/_shared/usePlacement.ts) → `alignEntryToY()` **scrolls the editor row** (and the
selected card expands), which makes `ResizeObserver(editor.view.dom)` / the card RO fire `schedule()` →
`measure()` re-runs against the **now-settled** layout → correct `naturalTop` → cascade reflows correctly.
**The minimal corrective signal is simply "re-measure once after layout is final."**

### 3e. Reconciling "haven't viewed in a while"

Scroll itself does **not** re-corrupt positions — `translateY` is pod-relative and **scroll-invariant**
(repro agent confirmed: scrolling to 2000px left the deck unchanged; pod top moves with content, cancelling
the coords shift). So "not viewed in a while" is **not** a scroll-caused regression — it's the user
**encountering a stale stack that was baked at load** (or at an off-screen reflow the leaky RO missed) and
never corrected, because plain scroll triggers no re-measure. Same root cause as "just opened."

---

## 4. Relationship to prior fixes (why this slipped through)

The earlier **"note cards flash stacked at top while typing"** fix (`MEMO_MARGINALIA_OMNI_FLASH.md`; live-pos
via `useLivePosResolver` / `resolvePos` at measure time) closed the **typing-time** staleness channel (a stale
*baked* `item.pos` after content shifts). It shares the **exact same downstream symptom** (negative natural →
clamp-to-0 → cascade stack) but a **different upstream cause**. The cold-load / unstable-initial-layout channel
was left open: `resolvePos` gives a correct PM *position*, but `coordsAtPos` of that correct position still
returns a wrong *pixel top* until the editor finishes laying out. **The two bugs converge on the clamp at
`:284` from opposite directions.**

---

## 5. Proposed deep fix (per the unified-architecture principle)

**One change, in `useInTextPositions` only → fixes every Omni card kind, both sides, and any future consumer.**
Reframe the measurement as a **settle-aware, self-validating lifecycle** instead of a fire-once read:

### Part A — Guarantee a corrective re-measure after layout settles (the core fix)
Add to the `useLayoutEffect` trigger set ([:321-374](src/hooks/useInTextPositions.ts:321)):

1. **`onFontReady(schedule)`** — reuse the existing helper at [`text-metrics.ts:231`](src/lib/text-metrics.ts:231)
   (already used this exact way by [`TextObjectGrabHandle.tsx:829`](src/text-objects/TextObjectGrabHandle.tsx:829)).
   Catches the FOUT reflow that moves every line.
2. **A bounded post-mount stabilization loop** — after the initial `measure()`, keep scheduling rAF
   re-measures until `naturalRef` (or `editorDom.scrollHeight`) is unchanged across 2 consecutive frames, or a
   small budget (~500 ms) elapses. This absorbs KaTeX / `expex` / figure / image async layout **generically**
   without enumerating each source. **Self-terminating** ⇒ zero steady-state cost (keystroke sanctity intact —
   it runs only during the load/settle transient, never on a keystroke).
3. *(optional)* also observe the editor **scroll container** with the RO, not just `editor.view.dom`.

### Part B — Stop trusting/painting a premature measure (hardening, avoids even one bad frame)
Replace the silent `if (naturalTop < 0) naturalTop = 0` at [:284](src/hooks/useInTextPositions.ts:284) with a
**degenerate-measure guard**: a strongly-negative *pre-clamp* natural for a non-top anchor is a sentinel that
the editor hasn't reached final layout. If the measure looks degenerate (e.g. ≥2 items whose pre-clamp natural
is well below 0, or all rendered items collapsing to an identical `0` while their `pos` values are widely
spread), **do not overwrite `naturalRef` / bump `measureVersion`** — keep the previous good naturals (or paint
nothing) and schedule a retry. Must NOT misfire on a *legitimate* all-top-anchored deck (those sit at
natural ≈ 0, **not** strongly negative — distinguish by pre-clamp sign/magnitude + `pos`-spread).

### Explicitly REFUTED / insufficient (save the cleaning session the detour)
- ❌ Bootstrapping `editorContentHeight` to nonzero — `podRect.top` is invariant to pod `minHeight` (§3b).
- ❌ Adding `editorContentHeight` to the `positions` `useMemo` deps **alone** — it re-resolves the cascade but
  does not re-**measure**, so it just re-runs against stale naturals.

### Lighter alternative (if minimal diff preferred)
Part A.1 (`onFontReady`) + a single double-rAF post-mount re-measure. Likely fixes the common font-swap case;
the stabilization loop (A.2) is more robust for NodeView/image async and is the recommended form.

---

## 6. Scope, blast radius, tests
- **Blast radius:** `useInTextPositions` is consumed by `OmniViewPanel` (left + right). No docked-panel impact.
- **Keystroke sanctity:** the stabilization loop is load/transient-only and self-terminating; verify
  `window.__virgilBusStats().emitCount` stays flat on typing and that no measure loop runs steady-state.
- **Repro doc:** the live agent could NOT reproduce on the current `doc_devtest` — it had been overwritten with
  a synthetic 60-plain-paragraph filler fixture with **no** KaTeX/expex/figures, so the editor reached final
  height on first paint (no reflow-after-paint to corrupt the measure). **To reproduce naturally, restore the
  real sample** (`rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest`) —
  it has `expex` examples + 14 citations + figures, i.e. real post-paint reflow — then hard-reload and watch
  the margin deck.
- **Regression test:** unit-test `resolveCascade` degeneracy guard (Part B) + a measurement-lifecycle test that
  a font-ready/settle ping re-runs `measure()` and corrects naturals.

---

## 7. Key code anchors
- [`src/hooks/useInTextPositions.ts`](src/hooks/useInTextPositions.ts): `:280` naturalTop, `:284` lossy clamp,
  `:127-176` cascade, `:321-374` trigger graph, `:389-421` card RO, `:426-429` positions memo deps.
- [`src/panels/Omni/OmniViewPanel.tsx`](src/panels/Omni/OmniViewPanel.tsx): `:489` hook call, `:534` pod
  minHeight, `:545-587` translateY render, `:567-582` pin-on-mousedown.
- [`src/lib/text-metrics.ts:231`](src/lib/text-metrics.ts:231) `onFontReady` (reuse) ·
  [`src/text-objects/TextObjectGrabHandle.tsx:829`](src/text-objects/TextObjectGrabHandle.tsx:829) (precedent).
- `src/lib/tiptap/doc-structure/observer-plugin.ts` `state.init()` — `buildInitial` emits no diff on load.
- Sibling diagnosis: `MEMO_MARGINALIA_OMNI_FLASH.md` (typing-time half of the same clamp convergence).

---

## 8. Open questions for the cleaning session
1. Does `editorDom.scrollHeight` reflect KaTeX/expex/figure dimensions *immediately* on NodeView mount or lag a
   layout pass? (Determines whether the RO alone could ever be made sufficient, or the settle loop is required.)
2. Mount-ordering: does `OmniHost`/`useInTextPositions` attach its RO *after* the editor's post-paint reflow has
   already completed on a fast load? (If yes, the RO can never catch it → settle loop / `fonts.ready` mandatory.)
3. Should Part B *skip rendering* degenerate-measure cards (blank margin for a frame) or *retain previous
   positions* (preferred — no flash)? Pick based on first-paint UX.
