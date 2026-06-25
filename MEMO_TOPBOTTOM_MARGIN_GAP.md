# BUG — Top/bottom margin slider can't collapse the white strip between text and the pod border

**Status:** `IMPLEMENTED` (shipped 2026-06-24, commit `c178218e`) · **⚠️ PARTIAL REGRESSION — see correction below**
**Filed by:** bug-catcher session, 2026-06-21
**Surface:** editor pod top/bottom vertical padding (margin-edit slider)

> ## ⚠️ CORRECTION (2026-06-24) — my "delete `--doc-top-extra`" recommendation was WRONG and caused a regression
> This memo's §3/§5 called `--doc-top-extra` (the +40px on the prose `pt`) **dead code** and recommended deleting it.
> It was **shipped** in commit `c178218e` (which correctly also lowered `MARGIN_MIN.top/bottom` → 0). **But git proves
> `--doc-top-extra` was NOT dead** — commit `244c5d60` (2026-06-15) added it deliberately, titled *"feat(editor):
> default healthy top space above the document title."* It was the **intentional one-off whitespace lead-in above the
> title**, just *implemented* as a fixed term inside the adjustable prose `pt` (which is why it also blocked the slider
> from reaching 0 — the real reason it looked vestigial). Deleting it removed that lead-in → **user-reported regression
> (item 2):** no whitespace above the title anymore.
>
> **The correct fix was to DECOUPLE, not delete:** keep `MARGIN_MIN→0` (so the adjustable margin reaches the pod edge —
> item 3, ✅ shipped), AND restore the one-off lead-in as a **separate, scroll-away space above the title that is NOT
> part of `--editor-pt`**. Full reconciled plan for items (2)+(3) is in **§10** below. My §3 claim "it is almost certainly
> a vestige of the removed top-gutter (backlog #5)" was the analysis error: the top-gutter was removed 2026-06-13
> (`1cac8e2a`), but `--doc-top-extra` was added *separately and later* (2026-06-15) as a new feature.

---

## 1. Symptom (user + screenshot of the pod top edge)

There's a strip of white between the text and the pod border (top **and** bottom) that feels like wasted space. The
user wants the top/bottom **margin setting** to be able to go all the way to the pod's top/bottom edge — i.e. the
slider should collapse that gap to ~0.

---

## 2. The vertical stack (verified) — and why top looks more padded than bottom

Prose padding ([Editor.tsx:504](src/components/Editor.tsx:504)):
`pt = calc(var(--editor-pt,40px) + var(--doc-top-extra,40px))` · `pb = var(--editor-pb,40px)`.

| | Slider var | Fixed extras | Default gap | At slider-min |
|---|---|---|---|---|
| **TOP** | `--editor-pt` (def 40, **floor 24**) | **`--doc-top-extra` = 40px** + ~8px cap-inner | **~80px** + cap | **~64px** + cap |
| **BOTTOM** | `--editor-pb` (def 40, **floor 24**) | ~8px cap-inner (no `--doc-bottom-extra`) | **~40px** + cap | **~32px** + cap |

So the **top is ~40px more padded than the bottom** — that asymmetry is itself a giveaway.

---

## 3. Root cause (three pieces, two of them fixable)

1. **`--doc-top-extra` = 40px is DEAD CODE.** It's read with a 40px default at [Editor.tsx:504](src/components/Editor.tsx:504)
   but is **never assigned anywhere** in the codebase (two independent repo-wide greps incl. `.css` and the `setProperty`
   sites → 1 match, the consumer only). So it's a permanent, slider-uncontrollable **+40px** locked onto the top — the
   **primary wasted strip**, and the reason the top is more padded than the bottom. It is almost certainly a vestige of
   the **removed top-gutter subsystem** (backlog #5). ← biggest, easiest win.
2. **`MARGIN_MIN.top = 24`, `MARGIN_MIN.bottom = 24`** ([useMarginEdit.ts:77-78](src/hooks/useMarginEdit.ts:77)) is the
   hard slider floor (clamped `Math.max(min, …)`) — even after removing the dead extra, the slider can't go below 24px.
3. **`--pod-cap-inner` ≈ 8px is irreducible and NOT wasted space** — it's the rounded-corner arc + box-shadow mask
   ([EditorPane.tsx:4744](src/components/EditorPane.tsx:4744)). This ~8px is the *physical* minimum gap (text can't
   literally touch a rounded border). The fix must **preserve** it — this is the backlog #5 trap (don't touch the cap's
   negative-margin net-zero geometry or the `[data-pod-frame]` box-shadow ring).

---

## 4. Load-bearing — DO NOT TOUCH (backlog #5 trap)
The sticky caps and frame ring draw the pod and mask its box-shadow via **net-zero-flow negative margins**:
- Top cap `[data-editor-pod-cap]` ([EditorPane.tsx:4918-4958](src/components/EditorPane.tsx:4918)) + 8px white inner.
- Bottom cap `[data-editor-pod-cap-bottom]` ([:5527-5561](src/components/EditorPane.tsx:5527)) + 8px white inner
  (hidden when the doc fits the viewport via `--cap-bottom-display`).
- Pod frame ring `[data-pod-frame]` ([:4976-5010](src/components/EditorPane.tsx:4976)) — the sole border + box-shadow.
- The margin-edit guide overlay already reads `--pod-cap-inner` dynamically, so it auto-adapts.

**The fix changes only prose padding + the slider floor — none of the cap geometry.**

---

## 5. Deep fix (the slider becomes the single control of the gap)

1. **Delete the dead `--doc-top-extra`** ([Editor.tsx:504](src/components/Editor.tsx:504)):
   `pt-[calc(var(--editor-pt,40px)_+_var(--doc-top-extra,40px))]` → `pt-[var(--editor-pt,40px)]`.
   Removes the permanent 40px, makes the top fully slider-controlled, **and restores top/bottom symmetry** (top default
   drops 80→40, matching the bottom). This single change is most of the perceived "wasted space" win.
2. **Lower the slider floor** ([useMarginEdit.ts:77-78](src/hooks/useMarginEdit.ts:77)): `MARGIN_MIN.top` and
   `.bottom` from `24` → **`0`** (left stays 72, right stays 24). Now the slider can drive the gap down to the
   irreducible ~8px cap-inner.
3. **Preserve** `--pod-cap-inner` (8px) and all cap/frame geometry (§4) — untouched.

Net: the top/bottom margin slider ranges 0→240 and the gap collapses to ~8px (the rounded-corner floor) — "all the way
to the edge" in practice. The grep confirms nothing else reads `MARGIN_MIN.top/bottom`, so lowering the floor is local.

---

## 6. Design decisions (the only open calls)
- **Floor 0 vs 8.** `0` lets the user drag to the true minimum (residual ~8px = the corner arc; there's **no dead
  slider travel** because every px of `--editor-pt/pb` adds above the 8px cap). `8` makes the slider's labeled "min"
  equal the physical floor. **Recommend 0** — the user asked to go "all the way," and `0` delivers the minimum the pod
  geometry allows. Either is safe.
- **Default margin.** Removing `--doc-top-extra` already tightens the **top default 80→40** (now symmetric with the
  bottom), which likely addresses the screenshot's padded look. Whether to also lower the *shared* default below 40 (so
  new docs open tighter) is a separate aesthetic call — flag for the user. Keeping 40 means existing saved prefs render
  identically.

