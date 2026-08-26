---
description: |
  Front-door for Virgil — the browser-based LaTeX editor with an AI cowork
  pattern. Use this whenever the user addresses "Virgil" by name (examples:
  "Virgil, review my document", "Virgil, fix my bibliography", "hey Virgil",
  "Virgil, introduce me", "Virgil, what can you do") or when someone working
  in a Virgil paper folder asks for help in general terms without naming a
  specific skill. Orient the user, resolve their paper and library context,
  and dispatch to the right specialist (editor or library skill) as a
  subagent. Also handles first-time onboarding for users new to Virgil.
  Does NOT trigger for unrelated "review" / "edit" requests outside of a
  Virgil paper folder.
---

# /virgil/start

Entry point for the Virgil cowork experience. The user addresses "Virgil"
naturally ("Virgil, review my doc", "Virgil, introduce me"); this skill
figures out what they actually want, surfaces their current context, and
hands off to the appropriate specialist.

The skill set is split internally across `editor:*` and `library:*`, but
the user only sees "Virgil" and "the Library." Treat them accordingly:
when dispatching, mention what's happening but don't quiz the user about
namespaces.

## Args

- `<docPath>` *(optional)* — absolute or repo-relative path to the
  document folder. Resolve in order:
  1. Explicit arg.
  2. `cwd` if it has a `virgil/` subdir.
  3. Otherwise **prompt** the user to pick one.

  Rungs 1-2 are `/editor/review`'s; rung 3 is the front door's own —
  review *errors* when it cannot resolve a doc, and a front door asks.

## Procedure

### Step 1 — State check (always, first action)

1. **Resolve doc context.** If an explicit arg was given, use it; else
   check whether `cwd` has a `virgil/` subdir; else surface the missing
   context and ask the user which paper folder they're working in. Stop
   if no doc context can be resolved.

2. **Resolve library mount status.** Find `library_path.py`:
   - End-user flow: synced at `<docPath>/.virgil/scripts/editor/library_path.py`.
   - Dev flow (running inside the Virgil repo): `editor/scripts/library_path.py`.

   Run `python3 <library_path.py> --get`. Interpret:

   | library_path resolves? | library root has `.claude/commands/library/`? | Mode |
   |---|---|---|
   | yes | yes | **full-ops** — library is mounted as a sibling project in this Cowork/Claude Code workspace; library skills can be dispatched inline. |
   | yes | no | **light-ops** — library is configured but not mounted in this project; only single-citekey light library skills are safe to run inline. |
   | no | — | **no-library** — no library set up; the user needs to pick one in Virgil's Library tab before any library work. |

   The `.claude/commands/library/` heuristic is load-bearing: the
   library's skill bundle is only synced into that directory when the
   Virgil PWA has opened the library as a workspace. If the user has
   the library folder as a parallel project in Cowork/Claude Code, the
   PWA has already synced; if they don't, it hasn't.

3. **Surface a one-line state summary** to the user before dispatching.
   Example:

   ```
   You're in samples/annotation-history. Library: full-ops (mounted at /Users/gabriel/Virgil-Library).
   ```

   Or:

   ```
   You're in samples/annotation-history. Library: light-ops (configured at /Users/gabriel/Virgil-Library but not mounted in this Cowork project).
   ```

   Or:

   ```
   You're in samples/annotation-history. Library: not set up.
   ```

### Step 2 — Intent classification

**The skills' own descriptions ARE the routing vocabulary.** Every `editor:*`
and `library:*` skill declares, in its `description:` frontmatter, the phrases
it triggers on (`Triggers on: …`) and the asks it explicitly does *not* take
(`Does NOT trigger for …`). The harness surfaces all of them in the skill
listing you can already read. So read the user's most recent message, match it
against those declared triggers, and dispatch the best fit **as a subagent**.

That is the whole vocabulary, and it is deliberately not repeated here. A
hand-typed copy of it can only fall behind the skill set — and did, for months,
opening a loop it could not close (it routed "draft a suggestion" and knew
nothing about accepting or rejecting one). Read from the descriptions and a
skill is routable the moment it ships.

Four rules shape the match, and each reads a declaration the skill makes about
itself rather than a list kept here:

1. **Developer-only skills are not user routes.** A description that opens
   `Developer-only` is for a Virgil maintainer working on the skill set
   itself. Do not offer one to an end user.
2. **A heavy library op takes Step 4** when the mode is not full-ops — see
   Step 4, which reads the skill's own weight declaration.
3. **A specialist is Task-bound** when its own `Args:` line declares a
   *required* — unbracketed — `<requestId>` or `<bibKey>`. Then the id
   contract immediately below applies. A **bracketed** `[<requestId>]` is the
   skill declaring the id optional: `/editor/create-card` is that door, and it
   is the answer to "there is no Task".
