---
description: |
  Verify and look up a bibliography entry in the Virgil Library against
  external authoritative sources. Triggers on: "authenticate <citekey>",
  "verify this bib entry", "look up the metadata for <citekey>",
  "Virgil, check this reference against Crossref", "fix the fields for
  X". Searches Crossref/OpenAlex/Semantic Scholar/arXiv, verifies any
  DOI, cross-checks fields, logs diffs, and updates master.bib +
  catalog status. Does NOT trigger for adding a new citation by
  description (use /editor/find-citation in a paper context), for
  applying a manual user edit (use /apply-bib-edit), or for
  whole-paper bibliography cleanup (use /clean-bibliography). Light —
  safe to invoke from a paper session with --library. Args:
  <citekey> [--library <path>].
---

# /authenticate-bib $ARGUMENTS

## Args

- `<citekey>` — the entry in `master.bib` to authenticate.
- `--library <path>` — override library-path resolution. Useful when
  invoking this skill **from a paper session** with multiple libraries on
  disk; without it the normal chain
  (`./.virgil/library-path.json` → `VIRGIL_LIBRARY_ROOT` →
  `~/.config/virgil/library-path.json` → `~/Virgil-Library/`) is used.

## Bootstrap (run this first)

This skill operates on the user's Virgil Library. Resolve the library
root and cd into it before running anything else — that way the skill
works from any Virgil-managed folder (paper folder, library folder, or
anywhere with the Virgil sync bundle).

