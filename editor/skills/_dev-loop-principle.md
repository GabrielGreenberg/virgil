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

     To keep those inline copies from drifting away from this SSOT, the
     drift guard `editor/skills/__tests__/dev-loop-principle.test.ts`
     extracts the sentence below and asserts both skills contain it
     byte-for-byte. Edit the wording HERE; the test will flag any copy
     that falls out of sync. Do not paraphrase.

     Not a slash command — the leading underscore filters it out of the
     command mirror in the build script. -->

## The central design principle (load-bearing)

> **(CENTRAL DESIGN PRINCIPLE)** I want unified, deep, architectural solutions that capture a range of related phenomena--- avoid superficial, surgical patches.  Whenever reasonable, consider the deepest possible solution to the problem that will also improve the app.

Refinement (learned): "deep" ≠ "broadest blast radius." Match the fix to
the *true* scope of the phenomenon; verify a phenomenon is actually
general before generalizing the fix.
