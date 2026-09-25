---
description: |
  Save a manual bib edit the user made through the library UI's "Edit"
  button. Triggers on: "apply the bib edit for <citekey>", "save my
  manual edit", or when the queue has a `<citekey>-bibedit.json` entry
  to drain. Reads `.virgil/queue/<citekey>-bibedit.json` for the user's
  field-level diff, splices exactly those fields into the CURRENT
  master.bib block (holding any that changed on disk since the edit was
  opened), resyncs references.bib, and bumps the catalog version. Does NOT trigger for
  external-source verification (use /library/authenticate-bib) or for
  bibliography cleanup of a paper (use /library/clean-bibliography). Light —
  safe to invoke from a paper session with --library. Args:
  <citekey> [--library <path>].
---

# /library/apply-bib-edit $ARGUMENTS

## Args

- `<citekey>` — the entry whose queued edit
  (`.virgil/queue/<citekey>-bibedit.json`) should be applied.
- `--library <path>` — override library-path resolution. Useful when
  invoking this skill **from a paper session** with multiple libraries on
  disk; without it the normal chain
  (`./.virgil/library-path.json` → `VIRGIL_LIBRARY_ROOT` →
  `~/.config/virgil/library-path.json` → `~/Virgil-Library/`) is used.

Every command below refers to the citekey as `"$CITEKEY"` — always
quoted, never a bare `$ARGUMENTS` (which would also swallow the
`--library` flag into the positional).

## Bootstrap (run this first)

This skill operates on the user's Virgil Library. Resolve the library
root and cd into it before running anything else.

```bash
# Set both from the invocation above. CITEKEY is the positional argument
# (every command below uses "$CITEKEY", never a bare $ARGUMENTS). LIBRARY
# holds the value of an explicit `--library <path>`, empty when absent.
# Build the flag as an ARRAY, not a `${LIBRARY:+--library "$LIBRARY"}`
# string — under zsh that idiom collapses into ONE argument
# ("--library /path") and argparse rejects it. Empty array = zero args.
CITEKEY="<citekey>"
LIBRARY=""   # e.g. LIBRARY="/Users/me/Papers/Virgil-Library"
lib_args=()
[ -n "$LIBRARY" ] && lib_args=(--library "$LIBRARY")

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
library_root="$(python3 "$library_path_py" --get "${lib_args[@]}" 2>/dev/null)" || {
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
       "baseType": "article",
       "set": { "title": "...", "note": "..." },
       "remove": ["keywords"],
       "baseRaw": "@article{<citekey>,\n  title = {...},\n ...\n}\n"
     }
   }
   ```
   It is a **DIFF, not an entry** (task 763): `set` holds only the fields the
   user added or changed, `remove` only the fields they removed, and
   `baseRaw`/`baseType` the entry as the Edit modal read it. Every field the
   user did not touch is absent — and must stay exactly as it is on disk now,
   including any field another skill added after the modal opened. If the
   file is missing or malformed, stop and report the error.

   **Legacy shape.** An edit queued before task 763 carries
   `"bibEdit": { "type": "...", "fields": { ... } }` — a whole entry whose
   omissions cannot be trusted. Apply it as `set = fields`, `remove = []`, no
   base (step 2 without the two `--base-*` flags). It then cannot remove a
   field, which is the price of not deleting ones it never saw.

