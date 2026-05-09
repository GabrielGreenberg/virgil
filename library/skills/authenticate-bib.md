---
description: Authenticate a .bib entry against Crossref/OpenAlex/Semantic Scholar/arXiv — verify DOI, cross-check fields, log diffs. Args: <citekey>.
---

# /authenticate-bib $ARGUMENTS

Run the bib authentication subprocess for ONE citekey. Useful when:
- A user added an entry to `master.bib` by hand and wants it verified
  without indexing a PDF.
- The `bib.state` for an indexed paper is `unverified` and the user wants
  to retry (e.g. after the network was flaky).

## Steps

All paths below are relative to the library root (the current working
directory).

1. **Read the citekey's current fields** from `master.bib`.

2. **Run the helper.** Pass `library` and `citekey` so the recovery chain
   can read the indexed paper at `papers/<citekey>/main.tex`:
   ```bash
   python3 -c '
   import sys, json
   from pathlib import Path
   sys.path.insert(0, "scripts")
   from bib_auth import authenticate
   from dataclasses import asdict
   # Fill in title and authors from master.bib for citekey
   r = authenticate(<title>, <authors_list>, <fields_dict>,
                    entry_type=<entry_type>,
                    library=Path("."), citekey=<citekey>)
   print(json.dumps(asdict(r), indent=2))
   '
   ```

   **What the helper does automatically (no skill-level backstop needed):**

   1. **DOI fast-path.** If the bib already has a `doi` and Crossref
      returns a record for it, return `authenticated` immediately. The
      DOI is the canonical identifier — junk titles in the bib don't
      block this. Field changes will replace the junk title with the
      Crossref title.
   2. **Main multi-source title search.** Crossref + OpenAlex + Semantic
      Scholar + arXiv (and OpenLibrary/Google Books for books).
   3. **Recovery chain** (only runs if step 2 didn't authenticate AND
      `library`/`citekey` were passed):
      - Extract DOI candidates from `papers/<citekey>/main.tex` and the
        first 3 pages of the source PDF; verify each via Crossref;
        accept on author surname overlap.
      - Extract the first non-generic `\section{}` heading from
        `main.tex` and re-run the title search with that.
      - Crossref query by author + journal + year (ignoring the junk
        title) when a journal/booktitle field is present.

   The `result.note` field describes which step produced the match.

3. **Fill remaining fields via web search.** The Python helper covers
   the core nine fields but leaves the rest empty. Check which of
   `abstract`, `url`, `booktitle`, `editor`, `series`, `address`,
   `month`, `isbn`/`issn`, `edition` are still empty and fill them with
   progressively wider searches:

   **Tier 1 — publisher page.** If a `doi` is present, `WebFetch
   https://doi.org/<doi>`. Otherwise `WebSearch` the exact title in
   quotes plus the first author's surname and fetch the publisher /
   repository page.

   **Tier 2 — third-party references.** `WebSearch` the title in
   quotes; pull values from other papers' bibliographies or
   authoritative catalogs (WorldCat, LoC, publisher site). Require two
   independent sources to agree, or one authoritative one.

   **Tier 3 — document inference.** If the source file exists at
   `papers/<citekey>/<citekey>.*`, check first/last pages for publisher city,
   dates, edition. Append `[inferred from source]` to `note` for any
   value obtained this way.

   Merge these findings into `result.field_changes` before proceeding.

4. **Apply changes** to `master.bib`:
   - For each field in `result.field_changes`, update the entry.
   - Re-emit the entry with the new fields.

5. **Re-emit `references.bib`** from the updated master.bib entry:
   ```bash
   python3 -c '
   import sys; from pathlib import Path
   sys.path.insert(0, "scripts")
   from index_paper import _resync_references_bib
   ok = _resync_references_bib(Path("."), "<citekey>")
   print("references.bib resynced" if ok else "no paper dir — skipped")
   '
   ```

6. **Update .virgil/catalog.json** — derive top-level fields from master.bib so
   they can't drift:
   ```bash
   python3 -c '
   import sys, json; from pathlib import Path
   sys.path.insert(0, "scripts")
   from index_paper import _sync_catalog_entry_from_master
   bib_status = <bib_status_dict_from_step_2>
   _sync_catalog_entry_from_master(Path("."), "<citekey>", bib_status)
   print(".virgil/catalog.json synced from master.bib")
   '
   ```
   The `bib_status` dict must include: `state`, `fieldChanges` (append to
   existing), `sources`, `doiVerified`, and `authenticatedAt` (if
   authenticated).

7. **Bump** `.virgil/catalog-version.txt` and append an `authenticated` notification.

7. **Remove from pending-reviews manifest.** Read
   `.virgil/queue/pending-reviews.json`, remove the entry for this citekey, and
   write back. This keeps the manifest in sync so subsequent skill runs
   don't re-process it.
   ```bash
   python3 -c '
   import json; from pathlib import Path
   p = Path(".virgil/queue/pending-reviews.json")
   if p.exists():
       d = json.loads(p.read_text())
       d["pendingReviews"] = [r for r in d.get("pendingReviews", []) if r["citekey"] != "<citekey>"]
       p.write_text(json.dumps(d, indent=2) + "\n")
   '
   ```

## Reply format

If `state == "authenticated"`:
> `Authenticated <citekey> via <sources>. <N> field changes applied.`

If `state == "unverified"`:
> `Unverified <citekey>. Best match score <S> from <source>. Manual review recommended.`

If `state == "failed"`:
> `Failed to authenticate <citekey>. <note>. Try the Google Scholar search manually: <google-scholar-search-url>`
