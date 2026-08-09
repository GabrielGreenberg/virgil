<!-- Canonical "find-or-surface, never fabricate" doctrine for every
     citation / bibliography skill in BOTH silos (editor + library).

     SSOT: this file is the single source of truth. An identical copy
     lives at `editor/skills/_find-or-surface.md` so the editor bundle
     ships it too (editor and library are separate bundles that land in
     separate on-disk folders, so each silo needs a local copy for the
     `[_find-or-surface.md](_find-or-surface.md)` links to resolve). The
     two copies are kept byte-identical by a drift-guard test
     (`library/lib/__tests__/find-or-surface-doctrine.test.ts`) — edit
     BOTH, or the test fails. Do not paraphrase this doctrine back into a
     skill; link to it.

     Not a slash command — the leading underscore filters it out of the
     command mirror in both build scripts. -->

## Find-or-surface doctrine (load-bearing)

Sourcing skills — anything that adds, verifies, or cites a real work
(`find-citation`, `authenticate-bib`, `answer-bib-review`,
`draft-footnote`, `sync-bib-to-library`, `import-bib`, `merge-bibs`,
`clean-bibliography`) — share one rule. It is stated **here once** and
referenced, never re-paraphrased, so it cannot drift skill to skill.
This set is the mirror image of the drift-guard test's
`REFERENCING_SKILLS`
(`library/lib/__tests__/find-or-surface-doctrine.test.ts`): a skill added
here that drops its pointer, or a new sourcing skill added to the set,
fails CI until it links back.

**1. Never fabricate.** A source, a bibliographic field, a DOI/ISBN, or a
`\cite`/`\citet`/`\textcite` command is real evidence about the world. Do
not invent one. Concretely, never:

- mint a citation for a work you could not locate in an authoritative
  source;
- fill a bib field (`doi`, `author`, `title`, `year`, `journal`,
  `publisher`, …) from guess, from a landing-page URL, or from the
  model's own recollection;
- emit a `\citet{key}` for a `key` that is not in `references.bib`;
- pass off a low-confidence match as authenticated.

A fabricated citation is worse than a missing one: it looks correct,
survives every structural validator, and is only caught by a human who
tries to follow it. Silence about a gap is the failure mode; a surfaced
gap is the success mode.

**2. Search the Library first.** Before reaching for external databases,
check the user's Virgil Library — the canonical `master.bib` and its
catalog (via the library-path resolver / `bib_auth.py`, or a direct read
of `master.bib` when you already hold the library root). The user may
already own the work, already authenticated. A Library hit is the
strongest, cheapest source: it reuses the user's own verified metadata
and citekey conventions instead of minting a divergent entry. This step
is the reason the doctrine is Library-first, not database-first.

**Calling `bib_auth.py`.** The helper has TWO modes, and picking the wrong
one is how a sourcing skill talks itself into the failure path with a good
answer in hand. State the mode explicitly; there is no useful default.

- **Discovery** — you're looking for a work you don't have yet:
  `bib_auth.py --query "<free text>" [--type article] [--limit N]`.
  Prints `{"mode": "search", "candidates": [...]}`: ranked records from
  Crossref / OpenAlex / Semantic Scholar / arXiv (plus OpenLibrary +
  Google Books for book types). Each candidate is a **lead**, and its
  `score` is title similarity — your skill's acceptance bar still decides
  whether it's found. Never authenticate a description: the seed title
  can't match, so the verdict is `failed` even when the top hit is right.
- **Verification** — you hold a specific entry and want a verdict:
  `bib_auth.py --citekey <key> [--library <root>]`, or
  `bib_auth.py --fields-file <entry.json> [--type <bibtex-type>]` when the
  entry isn't in the Library's `master.bib`. Prints the `AuthResult`
  (`state`, `matched_record`, `field_changes`). Both doors exist to carry
  the entry's own fields in **verbatim**: `doi`, `eprint`, `isbn`,
  `journal` and `url` drive the fast-paths that fix bad metadata, so an
  entry reduced to a title gets only the fuzzy search. `--citekey`
  additionally passes the library root through, enabling the recovery
  chain over `papers/<key>/`. Prefer either to hand-marshalling the values
  into a `python3 -c` snippet, which is where transcription and
  shell-quoting errors come from. Individual seeds can be overridden —
  `bib_auth.py --citekey <key> --title "<corrected>" --author "<a>" --type <t>`
  — and positional `<title> [author…]` still works.

The flags above are checked against the script's real interface by
`library/lib/__tests__/skill-script-cli-guardrail.test.ts`, for every skill
in both silos — a documented flag no script declares fails CI, and that
includes the interpreter-less forms written here.

**3. Then external authoritative sources.** If the Library has no match,
search Crossref → OpenAlex → Semantic Scholar → arXiv (and
OpenLibrary / Google Books / Internet Archive for books) — in that order
of preference. Each skill's own acceptance bar (DOI-verified,
multi-source agreement thresholds, the pre-digital route) governs what
counts as "found"; the doctrine does not relax it.

**4. If still not found, surface the gap — never fake it.** Take the
failure path the skill provides, rather than inventing content:

- **`find-citation`** → mark the request complete/failed with a note
  explaining what was searched (no `.bib` / card write).
- **`authenticate-bib`** → the terminal state (`unverified` / `failed` /
  `canonical`) *is* the surfaced gap; leave junk fields for a human, do
  not "authenticate" a guess.
- **`answer-bib-review`** → leave the unverifiable field as-is and name it
  in the reply as still-unverified.
- **`draft-footnote`** and prose skills → write the prose without the
  unresolved cite and file a `citation` follow-up request; never emit a
  `\citet{key}` for a missing key.

The specific op / status vocabulary is the skill's; the principle —
**find it for real, or surface that you couldn't** — is this file's.
