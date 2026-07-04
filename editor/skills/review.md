---
description: |
  Take a pass on a Virgil paper folder — handle every open AI request the
  user has filed. Triggers on: "review my doc / paper", "go through my AI
  requests", "drain my inbox", "handle my open requests", "take a look at
  my paper" (when the user is working inside a Virgil paper folder).
  Walks the unified request inbox (footnotes, citations, notes, todos,
  suggestions, bib reviews, style merges) and dispatches each one to the
  matching specialist as a subagent. Does NOT trigger for "review my
  code", "review this PR", or any non-Virgil "review" request. Args:
  <docPath> (optional, falls back to cwd if it has a virgil/ subdir).
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
   Stdout is JSONL, one row per **open** request:
   ```json
   {"source":"ai-requests","kind":"footnote","id":"...","text":"...",
    "paragraphIds":[...], "selectedText":"...", "linkedTo":{...},
    "extra":{"status":"pending","result":null,"safetyLevel":2,"resultId":null}}
   {"source":"bib-review","kind":"bib-review","id":"<bibKey>","text":"...","extra":{"type":"fields"}}
   {"source":"card-flag","kind":"todo","id":"virtual:todos:<cardId>",...}
   ```
   "Open" is **not-terminal**: `pending` | `in-progress` (and the legacy
   `draft` | `submitted`, and a status-absent row) are open; `complete` |
   `failed` are terminal and already filtered out, so the umbrella never
   re-dispatches a drained request. Each `ai-requests` row carries the
   two-field outcome vocabulary (`extra.status` + `extra.result`) and the
   `extra.safetyLevel` the responder routes on (1/2/3 or null).

   Stderr ends with `# <N> open: …` — surface this count up front so
   the user sees how much you're about to do.

3. **Triage and dispatch.** Process in this order so cheap, isolated
   work lands first:

   1. `kind: "bib-review"` → `/editor/answer-bib-review <docPath> <bibKey>`
   2. `kind: "style-merge"` → `/editor/style-merge <docPath>`  *(handles
      all pending style-merges in one call; skip after the first one)*
   3. `kind: "footnote"` → `/editor/draft-footnote <docPath> <id>`
   4. `kind: "citation"` → `/editor/find-citation <docPath> <id>`
   5. `kind: "report"` → `/editor/answer-report-request <docPath> <id>`
   6. `kind: "note"` → `/editor/answer-note-request <docPath> <id>`
   7. `kind: "highlight"` → `/editor/answer-note-request <docPath> <id>`
      *(a highlight is a passage the user flagged for attention; it has no
      body of its own, so the note responder handles it — the anchor +
      selectedText carry the context)*
   8. `kind: "todo"` → `/editor/answer-todo-request <docPath> <id>`
   9. `kind: "suggestion"` → `/editor/draft-suggestion <docPath> <id>`

   For card-flag virtual requests (`id` starts with `virtual:`), the
   subskill receives the virtual id; `apply_response.py` knows to clear
   the source flag without touching `ai-requests.json`.

   Run each subskill **as a subagent** so the umbrella's context stays
   bounded. Pass through the request's full row from the JSONL as
   context to the subagent prompt.

   **Reflection (DEV mode) — enforced here.** If `VIRGIL_DEV=1`, then after
   each dispatched subskill returns (success *or* failure), reflect on it:

   ```bash
   python3 editor/scripts/reflect.py <docPath> <subskill> <taskId>
   ```

   This is the umbrella **enforcing** the one editor/AGENTS.md reflection
   convention for every subskill it dispatches — it makes "every skill reflects"
   true by construction rather than relying on each subagent to remember. When
   the subagent surfaced concrete friction or a `Done:` line, pass it through
   `--memo-json` (see [/editor/reflect](reflect.md)); a bare call still writes a
   correctly-classified memo from the Task's `result`. The script no-ops when
   `VIRGIL_DEV` is unset, so this line is inert in a normal or end-user session
   — leave it in unconditionally.

   **Safety level + outcome.** A Task may carry a `safetyLevel` (1/2/3). The
   umbrella doesn't build cards or pick subcommands — the dispatched subskill
   reads the level off the Task and routes its card-create through
   `create_card.py` → `apply_response.py`: **1** → silent apply, **2** → apply +
   a sibling comment, **3** → propose (drafted; `.tex` untouched; Task left
   `in-progress`, awaiting review), **no level** → direct create. The subskill
   stamps the two-field `status`/`result` (`complete` + `silent-applied` /
   `auto-applied` / `direct-created`, or `in-progress` for a level-3 proposal).
   Surface the level in the banner (below) and echo the subskill's stamped
   outcome. A level-3 proposal stays open, so a later `/editor/review` re-lists
   it until the user accepts or rejects.

4. **Surface progress as you go.** Before each dispatch, print:
   ```
   ════════════════════════════════════════════════════════════
   AI REQUEST · <kind> · <id> · safety <N|direct>
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
- Does **not** mutate sidecars on its own; subskills delegate the writeback to
  `editor/scripts/create_card.py` → `apply_response.py` (atomic, pen-protected).
- Does **not** retry failed subskills; the user re-runs `/editor/review`
  to pick them up again.

## Pairing with /loop

`/loop /editor/review <docPath>` is the right shape for "babysit my
open requests while I keep adding them." Each tick re-walks the inbox,
so requests filed mid-loop are picked up on the next pass.
