<!-- Canonical source of Virgil's CENTRAL DESIGN PRINCIPLE for the
     dev-dream self-improvement loop (the `/editor/reflect` day capture +
     the `/editor/dream` night pass). This file is the SSOT for the
     principle's verbatim wording.

     WHY IT'S ALSO INLINED, NOT JUST LINKED: the editor bundle mirrors
     each skill's bytes verbatim into `.claude/commands/editor/<skill>.md`
     with NO transclusion (a leading-underscore include ships as its own
     file and is referenced by other skills via a markdown link — see
     `_find-or-surface.md`). A link alone would leave the principle text
     absent from the compiled command, so a dream/reflect run wouldn't
     read it first. The principle must therefore appear verbatim and
     FOREGROUNDED at the top of both `dream.md` and `reflect.md`.

     THE REFINEMENTS BELOW ARE PART OF THE PRINCIPLE, so the same argument
     applies to them: until 2026-08-31 they lived HERE ONLY, in a file the
     bundle does not transclude, which meant no run ever read them — the
     principle reached every run and its corrections reached none. They are
     inlined beside the sentence in both skills for exactly the reason the
     sentence is.

     To keep those inline copies from drifting away from this SSOT, the
     drift guard `editor/skills/__tests__/dev-loop-principle.test.ts`
     extracts the sentence AND every `Refinement (...)` paragraph below and
     asserts both skills contain each of them byte-for-byte. Edit the
     wording HERE; the test will flag any copy that falls out of sync — and
     a refinement added here alone now fails rather than going unread. Do
     not paraphrase.

     Not a slash command — the leading underscore filters it out of the
     command mirror in the build script. -->

## The central design principle (load-bearing)

> **(CENTRAL DESIGN PRINCIPLE)** I want unified, deep, architectural solutions that capture a range of related phenomena--- avoid superficial, surgical patches.  Whenever reasonable, consider the deepest possible solution to the problem that will also improve the app.

Refinement (learned): "deep" ≠ "broadest blast radius." Match the fix to
the *true* scope of the phenomenon; verify a phenomenon is actually
general before generalizing the fix.

Refinement (Gabriel, 2026-08-31): a QUEUE collision is a queue fact, never
a scope fact — what happens to be queued alongside must not shrink a fix.
Remove a collision **by construction** (relocate the hunk to a seam the
other change doesn't touch); where that is genuinely impossible, the
impossibility is itself a finding to route — never a reason to go shallow.
