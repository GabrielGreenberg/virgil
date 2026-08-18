# Omni cards overlap vertically (dense anchors + late-laid-out previews) — 2026-06-30

Bug-catcher session. Research only — **no code edited** (checkout live-driven,
HEAD 1b776636). For the bug-cleaning session.

## Status: `ROOT-CAUSE-FOUND` (high confidence)

**Symptom (screenshot):** in the right-margin **omni** column, note/archive cards
**overlap vertically** — each card's header covers the previous card's body. Context:
the cards are anchored to consecutive **list items** (a "Contributions" bibliography
list), and several notes have **long multi-line body previews** ("Pair: (a)… (b)…").

## Root cause — the cascade is fed stale, too-small card heights (no per-card ResizeObserver)

Omni cards are absolute-positioned in a column by a push-down cascade, not normal
flow. The cascade ([`resolveCascade`, useInTextPositions.ts:222-263](src/hooks/useInTextPositions.ts#L222)) sorts cards by anchor Y and, forward-pass, forces
`rows[i].top ≥ prev.top + prev.height + MIN_GAP` ([:240](src/hooks/useInTextPositions.ts#L240)). **So overlap is only possible if `prev.height` is smaller than the card's actual rendered height.**

Each card's `height` is measured with `getBoundingClientRect()` inside `measure()`
([:465-471](src/hooks/useInTextPositions.ts#L465)), which re-runs on a fixed set of
triggers wired in the effect at [:516-668](src/hooks/useInTextPositions.ts#L516):
editor-DOM ResizeObserver ([:649-654](src/hooks/useInTextPositions.ts#L649)), window
resize, `document.fonts.ready`, DocStructureBus structural events, items-list change,
and a **bounded** post-mount settle loop.

**The ResizeObserver observes ONLY `editor.view.dom`** — there is **no per-card
ResizeObserver** on the `[data-omni-entry-wrapper]` elements. So when an individual
card's height changes **after** those triggers — its rich body preview
(`BorrowedMainText` / multi-line note preview), a lazily-hydrated inline atom, or a
font swap laying out taller *after* the settle window ends — **nothing re-triggers
the cascade.** It keeps the smaller height captured earlier, and the forward-pass
under-allocates, so the next card overlaps the now-taller one. A change to a margin
card's own height does not change the editor content height, so the editor RO never
fires for it. (The hook's own comments at [:113](src/hooks/useInTextPositions.ts#L113)/[:340](src/hooks/useInTextPositions.ts#L340)/[:675](src/hooks/useInTextPositions.ts#L675) *refer to* "per-card ResizeObservers" as if they exist — but the code wires only the editor RO. Latent doc/code mismatch.)

**Why it shows here specifically:** (1) many cards anchored to close-together list
items → the cascade is doing dense real stacking (not one card per screen), so any
height error compounds; (2) the note previews are long/multi-line → their true
rendered height substantially exceeds whatever was captured at the last editor-
triggered measure.

**Secondary contributor:** the `DEFAULT_ENTRY_HEIGHT = 60` fallback ([:95](src/hooks/useInTextPositions.ts#L95)) is used for any card whose anchor is **outside the ±`NEAR_ZONE_PX` (600px) viewport gate** ([:432-471](src/hooks/useInTextPositions.ts#L432)) — 60px is far shorter than a typical multi-line omni card, so an out-of-near-zone card under-allocates until scrolled near. In a long dense list some cards can sit at 60px.

## The bug family (reactive geometry with incomplete re-measure triggers)

This is the third bug this session in the marginalia/omni geometry layer, all the
same shape — **geometry measured in a bounded/triggered window, not re-observed when
the measured element's own layout changes late:**
- [[note_marginalia_jump_2026_06_30_status]] — note markers jump up on a settle re-measure (branch/reference flip).
- batch item (2) — notes anchor to the divider.
- **this** — omni cards overlap because per-card height changes aren't observed.

## Deep fix

**Add a per-card ResizeObserver in `useInTextPositions`** that observes each rendered
`entry` wrapper (`[data-omni-entry-wrapper="<id>"]`) and calls `schedule()` on any
size change, so the cascade **self-corrects** whenever a card's true height changes —
no matter how late its preview/atoms/fonts lay out. This aligns the code with what
its own comments already assume, and makes the cascade robust by construction (it
always packs by the current measured height). Keystroke-sanctity is preserved: the RO
fires only on real card size changes (not per keystroke), `measure()` is RAF-coalesced
and change-gated (`setMeasureVersion` only bumps when a natural actually changed,
[:498-513](src/hooks/useInTextPositions.ts#L498)), so it cannot loop on typing.

Complementary hardening: (a) raise/kill the too-small `DEFAULT_ENTRY_HEIGHT` reliance
by measuring a card's height once it enters the near zone (already done) AND re-running
when it grows (the per-card RO); (b) optionally extend the settle loop to key off card-
height stability, not just editor stability.

**Surgical (if not adding the RO):** re-run `measure()` after the omni cards' previews
have laid out — e.g. a one-shot RAF (or `requestIdleCallback`) after mount/items-change
that re-measures once previews render, and/or observe `panelScrollRef.current`
(the pod) with a ResizeObserver so the pod's own content-driven size change re-triggers.
But the per-card RO is the real, self-correcting fix.

## Live-verify (dev preview OK; also real FSA per [[anchor_persistence_dev_masks_fsa]])
- Open a doc with a dense list where several items carry notes with **multi-line** body previews (the screenshot's "Contributions" list is the exact repro); confirm the omni cards overlap.
- Instrument: log `resolveCascade` inputs (`rows` id/top/height) — confirm the overlapping cards' `height` is smaller than their live `getBoundingClientRect().height` (stale) or equals `DEFAULT_ENTRY_HEIGHT=60` (fallback).
- Confirm a forced re-measure (resize the window a hair, or toggle the panel) makes them re-cascade and **stop overlapping** — that proves the missing trigger is the cause.
- After the fix: cards pack with `MIN_GAP` and never overlap regardless of preview length; verify typing leaves `__marginaliaStats`/measure counters flat (no per-keystroke re-measure loop).
