---
description: Apply a queued manual bib edit to master.bib and references.bib. Args: <citekey>. Reads .virgil/queue/<citekey>-bibedit.json for the new entry type + field map.
---

# /apply-bib-edit $ARGUMENTS

Apply a manual bib edit that the frontend wrote to
`.virgil/queue/<citekey>-bibedit.json`. The frontend never writes `master.bib`
itself (cowork constraint) — this skill is the drain.

All paths below are relative to the library root.

## Steps

1. **Read the queue entry** at `.virgil/queue/<citekey>-bibedit.json`. It has
   shape:
   ```json
   {
     "kind": "bib-edit",
     "status": "requested",
     "citekey": "<citekey>",
     "requestedAt": "<ISO>",
     "attempts": 0,
     "bibEdit": {
       "type": "article",
       "fields": { "title": "...", "author": "...", ... }
     }
   }
   ```
   If the file is missing or malformed, stop and report the error.

2. **Replace the entry block in `master.bib`.** Locate the existing
   `@<oldType>{<citekey>, ... }` block (brace-balanced — entries can
   contain `{}`-wrapped values). Replace it verbatim with a freshly
   emitted block. Format identical to `.virgil/scripts/index_paper.py`'s
   `_emit_bib_entry`:
   ```
   @<type>{<citekey>,
     <field1> = {<value1>},
     <field2> = {<value2>},
     ...
   }
   ```
   Omit fields whose value is empty / whitespace-only. Preserve the
   citekey from the existing block — never let `bibEdit.fields.citekey`
   override it. If no existing block matches the citekey, append a new
   block at the end (separated by a blank line).

3. **Re-emit `papers/<citekey>/references.bib`.** This is a single-entry
   mirror of the master.bib block, byte-identical except for the trailing
   newline. Skip this step if `papers/<citekey>/` doesn't exist
   (legitimate: the user may have edited a hand-added bib entry that has
   no indexed paper folder yet).

4. **Update `.virgil/catalog.json`.** Find the row whose `citekey` matches:
   - Set `bib.manuallyEditedAt = <now ISO>`.
   - Append to `bib.fieldChanges` one entry per field that changed value
     between the old and new entry, in the same shape Python uses:
     ```json
     { "field": "<name>", "from": "<old>", "to": "<new>", "source": "manual", "at": "<now ISO>" }
     ```
   - Do NOT clear `bib.state` — a manual edit doesn't invalidate prior
     authentication. If the user wants to re-authenticate, they'll click
     "AI review" which queues `kind: "authenticate"` separately.
   - Update top-level `title`, `authors`, `year`, `doi` if those fields
     changed (these are the columns the frontend index uses).

5. **Bump `.virgil/catalog-version.txt`** by writing a new monotonic counter
   value. The frontend polls this 1-byte file every 6s and reloads the
   catalog + master.bib when it changes.

6. **Append a notification** to `.virgil/notifications/inbox.json`:
   ```json
   { "kind": "authenticated", "citekey": "<citekey>", "at": "<now ISO>", "summary": "Applied manual edit (<N> field changes)" }
   ```
   (The `authenticated` kind is reused — the frontend renders it as a
   neutral toast and we don't want to expand the kind enum just for this.)

7. **Mark the queue entry done** by renaming
   `.virgil/queue/<citekey>-bibedit.json` → `.virgil/queue/<citekey>-bibedit.done`
   (or deleting it — both are fine).

## Reply format

One line:
> `Applied bib edit for <citekey>: <N> field changes.`

If the queue entry was malformed or the citekey was missing, paste the
relevant traceback / explanation in a fenced block and stop. Don't
attempt heuristic reconstruction of garbled fields.