```bash
# Set from the invocation above: LIBRARY holds the value of an explicit
# `--library <path>`, and stays empty when the caller didn't pass one.
# Build the flag as an ARRAY, not a `${LIBRARY:+--library "$LIBRARY"}`
# string — under zsh that idiom collapses into ONE argument
# ("--library /path") and argparse rejects it. Empty array = zero args,
# so an absent flag falls through to the normal resolution chain.
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

All paths in the rest of this skill resolve against the library root.

---

> **Shared doctrine — find-or-surface, never fabricate.** Read
> [_find-or-surface.md](_find-or-surface.md). This skill is the
> verification arm of that doctrine: authenticate against real sources,
> and let the terminal state (`unverified` / `failed` / `canonical`) be
> the surfaced gap — never "authenticate" a guess or invent a field.

Run the bib authentication subprocess for ONE citekey. Useful when:
- A user added an entry to `master.bib` by hand and wants it verified
  without indexing a PDF.
- The `bib.state` for an indexed paper is `unverified` and the user wants
  to retry (e.g. after the network was flaky).

## Steps

All paths below are relative to the library root (the current working
directory).

1. **Read the citekey's current fields** from `master.bib`.

2. **Coherence pre-flight — ADVISORY, never a gate.** Run the cross-field
   checker *before* the network search, so an internally-incoherent entry is
   known while you are still choosing the seed. That shape is what PRODUCES
   the failure this skill is most often called to repair: in the
   `2026-05-13-bib-auth-mismatch-leong1994towards` memo a `@phdthesis`
   carrying a `journal` field drew a partial Crossref match against a journal
   article and came back "authenticated" as one.

   ```bash
   python3 .virgil/scripts/library/validate_bib_coherence.py "<citekey>" --json --no-cover-check
   ```

   **Branch on the REPORT, never on `$?` alone.** The script's exit codes are
   honest (0 clean / 1 findings / 2 unreadable entry), but the two non-zero
   answers mean opposite things and only the JSON says which:

   - **`{"error": …}`** — the entry is not in `master.bib`. That is a wrong
     citekey (or an entry nobody has written yet), *not* incoherence. Stop and
     report it: step 3's `--citekey` reads the same file and fails the same
     way, so there is nothing further to run.
   - **`"findings": []`** — nothing to say. Continue, silently.
   - **`"findings": [...]`** — record them and **continue anyway**. A finding
     is a hint for the auth pass, not a refusal:
     - a disallowed `journal` on a `@phdthesis`/`@inproceedings` entry is
       usually a wrong `@type`, so it is a candidate for step 3's
       `--type <bibtex-type>` override — the seed the helper cannot infer;
     - it is also the case where step 5's `proposed_type` deserves a real
       eyeball rather than a rubber stamp, since a partial match against the
       *wrong* record is exactly what the incoherent field invites.

   Two flags on that line are deliberate. `--no-cover-check` keeps this to
   the cross-field leg: cover-page-vs-bib checking already has an owner in
   `/library/di-preflight` (`detect_metadata_mismatch.py`, with a richer
   `kind` taxonomy feeding an auto-resolution policy), and a second algorithm
   for one question is worse than none. `--check-url-doi` stays off because
   it is a live `urlopen` with a 10 s timeout, and this step must stay cheap
   and local.

   **Persist the verdict** so a finding outlives the run and reaches the
   Library UI. Run this **whether or not there were findings** — the kind is
   declared either way, and a declared kind with an empty array is how a
   finding the user has since fixed stops being flagged (append-if-absent
   could never clear it):

   ```bash
   cat > /tmp/<citekey>-coherence.json <<'EOF'
   {
     "indexed": {
       "warnings": [
         "bib-coherence: @phdthesis should not have `journal` field (value: '...')"
       ]
     }
   }
   EOF
   python3 .virgil/scripts/library/update_catalog_entry.py "<citekey>" \
     --patch-file /tmp/<citekey>-coherence.json \
     --recompute-warning-kind bib-coherence
   rm /tmp/<citekey>-coherence.json
   ```

   Every line must start `bib-coherence: ` — the shim drops and re-appends by
   exact head, and a fresh line whose head isn't a declared kind is refused
   outright (it could never be dropped by a later pass, so it would duplicate
   forever). `bib-coherence` is **this skill's** warning kind: no deep-index
   step declares it, so nothing else clears it, and a finding survives until
   the next authentication of this entry.

   Handle the shim's own exit codes — this is a catalog write inside a skill
   that deliberately serves entries with no catalog row:

   - **exit 1** — no catalog row for this citekey (a reference-only entry:
     cited but not held, so the F#4 gate never minted one). There is nothing
     to write. Note it in the reply and **continue** — an advisory warning
     that cannot be filed must not end an authentication run.
   - **exit 2** — a real refusal (malformed patch, or a row whose
     `indexed.warnings` is not a list). Report the message verbatim and
     continue; the row needs a human repair.

   Do **not** set `bib.state = needs-reauth` here. `_tools.py` defines that
   state as "re-run `/library/authenticate-bib`", which is circular from
   inside this skill.

3. **Run the helper.** `--citekey` reads title / authors / fields /
   entry-type straight out of `master.bib` and threads the library root
   through, so the recovery chain can read the indexed paper at
   `papers/<citekey>/main.tex`. The Python pipeline lives at
   `.virgil/scripts/library/`.
   ```bash
   python3 .virgil/scripts/library/bib_auth.py --citekey <citekey> --library .
   ```
   Prints the `AuthResult` as JSON (`state`, `sources`, `score`,
   `matched_record`, `field_changes`, `proposed_type`).

   **Don't hand-marshal the seed values.** The entry must reach the helper
   exactly as it appears in `master.bib` — verbatim, no cleanup, no
   normalization — because the DOI fast-path, arXiv-ID fast-path and
   recovery chain are what fix bad metadata; cleaning up first defeats
   them. `--citekey` guarantees that by construction, where retyping the
   fields into a `python3 -c` snippet cannot (an apostrophe or a brace
   accent in a title breaks the shell quoting outright).

   Two overrides exist for the cases the bib alone can't express, both
   keeping the rest of the entry verbatim: `--title "<corrected>"` re-runs
   the search with a different seed — for when the bib's title is a
   triage-time stub the helper's own recovery chain couldn't get past, and
   you have the real one from the PDF cover page (`/library/index-paper`
   step 3 spells that case out) — and `--type <bibtex-type>` overrides a
   wrong `@type`. The Python API (`from bib_auth import authenticate`)
   remains for scripts that already hold the fields in memory —
   `index_paper.py` and `merge_paper_references.py` use it.

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

   5. **Pre-digital route → `authenticated`, then the `canonical`
      descriptor (F#3).** When the full chain fails on what looks like a
      pre-digital work (book/incollection/inbook, `0 < year < 1980`, no
      DOI and no ISBN in the bib), the helper runs the **pre-digital
      authentication route** before giving up: it scores agreement across
      book catalogs (OpenLibrary, Internet Archive, Google Books) and
      scholarly indexes (OpenAlex, Crossref), corroborated by the bib's
      publisher. If ≥2 independent sources agree on title+author (or one
      authoritative catalog agrees AND the publisher matches), the entry
      becomes a real **`authenticated`** with a provenance note — a
      pre-digital work CAN be authenticated, just by different means than
      a DOI. Only when that route ALSO finds no agreement does the helper
      fall back to `state="canonical"` — now a *descriptor* ("pre-digital
      classic; no authoritative agreement found"), not a give-up auth
      state. Runs for cited-only references too (no paper folder needed).
      Year gate is **`<1980`** (the code's actual cutoff; older docs said
      ~1950).

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

4. **Fill remaining fields via web search.** The Python helper covers
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
   source, at}` dicts). They're merged into the catalog row in step 7
   — keep them outside `result.field_changes`.

