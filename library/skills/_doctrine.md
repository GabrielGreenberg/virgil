<!-- Shared doctrine for the deep-index subskill family.
     Transcluded by every subskill via `@_doctrine.md`.
     Do not surface this file as a slash command — the build script
     filters leading-underscore files out of the command mirror. -->

## Scope doctrine (load-bearing)

**Aggressive default: in-scope unless proven otherwise.** The deep-index
family is responsible for every cleanup problem that can be solved by
reading the source PDF, the existing `main.tex`, and the bibliography.
Recoverable problems explicitly include:

- **Footnotes** — leaked-prose, orphan, column-format, chapter-end,
  multi-page continuations, endnote-style (per-chapter and unified
  end-of-book), page-hint endnotes (popular-science books),
  superscript-prefixed leaks (modern OUP/Cambridge/Springer
  extracts). Walk the tier ladder. The Tier 4 orphan-prefix fallback
  always succeeds with approximate placement; it is strictly better
  than leaving content unattached.
- **Chapter titles and heading hierarchy** — infer from body context,
  the TOC, or PDF visual structure. Merge wrapped section fragments.
  Demote math-symbol-only headings. Delete OCR-garbage cluster
  headings (figure-caption blocks, payoff-matrix shorthand, diagram
  axis labels). Promote all-caps siblings.
- **Pagination and pgmarks** — offset detection has multiple fallback
  patterns (standalone numeric footer, recto/verso running headers,
  modal offset from multiple anchors). Blank pages get
  `\pgmark[low]{N}` with no body. Low-confidence markers get
  re-verified by content overlap after prose cleanup.
- **Misplaced text** — relocate body fragments to their correct
  positions; remove adjacent-article content from multi-article PDFs
  surgically.
- **Drop-cap recovery** — OCR'd chapter-starts missing their initial
  letter are recoverable from `pdftotext -layout` on the PDF.
- **Invisible characters and ligatures** — strip soft hyphens,
  normalize U+FB00–U+FB06 ligatures, replace mid-word NBSP, replace
  U+2800 Braille pattern blank in citation contexts. Decode
  Caesar-shifted custom-CMap PDF text (JSTOR class).
- **Bibliography parsing** — even 1000+ entry book bibliographies are
  in-scope. State-machine parser handles run-on prose; multi-word
  surnames (`McNaughton`, `van Fraassen`, `Graf Fara`) and lowercase
  particles (`von`, `de`, `van der`, `Mc`) work via longest-suffix
  match against the parsed author list. Subject indices are in-scope
  the same way bibliographies are.
- **Citation rewriting** — every style: author-year, APA
  comma-separator, numeric/Vancouver, bracket-key (SIGGRAPH/CS),
  bracket-author-year (SIGGRAPH/Eurographics), author-year-paren
  (humanities theses), bracket-locator (`Author [Year: page]`),
  endnote-style with full bibliographic detail at first mention.
  Index bib entries under every author surname (not just first).
  Title-only fallback for short-form citations. Alphabetic
  year-suffix support (`Peacocke 2017a` → `peacocke2017atemporal`).
  Fused-surname tokenizer (Mc/Mac/O'/D'/De/Van/Von/La/Le/St).
- **Multi-article PDFs** — JSTOR scans and Annual-Reviews collections
  that bundle adjacent-article content into `main.tex` get surgical
  removal. Use `detect_multi_article.py` to identify; remove with
  a targeted body edit, not by re-extracting.
- **Content/metadata mismatch (file is source of truth)** — when the
  on-disk file content does not match `master.bib` (e.g., the file
  is the whole book but `master.bib` describes one chapter), update
  the metadata to match the file. The four-condition auto-resolution
  policy is documented in `di-preflight`.

**Genuinely out of scope is narrow.** Only four categories qualify:

1. **Source-missing content** — a page literally absent from the PDF.
   Verify with `pdfinfo`. Tag as
   `source-missing — verified absent from PDF (pages X–Y)`.
2. **Figure/diagram reconstruction** — raster-only content whose
   meaning is the image. Text in captions IS in scope.
3. **User-judgment-required** — a genuinely ambiguous call needing
   human input. Default expectation: this is almost never the right
   tag. If you're tempted to use it, you are probably failing to
   exhaust a tier.
4. **Validator-false-positive** — the validator's heuristic flagged
   something verifiably correct (journal-offset reprint, multi-section
   pagination, low-confidence flood on a scanned-OCR book where each
   marker has been positionally verified). The file is already
   correct; the validator is the thing that's mis-classifying.

Everything else is in-scope. **"I tried one approach and it didn't
fully work" is not exhaustion.** Tier 4 (orphan-attachment with
`[orphan fn N]` prefix) always succeeds with approximate placement.