4. **When two skills both fit, prefer the narrower one**, and read the loser's
   `Does NOT trigger for …` line — the descriptions disambiguate each other by
   design (`/editor/edit-card` refuses a suggestion's `status`;
   `/editor/accept-suggestion` owns it).

#### Task routes: where the id comes from, and what to do when there is none

A **Task-bound** specialist (rule 3 above) acts on a **request in the paper's
AI-request inbox** — a Task the *user* minted by flagging a card or a paragraph
for AI in the app. Every one of them validates that id in its own step 0 and
**refuses** an unknown or wrong-kind one, so the id is not optional and it is
not yours to invent.

**Helper-script paths, once.** The recipes below name a helper as
`<editor-scripts>/<name>.py`. Resolve that prefix the same way Step 1 resolved
`library_path.py`: end-user flow `<docPath>/.virgil/scripts/editor/`, dev flow
(running inside the Virgil repo) `editor/scripts/`.

Answer this before you dispatch a Task-bound specialist:

1. **Is there already a Task for this ask?** One door lists all three inboxes
   (`ai-requests.json`, `bib-review-requests.json`, and un-bridged card flags):

   ```bash
   python3 <editor-scripts>/list_requests.py <docPath>
   ```

   If exactly one open row matches what the user just asked for, pass its `id`
   and dispatch. If several match, or the user asked for a pass over the whole
   inbox rather than one thing, dispatch `/editor/review <docPath>` instead —
   draining the inbox is its job, not the front door's.

2. **If there is none, do NOT create one, and do NOT make an id up.** There is
   no door that appends a *pending* `ai-requests.json` row, and that sidecar
   must never be edited with a file-editing tool: it has one authority
   (`apply_response.py` — atomic, version-bumped, under the editing pen). The
   rule is the editor silo's, stated once and **not paraphrased here** — read
   it at [`_ask-shape.md`](../../editor/skills/_ask-shape.md) (in a synced
   paper folder, the same file is `.claude/commands/editor/_ask-shape.md`).

