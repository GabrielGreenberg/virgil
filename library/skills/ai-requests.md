---
description: Drain only user-authored AI requests in ~/Virgil-Library/.virgil/queue/ — entries with a `note` field, plus all `paper-review` entries. Skips general indexing/triage. Pair with /loop for steady-state polling.
---

# /ai-requests

**Process only the user-driven AI requests.** Do **not** run the
general-purpose indexing/triage pipeline. The user explicitly invoked
this command because they want their hand-written notes addressed, not
a queue drain.

All paths are relative to the library root (the current working
directory).

> **Where any memo you write goes.** Dev memos (skill retros, ideas for
> improving this pipeline) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`.
> Paper-specific analyses or reports → `papers/<citekey>/notes/<slug>.md`.
> Never drop a markdown file at the library root.

## What counts as an AI request

A queue entry is an AI request when **any** of these is true:

1. `kind == "paper-review"` — produced by the AI request button in the
   paper text view. File: `.virgil/queue/<citekey>-paperreview.json`.
   Always has a `note`.
2. `kind == "authenticate"` and the entry has a non-empty `note` field
   — produced by the AI request button on the bib card when the user
   typed a note before submitting. File: `.virgil/queue/<citekey>.json`.
   (`authenticate` entries **without** a note are vanilla auth requests
   and should be left for `/index-pending` / `/authenticate-bib` to
   handle on the regular path. Skip them here.)
3. `kind == "deepIndex"` (or legacy `"richIndex"`) and the entry has a
   non-empty `note` field — produced by the deep-index button with a
   user note.
   File: `.virgil/queue/<citekey>-deepindex.json` (legacy:
   `.virgil/queue/<citekey>-richindex.json`).
   Dispatch to `/deep-index <citekey>` (the skill reads the note from
   the queue file). `deepIndex` entries **without** a note are standard
   deep-index requests — leave them for `/index-pending` to handle.

## Procedure

1. **Find the candidates.** List `.virgil/queue/*.json`, read each, and select
   the ones matching the criteria above. Build a working list with
   citekey, kind, scope (`bib` or `paper`), and note.

2. **For each request — surface the note prominently and act on it.**

   Print a clearly-delimited block before doing anything else:

   ```
   ════════════════════════════════════════════════════════════
   AI REQUEST · <citekey>
   Scope: <bib | paper>
   Queue file: .virgil/queue/<filename>
   ────────────────────────────────────────────────────────────
   <full verbatim user note>
   ════════════════════════════════════════════════════════════
   ```

   Do not paraphrase the note. Echo it verbatim so the user can see in
   the transcript exactly what they asked for.

   Then act:

   - **`bib` scope (`kind=authenticate` with note):** handle the note
     directly. The note is the spec. If it asks you to verify a field,
     verify it (web search / Crossref / OpenAlex as appropriate). If it
     asks you to fill missing fields, fill them. Stage the result via
     `/apply-bib-edit <citekey>` (or write a `bib-edit` queue entry).
     Do **not** fall through to the standard `/authenticate-bib`
     three-tier search unless the note specifically asks for it.

   - **`paper` scope (`kind=paper-review`):** the note is about the
     paper text in `papers/<citekey>/main.tex`. Read the file, find the
     section/element the note refers to, and fix it. If the request
     requires re-running the linearization pipeline (e.g. "re-extract
     section 3" or "this paper has a two-column layout"), invoke the
     relevant scripts (`.virgil/scripts/index_paper.py`, `.virgil/scripts/extract.py`)
     scoped as narrowly as you can. Save the updated `main.tex`. Bump
     `.virgil/catalog-version.txt` so the frontend reloads.

3. **Mark done.** Once the request is handled, delete its queue file.
   For `authenticate` entries, also remove the matching record from
   `.virgil/queue/pending-reviews.json` via the same logic
   `/authenticate-bib` uses.

4. **Report.** Print a final summary of what you did per request:

   ```
   AI requests: handled 2.
     • smith2020       (bib)   — filled doi, year; staged bib-edit.
     • jones2018       (paper) — re-extracted section 3 in main.tex; bumped version.
   ```

## What this command does NOT do

- Does **not** drain `kind=index` / `kind=reindex` / `kind=triage` /
  `kind=bib-edit` entries.
- Does **not** run vanilla `authenticate` entries (those without a
  note). They stay in the queue for `/index-pending` to pick up.
- Does **not** invoke `.virgil/scripts/drain_queue.py` — that's the general
  indexing path and is the wrong tool for AI requests.

## When the candidate list is empty

Reply with a single line:

```
No pending AI requests.
```

No further work.

## Pairing with /loop

`/loop /ai-requests` is the right shape for "babysit my AI requests
while I keep adding them." The user typically runs this in a session
separate from `/loop /index-pending` so the two queues don't fight.
