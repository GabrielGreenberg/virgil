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

  Rung 3 is also where a doc can honestly be **absent**: a `/library/*`
  skill takes a citekey rather than a docPath, and the library session's
  own cwd is the library root, which has no `virgil/` subdir. See Step 1.

## Procedure

### Step 1 — State check (always, first action)

1. **Resolve doc context.** If an explicit arg was given, use it; else
   check whether `cwd` has a `virgil/` subdir. If neither resolves, do
   **not** stop yet — carry on to 2 and decide once the mode is known:

   - mode `in-library` → proceed with **no** doc context. This session's
     cwd is the library root, which has no `virgil/` subdir by design, and
     a `/library/*` ask takes a citekey rather than a docPath. Say where
     you are (Step 1.3) and route. Only an *editor* ask needs a paper —
     ask for one then, when it is actually missing.
   - any other mode → surface the missing context, ask the user which
     paper folder they're working in, and stop.

2. **Resolve the library mode.** Find `library_path.py`:
   - End-user flow: synced at `<folder>/.virgil/scripts/editor/library_path.py`,
     where `<folder>` is the resolved `<docPath>` or, when there is none, the
     cwd. Every Virgil-managed folder carries the editor bundle — the library
     root included — so a library session finds it under its own `.virgil/`.
   - Dev flow (running inside the Virgil repo): `editor/scripts/library_path.py`.

   Run `python3 <library_path.py> --mode`. It prints the mode on line 1
   and, when a library resolved, its absolute path on line 2 — and it
   always exits 0, because "no library" is an answer rather than an error.

   | Mode | Means | Library skills |
   |---|---|---|
   | **no-library** | nothing in the resolution chain points at a library | none — the user picks a folder in Virgil's Library tab first |
   | **in-library** | a library resolved AND this session's cwd is that root (or under it) | all of them, inline — this *is* the library session |
   | **paper-session** | a library resolved and cwd is elsewhere (a paper folder, or the Virgil source repo) | light ones inline; a **heavy** one takes Step 4 |

   Both questions the mode asks are causally what they claim, and that is
   the point. "Is a library configured?" is what `resolve_library` answers.
   "Is this session in it?" is the exact condition every heavy library skill
   declares about *itself* — "must run from inside the library folder" — so
   the gate reads a fact the skills already state rather than a proxy for one.

   Do **not** reintroduce a `.claude/commands/library/` probe. The front door
   used to read that directory's presence at the library root as "the library
   is mounted as a sibling project here", and it cannot mean that: the PWA's
   per-folder skill sync writes `.claude/commands/<silo>/` and
   `.virgil/scripts/<silo>/` in one unfiltered pass, into **every** managed
   folder (paper folders included), while `library_path.py` only accepts a
   root that already has `.virgil/scripts/`. So the two columns shared one
   cause, the middle row was unreachable, and the presence measured was caused
   by the PWA rather than by anything Claude Code has mounted.

3. **Surface a one-line state summary** to the user before dispatching.
   Example:

   ```
   You're in /Users/gabriel/Virgil-Library. Library: in-library — this is the library session, so everything runs here.
   ```

   Or:

   ```
   You're in samples/annotation-history. Library: paper-session (library at /Users/gabriel/Virgil-Library). Heavy library ops will ask first.
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
2. **A heavy library op takes Step 4** when the mode is not `in-library` —
   see Step 4, which reads the skill's own weight declaration.
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

Right now you're in <docPath>. Your library is <in-library | paper-session | not set up>.

What do you want to do?
```

No wizard, no checklist. The Virgil app itself is the visual onboarding —
the panel rail on the right shows everything available. Your job is just
to be a friendly keyword-trigger and dispatch.

If the user follows up with a concrete request, jump to Step 2.

### Step 4 — Heavy-library branch (mount-or-queue)

Triggered when the matched library skill's **own description declares it a
`Heavy operation`**, AND the current mode is **not** `in-library`.

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

What this branch is *not*: a capability check. Every library skill's own
Bootstrap resolves the library root and `cd`s into it, so a heavy op dispatched
from a paper folder does work. What it costs is where the work HAPPENS — a long,
multi-subagent job runs in the session the user is writing in, and the library
session they may already have (`/loop /library/index-pending`) never sees it.
So the choice is the user's to make, not the front door's to make for them.

Print a 3-line explanation tailored to the mode:

- **paper-session**:
  ```
  <op> is a heavy library operation — it wants to run from inside the library folder, not from this paper session.
  Fastest path: open <resolved-library-path> as another project in this Cowork/Claude Code workspace, then ask me again.
  Alternative: I can queue it for your library session to pick up — useful if you have `/loop /library/index-pending` running there.
  ```

- **no-library**:
  ```
  You don't have a library set up yet. Open the Library tab in Virgil and pick a folder
  (default: ~/Virgil-Library). Once it's set up, ask me again.
  ```

Then ask:

> Mount the library, queue this for later, run it here anyway, or skip?

Branches:

- **Mount** → confirm and stop. The user takes manual action; on their
  next turn, run Step 1 fresh.
- **Queue** (only for `/library/deep-index <citekey>`, and only in
  `paper-session` — a queue entry needs a library to write into, and
  deep-index is the only heavy op the queue represents; the others *are*
  drainers or are library-wide with no citekey to key on):

  Write `<library-root>/.virgil/queue/<citekey>-deepindex.json`. A direct
  atomic write via Python `tempfile` + `os.replace` is fine — a deep-index
  entry touches neither `master.bib` nor `catalog.json`, so there is no
  flock to take.

  **State the whole entry; the app reads every field.** The shape is
  `library/lib/queue.ts` (`QueueEntry`) — check it there if you are unsure,
  and mirror what `queueDeepIndex` in `library/lib/bib-edit.ts` writes:

  ```json
  {
    "kind": "deepIndex",
    "status": "requested",
    "citekey": "<citekey>",
    "requestedAt": "<ISO-8601 UTC, e.g. 2026-08-25T18:24:00.000Z>",
    "attempts": 0
  }
  ```

  `status: "requested"` is **not** optional and is the field a hand-written
  entry loses first. `library/lib/queue-state-store.ts` skips any entry whose
  status is not `"requested"`, so without it the Library UI shows no queued
  badge; `cancelDeepIndex` in `library/lib/bib-edit.ts` requires the same
  value, so without it the user cannot cancel the request you just told them
  you made. The drainer keys on `kind` alone, so the entry would still run —
  invisible and unstoppable, which is the worst of both. (An optional `note`
  string may carry the user's own words; nothing else belongs in the file.)

  - Report:
    ```
    Queued <op> for <citekey> at <library-root>/.virgil/queue/.
    Your library session (or the next `/loop /library/index-pending` tick) will pick this up.
    ```
- **Run here anyway** → dispatch the specialist inline as a subagent, having
  said what it costs. The choice was surfaced; that is the invariant, not a
  refusal.
- **Skip** → confirm and stop.

In **in-library** mode, skip Step 4 entirely — this session already *is* the
library session, so every heavy op dispatches inline as a subagent.

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
- Does **not** silently run a heavy library operation from a paper session.
  Whenever the mode is not `in-library`, Step 4 surfaces the choice first —
  mount, queue, run here anyway, or skip. Running it *after* the user picks
  is not silence; skipping the question is.
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