## 7. Risk / the one thing to live-verify
- **Low/medium, surgical (2 lines).** Cap/frame/box-shadow geometry is untouched (§4); the clamp + symmetry-snap logic
  ([useMarginEdit.ts:317-422](src/hooks/useMarginEdit.ts:317)) is unchanged and still works for symmetric & asymmetric Y.
- **LIVE-VERIFY (the one real check):** with `--doc-top-extra` removed **and** `--editor-pt` at min, confirm the **first
  line doesn't tuck under the sticky toolbar/cap** when scrolled to the top. The agents reason the sticky chrome
  reserves its own space (`--chrome-top` + cap, independent of prose padding) so it's safe — but `--doc-top-extra`'s
  name hints it once provided that clearance, so verify in the preview at min top-margin + scroll-to-top. If clearance
  is needed, fold a small fixed amount into the cap/`--chrome-top`, NOT back into a dead prose var.
- **Confirm dead:** two greps found no assignment of `--doc-top-extra`; a final `setProperty('--doc-top-extra'` /
  template-literal sweep before deleting is cheap insurance.
- **Tests:** assert the slider can reach 0 on top & bottom; that `pt` no longer includes `--doc-top-extra`; symmetry
  snap still equalizes at low values.

## 8. Files
- [src/components/Editor.tsx:504](src/components/Editor.tsx:504) (remove `--doc-top-extra` from `pt`).
- [src/hooks/useMarginEdit.ts:74-79](src/hooks/useMarginEdit.ts:74) (`MARGIN_MIN.top/bottom` → 0).
- [src/components/EditorPane.tsx](src/components/EditorPane.tsx) (cap/frame geometry — **read-only reference, preserve**).

## 9. Open questions
1. Floor `0` or `8` (§6)? Recommend 0.
2. Lower the shared default below 40, or keep 40 (top already tightens to 40 via the dead-var removal)?
3. Live-verify: does the first line clear the sticky toolbar/cap at min top-margin + scroll-top (§7)?

---

## 10. RECONCILED PLAN (2026-06-24) — items (2) restore lead-in + (3) reach the pod edge · `PLAN-READY`

