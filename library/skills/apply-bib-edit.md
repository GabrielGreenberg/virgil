---
description: Apply a queued manual bib edit to master.bib and references.bib. Args: <citekey>. Reads .virgil/queue/<citekey>-bibedit.json for the new entry type + field map.
---

# /apply-bib-edit $ARGUMENTS

## Bootstrap (run this first)

This skill operates on the user's Virgil Library. Resolve the library
root and cd into it before running anything else.

```bash
# Find library_path.py — synced PWA folders have it under .virgil/scripts/,
# the Virgil source repo has it under editor/scripts/. Either is fine.
library_path_py=""
for candidate in .virgil/scripts/editor/library_path.py editor/scripts/library_path.py; do
  [ -f "$candidate" ] && { library_path_py="$candidate"; break; }
done
if [ -z "$library_path_py" ]; then
  echo "No library set up. Pick a library in Virgil first."
  exit 1
fi
library_root="$(python3 "$library_path_py" --get 2>/dev/null)" || {
  echo "No library set up. Pick a library in Virgil first."
  echo "  (Or run: python3 $library_path_py --set <abs-path>)"
  exit 1
}
cd "$library_root"
export VIRGIL_LIBRARY_ROOT="$library_root"
```

---

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

2. **Replace the entry block in `master.bib`.** Do **not** Read/Write
   `master.bib` directly — it's shared across all skills and a
   concurrent index/auth run could overwrite this skill's edit (or
   vice versa). Call the locked CLI shim instead:

   ```bash
   cat > /tmp/$ARGUMENTS-bibedit-fields.json <<'EOF'
   { "title": "...", "author": "...", "year": "...", ... }
   EOF
   python3 .virgil/scripts/library/update_master_bib_entry.py "$ARGUMENTS" \
     --entry-type "<type>" \
     --fields-file /tmp/$ARGUMENTS-bibedit-fields.json
   rm /tmp/$ARGUMENTS-bibedit-fields.json
   ```

   The script holds `lock_master_bib`, finds the existing
   `@<oldType>{<citekey>, ...}` block (brace-balanced) and replaces
   it verbatim with the freshly emitted block — or appends a new
   block if none exists. Omit any field whose value is empty /
   whitespace-only from `--fields-file`. Never include a `citekey`
   field; the script always uses the positional argument and won't
   accept it being overridden via the fields map.

   **Do not** pass `--bib-state`: a manual edit doesn't invalidate
   prior authentication. The existing `% bib.state = ...` comment is
   preserved when you omit the flag.

3. **Re-emit `papers/<citekey>/references.bib`.** This is a single-entry
   mirror of the master.bib block, byte-identical except for the trailing
   newline. Skip this step if `papers/<citekey>/` doesn't exist
   (legitimate: the user may have edited a hand-added bib entry that has
   no indexed paper folder yet).

4. **Update `.virgil/catalog.json`** via the locked CLI shim. Compute
   the field changes first (compare old vs new for each field).
   Construct a patch:

   ```bash
   cat > /tmp/$ARGUMENTS-bibedit-patch.json <<'EOF'
   {
     "title": "<new title or omit>",
     "authors": [...],
     "year": <YYYY>,
     "doi": "<new doi or null>",
     "bib": {
       "manuallyEditedAt": "<now ISO>",
       "fieldChanges": [
         { "field": "<name>", "from": "<old>", "to": "<new>",
           "source": "manual", "at": "<now ISO>" }
       ]
     }
   }
   EOF
   python3 .virgil/scripts/library/update_catalog_entry.py "$ARGUMENTS" \
     --patch-file /tmp/$ARGUMENTS-bibedit-patch.json
   rm /tmp/$ARGUMENTS-bibedit-patch.json
   ```

   Include top-level `title`/`authors`/`year`/`doi` only for the
   fields that changed — the deep-merge preserves untouched fields.

   **Do NOT** clear `bib.state` — a manual edit doesn't invalidate
   prior authentication. If the user wants to re-authenticate,
   they'll click "AI review" which queues `kind: "authenticate"`
   separately.

   Note: `bib.fieldChanges` is an array, and deep-merge **replaces**
   arrays. If you need to *append* to the existing fieldChanges, read
   it first (`jq ".entries[] | select(.citekey == \"$ARGUMENTS\") |
   .bib.fieldChanges" .virgil/catalog.json`) and include the
   concatenated list in the patch.

5. **Bump `.virgil/catalog-version.txt`** — already done by step 4's
   script. No additional bump needed.

6. **Append a notification** via the locked CLI shim:

   ```bash
   cat > /tmp/$ARGUMENTS-bibedit-notify.json <<'EOF'
   { "kind": "authenticated", "citekey": "<citekey>", "at": "<now ISO>",
     "summary": "Applied manual edit (<N> field changes)" }
   EOF
   python3 .virgil/scripts/library/append_inbox_item.py \
     --item-file /tmp/$ARGUMENTS-bibedit-notify.json
   rm /tmp/$ARGUMENTS-bibedit-notify.json
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