2. **Splice the diff into `master.bib`.** Do **not** Read/Write
   `master.bib` directly — it's shared across all skills and a
   concurrent index/auth run could overwrite this skill's edit (or
   vice versa). Call the locked CLI shim instead:

   ```bash
   cat > "/tmp/$CITEKEY-bibedit-set.json" <<'EOF'
   { "title": "...", "note": "..." }
   EOF
   cat > "/tmp/$CITEKEY-bibedit-base.bib" <<'EOF'
   <bibEdit.baseRaw, verbatim>
   EOF
   python3 .virgil/scripts/library/update_master_bib_entry.py "$CITEKEY" \
     --entry-type "<bibEdit.type>" \
     --fields-file "/tmp/$CITEKEY-bibedit-set.json" \
     --merge-existing \
     --drop-field "<one per name in bibEdit.remove>" \
     --base-raw-file "/tmp/$CITEKEY-bibedit-base.bib" \
     --base-type "<bibEdit.baseType>"
   rm "/tmp/$CITEKEY-bibedit-set.json" "/tmp/$CITEKEY-bibedit-base.bib"
   ```

   Repeat `--drop-field` once per name in `remove` (none when it is empty).
   Write `set` exactly as queued (an empty `{}` is fine). If `baseRaw` is
   absent, omit both `--base-*` flags. Never include a `citekey` field.
   **Never pass `--allow-field-drop`** — that flag trusts omissions, and a
   diff's omissions are the fields the user left alone.

   `--merge-existing` keeps every field nobody named; `--drop-field` removes
   the named ones; `--base-raw-file` checks each named field against the
   entry the user was looking at. Exit codes:

   - **0** — applied.
   - **5** — applied EXCEPT the changes stderr lists as held: those fields
     changed on disk since the modal opened (someone else edited them), so
     the newer value was kept rather than overwritten. Not an error — carry
     the held lines into the reply (and step 6's summary) so the user can
     redo them against the current entry. Continue with steps 3–7.
   - **2** — refused, nothing written (the entry is gone from master.bib, or
     `baseRaw` is unreadable). Report stderr verbatim and **skip to step 7**
     — the edit cannot be applied, and leaving it queued only re-fails.
   - **anything else** — nothing written; report it verbatim and stop.

   **Do not** pass `--bib-state`: a manual edit doesn't invalidate
   prior authentication. The existing `% bib.state = ...` comment is
   preserved when you omit the flag.

3. **Sync `papers/<citekey>/references.bib`** through the shared helper —
   the same one `/library/authenticate-bib` step 6 calls. Note this is the
   one command in this skill that does **not** interpolate `"$CITEKEY"`
   into the program text: a `$VAR` inside a heredoc/`-c` program is not
   expanded, so the key is passed as **argv** instead.

   ```bash
   python3 - "$CITEKEY" <<'PY'
   import sys; from pathlib import Path
   sys.path.insert(0, ".virgil/scripts/library")
   from index_paper import _resync_references_bib
   ok = _resync_references_bib(Path("."), sys.argv[1])
   print("references.bib resynced" if ok
         else "paper dir or master row missing — skipped")
   PY
   ```

   It **upserts**: only the `<citekey>` block is replaced, every other
   entry survives byte-identically, and it returns False (no-op) when
   `papers/<citekey>/` doesn't exist — legitimate, since the user may have
   edited a hand-added bib entry that has no indexed paper folder yet.
   On a `.bib` too malformed to splice safely it raises `BibSpliceRefused`
   and leaves the file untouched; report that verbatim and continue.

   Do **not** hand-write this file with a whole-file `Write` of one
   emitted entry. `references.bib` is a single-entry mirror of the
   master.bib block only until `/library/deep-index` runs: step 3f
   replaces it with the paper's **actual cited works**, so a re-emit
   destroys a deep-indexed paper's whole bibliography — and the loss
   propagates silently into the next `/library/merge-bibs` (task 168).

4. **Update `.virgil/catalog.json`** via the locked CLI shim. The field
   changes are the diff's `set` and `remove` minus anything step 2 held
   (`from` = the base value, `to` = the new value or `""` for a removal).
   Construct a patch:

   ```bash
   cat > "/tmp/$CITEKEY-bibedit-patch.json" <<'EOF'
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
   python3 .virgil/scripts/library/update_catalog_entry.py "$CITEKEY" \
     --patch-file "/tmp/$CITEKEY-bibedit-patch.json"
   rm "/tmp/$CITEKEY-bibedit-patch.json"
   ```

   Include top-level `title`/`authors`/`year`/`doi` only for the
   fields that changed — the deep-merge preserves untouched fields.

   **Do NOT** clear `bib.state` — a manual edit doesn't invalidate
   prior authentication. If the user wants to re-authenticate,
   they'll click "AI review" which queues `kind: "authenticate"`
   separately.

   Note: `bib.fieldChanges` is an array, and deep-merge **replaces**
   arrays. If you need to *append* to the existing fieldChanges, read
   it first (`jq ".entries[] | select(.citekey == \"$CITEKEY\") |
   .bib.fieldChanges" .virgil/catalog.json`) and include the
   concatenated list in the patch.

   Exit codes — the same three `/library/authenticate-bib` step 7
   documents, because this skill serves the same entries. Step 3 above
   already blessed the fileless case (the user may edit a hand-added bib
   entry with no indexed paper folder), and under the F#4 holdings model
   such an entry has **no catalog row** — its state lives as the
   `% bib.state` comment in master.bib. The Library list renders those
   references as synthetic rows and their **Edit** button queues a bib
   edit, so this is a live path, not a corner:

   - **exit 1** — no catalog row for this citekey (a reference-only entry:
     cited but not held, so the F#4 gate never minted one). The master.bib
     edit in step 2 is the real write and it has already landed; there is
     nothing to mirror. Note it in the reply — "reference-only, no catalog
     row to update" — and **continue to steps 5–7**. Do not stop: the
     queue-entry cleanup lives there, and an aborted run leaves
     `.virgil/queue/<citekey>-bibedit.json` undrained and re-attempted on
     every subsequent `/library/index-pending`.
   - **exit 2** — a refusal, and the write did not happen: an unreadable or
     malformed patch file. (Its sibling in `/library/authenticate-bib` lists
     a third cause — a row whose `indexed.warnings` is not a list — which
     cannot fire here: that check lives inside `update_catalog_entry`'s
     `--recompute-warning-kind` branch, and step 4 passes no such flag.)
     Report the message verbatim and continue; it needs a human repair.
   - **anything else** — treat as exit 2. The write did not happen; say so
     rather than guessing which branch it was.

5. **Bump `.virgil/catalog-version.txt`** — already done by step 4's
   script when it wrote a row. On the `exit 1` (reference-only) path there
   is no catalog change to announce, and the master.bib write in step 2
   schedules the `bib-index.json` rebuild the Library list actually reads
   for that entry. Either way, no additional bump.

6. **Append a notification** via the locked CLI shim:

   ```bash
   cat > "/tmp/$CITEKEY-bibedit-notify.json" <<'EOF'
   { "kind": "authenticated", "citekey": "<citekey>", "at": "<now ISO>",
     "summary": "Applied manual edit (<N> field changes)" }
   EOF
   python3 .virgil/scripts/library/append_inbox_item.py \
     --item-file "/tmp/$CITEKEY-bibedit-notify.json"
   rm "/tmp/$CITEKEY-bibedit-notify.json"
   ```

   (The `authenticated` kind is reused — the frontend renders it as a
   neutral toast and we don't want to expand the kind enum just for this.)

7. **Mark the queue entry done** through the queue-slot door:
   ```bash
   python3 .virgil/scripts/library/queue_slot.py retire --kind bib-edit --citekey <citekey>
   ```
   (It moves `<citekey>-bibedit.json` → `<citekey>-bibedit.done`, rotating an
   older `.done` out of the way first. Deleting the `.json` is also fine.)

## Reply format

One line:
> `Applied bib edit for <citekey>: <N> field changes.`

If step 2 held changes (exit 5), append them on the same line:
> `Applied bib edit for <citekey>: <N> field changes; held <M> that changed on disk since the edit was opened (<field>, …).`

For a reference-only entry (step 4 exited 1), say so on the same line:
> `Applied bib edit for <citekey>: <N> field changes (reference-only — no catalog row).`

If the queue entry was malformed or the citekey was missing, paste the
relevant traceback / explanation in a fenced block and stop. Don't
attempt heuristic reconstruction of garbled fields.