The two top-whitespace concerns are **separate mechanisms** and must be decoupled (the original memo conflated them in
one `pt` calc). Current shipped state (`c178218e`): `pt = var(--editor-pt,40px)` only; `MARGIN_MIN.top/bottom = 0`; the
sticky reading-frame mask height = `--editor-pt` ([EditorPane.tsx:4871](src/components/EditorPane.tsx:4871)).

### Item (3) — adjustable margin reaches the pod edge · **largely SHIPPED** + ⚠️ a SECOND gap source (user hint 2026-06-24)
With `MARGIN_MIN.top = 0`, the adjuster's extreme drives `--editor-pt` → 0, so the prose `pt` **and** the sticky
reading-frame mask (`height: var(--editor-pt)`) both go to 0 → text scrolls to the pod's inner edge. One residual is the
irreducible **~8px `--pod-cap-inner`** (the rounded-corner + box-shadow mask floor — §4 load-bearing, do not touch).

> **⚠️ USER HINT — the prime suspect for the residual band: the expand/collapse-all controls strip.**
> The user flagged that the gap "may be created by the strip that the appear-on-mouse collapse/expand button is on …
> you'll have to work around it." **That strip is the sticky expand-all / collapse-all sections control at
> [EditorPane.tsx:5196-5224](src/components/EditorPane.tsx:5196):** a `<div className="sticky z-20 shrink-0 group"
> style={{ top:0, height:24, marginBottom:-24 }}>` hosting the hover-revealed (`opacity-0 group-hover:opacity-100`)
> double-chevron expand/collapse-all buttons. It sits at the very top of the pod (above `paper-render`), so it's exactly
> in the band where item-3 wants text flush.
>
> **Why it's the suspect:** it fakes "zero flow" via `height:24` + `marginBottom:-24` (a fragile hack), and it carries
> `shrink-0` — a **flex-only** hint — yet there is **no CSS rule for `.editor-pane-pod`** (verified), so its children
> are *block* flow. In block flow the net-zero *should* hold (24 − 24 = 0); but if any ancestor/wrapper makes that row a
> **flex column**, a flex `gap` is **NOT** cancelled by the negative margin, leaving a band up to ~24px (which matches a
> visible white band far better than the 8px cap). The `shrink-0` strongly implies the author once assumed flex — so the
> net-zero is the fragile part.
>
> **Work-around (recommended, robust):** make this strip **genuinely zero-flow** — `position:absolute; top:0` (truly out
> of flow) instead of `sticky + height + negative-margin`, OR move the hover-revealed expand/collapse-all chevrons into
> an existing absolute overlay. Then it can never contribute to the top gap regardless of the parent's display/gap, and
> item (2)'s lead-in + item (3)'s reach-the-edge both stop fighting a phantom 24px band. **Verify live:** in the preview,
> temporarily set that strip to `display:none` (or `position:absolute`) at max top-margin and measure the gap — that
> isolates how much of the band is the strip vs the 8px cap.

**Also live-verify (orthogonal):** if the leftover band ≈ 8px after neutralizing the strip, that's the corner floor
(can't remove without squaring the pod corner). If still large, the user may be on a build **predating `c178218e`**
(deploy lag), or the slider's "highest position" doesn't map to `--editor-pt=0` (check the margin-edit clamp/range).

### Item (2) — restore the one-off lead-in above the title · **the regression fix**
Restore the deliberate "healthy top space above the document title" (commit `244c5d60`) as a **scroll-away, one-off**
space that is **independent of `--editor-pt`** (so it does NOT reintroduce a per-view band and does NOT block item 3):
- **Recommended:** a dedicated lead-in above the first block — e.g. a `.tiptap::before` pseudo-element (or a
  `pointer-events:none` spacer as the first flow child) of fixed height (~40px, the old value), **not** added into the
  adjustable prose `pt`. Keep the existing `:where(.tiptap) > :first-child { margin-top: 0 }` rule and ensure the
  lead-in isn't suppressed by it.
- **Do NOT** re-add `--doc-top-extra` into the `pt` calc (that's exactly what re-blocks item 3). Decouple it.
- Gate per surface: confirm whether the read-only **library Reader** wants the lead-in (likely yes for parity, but
  verify it doesn't double up with the Reader's own chrome).
- One-off = appears once at document start (above the title) and scrolls away — **not** reduplicated per page/screen
  (the user's explicit constraint).

**Net result:** top of doc shows a substantial lead-in above the title (item 2 ✓); the adjustable margin still collapses
to the pod edge as you scroll / at max adjuster (item 3 ✓); the two never fight because the lead-in is one-off and the
band is adjustable.

**Open calls:** lead-in mechanism (`::before` vs spacer child) + exact height (40 vs tuned); apply in Reader?; and the
item-3 live-verify above (is the user's band the 8px cap, or pre-`c178218e` deploy lag?).
