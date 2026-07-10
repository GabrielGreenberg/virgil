<!-- last-verified: 40d62da3 2026-07-10 -->
<!-- derives-from: docs/architecture/VIRGIL.md#cowork-pattern -->
<!-- covers-code: editor/skills/reflect.md, editor/AGENTS.md, library/scripts/skill-bundle-template/CLAUDE.md -->

# Memos (three streams, one routing rule) — operational manifest

A skill sometimes writes a markdown memo. There are **three** memo streams and
they **never mix**. Route by what the note is *about*, not by where you happen
to be running.

| Stream | The note is *about* | Lands in | When |
|---|---|---|---|
| **Cowork memo** | *this paper's content* — an ambiguity worth surfacing, a decision made while editing | `<docPath>/.virgil/memos/<YYYY-MM-DD>-<slug>.md` | any session |
| **Library memo** | *the library pipeline* — an extraction retro, a triage call, an indexing-flow idea | `~/Virgil-Library/.virgil/memos/<YYYY-MM-DD>-<slug>.md` | any session |
| **Reflection** | *Virgil's skill set itself* — how a skill behaved, a tooling improvement | the dev-loop reflection sink, **outside** any paper or library folder, via `/editor:reflect` | **DEV mode only** (`VIRGIL_DEV=1`) |

## The one decision rule

> A note about **Virgil's skills** is a **reflection** → `/editor:reflect` → the
> dev-loop sink. A note about **this paper's content** is a **cowork memo** →
> `<docPath>/.virgil/memos/`. The words *reflect / reflection* **always** mean
> the former; **never file a reflection under `.virgil/memos/`.**

This rule is stated identically wherever the dev-loop is documented — the
`/editor:reflect` skill and the editor subsystem guide — so any one of them
disambiguates the others. **"Dev memo" is a retired term.** It once named *both*
the reflection channel and the cowork channel, and that overload is exactly what
misrouted reflections into paper folders. Don't reintroduce it as a routing
label.

## Why the streams never mix

- A **reflection** improves the *tooling*, so it is useless sitting in a user's
  paper folder. It belongs to the dev-loop, which is DEV-only and writes to a
  sink outside any paper or library. Outside DEV mode there is nowhere to put
  one: skip it — do **not** fall back to `.virgil/memos/`. The exact sink path
  is owned by `/editor:reflect`; a skill running in a paper never writes it
  directly.
- A **cowork memo** is *about the paper in front of you* and lives beside it, so
  the user finds it when browsing that paper.
- A **library memo** is *about the indexing pipeline* and lives in the library —
  the pipeline's home.

## Memos vs. reports

A **report** (a paper-specific analysis the user asked for) is *not* a memo: it
goes to `<paper-folder>/notes/<slug>.md`, co-located with the paper. Reports are
user-facing deliverables; memos are working notes.
