# Bug: clicking an Outline section arms the panel-move drag (blue dock halo) instead of jumping

**Status:** `ROOT-CAUSE-FOUND` / `FIX-READY` (hardened; **fix re-scoped per user steer 2026-06-25 — see "Re-scoping"**) — diagnosis only, NOT implemented. Bug-catcher session 2026-06-25; traced + adversarially verified.
**Confidence:** HIGH on root cause + the fix; MEDIUM-HIGH on the "jump is swallowed" half (depends on click jitter — see Dual nature).
**Worktree:** TBD (the re-scoped fix touches the shared `Panel` wrapper + Outline; a fresh worktree, with a live feel-check).

---

## ⭐ Re-scoping (user steer — supersedes the original "general threshold" recommendation)

> User: *"Outline is a distinctive panel, unlike others. The deep fix here may be Outline-panel-specific, if it is arising from Outline-specific issues."*

**Correct, and confirmed by the code.** The bug arises precisely BECAUSE Outline is distinctive: it is **the only content-bodied *docked* panel.** Every other docked panel's body is `[data-card]` cards (Citations/Notes/Todo/Reports/Cutter/Revisions/Examples/Footnotes/Bibliography/Archive/Errors → all have card-based bodies). Only **Outline** and **Search** render non-card content — and they are exactly the two `Panel` `variant="raw"` panels ("own their own scroll element", [Panel.tsx:10-11](src/panels/_shared/Panel.tsx:10)).

The FloatingPanel "whole body is a drag handle, minus the `[data-card]` blocklist" model was **designed around card panels**: cards block the drag (press a card → lift it), and only the inter-card gaps / header drag the window. That model is coherent for card panels and **structurally wrong for a content panel** — Outline has no cards to block and no "gap background", so its entire interactive body falls through to the window-drag. So the general "add a threshold to FloatingPanel" fix (below, now **demoted**) was over-reach: it would change drag-arming feel for all 11 card panels + churn the blocklist test, to fix a problem that is really only Outline's (and Search's).

**The right-scoped deep fix → see "Recommended fix (re-scoped)".** It lives at the `Panel` content/header boundary and captures the real `{Outline, Search}` content-panel cluster, leaving card panels untouched.

---

## Request (user)

> "In the Outline panel, each time I click a section (to jump), it interprets it as grabbing the panel to drag it, triggering the blue halo, etc."

---

## Root cause: a zero-threshold whole-body window-drag, and Outline rows aren't on the drag blocklist

Docked panels are rendered as `<FloatingPanel mode="docked">` portaled into the band anchor ([panel-column.tsx:197](src/components/editor-layout/panel-column.tsx:197); the Outline instance is wrapped by EditorPane). In `FloatingPanel`, the panel-move drag handler `onHeaderMouseDown` is attached to a div that **wraps the entire panel body** `{children}` with `cursor: grab` — there is **no separate header strip** ([FloatingPanel.tsx:728-734](src/components/FloatingPanel.tsx:728)). So a press *anywhere* in the panel body is a candidate drag.

The only thing that stops a press from arming the drag is `WINDOW_DRAG_BLOCK_SELECTOR` = interactive controls + `[data-card]` ([drag-blocklist.ts:26-38](src/lib/drag-blocklist.ts:26)). **Outline rows are plain `<div onClick>`** ([OutlinePanel.tsx:727-731](src/panels/Outline/OutlinePanel.tsx:727), [:810-824](src/panels/Outline/OutlinePanel.tsx:810)) — not `button`, not `[data-card]`, not `[data-no-window-drag]` — so they fall through and the press arms the window-drag.

And the arming is **zero-threshold**: on mousedown in docked mode, `onHeaderMouseDown` immediately calls `setDockDragTarget(sourceGhost)` ([FloatingPanel.tsx:557](src/components/FloatingPanel.tsx:557)) — which is exactly what `DockOutline` (the blue halo) consumes via `useDockDragTarget` ([DockOutline.tsx:38-39](src/components/editor-layout/DockOutline.tsx:38)). No movement is required; the halo lights on press.

**Why only the Outline panel:** every other docked panel's body is `[data-card]` cards (blocklisted → a press lifts the card, not the window). The Outline panel is the only main docked panel whose body is **non-card interactive content**, so it's uniquely exposed. This is the *same class* as "bug #36" ([drag-blocklist.ts:30-36](src/lib/drag-blocklist.ts:30) admits "the window-drag armed with zero threshold and won the race"), which was patched **only for cards** by appending `[data-card]` — a surgical band-aid that never addressed the zero-threshold fragility.

## Dual nature (it's not purely cosmetic)

`onHeaderMouseDown` calls `e.preventDefault()` ([:575](src/components/FloatingPanel.tsx:575)), but `preventDefault` on **mousedown does NOT cancel the synthetic click**, and there is no `stopPropagation`/click-suppress anywhere in `FloatingPanel`. So:
- **Dead-still click (0px):** drag arms, halo flashes on at mousedown and clears on mouseup, **and the row `onClick` (jump) still fires.** → a spurious halo flash.
- **Click with ≥1px jitter (the common real case):** the undock check at [FloatingPanel.tsx:295](src/components/FloatingPanel.tsx:295) (`if (dx===0 && dy===0) return;` — i.e. fires on the *first* pixel) flips the panel docked→floating and `setPos` moves it under the cursor → `mouseup` lands on a different element → **the jump is swallowed.**

So the user sees the halo always, and intermittently the jump fails entirely. A movement threshold absorbs exactly this jitter.

---

## Recommended fix (re-scoped) — content panels drag by their HEADER, body is inert

