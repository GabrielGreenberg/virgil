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
   can read the indexed paper at `papers/<citekey>/main.tex`. The Python
   pipeline lives at `.virgil/scripts/` (NOT `scripts/`).

   **Pass `title`, `authors_list`, and `fields_dict` exactly as they
   appear in `master.bib` — verbatim, with no cleanup or normalization.
   The helper is responsible for fixing bad metadata via the DOI fast-
   path, arXiv-ID fast-path, recovery chain, etc. Cleaning up before
   passing in defeats the recovery logic.**
   ```bash
   python3 -c '
   import sys, json
   from pathlib import Path
   sys.path.insert(0, ".virgil/scripts")
   from bib_auth import authenticate
   from dataclasses import asdict
   # Fill in title and authors from master.bib for citekey, verbatim
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
   2. **arXiv-ID fast-path.** If the bib contains an arXiv ID in any
      common field (`journal`, `note`, `url`, `eprint`, `archivePrefix`,
      `howpublished`), the helper extracts it and verifies via the
      arXiv `id_list=` endpoint (deterministic — no fuzzy match). On
      success it self-heals `eprint` + `archivePrefix` back into the
      bib so future runs hit the deterministic path immediately.
   3. **Main multi-source title search.** Crossref + OpenAlex + Semantic
      Scholar + arXiv (and OpenLibrary/Google Books for books).
      **Watch for `sources=["crossref-republication"]`:** for
      `@article` entries with a known conference venue (NeurIPS, ICML,
      etc.) the helper retries Crossref both as `proceedings-article`
      and broad. The broad retry catches journal republications of
      conference papers (e.g. AlexNet 2012 NeurIPS republished in 2017
      CACM) and may swap `year`, `journal`, and `doi` wholesale. The
      citekey often bakes in the original year/venue, so eyeball
      `result.matched_record` before applying — the user may prefer to
      keep the original form.
   4. **Recovery chain** (only runs if the main search didn't
      authenticate AND `library`/`citekey` were passed):
      - Extract DOI candidates from `papers/<citekey>/main.tex` and the
        first 3 pages of the source PDF; verify each via Crossref;
        accept on author surname overlap.
      - Extract the first non-generic `\section{}` heading from
        `main.tex` and re-run the title search with that.
      - For book / incollection / inbook entries, scan the source PDF's
        copyright page for an ISBN; verify via OpenLibrary on title sim ≥0.8.
      - Crossref query by author + journal + year (ignoring the junk
        title) when a journal/booktitle field is present.

   5. **Canonical fallback.** When the full chain fails on what looks
      like a pre-digital work (book-typed, year before ~1950, no DOI
      and no ISBN in the bib), the helper returns
      `state="canonical"` instead of `failed` — these are works no
      external authority registry will ever index (Saussure, Frege,
      Plato, etc.) and the red `failed` pill is misleading for them.

   **Modern proceedings without DOIs are expected to land in
   `unverified`, not `authenticated` or `canonical`.** Conferences
   that predate their venue's Crossref registration (NeurIPS pre-
   2017, AAAI pre-2018, several ACL Anthology gaps, etc.) have no
   proceedings-level authority record to corroborate. The arXiv-ID
   fast-path verifies the *work's identity* deterministically (score
   1.0), but `unverified` is the right state because the *venue*
   isn't independently corroborated. Keep the bib's attested
   `booktitle`/`series`/`address` and let `eprint`/`archivePrefix`
   self-heal.

   The `result.note` field describes which step produced the match.

3. **Fill remaining fields via web search.** The Python helper covers
   the core nine fields but leaves the rest empty. Check which of
   `abstract`, `url`, `booktitle`, `editor`, `series`, `address`,
   `month`, `isbn`/`issn`, `edition` are still empty and fill them with
   progressively wider searches.

   **Skip fields that don't apply to the bib entry type:**
   - `@article`: `booktitle`, `editor`, `series`, `address`, `edition`,
     `isbn` are inapplicable; `issn` applies.
   - `@book`: `booktitle`, `editor` (unless edited volume) are
     inapplicable; `isbn`, `address`, `series`, `edition` apply.
   - `@incollection` / `@inbook`: `journal`, `issn` are inapplicable;
     `booktitle`, `editor`, `series`, `address`, `edition`, `isbn`
     apply.
   - `@inproceedings`: `journal` is inapplicable; `booktitle` (the
     conference proceedings name), `series`, `address` apply.

   For the still-empty applicable fields, run progressively wider
   searches:

   **Tier 1 — publisher page.** If a `doi` is present, `WebFetch
   https://doi.org/<doi>`. Else if the helper produced an `arxiv-id`
   match (or the entry has an `eprint = {<id>}` field), `WebFetch
   https://arxiv.org/abs/<arxiv_id>` for canonical URL, primary class,
   submission month, and (when present) cross-listed DOI. Otherwise
   `WebSearch` the exact title in quotes plus the first author's
   surname and fetch the publisher / repository page.

   *If the publisher page returns 4xx/5xx or blocks scrapers (common
   for ACM, Elsevier, Springer, IEEE, JSTOR, Wiley):* fall back to the
   helper's `result.matched_record.raw` Crossref payload for
   `abstract` (strip `<jats:p>` wrappers), `URL`, `published-online`/
   `published-print` month, and `ISSN` (use the print ISSN when both
   are returned). Source these field changes as `crossref-raw`. This
   is a routine fallback — don't treat the block as a failure.

   **Tier-1 source labels.** Use stable strings so subsequent runs
   can attribute changes:
   - `crossref-raw` — Crossref payload fallback (publisher page blocked)
   - `arxiv-api` — arXiv Atom feed (`http://export.arxiv.org/api/...`)
   - `arxiv-html` — arXiv abstract page (`https://arxiv.org/abs/...`)
   - `<venue>-proceedings` — canonical proceedings page, e.g.
     `nips-proceedings`, `acl-anthology`, `cvf-openaccess`
   - `internet-archive` — `archive.org/details/...` (the most reliable
     free source for book metadata when the publisher page blocks)
   - `worldcat` — `worldcat.org` (deep cataloging, alternate ISBNs)
   - `publisher-page` — generic publisher landing page

   **Tier 2 — third-party references.** `WebSearch` the title in
   quotes; pull values from other papers' bibliographies or
   authoritative catalogs (WorldCat, LoC, publisher site). Require two
   independent sources to agree, or one authoritative one.

   **Tier 3 — document inference.** If the source file exists at
   `papers/<citekey>/<citekey>.*`, check first/last pages for publisher city,
   dates, edition. Append `[inferred from source]` to `note` for any
   value obtained this way.

   Collect these findings as a separate `tier1_changes` list (same
   shape as the helper's `field_changes`: list of `{field, from, to,
   source, at}` dicts). They're merged into the catalog row in step 6
   — keep them outside `result.field_changes`.

4. **Apply changes** to `master.bib`. **Filter before applying:**
   - Drop any `field_change` whose target field is inapplicable to
     the entry type (the table in step 3). For example, when the
     helper's only match is arXiv on an `@inproceedings` NeurIPS
     entry, the helper proposes `journal=arXiv` and `publisher=arXiv`
     — both wrong for an inproceedings; drop them.
   - Drop changes that overwrite an attested venue field
     (`publisher`, `address`, `booktitle`, `series`) with a value
     drawn from a single non-canonical source. arXiv knows preprint
     metadata, not proceedings metadata; OpenLibrary knows book
     metadata at the edition level (often a different reprint than
     the bib's intended one).
   - **Single-source eyeball rule:** any time `r.sources` is a
     singleton (`["arxiv"]`, `["openalex"]`, `["semanticscholar"]`,
     `["openlibrary-search"]`) AND the bib already carries an
     attested venue, eyeball whether the proposed swaps would corrupt
     that attestation. The deterministic fast-paths (DOI fast-path,
     arXiv-ID fast-path) verify the *work*; they can't verify the
     *venue*.
   - **OpenLibrary cosmetic quirks** (when `r.sources ==
     ["openlibrary-search"]`): the OL search response (a) title-cases
     all titles ("Poetics Of Cinema"), (b) drops colon-subtitles
     ("Mind in Motion" instead of "Mind in Motion: How Action Shapes
     Thought"), and (c) renders authors as `"First Last"`. All three
     forms diverge from common bib conventions. Drop title-case and
     subtitle-truncation swaps unless an authoritative second source
     (publisher page, Internet Archive) corroborates the change; keep
     author in the bib's `"Last, First"` form.
   - **OpenLibrary multi-ISBN disambiguation:** OL works often expose
     multiple ISBNs (paperback + hardcover variants for the same
     work). When picking the ISBN to apply, prefer the one whose
     imprint year matches the bib's `year` (or the citekey's baked-in
     year) — corroborate via Internet Archive when possible.
   Apply the surviving changes via the locked CLI shim — do **not**
   Read/Write `master.bib` directly:

   ```bash
   cat > /tmp/<citekey>-auth-fields.json <<'EOF'
   { "title": "...", "author": "...", "year": "...", ... }
   EOF
   python3 .virgil/scripts/update_master_bib_entry.py "<citekey>" \
     --entry-type "<entry_type>" \
     --fields-file /tmp/<citekey>-auth-fields.json \
     --bib-state "<final_state>"
   rm /tmp/<citekey>-auth-fields.json
   ```

   `--bib-state` updates the `% bib.state = <X>` comment preceding the
   entry to the terminal state (`authenticated` / `unverified` /
   `canonical` / `failed`) in the same locked write — no separate
   step-9 marker-comment edit is needed.

   Record only the changes you actually applied in `bib.fieldChanges`
   (step 6).

5. **Re-emit `references.bib`** from the updated master.bib entry:
   ```bash
   python3 -c '
   import sys; from pathlib import Path
   sys.path.insert(0, ".virgil/scripts")
   from index_paper import _resync_references_bib
   ok = _resync_references_bib(Path("."), "<citekey>")
   print("references.bib resynced" if ok else "no paper dir — skipped")
   '
   ```

6. **Update .virgil/catalog.json** — derive top-level fields from master.bib so
   they can't drift. Build `bib_status` from the helper's `AuthResult`
   and the prior catalog row's `fieldChanges` (the helper returns only
   *this run's* changes; we want the cumulative list):
   ```bash
   python3 -c '
   import sys, json, time
   from pathlib import Path
   sys.path.insert(0, ".virgil/scripts")
   from index_paper import _sync_catalog_entry_from_master

   # `r` is the AuthResult dict from step 2 (deserialize the JSON
   # printed there, or rebuild it in-process). `tier1_changes` is the
   # extra field-change list you produced in step 3 — same shape as
   # the helper's: list of {"field": str, "from": str, "to": str,
   # "source": str, "at": ISO8601 str} dicts. May be [].
   r = <auth_result_dict>
   tier1_changes = <tier1_field_changes_list_or_[]>

   prior = {}
   cat = Path(".virgil/catalog.json")
   if cat.exists():
       for e in (json.loads(cat.read_text()).get("entries", []) or []):
           if e.get("citekey") == "<citekey>":
               prior = (e.get("bib") or {})
               break
   prior_changes = prior.get("fieldChanges") or []

   # Tier-1 upgrade: for DOI-less books, the helper's threshold logic
   # (Crossref+OpenAlex agreement, or Google Books × OpenLibrary
   # agreement at ≥0.85) is sometimes too strict — a single OL hit
   # corroborated by Internet Archive + the publisher page is just as
   # authoritative as a two-API title-search agreement. When state is
   # `unverified` AND tier1_changes contains corroboration from ≥2
   # *authoritative* sources (Internet Archive, WorldCat, publisher
   # page, venue-proceedings page) AND those changes agree with the
   # helper's matched_record on title/publisher/ISBN, the operator
   # may upgrade.
   t1_sources = {c["source"] for c in tier1_changes}
   AUTHORITATIVE = {"internet-archive", "worldcat", "publisher-page",
                    "crossref-raw"}  # add venue-proceedings labels as needed
   final_state = r["state"]
   final_sources = list(r["sources"])
   if (r["state"] == "unverified"
           and len(t1_sources & AUTHORITATIVE) >= 2):
       final_state = "authenticated"
       final_sources = list(r["sources"]) + sorted(t1_sources & AUTHORITATIVE)
   # `canonical` is terminal — never upgrade. If you have authoritative
   # tier-1 sources for a `canonical` verdict, the helper's canonical
   # fallback fired prematurely; the right fix is to surface the
   # corroboration to bib_auth.py, not to patch around it here.

   bib_status = {
       "state":         final_state,
       "doiVerified":   r["doi_verified"],
       "sources":       final_sources,
       "fieldChanges":  prior_changes + r["field_changes"] + tier1_changes,
       "score":         r["score"],
       "note":          r["note"],
   }
   if final_state == "authenticated":
       bib_status["authenticatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

   _sync_catalog_entry_from_master(Path("."), "<citekey>", bib_status)
   print(".virgil/catalog.json synced from master.bib")
   '
   ```
   `_sync_catalog_entry_from_master` *replaces* the catalog row's `bib`
   block wholesale — the merge with `prior_changes` above is what makes
   `fieldChanges` accumulate across runs.

7. **Append a notification** via the locked CLI shim. (No need to bump
   `catalog-version.txt` separately — step 6's
   `_sync_catalog_entry_from_master` does it for you.) Pick a `kind`
   matching the terminal state — one of `"authenticated"`,
   `"unverified"`, `"canonical"`, `"manuscript"`, or `"failed"`:

   ```bash
   cat > /tmp/<citekey>-auth-notify.json <<'EOF'
   { "kind": "<state>", "citekey": "<citekey>",
     "at": "<now ISO>",
     "summary": "Authenticated <citekey> via <sources> (<N> field changes)" }
   EOF
   python3 .virgil/scripts/append_inbox_item.py \
     --item-file /tmp/<citekey>-auth-notify.json
   rm /tmp/<citekey>-auth-notify.json
   ```

8. **Remove from pending-reviews manifest.** Read
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

9. **(No-op.)** The `% bib.state = <X>` marker comment is updated as
   part of step 4 via `update_master_bib_entry.py --bib-state`. No
   separate edit needed.

## Reply format

If `state == "authenticated"`:
> `Authenticated <citekey> via <sources>. <N> field changes applied.`

If `state == "unverified"`:
> `Unverified <citekey>. Best match score <S> from <source>. Manual review recommended.`

If `state == "canonical"`:
> `<citekey>: pre-digital classic (year=<y>); no external authority record expected. Pill marked canonical.`

If `state == "manuscript"`:
> `<citekey>: marked as manuscript (entry_type=@unpublished). No external authentication attempted; pill marked MS.`

If `state == "failed"`:
> `Failed to authenticate <citekey>. <note>. Try the Google Scholar search manually: <google-scholar-search-url>`