### Anti-patterns: things that are NOT exhaustion signals

A retrospective on the 5-13 / 5-14 batch of streamlining memos shows
the deep-indexer was repeatedly stopping work for reasons the skill
text doesn't accept. Each of the following is **not** a reason to
emit an `outstanding-work` item — it's a reason to do the work:

1. **"No existing script for this."** Write the script. The skill is
   explicit that this is in-scope; the streamlining memo is for
   *recording* that the script should exist permanently, not for
   substituting a memo *in place of* doing the work this pass. If
   the same gap shows up across multiple papers, lift the script
   into `library/scripts/` so future runs inherit it.
2. **"The auto-pipeline produced false positives."** Build a more
   conservative version. The right response to a script that's too
   aggressive is to add a guard (TOC-skip, citation-arg guard,
   pgmark-preservation, body-argument-list filter), not to abandon
   the pass.
3. **"A safeguard fired (e.g., >50% removal threshold)."** Add a
   per-paper override (`--max-page N`, `--style=<X>`) or fix the
   safeguard. The safeguard's job is to catch bad cases, not to
   define exhaustion.
4. **"The validator flagged something."** Distinguish real defects
   from heuristic limitations. If the finding is a confirmed false
   positive, record it as `validator-false-positive` and proceed.
   Validator findings are gates only when they reflect actual file
   defects.
5. **"It's risky to auto-fix."** Design the safer version. If
   coordinated compounds like `pre- and post-test` are getting
   misflagged as hyphenation artifacts, the fix is a negative
   lookahead, not a deferral. If hyphenation cleanup might rejoin a
   legitimate compound, use a dictionary check or a conservative
   rule.

### Self-check before emitting any outstanding-work item

Before tagging any item as `[source-missing]`,
`[figure-reconstruction]`, `[user-judgment-required]`, or
`[validator-false-positive]`, walk this checklist:

- Have I exhausted the in-scope ladder for this category?
- For a footnote: did I try Tier 4 (orphan-prefix) — which always
  succeeds where a preceding body paragraph exists?
- For a script-protected operation: did I try a per-paper override
  flag (`--max-page`, `--style=...`, `--diagram-tokens`)?
- For a missing bibliography entry that's a well-known cited work:
  did I consider synthesis from external reference data with a
  `% synthesized` comment?
- For metadata mismatch where the citekey clearly names the work
  and the body matches: did I apply the auto-resolution policy
  (update `master.bib` + catalog, set `bib.state = needs-reauth`)?

If any answer is no, the deferral is premature — do the work first.

## Persistence: internal convergence loop (no cap)

The deep-index orchestrator runs an internal loop, not a single pass.
Each subskill is invoked from that loop and may itself run sub-iterations.

**Convergence criterion.** Two consecutive passes produce the *same*
outstanding set (treated as a set of bullet contents, normalized
whitespace) and the *same* audit punch-list and the *same* validator
findings. The skill stops because nothing more can change, not
because a counter ran out.

**No hard cap.** The only termination backstops are (a) genuine
convergence (preferred) and (b) the pathological-loop guard (only
fires after pass 3 if the outstanding list is *growing* and no
resolutions are happening). Most papers converge in 1–4 passes; some
books take 5–8. Run all of them autonomously without asking the user.

**Anti-pattern enforcement.** Stopping after 3-4 passes because the
remaining work is laborious is **not** convergence. The loop continues
until either:

- (a) the outstanding list is empty, or narrow-out-of-scope only
  (the four narrow categories above), or
- (b) the pathological-loop guard fires.

Items the agent expects to address in a follow-up pass should be
tagged `[in-progress]`, not `[user-judgment-required]`, and should
be carried forward by the loop — not surfaced to the user as
questions.

## When `user-judgment-required` IS the right tag

A short list of cases where this tag is genuinely warranted:

- The user has set `metadata-lock: true` in the catalog row or left
  an explicit note in `papers/<citekey>/virgil/notes.json` about
  intended chapter-level identity, and the on-disk file no longer
  matches that intent.
- The on-disk file and `master.bib` describe genuinely different
  works (different authors, different years, no obvious subset
  relation) and the citekey could plausibly refer to either.
- A republication / reprint identity choice where both options are
  defensible and the user has not previously expressed a preference.

If the situation doesn't match one of these, the right move is
almost always to apply a reasonable default (file is source of
truth; update metadata to match) and proceed.

## No-paraphrase rule (load-bearing)