5. **Apply changes** to `master.bib`. **Filter before applying:**
   - Drop any `field_change` whose target field is inapplicable to
     the entry type (the table in step 4). For example, when the
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
   Read/Write `master.bib` directly.

   > **The shim's write is a WHOLE-BLOCK REPLACEMENT, not a diff.** It
   > finds the brace-balanced `@<type>{<citekey>, ...}` block and
   > replaces it with a block emitted from *exactly* the fields file —
   > nothing is merged for you. What you are holding at this point is a
   > **filtered change list**, not an entry, so writing it directly
   > would destroy every field the auth pass didn't touch (`pages`,
   > `volume`, `publisher`, `doi`, `isbn`, `url`, `note`). Two ways to
   > be safe, and the shim refuses the write unless you pick one:
   >
   > - **Pass `--merge-existing`** (used below) — the shim merges your
   >   change-set over the entry's current fields, so untouched fields
   >   survive. This is the right form for an auth pass.
   > - Or build the complete merged set yourself, from the fields you
   >   read in step 1 plus the surviving changes, and write that.
   >
   > A field you mean to *remove* needs `--drop-field <name>`
   > (repeatable). `--merge-existing` re-adds every field the entry
   > currently has, so an omission can no longer say "remove this" —
   > `--drop-field` is applied after the merge and is the only removal
   > signal that composes with it. (`--allow-field-drop`, which trusts
   > omission as removal, is inert here; that flag is for
   > `/apply-bib-edit`, where the user hands a complete entry.)

   **Entry type — use the helper's `proposed_type` when it set one.**
   `AuthResult.proposed_type` is non-empty when Crossref's type
   disagrees with the master.bib type (article + book-chapter →
   `incollection`, article + proceedings-article → `inproceedings`,
   posted-content → `unpublished`). The helper computed the field
   changes you are about to apply *against that proposed type*
   (`effective_type = proposed_type or entry_type`), so re-emitting
   under the original type would land the new fields — `booktitle`,
   `publisher` — on an entry still marked `@article`. Write
   `r["proposed_type"] or "<entry_type>"`.

   A type change usually also *retires* fields, and the helper only ever
   proposes additions — so name the retirements yourself with
   `--drop-field`, matching what `index_paper.py` does in-process for
   this same flow:

   | type change | also pass |
   |---|---|
   | `article` → `incollection` | copy `journal`'s value into `booktitle` if absent, then `--drop-field journal` |
   | anything → `unpublished` | `--drop-field journal --drop-field booktitle --drop-field volume --drop-field number --drop-field pages` |
   | `article` → `inproceedings` | copy `journal` → `booktitle` if absent, then `--drop-field journal` |

   ```bash
   cat > /tmp/<citekey>-auth-fields.json <<'EOF'
   { "title": "...", "author": "...", "year": "...", ... }
   EOF
   python3 .virgil/scripts/library/update_master_bib_entry.py "<citekey>" \
     --entry-type "<proposed_type or entry_type>" \
     --fields-file /tmp/<citekey>-auth-fields.json \
     --bib-state "<final_state>" \
     --merge-existing
   rm /tmp/<citekey>-auth-fields.json
   ```

   `--bib-state` updates the `% bib.state = <X>` comment preceding the
   entry to the terminal state (`authenticated` / `unverified` /
   `canonical` / `failed`) in the same locked write — no separate
   step-10 marker-comment edit is needed.

   Record only the changes you actually applied in `bib.fieldChanges`
   (step 7). If you applied a type change, say so in the reply.