**Drag a content panel by its `PanelHeader` (title bar), not its body.** In the shared `Panel` wrapper, mark the content/scroll region of `variant="raw"` (content) panels with `[data-no-window-drag]` (the existing opt-out already in `INTERACTIVE_CONTROL_SELECTOR`, [drag-blocklist.ts:27](src/lib/drag-blocklist.ts:27)). The `PanelHeader` — rendered as a sibling **above** the body ([Panel.tsx](src/panels/_shared/Panel.tsx)) and already inside FloatingPanel's drag region — stays draggable, so **undock still works by dragging the panel's title bar** (the conventional window model; no new grip needed). A press on an Outline row now `closest()`-es the inert body → `onHeaderMouseDown` bails at [FloatingPanel.tsx:522](src/components/FloatingPanel.tsx:522) → the row's `onClick` (jump) fires, no drag armed, no halo — at 0px AND with jitter (both failure modes die, since the drag never arms at all).

**Why this is the deep, *grounded-scope* fix:**
- It captures the real cluster — content-bodied (`raw`) panels: **Outline + Search** — in ONE place (the `Panel` primitive), so the next content panel inherits the correct behavior automatically. Not a per-element band-aid (the bug-#36 `[data-card]` shape), not a global threshold change that touches all 11 card panels.
- It honors the actual archetype distinction the codebase already encodes (`variant="list"` card-bodied vs `variant="raw"` content-bodied): **card panels drag from gaps + header and lift cards; content panels drag from the header only.** That is the correct mental model — a content panel's body is for reading/clicking, its title bar is for moving — and it leaves card-panel behavior completely untouched.
- It resolves the earlier "Outline has no other undock affordance" concern: the affordance is the **header** (we mark only the body inert, NOT the header).

**Implementation note:** for `variant="raw"`, the body is "rendered as direct children with no scroll wrapper" ([Panel.tsx:11](src/panels/_shared/Panel.tsx:11)) — so add a `data-no-window-drag` wrapper (or stamp the attribute on the raw body container). Verify the `PanelHeader`'s own empty/title area (outside its buttons) remains draggable so undock is discoverable; the header buttons are already `INTERACTIVE_CONTROL_SELECTOR`-blocked, which is correct.

**Tests:** clicking an Outline row jumps and never flashes the dock halo / never undocks (0px and with jitter); dragging the Outline panel's **title bar** still undocks; Search inherits the same (content body inert, header drags). No change to `float-window-drag-blocklist.test.tsx` is required (the global threshold is no longer in scope).

### Demoted — the general threshold (now a SEPARATE, optional polish, NOT this bug's fix)
The original recommendation was to give FloatingPanel's window-drag a ~5px movement threshold (mirroring `CARD_LIFT_THRESHOLD = 5`, [panel-primitives.tsx:1860](src/components/panel-primitives.tsx:1860)) by moving `setDockDragTarget` ([:557](src/components/FloatingPanel.tsx:557)), the drag-state arming ([:559](src/components/FloatingPanel.tsx:559)), and the `userSelect/cursor='grabbing'` writes ([:573-574](src/components/FloatingPanel.tsx:573)) out of mousedown into a `dx²+dy²≥25`-gated `mousemove`. **Per the user steer, this is decoupled from the Outline bug** — with the content body inert, Outline no longer arms the drag at all, so the threshold isn't needed to fix it. The threshold only addresses a *residual, minor* general jank: a press on a **card panel's inter-card gap** still flashes the halo at 0px ([float-window-drag-blocklist.test.tsx:117-130](src/components/__tests__/float-window-drag-blocklist.test.tsx:117) asserts "background DOES arm"). Worth doing on its own merits as polish (it would also rewrite that test + needs the watch-outs: fold the [:295](src/components/FloatingPanel.tsx:295) undock into the same gate; verify floating-move feel; `beginDragAt` [:582-597](src/components/FloatingPanel.tsx:582) is untouched), but it is NOT required for this report and should not be bundled.

### Surgical alternative (inferior — recorded for completeness)
Tag just the Outline rows `[data-no-window-drag]` (not the whole body). Works for the rows but leaves the thin inter-row gaps + any non-row body area draggable (fragile), and doesn't generalize to Search. The header-inert-body approach above is the same mechanism done at the right (Panel) altitude.

---

## Tests
- **Rewrite:** [float-window-drag-blocklist.test.tsx:117-130](src/components/__tests__/float-window-drag-blocklist.test.tsx:117) — the "background DOES arm" case asserts `defaultPrevented===true` + `cursor==='grabbing'` **at mousedown with no movement**; both become false under the threshold. Reassert arming only after a ≥5px `mousemove`. (The companion `[data-card]` "does NOT arm" case still passes.)
- **Add:** docked-mode mousedown→mouseup at 0px (and 3px) does NOT call `setDockDragTarget` and a row `onClick` fires; a ≥5px move DOES arm + light the halo. (Outline-specific integration: clicking a section row jumps and never flashes the dock halo.)

## No second cause
The halo has exactly one producer (`setDockDragTarget`). The Outline focus-mode `draggable`+`onDragStart` ([OutlinePanel.tsx:1047-1050](src/panels/Outline/OutlinePanel.tsx:1047)) is a separate edit-mode reorder DnD (no `setDockDragTarget`); the root `onMouseDown={onFocus}` ([FloatingPanel.tsx:726](src/components/FloatingPanel.tsx:726)) is just LRU focus tracking. Neither produces the halo.

## Repro
Dock the Outline panel; click any section row → the blue dock-socket halo flashes (and, if the press carries any motion, the panel may undock/jump and the section jump is lost). Other panels (Citations/Notes — card bodies) don't, which isolates it to the non-card body falling through the drag blocklist.