**The deep-index AI step must not rewrite the words of the source.**
The pipeline is a *structural* cleanup pass — it re-shapes extraction
artifacts (heading hierarchy, pgmark placement, footnote anchoring,
citation form, bibliography layout) so a human reader can navigate
the paper. It is **not** a copyediting pass. Source prose — in body
paragraphs, footnotes, captions, examples, and notes — is sacrosanct.

**Permitted prose edits** (purely structural / deterministic):

- **Re-anchor leaked footnote prose to its call site.** Strip a
  leading bare numeral (`7See e.g., Hobbs…` → `\footnote{See e.g.,
  Hobbs…}`). Do not change any other word inside the body.
- **Fix deterministic OCR artifacts** — soft hyphens, U+FB00–FB06
  ligatures (`ﬁ` → `fi`), word-internal NBSP, hyphenated line breaks
  (`re- semble` → `resemble`), diacritic restoration on a single
  identified character where the PDF unambiguously shows it.
- **Format the References list** as `\begin{itemize}…\end{itemize}`
  with one `\item` per entry. The entry text itself is preserved —
  only the surrounding markup changes.
- **Convert inline author-year mentions to `\cite{…}`/`\citet{…}`.**
  The author and year tokens are replaced by the citation command;
  surrounding prose is untouched. Every cited author-year pair in the
  source must survive as a `\cite…{}` in the output.
- **Surgically remove adjacent-article spans** flagged by
  `detect_multi_article.py`. The span is deleted, not paraphrased
  into a summary.

**Forbidden prose edits** (this is the failure mode that motivates
the rule):

- **Substituting new sentences for existing prose.** If the source
  says "appealing to the Lebesgue measure", the output must contain
  the words "appealing to the Lebesgue measure" — not a paraphrase
  such as "measuring size in terms of some other notion of measure".
- **"Improving" the writing.** Tightening, expanding, smoothing,
  re-ordering clauses, varying word choice — all forbidden. The
  author wrote the words; the AI does not rewrite them.
- **Expanding a terse footnote into a longer explanation.** A
  one-sentence footnote stays a one-sentence footnote. `See Tao
  [2011] for more discussion of measures.` becomes `\footnote{See
  \citet{tao2011} for more discussion of measures.}` — never a
  paragraph of fresh prose on measure theory.
- **Dropping citations while paraphrasing.** A paraphrase that loses
  an existing `Author [Year]` mention is a doctrine violation twice
  over (rewritten prose + dropped citation).
- **Filling in "missing" content from the model's own knowledge.** A
  footnote that ends mid-sentence is a `recover-footnotes` truncated-
  recovery problem (pull continuation from the PDF via
  `recover_truncated_footnote.py`), not a license to invent text.

**The test before any in-prose edit.** Before changing any character
inside an `\footnote{…}`, a body paragraph, a caption, an example, or
a note, ask: *Is this change a deterministic transformation of the
existing characters (ligature normalization, hyphen rejoin, citation-
form conversion, structural re-anchoring), or is it a new sentence
the model is writing?* If the latter, **stop.** The edit is forbidden,
regardless of whether the new sentence reads better.

**Why this is load-bearing.** Paraphrase damage is silent: the output
reads fluently, the structural anchors (footnote position, pgmark,
heading) align with the source, and existing validators see nothing
wrong. The only post-hoc detection mechanism is a word-level diff
against a preserved baseline. One documented instance
(`lee2023structure` footnote 18, 2026-05) had the AI step substitute
invented philosophy prose for the source text and silently drop a
`Tao [2011]` citation. Without the pre-deepindex baseline, the damage
would have been undetectable. **No automated validator currently
catches this class of failure** — the rule above is the only line of
defense.

**Future work — paraphrase-diff validator.** A
`validate_footnote_text.py` script that diff-checks every
`\footnote{…}` body against `pdftotext`-extracted footnote text from
the corresponding page would catch the lee2023 case post-hoc.
Sketched design: walk every `\footnote{…}` in `main.tex` and resolve
its hosting page via the nearest preceding `\pgmark{N}`; for each
hosting page run `pdftotext -layout` and isolate the
bottom-of-page region (lines below the last running-header-y cutoff,
or lines after a short rule / increased line gap); token-compare
each footnote body against that region with a tolerance for OCR
ligature / hyphen drift and for citation-rewriting (`Tao [2011]` →
`\citet{tao2011}`); emit a `footnote-paraphrase-suspected:` finding
for any body whose normalized token-overlap with the PDF-side
footnote text drops below ~70%. Page-bottom region detection is the
hard part — extending to body paragraphs (not just footnotes) is
even harder because it requires a clean pgmark-to-page mapping the
validator can't always trust. Not yet implemented; the rule above
is the substitute.
