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
  document folder. Same resolution as `/editor/review`:
  1. Explicit arg.
  2. `cwd` if it has a `virgil/` subdir.
  3. Otherwise prompt the user to pick.

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

Read the user's most recent message. Pick the highest-fit category and
dispatch:

| User says (or sounds like) | Branch |
|---|---|
| "introduce me" / "how does this work" / "what can you do" / "I'm new" / "Virgil?" with no other content | **Onboarding** (Step 3) |
| "review my doc/paper" / "look at my open requests" / "drain my inbox" / "Virgil, take a pass" | Dispatch `/editor/review <docPath>` as a subagent |
| "fix my bibliography" / "tidy my references" / "sync my refs to the library" | Dispatch `/editor/sync-bib-to-library <docPath>` as a subagent (start with `--dry-run` if the user hasn't confirmed they want writes) |
| "add a footnote" / "draft a footnote here" | Dispatch `/editor/draft-footnote <docPath> <requestId>` (find or create the request) |
| "find/add a citation" / "look up the source for this claim" | Dispatch `/editor/find-citation <docPath> <requestId>` |
| "answer this note" / "address this todo" / "respond to my comment" | Dispatch the appropriate `/editor/answer-*` skill |
| "draft a suggestion" / "propose an edit here" | Dispatch `/editor/draft-suggestion <docPath> <requestId>` |
| "answer this bib review" / "verify this bib entry" | Dispatch `/editor/answer-bib-review <docPath> <bibKey>` |
| "merge my preamble style" / "apply my style customizations" | Dispatch `/editor/style-merge <docPath>` |
| "authenticate <citekey>" / "verify this source" / "look up <author, year>" in the catalog | Dispatch `/library/authenticate-bib <citekey>` (light, runs in any mode where library_path resolves) |
| "apply the bib edit for <citekey>" | Dispatch `/library/apply-bib-edit <citekey>` (light) |
| "index this PDF" / "process this paper" | If a citekey already exists, dispatch `/library/index-paper <citekey>`; else dispatch `/library/triage-pdf <filename>` (both light) |
| "deep-index <citekey>" / "do a deep index pass" / "deep research <topic>" / "drain my library queue" / "triage everything in unsorted" / "process all pending" | **Heavy-library branch** (Step 4) — does NOT dispatch inline in light-ops mode |
| Anything else | Ask one short clarifying question, then re-classify |

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

Triggered when the user wants `/library/deep-index`,
`/library/triage-pending`, `/library/index-pending`,
`/library/ai-requests`, `/library/iterate-skill`, or any future heavy
library operation, AND the current mode is **not** full-ops.

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
  flock-protected shims.
- Does **not** silently run heavy library operations in light-ops mode.
  Always surface the mount-or-queue choice.
- Does **not** retry failed specialists. If a dispatch fails, surface
  the error and stop.

## Pairing with /loop

`/loop /virgil/start <docPath>` is the right shape for "babysit my Virgil
session" — every tick re-checks the inbox and surfaces any new requests
that landed. Use sparingly: most users want a single-turn dispatch, not
a polling loop.
