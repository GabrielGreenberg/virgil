---
description: |
  Import ONE library paper's bibliography — fold
  `papers/<citekey>/references.bib` into the central `master.bib`. The
  single-paper slice of `/library/merge-bibs`: it runs the same per-entry
  engine (duplicate-detect → authenticate → transient-skip → locked
  master.bib write) for a single citekey, then marks the paper imported
  on its catalog row (the blue "imported" check) and snapshots its
  references.bib citekey set so a later *addition* clears the flag.

  Triggers on: "import this paper's bibliography", "import bib for
  <citekey>", "fold <citekey>'s references into master", or as the
  drain target for an `import-bib` AI request filed from the Library
  (the "Import bib" checkbox in the paper header / the "Import
  bibliography" row-menu item → `.virgil/queue/<citekey>-importbib.json`).

  Does NOT trigger for the whole-library merge — that's
  `/library/merge-bibs`. Does NOT verify a single bib entry — that's
  `/library/authenticate-bib`. Does NOT sync a working paper's bib
  against the library — that's `/editor/sync-bib-to-library`.

  Args: `<citekey>`.
---

# /import-bib $ARGUMENTS

Import one paper's `references.bib` into the library's `master.bib`.
Lightweight by design — it does NOT take the snapshot/preflight/postflight
machinery of `/library/merge-bibs` (that's for the whole-library sweep).
The engine self-locks every shared-file write, so a single-paper run is
safe to invoke directly.

## Bootstrap (run this first)

Resolve the library root and cd into it before running anything else.

```bash
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

All paths below resolve against the library root.

## Args

`$ARGUMENTS` is a single `<citekey>` (both dispatch callers —
`/index-pending` and `/ai-requests` — always pass it explicitly). If it's
empty (a bare manual invocation), fall back to the first pending
`*-importbib.json` request on the queue. Resolve it into `CK`:

```bash
CK="$(printf '%s' "$ARGUMENTS" | awk '{print $1}')"
if [ -z "$CK" ]; then
  for q in .virgil/queue/*-importbib.json; do
    [ -f "$q" ] || continue
    CK="$(python3 -c "import json; print(json.load(open('$q')).get('citekey',''))" 2>/dev/null)"
    [ -n "$CK" ] && break
  done
fi
if [ -z "$CK" ]; then
  echo "No citekey given and no pending *-importbib.json request found — nothing to do."
  exit 0
fi
echo "Importing bibliography for: $CK"
```

If the request came from the queue, read the file and **echo any `note`
verbatim** before acting — the user may have attached instructions:

```bash
qfile=".virgil/queue/${CK}-importbib.json"
[ -f "$qfile" ] && python3 -c "import json; d=json.load(open('$qfile')); n=d.get('note'); print('NOTE:', n) if n else None"
```

## Steps

1. **Confirm there is something to import.**
   ```bash
   test -f "papers/${CK}/references.bib" || { echo "no references.bib for ${CK} — nothing to import"; }
   ```
   If absent, delete the queue file (step 4) and stop with that message.

2. **Run the merge engine for this paper.** It does the dedup →
   authenticate → transient-skip work, writes
   `.virgil/merge-reports/<citekey>.json`, **marks the catalog row
   `bib.imported = true` (snapshotting `bib.importedKeys`)**, and bumps
   `catalog-version.txt` so the frontend shows the blue "imported" check
   within ~6s. One-line summary on stdout (`+A ~D ⇄U ⤬T ⚠F ?M`).
   ```bash
   python3 .virgil/scripts/library/merge_paper_references.py "${CK}"
   ```
   (The frontend's catalog-version poll handles the UI refresh — no
   extra bump needed.)

3. **Surface manual review, if any.** Read the report. If
   `manual_review[]` is non-empty, briefly look at each item (reading the
   relevant `master.bib` entries when useful) and tell the user what
   needs a human decision. Do NOT silently drop them — the paper is still
   marked imported (re-running won't help these specific entries), so the
   user needs to know. For `split_paper_unauthenticatable` /
   `split_citekey_collision` items, default to deferring to the user.

4. **Mark the request done.** If a queue file exists, delete it:
   ```bash
   rm -f ".virgil/queue/${CK}-importbib.json"
   ```

5. **Report.** One line:
   ```
   Imported <citekey>: +<added> ~<dup> ⇄<unauth-dup-handled> ⤬<transient> ⚠<failed> ?<manual>.
   ```

## Hard rules

- Operates on the user's real library — no test fixtures.
- Do not edit any file under `library/skills/` or `library/scripts/`.
- Do not invoke other `/library/...` skills from here — your job is to
  run the merge helper for one paper and surface its output.
- Never Read/Write `master.bib` or `.virgil/catalog.json` directly — the
  engine's locked writers own those.