6. **Sync `references.bib`** from the updated master.bib entry. The citekey
   goes in as **argv**, not interpolated into the program — a `$VAR` inside
   `python3 -c '…'` single quotes is never expanded by the shell, so that
   form silently resyncs nothing:
   ```bash
   python3 - "<citekey>" <<'PY'
   import sys; from pathlib import Path
   sys.path.insert(0, ".virgil/scripts/library")
   from index_paper import _resync_references_bib
   ok = _resync_references_bib(Path("."), sys.argv[1])
   print("references.bib resynced" if ok
         else "paper dir or master row missing — skipped")
   PY
   ```

   The helper **upserts** — it replaces only the `<citekey>` block and
   leaves every other entry in the file byte-identical. That matters
   because `papers/<citekey>/references.bib` is a single-entry mirror of
   master.bib only until `/library/deep-index` runs: step 3f replaces it
   with the paper's **actual cited works**. Never hand-write this file
   with a whole-file `Write` of one emitted entry — that is exactly the
   truncation this helper exists to prevent (task 168).

   On a `.bib` malformed enough that the splice can't be made safely (an
   unbalanced brace in a value), the helper raises `BibSpliceRefused` and
   leaves the file **untouched** — losing entries is never the fallback.
   Report the message verbatim and move on to step 7; the bib needs a human
   repair.

