<!-- last-verified: 68f6ffe6 2026-09-21 -->
<!-- derives-from: AGENTS.md#laws -->

# Escape means cancel

> **Escape ABANDONS. It is never the key that saves, and it is never a synonym for whatever a click elsewhere would have done.** Wherever a surface or a field can END in more than one way, the endings are separate CHANNELS with separate names — a COMMIT (a button, Return), a DISMISS (click-away, blur), and a CANCEL (Escape, and any control whose own label names Escape). Two of those may coincide; they may never be *forced* to coincide by sharing one prop.

The defect this law names is not a wrong decision — it is an **undecided** one. Escape is folded into a close channel that already existed, nobody states what it should mean, and the affordance the user reaches for to back out becomes the fastest way to commit. Both halves below shipped green under every test the repo had, because each site's tests spelled the ending the same way the site did.

## The field half (task 555)

Five fields were filed as presenting Escape as a cancel while actually committing; checking the list against the memo-era commit found the real population was **one** — `CitationCard`'s Code box, which holds a draft *and* debounces a write behind it. It ended Escape through the same handler as Enter (`e.key === "Enter" || e.key === "Escape"`), and that aliasing is precisely what had removed it from task 529's census: a handler naming both keys was classified as a field whose `onChange` commits every keystroke, for which the alias is harmless. **An alias is what takes a site OUT of the population**, so the one field where the alias was a lie was the one field the guard could not see.

The remedy is 529's door, not a third spelling: Escape drops the pending debounced write, restores the command the session *opened* with (an earlier debounce may already have landed), and ends the session exactly once. The census that replaced the hand list DISCOVERS the aliasing population and pins it as an exact set with each member's reason. CI: `citation-code-escape-cancel.test.tsx`, `field-edit-session.test.tsx`.

Two corollaries the same sweep fixed, both in [a-nodeview-owns-its-timers-lifetime.md](a-nodeview-owns-its-timers-lifetime.md): a cancel must undo what **the session** did and never what someone else did (the baseline moves with a foreign write), and a session that ends by UNMOUNT ends zero times unless the component's lifetime scope ends it, because React dispatches no `blur`.

## The surface half (task 687)

A floating surface ends through three exits — DISMISS (click-outside), CANCEL (Escape, the header ×), COMMIT (a button, Return). [`useMenuDismiss`](../../../src/components/menu/useMenuDismiss.ts) routed the first two through one `onClose` prop, which is harmless for ~20 menus that stage nothing: with no draft in hand, dismissing and cancelling are the same act.

Then a **deferred-commit** surface arrived. `CitationCreatePopover` stages citekeys and materializes the `\cite` only on commit — and committing on click-away is a deliberate, good design there (the user built a citation and went elsewhere; they get it). So it bound the commit chokepoint to the one close channel it was given, `onClose={commitAndClose}`, and **Escape inserted the citation the user pressed it to abandon**, with no way out short of removing every staged chip by hand. Nothing decided that; a prop was reused.

The fix is a channel split at the primitive, not at the popover: `useMenuDismiss` and `MenuProvider` take an `onCancel` that Escape ends through, **defaulting to `onClose`** so every existing menu is byte-identical, and `BibEntryPickerMenu` → `CitekeyPicker` forward it. A picker's header × goes through the cancel door too — its label reads "Close (Esc)", so it must do what Escape does (the 386/389 "a key must do what its affordance says" family). What a cancel deliberately does **not** undo: staging a library-only key calls `onAddBibEntry` at *pick* time, so an abandoned pick can leave a row in `references.bib`. An uncited BibTeX entry is inert; removing one on an abandon path is a bib mutation that could delete a key cited elsewhere.

**The census discovers its population by the QUESTION, not by a mechanism** (task 404's rule): *which JSX element hands its close channel a function that COMMITS?* Any such element must also hand over a distinct `onCancel`. Not "every element with an `onClose`" — that is the whole menu system, and an allowlist of surfaces that stage nothing is a filing cabinet, not a guard. Stated residual: a commit bound through an identifier named for its subject rather than its verb (`onClose={finish}`), or wrapped inline, is invisible to the text scan and is answered by the MECHANISM legs instead.

CI: [escape-means-cancel-census.test.ts](../../../src/components/menu/__tests__/escape-means-cancel-census.test.ts) (the population leg + the two mechanism legs), `useMenuDismiss.test.tsx` (Escape → cancel, click-outside → dismiss, fallback, the two-stage interceptor still outranking both), `bib-entry-picker-combobox.test.tsx`, and [citation-create-popover-escape-cancel.test.tsx](../../../src/panels/Citations/__tests__/citation-create-popover-escape-cancel.test.tsx) — which drives the REAL chain with a REAL window Escape, because `useMenuDismiss` owns a capture-phase window listener and stops the event before the picker's own keydown handler ever sees it: a mocked picker cannot witness this claim.