3. **Land it through the chat-initiated door instead (Workflow B).** Compose
   the artifact in chat — composition is chat's job — and hand it to
   `/editor/create-card`, which synthesizes *and completes* its own Task, so no
   pre-existing request is needed:

   ```
   /editor/create-card <docPath> --kind=<kind> --anchor <paragraph-uuid> --body "<what you composed>"
   ```

   **Resolving `<paragraph-uuid>`.** Workflow B anchors on a paragraph's
   `%!v:` uuid, and the front door has no cursor. Get one — never guess, and
   never pass an anchor you have not confirmed (`create_card.py` refuses an
   unknown uuid outright, and a *wrong* one anchors the artifact to the wrong
   prose silently):

   - the user quoted or named a passage → find it in the `.tex` and read the
     `%!v:<uuid>` marker on that paragraph, then confirm you resolved the
     paragraph you meant by echoing it back:
     `python3 <editor-scripts>/get_para_context.py <docPath> <uuid>`;
   - the ask is about a paragraph that already carries cards →
     `python3 <editor-scripts>/cards_for_paragraph.py <docPath> <uuid>`;
   - otherwise **ask one short question** ("which paragraph — quote a few
     words of it?") and re-classify.

4. **If `create-card` refuses the kind**, the job belongs to a Task-bound
   specialist and there is still nothing to invent. That happens when the kind
   has no chat-initiated builder, or has a prerequisite you do not hold (a
   `citation` whose citekey is not in `references.bib` yet — sourcing it is
   `/editor/find-citation`'s job, and that skill is Task-bound). Say so plainly
   and give the user the one action that mints a real Task: flag the paragraph
   or the card for AI in Virgil, then ask again — or run
   `/editor/review <docPath>` once it is flagged.

The table below is **not** the route list. It records only the handful of
asks that carry something no description can say: a front-door branch with no
skill behind it, a default flag the front door must supply, or a rule about
which of several matching skills wins. If an ask matches a skill's declared
triggers and no row here says otherwise, dispatch that skill.

| Ask shape | What the skill's own description cannot say |
|---|---|
| "introduce me" / "how does this work" / "what can you do" / "I'm new" / "Virgil?" with no other content | **Onboarding** (Step 3) — a front-door branch, with no skill behind it |
| a pass over the *whole* inbox, **or** several open Tasks match one ask | Dispatch `/editor/review <docPath>`. The front door does not choose between Tasks — draining the inbox is review's job |
| a bibliography sync the user has not confirmed they want written | Dispatch `/editor/sync-bib-to-library <docPath>` with `--dry-run` first |
| an ask that matches no skill's declared triggers | Ask one short clarifying question, then re-classify. Do **not** invent a skill name — if nothing in the listing fits, nothing fits |

For each dispatch, mirror the `/editor/review`
pattern: dispatch the specialist as a **subagent** so the front-door's
context stays bounded, and echo the specialist's one-line `Done:` reply.

### Step 3 — Onboarding branch

Print a 6-line orient and then ask one diagnostic question.

```
Virgil has three surfaces:
  • the editor — write papers, get AI help on requests (footnotes, citations, notes, suggestions, bib reviews).
  • the Library — your indexed catalog of source PDFs and DOCX files.
  • slash commands — /editor/* and /library/* for direct invocation.
Say "Virgil, …" any time and I'll route you.

Right now you're in <docPath>. Your library is <full-ops | light-ops | not set up>.

What do you want to do?
```

No wizard, no checklist. The Virgil app itself is the visual onboarding —
the panel rail on the right shows everything available. Your job is just
to be a friendly keyword-trigger and dispatch.

If the user follows up with a concrete request, jump to Step 2.

### Step 4 — Heavy-library branch (mount-or-queue)

Triggered when the matched library skill's **own description declares it a
`Heavy operation`**, AND the current mode is **not** full-ops.

That declaration is the gate — there is no list here to keep in step with the
skill set, and there was: the previous hand list had already lost
`/library/merge-bibs`, which folds *every* paper's `references.bib` into
`master.bib` library-wide. A heavy skill says so in its own `description:`
frontmatter, beside the reason ("must run from inside the library folder",
"spawns multiple per-paper subagents"); a light one says `Light — safe to
invoke from a paper session with --library` and dispatches inline in any mode
where `library_path` resolves.

A skill that declares **neither** is treated as light, because that is what the
front door has always done with one — but that is a gap in the declaration, not
a licence. If the ask is plainly a whole-library or multi-paper write, treat it
as heavy whatever its description omits.

Print a 3-line explanation tailored to the mode:

- **light-ops**:
  ```
  <op> needs the library folder mounted as a sibling project in this Cowork/Claude Code workspace.
  Fastest path: open <resolved-library-path> as another project here, then ask me again.
  Alternative: I can queue this for your library session to pick up — useful if you have `/loop /library/index-pending` running there.
  ```

- **no-library**:
  ```
  You don't have a library set up yet. Open the Library tab in Virgil and pick a folder
  (default: ~/Virgil-Library). Once it's set up, ask me again.
  ```

Then ask:

> Mount the library now, queue this for later, or skip?

Branches:

- **Mount** → confirm and stop. The user takes manual action; on their
  next turn, run Step 1 fresh.
- **Queue** (only available in light-ops):
  - For `/library/deep-index <citekey>`: write a queue entry to
    `<library-root>/.virgil/queue/<citekey>-deepindex.json` with the
    shape the library's queue drainer expects. Acquire the appropriate
    flock if mutating shared state (deep-index queue entries don't
    touch `master.bib` or `catalog.json`, so a direct atomic file
    write via Python `tempfile` + `os.replace` is fine; if uncertain,
    shell out to a library helper).
  - Report:
    ```
    Queued <op> for <citekey> at <library-root>/.virgil/queue/.
    Your library session (or the next `/loop /library/index-pending` tick) will pick this up.
    ```
- **Skip** → confirm and stop.

In **full-ops** mode, skip Step 4 entirely — heavy library ops can be
dispatched inline as subagents.

## Done convention

End with a single line in the library skill format:

```
Done: <action> for <id>. Output: <files-touched | "dispatched specialist">.
```

For onboarding-only turns where nothing was dispatched, use:

```
Done: oriented user. Output: state-summary.
```

## What this skill does NOT do

- Does **not** invoke specialists directly without a subagent — that's
  what bounds context.
- Does **not** mutate sidecars on its own; specialists handle their own
  writeback via `editor/scripts/apply_response.py` or the library's
  flock-protected shims. In particular it never appends, edits, or fabricates
  a row (or an id) in `virgil/ai-requests.json` — there is no door for that,
  and Step 2 says what to do instead.
- Does **not** silently run heavy library operations in light-ops mode.
  Always surface the mount-or-queue choice.
- Does **not** retry failed specialists. If a dispatch fails, surface
  the error and stop.
- Does **not** keep its own list of what the skills do. Each skill's
  `description:` is the one place its triggers, its weight and its argument
  contract are stated; the table in Step 2 records only what a description
  structurally cannot. Adding a row that restates a skill's triggers puts the
  front door back one commit behind the skill set.

## Pairing with /loop

`/loop /virgil/start <docPath>` is the right shape for "babysit my Virgil
session" — every tick re-checks the inbox and surfaces any new requests
that landed. Use sparingly: most users want a single-turn dispatch, not
a polling loop.