7. **Update .virgil/catalog.json** — derive top-level fields from master.bib so
   they can't drift. Build `bib_status` from the helper's `AuthResult`
   and the prior catalog row's `fieldChanges` (the helper returns only
   *this run's* changes; we want the cumulative list):
   ```bash
   python3 -c '
   import sys, json, time
   from pathlib import Path
   sys.path.insert(0, ".virgil/scripts/library")
   from index_paper import _sync_catalog_entry_from_master

   # `r` is the AuthResult dict from step 3 (deserialize the JSON the
   # helper printed — don't re-run it). `tier1_changes` is the
   # extra field-change list you produced in step 4 — same shape as
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
   # `canonical` may upgrade — it is NO LONGER terminal (F#3). It now means
   # "the pre-digital route ran and found no authoritative agreement", so if
   # YOU have ≥2 authoritative tier-1 corroborations for a `canonical` verdict
   # (e.g. Internet Archive + a publisher page agreeing on the work), promote
   # it to `authenticated` the same way as the unverified case — the helper's
   # pre-digital route simply didn't reach those sources. The deeper fix is to
   # surface the corroboration to bib_auth.py's pre-digital route; this is the
   # operator escape hatch.
   if (r["state"] == "canonical"
           and len(t1_sources & AUTHORITATIVE) >= 2):
       final_state = "authenticated"
       final_sources = list(r["sources"]) + sorted(t1_sources & AUTHORITATIVE)

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

8. **Append a notification** via the locked CLI shim. (No need to bump
   `catalog-version.txt` separately — step 7's
   `_sync_catalog_entry_from_master` does it for you.)

   > **`kind` is the frontend's toast enum, NOT the bib.state enum.**
   > The only values the Library UI knows are `"indexed"`,
   > `"authenticated"`, `"failed"`, `"triaged"`, `"setup-needed"`
   > (`NotificationItem["kind"]` in `library/lib/queue.ts`). Nothing
   > rejects an off-list value — `append_inbox_item.py` appends
   > verbatim — it just falls through `notificationSeverity()` to the
   > default `info`, so a `"unverified"` toast that should linger for
   > 11 s as an *attention* row is rendered as a routine 5 s one and the
   > user misses the entry that needed them. So map the terminal state
   > onto the enum by **whether the user must act**, and keep the
   > fine-grained state in the summary:
   >
   > | terminal state | `kind` | why |
   > |---|---|---|
   > | `authenticated` | `authenticated` | done, neutral toast |
   > | `canonical` | `authenticated` | descriptor, not a give-up — no action needed |
   > | `manuscript` | `authenticated` | terminal, no action needed |
   > | `unverified` | `failed` | "manual review recommended" — needs the attention TTL |
   > | `failed` | `failed` | needs the attention TTL |
   >
   > Reusing `authenticated` as the family's neutral kind rather than
   > widening the enum is the same call `/apply-bib-edit` makes.

   ```bash
   cat > /tmp/<citekey>-auth-notify.json <<'EOF'
   { "kind": "<authenticated|failed per the table above>",
     "citekey": "<citekey>",
     "at": "<now ISO>",
     "state": "<terminal state>",
     "summary": "<citekey>: <terminal state> via <sources> (<N> field changes)" }
   EOF
   python3 .virgil/scripts/library/append_inbox_item.py \
     --item-file /tmp/<citekey>-auth-notify.json
   rm /tmp/<citekey>-auth-notify.json
   ```

9. **Remove from pending-reviews manifest.** Read
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

10. **(No-op.)** The `% bib.state = <X>` marker comment is updated as
   part of step 5 via `update_master_bib_entry.py --bib-state`. No
   separate edit needed.

## Reply format

**Always lead with the step-2 pre-flight verdict**, on its own line before
the state line below. It is advisory, so nothing downstream stops on it —
which is exactly why it has to be *said*: an unreported advisory finding is
indistinguishable from no finding.

If step 2 produced findings:
> `Pre-flight: <N> cross-field coherence finding(s) — <first finding>. Recorded as bib-coherence: in the catalog row.` (add `Catalog row absent (reference-only entry); not recorded.` when the shim exited 1)

If it produced none:
> `Pre-flight: coherent (@<entry_type>).`

If it could not read the entry (`{"error": …}`), that is the whole reply —
report the message verbatim and stop; the auth step reads the same file.

Then, for the terminal state:

If `state == "authenticated"`:
> `Authenticated <citekey> via <sources>. <N> field changes applied.`
> (When the pre-digital route fired, `<sources>` reads `predigital(<srcs>)` and
> the note records the corroborating catalogs/indexes.)

If `state == "unverified"`:
> `Unverified <citekey>. Best match score <S> from <source>. Manual review recommended.`

If `state == "canonical"`:
> `<citekey>: pre-digital work (year=<y>); the pre-digital route found no authoritative multi-source agreement. Marked canonical (descriptor, not a give-up — re-runnable as catalogs improve).`

If `state == "manuscript"`:
> `<citekey>: marked as manuscript (entry_type=@unpublished). No external authentication attempted; pill marked MS.`

If `state == "failed"`:
> `Failed to authenticate <citekey>. <note>. Try the Google Scholar search manually: <google-scholar-search-url>`
