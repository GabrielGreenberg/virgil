# BUG — Top/bottom margin slider can't collapse the white strip between text and the pod border

**Status:** `ROOT-CAUSE-FOUND` / `PLAN-READY` (2-line fix + one design decision; one live-verify) · confidence **high**
**Filed by:** bug-catcher session, 2026-06-21
**Surface:** editor pod top/bottom vertical padding (margin-edit slider)
**Repo note:** diagnosis only (no source edits). Unrelated to the `keep-alive` worktree; whoever implements picks the worktree.

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
