---
description: Drain every open AI request in a Virgil paper folder — dispatches each request to the appropriate per-kind subskill (footnote / citation / note / suggestion / bib-review / style-merge). Pair with /loop for steady-state polling.
---

# /editor/review

Walk every open AI request in a Virgil document and resolve each one
through its per-kind subskill. Use this as the default "Claude, take a
pass on my open requests" command.

The umbrella runs to empty in one turn, so for steady-state polling wrap
with `/loop /editor/review`.

## Args

- `<docPath>` *(optional)* — absolute or repo-relative path to the
  document folder. Examples:
  - `samples/annotation-history`
  - `virgil-data/doc_devtest`
  - `/Users/gabriel/Documents/papers/lattice-trees`

  If omitted: use `cwd` if it has a `virgil/` subdir; otherwise error.

## Procedure

1. **Locate the helper scripts.** They live at `editor/scripts/` from
   the Virgil repo root. If the repo root isn't your `cwd`, set the
   absolute path once and reuse it. (Future: synced into
   `<docPath>/.virgil/scripts/` for end-user flows.)

2. **List candidates.**
   ```bash
   python3 editor/scripts/list_requests.py <docPath>
   ```
   Stdout is JSONL, one row per open request:
   ```json
   {"source":"ai-requests","kind":"footnote","id":"...","text":"...",
    "paragraphIds":[...], "selectedText":"...", "linkedTo":{...}}
   {"source":"bib-review","kind":"bib-review","id":"<bibKey>","text":"...","extra":{"type":"fields"}}
   {"source":"card-flag","kind":"todo","id":"virtual:todos:<cardId>",...}
   ```
   Stderr ends with `# <N> open: …` — surface this count up front so
   the user sees how much you're about to do.

3. **Triage and dispatch.** Process in this order so cheap, isolated
   work lands first:

   1. `kind: "bib-review"` → `/editor/answer-bib-review <docPath> <bibKey>`
   2. `kind: "style-merge"` → `/editor/style-merge <docPath>`  *(handles
      all pending style-merges in one call; skip after the first one)*
   3. `kind: "footnote"` → `/editor/draft-footnote <docPath> <id>`
   4. `kind: "citation"` → `/editor/find-citation <docPath> <id>`
   5. `kind: "quotation"` → `/editor/draft-quotation <docPath> <id>`
   6. `kind: "note"` → `/editor/answer-note-request <docPath> <id>`
   7. `kind: "todo"` → `/editor/answer-todo-request <docPath> <id>`
   8. `kind: "suggestion"` → `/editor/draft-suggestion <docPath> <id>`

   For card-flag virtual requests (`id` starts with `virtual:`), the
   subskill receives the virtual id; `apply_response.py` knows to clear
   the source flag without touching `ai-requests.json`.

   Run each subskill **as a subagent** so the umbrella's context stays
   bounded. Pass through the request's full row from the JSONL as
   context to the subagent prompt.

4. **Surface progress as you go.** Before each dispatch, print:
   ```
   ════════════════════════════════════════════════════════════
   AI REQUEST · <kind> · <id>
   ────────────────────────────────────────────────────────────
   <verbatim text from the request>
   ════════════════════════════════════════════════════════════
   ```
   Then dispatch. Echo the subskill's one-line `Done:` reply. On
   subskill failure, log the error and move to the next entry — one bad
   request shouldn't block the rest.

5. **Final summary.** After every dispatch:
   ```
   /editor/review: handled <H>, skipped <S>, failed <F>.
     • <kind> <id> — <action>
     • ...
   ```

## When the queue is empty

Reply with the single line:

```
No open AI requests.
```

No further work.

## What this skill does NOT do

- Does **not** invoke subskills directly without a subagent — that's
  what bounds the context.
- Does **not** mutate sidecars on its own; subskills delegate to
  `editor/scripts/apply_response.py` for the writeback.
- Does **not** retry failed subskills; the user re-runs `/editor/review`
  to pick them up again.

## Pairing with /loop

`/loop /editor/review <docPath>` is the right shape for "babysit my
open requests while I keep adding them." Each tick re-walks the inbox,
so requests filed mid-loop are picked up on the next pass.
