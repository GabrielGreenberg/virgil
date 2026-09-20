<!-- last-verified: aea05929 2026-09-20 -->
<!-- derives-from: AGENTS.md#laws -->

# The prose index: "which characters are prose, and where"

> **One question, one owner.** `src/lib/prose-index.ts` yields the PROSE
> character runs of a document with their ProseMirror positions — every
> carrier run, every markless block and every atom excluded — and the
> exclusion vocabulary is DERIVED from the SSOTs and from the live schema,
> never hand-listed.

This is the "searching `emph` finds command names" class (task 517, subsuming
the retired 513), and the finding is that three parts of Virgil each held HALF
of one answer and none of them knew both:

- the **word counter** (`word-count-core.ts`) sorts characters into categories
  — main text / headings / footnotes / captions / math / comments — and throws
  every POSITION away;
- the **raw-LaTeX highlighter** (`scanRawLatexSpans` + the carrier marks) keeps
  positions exactly, because it has to paint over them — and tracks only
  LATEX, never prose;
- the **Search index** kept positions and knew nothing about LaTeX at all. Its
  `buildMainTextIndex` took every text node in every textblock with no carrier
  filtering, so `emph` matched command names and a query matched inside a `%`
  comment block.

A spellchecker needs both halves at once, which is why the foundation was built
before it (the approved program's phase 1 of 3; phase 2 is Virgil's own
checker, phase 3 the curated autocorrect list).

Seven rules it earned:

- **The vocabulary is three DERIVED rules, not a list of node names.** A TEXT
  node is prose unless it wears a raw-LaTeX mark; a BLOCK carries prose only
  if it is a textblock that ADMITS MARKS; anything that is not a text node
  contributes no prose characters. That covers every carrier, every verbatim
  container and every atom — including ones nobody has written yet.
- **`RAW_LATEX_MARK_NAMES` is a THIRD census, deliberately distinct from
  `CARRIER_MARK_NAMES`.** The carrier table answers the DEMOTION question
  ("does this run still spell what its carrier says it is?", task 407) and is
  the STRICTER set — the marks whose bytes are literal or inert — which is
  exactly what `isOpaqueRun` must keep reading, because a `latexCommand`
  scanner has to look INSIDE a command run. "Is this prose?" is the wider
  question, so it gets its own derived export (`CARRIER_MARK_NAMES` plus
  `LATEX_COMMAND_MARK`) rather than a fourth hand list. `latexCommand`'s name
  finally has a constant too, and `latex-command.ts` now spells NO mark-name
  literal of its own.
- **The markless test is asked of the LIVE SCHEMA** (`type.markSet`), which is
  the derivation `text-object-registry.ts` asks for in place beside its own
  `MARKLESS_BLOCK_ACTIONS` hand-assignment: a node declaring `marks: ""` can
  never wear a carrier, so Virgil has no way to say which of its characters
  are raw LaTeX — which is what verbatim MEANS. `latexComment` and `codeBlock`
  fall out; a third such kind is covered by shipping.
- **`figureBlock` is the one shape that needed a decision rather than a rule,
  and the rules get it right anyway.** It is not a schema atom, it holds a
  `figureCaption`, and that caption IS the user's words — so it is walked like
  any other textblock while its siblings (`texBlock`, `forestBlock`,
  `graphicsBlock`, `displayMath`) are excluded by the atom rule.
- **The run table was already the right shape, and that is why the fix is
  small.** `buildMainTextIndex` kept per-text-node runs precisely so an inline
  ATOM — zero characters, one PM slot — could not skew char → PM conversion. A
  SKIPPED CARRIER is the identical shape, so the whole `spanAtOffset` /
  `proseOffsetToPos` machinery carries the new gaps for free. Consecutive runs
  are char-contiguous and PM-DISJOINT, and that gap is the contract a consumer
  that must not span an excluded thing (a spell squiggle, task 518) reads.
- **It does NOT extract `\caption{…}` payloads the way the word counter does.**
  That extraction is a REGEX REWRITE of a string — it strips commands and
  braces — so it cannot say WHERE the surviving characters are, and this
  index's whole contract is positions. A payload the index cannot place is one
  it must not claim.
- **The word counter is a stated NON-GOAL, not an oversight.** Its bucketing
  laws (tasks 112 / 121 / 122) are settled, its buckets need the three marks
  named INDIVIDUALLY and IN ORDER (a comment tail goes to `comments` and must
  be tested BEFORE the pair whose `\caption{…}` payloads go to `captions`), so
  a single "is this raw LaTeX" predicate cannot express it. It remains the
  third half-answer and MAY migrate later — deliberately, not in passing. It
  is the census's one exemption, scoped to that reason.

**Cost class.** `buildProseIndex` is O(doc) and is a DERIVED PRODUCT: a
consumer re-derives EVENT-DRIVEN (the `DocStructureBus` counters, a
`doc-products` tier, or — like Search — once per user-initiated query), never
on the keystroke path. `collectProseRuns` is the per-BLOCK entry point for a
consumer holding a touched block from the typed structural diff.

CI: [prose-index.test.ts](../../../src/lib/__tests__/prose-index.test.ts) drives the
REAL `buildEditorExtensions("main")` stack over the REAL parse — so the marks
under test are the ones the parser produces rather than ones a fixture asserts
into existence — and its legs with teeth are the SWEEPS (every `ATOM_REGISTRY`
kind, every `RAW_LATEX_MARK_NAMES` member, every markless textblock the schema
declares) plus the CENSUS. **No pre-517 suite could see any of this**: every
search fixture in the repo is plain prose plus inline atoms — the one non-prose
shape the old index already handled — so a carrier run reaching the index is
unrepresentable in all of them.
[search-prose-only.test.ts](../../../src/panels/Search/__tests__/search-prose-only.test.ts)
is the 513 acceptance, each red leg carrying its PROSE control through the
identical harness (a suite that only proved "emph is not found" would pass on
an index that finds nothing at all). Measured by neutering the two predicates:
**13 legs fail**, and the 17 that pass are the controls — plain prose, a
MODELED command's payload (an `\emph{…}` is an italic MARK, not a carrier, so
its words survive and only the name is gone), the offset round-trip, and the
derivation pins.

**Residual, stated.** The joined text still concatenates ACROSS a skipped
thing, so `a\foobar{x}c` reads as `ac` to a whole-string matcher — exactly as
`doc.textBetween(0, size, "\n")` has always joined across an inline atom. That
is preserved deliberately: changing it would move Search's behaviour, and the
consumer that must not join (the squiggle) reads the RUNS, which is what they
are for.

### The switch half: native spellcheck becomes deliberate

Same task, the memo's Tier A. Chrome spellchecks any editable text unless told
not to, and Virgil said "don't" in ELEVEN places that had never been collected
into a rule — two CodeMirror source pods, the read-only branch of the main
editor, and eight discrete form inputs (citekey, label key, two hex-colour
fields, the math and figure LaTeX textareas, the bib picker, the raw-BibTeX
textarea). Every decision was right and none was STATED, so from outside the
pattern read as arbitrary, and there was no way to turn the thing off.

> **The switch is ONE inherited `spellcheck` attribute on `<body>`, written
> from one `VIEW_PREF_REGISTRY` row — not a prop threaded into every prose
> surface.**

Four rules it earned:

- **Twelve threads are twelve chances to forget the thirteenth.** There are
  twelve `editorProps.attributes` blocks that would each need a
  `checkSpelling` prop (the main editor, `RichTextField`, `BorrowedMainText`,
  nine float bodies, `ExampleCard`) and NONE of them sets `spellcheck` today.
  The body attribute covers every surface that exists and every surface that
  will, by construction — the same mechanism and the same reasoning as
  `EditorLayout`'s `.hide-card-titles` / `.card-outline-chrome` body classes,
  whose own comment gives the reason ("cards render in the panel strips, the
  omni host, AND body-portaled float popouts").
- **ON is the ABSENCE of the attribute, not `"true"`.** The default state IS
  on, so the pref's default position leaves the DOM byte-identical to what
  shipped before the switch existed.
- **The deliberate opt-outs need no knowledge of the pref.** They are
  DESCENDANT `false`s, which win over an inherited value — so they survive
  either position, and the read-only rule in `Editor.tsx` stays a rule of its
  own ABOVE the preference: a read-only document is never squiggled whatever
  the pref says. Both compose without either knowing about the other.
- **They spell it through the door** (`NEVER_SPELLCHECK_ATTRS` /
  `NEVER_SPELLCHECK_PROPS`, [spellcheck-policy.ts](../../../src/lib/spellcheck-policy.ts))
  rather than a bare literal, which is what makes "the surfaces deliberately
  left out" a checkable list instead of eleven scattered literals. Two more
  CodeMirror surfaces (the code view, the style/preamble editor) set nothing
  and are always off regardless: CodeMirror 6 hardcodes `spellcheck: "false"`
  in its own default content attributes.

A stale claim went with it: `library/styles/library.css` said its
`caret-color: transparent` rule suppressed "red-squiggle spellcheck
underlines", which CSS cannot do — the suppression was always `Editor.tsx`'s
read-only branch. Corrected in place with the reason at the site.

CI: [spellcheck-policy.test.ts](../../../src/lib/__tests__/spellcheck-policy.test.ts).
The leg with teeth is the CENSUS — the door was never the part that could
misbehave, a surface that opts out with a bare literal is, and it renders
perfectly while leaving the list unstated: no production file outside the door
may spell `spellCheck={false}` or `spellcheck: "false"` (allowlist EMPTY), the
door must have real consumers of BOTH shapes, and the policy must have exactly
ONE mount (two writers of one attribute is how they come to disagree, and the
effect's cleanup restores ON). Measured: a planted literal takes the census, a
dropped mount takes the mount leg.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a schema walk plus
a body attribute, no disk), so the check is cheap and real — search `emph` in
the dev doc and get prose hits only, then toggle View › Check spelling and
watch the squiggles go.

### The word half: Virgil's own spellchecker

Same index, one step further in (task 518, phase 2 of the approved three-phase
program). Characters are not what a dictionary knows about, and the step from
one to the other is not a formality: the 517 run table's GAPS carry information
a character-level answer throws away.

> **THE RUN GAP IS THE WORD BOUNDARY.** Two prose runs that abut in the
> document are one word split at a MARK boundary; two separated by an atom or
> by an excluded raw-LaTeX run are two.
> [`prose-words.ts`](../../../src/lib/spell/prose-words.ts) MERGES PM-contiguous runs
> before tokenizing — within a segment the character offset and the PM offset
> advance together, so a token's document position is `pmStart + offset` with
> nothing to correct for — and it tells the two kinds of cut APART.

Seven rules the pair earned:

- **An ATOM ends a word; an excluded TEXT run does not.** `Smith`+`[1]` is a
  finished word, and refusing to check one merely because a footnote marker
  follows it would give up most of the checkable text in a real paper. An
  excluded text run is different: it is characters the user typed that the index
  deliberately did not read, so `un` + `\textsc{clear}` is a FRAGMENT and is not
  checked. So a segment records, per edge, whether the child immediately across
  the gap was TEXT. (`hardBreak` is a non-text node and correctly ends a word.)
- **ONE authority for "this word is fine."**
  [`accepted-words.ts`](../../../src/lib/spell/accepted-words.ts) composes the paper's own
  `dictionary.json`, the user's global list and every name in the bibliography's
  `author`/`editor` fields — three SOURCES of one answer rather than three tests
  scattered across the checker, the popover and the add affordance. It matches
  case-insensitively in both directions and strips ONE trailing possessive;
  nothing else is inferred, because a plural is a different word and guessing it
  is morphology invented for a name the dictionary has never seen.
- **The BASE dictionary is deliberately NOT one of those sources.** It answers
  about ENGLISH and lives in the worker; the user's exceptions answer about the
  USER and live on the main thread. That split is what lets a dictionary change
  re-derive with no worker round trip, and what keeps
  [`spell-core.ts`](../../../src/lib/spell/spell-core.ts) a pure function of its two
  assets — testable from a five-word inline `.dic` rather than a 550 KB one.
- **A bibliography name drops its GROUPING BRACES before splitting, and that is
  not a renegotiation of task 409.** 409 decided the braces SURVIVE the display
  projection, because what a bare `{…}` MEANS needs a vocabulary this codebase
  has no SSOT for; that is about what a READER sees. Here `wordsIn` would split
  `L{ó}pez` into `pez` — the surname the user actually writes staying flagged
  while a fragment of it was excused — and in an author field a grouping brace
  has exactly one BibTeX meaning, so removing it before SPLITTING is a narrow,
  name-field-only repair that renders nothing and invents no vocabulary.
- **A SQUIGGLE IS A VIEW**, so every rule task 120 states applies verbatim:
  [`spellcheck-decorator.ts`](../../../src/lib/tiptap/spellcheck-decorator.ts) paints a
  `DecorationSet` replaced by META-ONLY transactions — no undo step, no autosave
  arm, nothing captured when the paragraph is archived.
- **The keystroke path is empty.** `apply` maps the set, maps its dirty-block
  list, and on a doc change adds the textblocks the transaction TOUCHED through
  the shared `touchedTextblocks` door (tasks 400/430). It never walks the
  document and never asks the dictionary. The ONE whole-document arm lives in
  the plugin VIEW, behind a 300 ms debounce (the interactive tier — a spelling
  squiggle at the lint tier's 1.5 s would feel broken), and runs only on a port
  `version()` change: a preference flip, a dictionary edit, a bibliography
  reload, a document load.
- **The pass is TWO-PHASE, because positions move and the dictionary is async.**
  Phase A tokenizes the blocks it owes, collects the words the client has no
  cached verdict for, and awaits ONE warm-up; phase B re-reads the LIVE document
  and builds synchronously. A word still unresolved after the warm-up is treated
  as KNOWN — a missed flag is the status quo, a false squiggle is the thing this
  feature must not be.
- **The caret MOVING is what finishes a word.** A token containing the caret is
  skipped (which stops `th` being underlined on the way to `the`), so a
  selection change marks both the block the caret left and the block it entered
  — two O(depth) resolves, scheduling a pass bounded by ONE block.

> **ONE OWNER FOR "WHO UNDERLINES THIS SURFACE."** The plugin that PAINTS is the
> plugin that turns the browser's underline off, contributing `spellcheck=false`
> through its own `props.attributes` — declaratively, so ProseMirror adds and
> removes it and it composes with `Editor.tsx`'s read-only opt-out rather than
> fighting it. It goes away the moment the preference goes off, the surface goes
> read-only, or the DICTIONARY FAILS TO LOAD: the honest answer to a failed load
> is the browser's checker, not no checker. That hand-back is why
> `spellEngineAvailable()` is published rather than swallowed, and
> `spellcheck-policy.ts` now states THREE claims rather than two
> (`NEVER_SPELLCHECK_*` = "a squiggle here would be nonsense"; the `<body>`
> attribute = "the user turned checking off"; `VIRGIL_CHECKED_ATTRS` = "Virgil
> underlines this surface"). `checkSpelling` stays ONE control for the pair.

**…and a failed load is RECOVERABLE (task 580).** Pre-580 a failure set a latch,
the latch made the port report DISABLED, a disabled surface never asked the
client again, and the latch's only reset lived inside a successful ask — so the
worker's deliberate don't-cache-a-rejected-engine retry was dead code, one
offline first-open cost the whole session, and every word asked during the
outage was cached KNOWN forever. Three rules now, all in
[spell-client.ts](../../../src/lib/spell/spell-client.ts): the CLIENT owns the retry (a
back-off probe from `SPELL_RETRY_BASE_MS` doubling to `SPELL_RETRY_CAP_MS`, plus
the tab-return edge and `online`), never the surface, which stays handed to the
browser throughout so a probe cannot flicker two underlines; a failure caches
NO verdict (an unresolved word is already read as known in phase B, the one
place that answer belongs); and every availability flip is PUBLISHED — the
provider folds the client's epoch into `version()`, and the port's REQUIRED
`onInvalidate` pushes it so a recovery while the user is READING runs one
whole-document re-check with no transaction. A crashed WORKER is not a failed
dictionary: requests `onerror` strands are answered by the main-thread engine.
CI: [spell-engine-recovery.test.tsx](../../../src/lib/spell/__tests__/spell-engine-recovery.test.tsx)
drives the REAL client and provider through a failing-then-succeeding fetch,
plus a decorator leg in `spellcheck-decorator.test.ts`. Measured by neutering:
no retry takes 6 legs, a cached failure verdict 1, a decorator that never
subscribes 1.

**…and a squiggle is RE-VERIFIED where it is used (tasks 581/582).** Three
things the pass used to trust from an earlier moment: a block's prose-ness (a
paragraph converted to a code block or `%` comment carried its squiggles in by
mapping, and phase B skipped a non-prose block, so they stayed —
right-clickable over verbatim bytes); the menu's range (captured at OPEN, while
suggestions load and the document can move); and a boolean whole-document
request (a dirty pass resuming from its `ensure` cleared a request a version
bump made during the await). Now `tokensAt` answers `[]` for a textblock that
stopped being prose, a whole-document pass REPLACES the set; the decoration
SPEC is the squiggle's identity (reused when a pass re-flags the same word at
the same range), and `liveSpellRange` finds it in the live mapped set — the
menu edits only what is still that flagged word, else closes; the request is a
generation counter satisfied only by a whole pass with nothing newer; passes
are serial; and a block holding a word typed during phase A's await stays
OWED rather than being settled clean. Legs in both spell suites; each of the
seven halves fails its own leg under neuter.

**The dictionary is VENDORED, and it has to be.** `dictionary-en@4` (US
English) reads its files with `node:fs`, so the package cannot be imported in a
browser at all: `tools/sync-dictionary.mjs` copies the Hunspell pair into
`public/dictionaries/en/`, the Worker FETCHES it through `publicAssetUrl` (task
365's door), and `sw.js` precaches it by the same paths — which a service worker
cannot import, so the two spellings are pinned against each other. The package
stays a dependency BECAUSE it is the source of truth that pin reads.

**The suggestion menu is a gesture-scoped SINGLETON**
([spell-menu-store.ts](../../../src/lib/spell/spell-menu-store.ts)) whose REQUEST carries
the document's own port, so one renderer at the app root serves every keep-alive
pane and every portaled float with no per-document context. It opens on the
CONTEXT MENU over a flagged word and falls through everywhere else — suppressing
the browser's own menu is honest only where this surface has already declined
the browser's checker. A suggestion is an ordinary undoable `insertText`, so
Cmd+Z restores the misspelling and a correction inside a bold run stays bold.

CI: [prose-words.test.ts](../../../src/lib/spell/__tests__/prose-words.test.ts) drives
the REAL main stack over the REAL parse, with the MERGE case and the CUT case
over the same shape — an implementation that merged everything and one that
merged nothing each fail exactly one leg.
[spellcheck-decorator.test.ts](../../../src/lib/tiptap/__tests__/spellcheck-decorator.test.ts)
measures the keystroke cost as an A/B against the same stack with the plugin
ABSENT, and the reason is worth carrying forward: an ABSOLUTE walk count is
blind here, because a whole-document rebuild inside `apply` adds exactly ONE
`descendants` call at every document size — measured, this leg's first draft
compared two document SIZES and passed under its own neuter, and it passed a
second time when the B arm was `{ current: null }` (which still registers the
plugin) rather than `null` (which does not).
[spell-suggestion-menu.test.tsx](../../../src/components/__tests__/spell-suggestion-menu.test.tsx)
drives the REAL gesture and the REAL menu.
[spellcheck-surface-census.test.ts](../../../src/lib/__tests__/spellcheck-surface-census.test.ts)
is the leg with teeth: a prose surface that never names the checker type-checks
perfectly, renders perfectly, and fails in the quietest possible way — the
browser keeps its own underline there and nothing looks broken. Membership is
DISCOVERED from every production file that builds an extension stack; allowlists
EMPTY.

**Residuals, stated.** English only, one dictionary, no language detection: a
German quotation is underlined word by word until its terms are added. All-caps
tokens are never checked (academic prose is dense with acronyms a stock
dictionary does not know), so a shouted typo is missed — the right side of that
trade. And the checker sees only what the 517 index yields, which by that
module's own stated non-goal excludes a `\caption{…}` payload inside a
raw-LaTeX run: the index cannot say WHERE those characters are, and a payload it
cannot place is one this checker must not claim.

**PRINT — silent for ten days, and CLOSED by task 523.** This section shipped
with nothing to say about paper, and the squiggle printed: `text-decoration` is
painted with the text, so unlike every other view-only paint in the app it
needed no "Background graphics" setting, and `checkSpelling` defaults ON. The
squiggle is now stamped `viewOnly(SPELL_ERROR_CLASS)` and neutralised by ONE
rule in `@media print` — see "What reaches paper — editor state never does" in
`STYLE_GUIDE.md`, and the section immediately below.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked except the paper
dictionary's sidecar half, so the durable proof there is the unit round trip —
type a misspelling and watch the squiggle arrive after the debounce, right-click
it, correct it, and confirm `\emph{teh}` inside a command never flags.


### The correction half: a WORD swap has no reverse map

Same word layer, the WRITE (task 519, phase 3 of 3) — and the case where the
gate the typographic rules ride is exactly right for a GLYPH and not enough for
a WORD.

`typographyToLatex` turns `–` back into `--` on every save, so a smart quote
that lands somewhere it should not have is cosmetic-in-source and round-trips.
That is the whole reason `smart-quotes.ts` may take TipTap's own input-rule
gate alone, and why `LatexCommandMark` is DELIBERATELY not `code: true`
(`latex-command.ts` says so in place: smartening a quote typed into a stray
inherited command span keeps it emitting valid `.tex`). A word replacement has
no reverse map at all: `\label{teh}` rewritten to `\label{the}` is a broken
cross-reference, silently and forever.

> **AUTOCORRECT IS A CURATED TABLE, NEVER A DICTIONARY.** A checker that
> silently swapped a flagged word for its nearest neighbour would rewrite the
> user's own vocabulary — a technical term, a surname, a coinage — with no
> signal that anything happened, which is what the write-path doctrine is
> against. Everything Virgil is unsure about gets a SQUIGGLE and a gesture;
> only what a human has declared unambiguous is rewritten unasked. And the
> table is WORDS ONLY: a row is two words, so a row that inserted a space, a
> full stop or a capital is unwritable.

`AUTOCORRECT_TABLE` ([autocorrect.ts](../../../src/lib/tiptap/autocorrect.ts)) is the
SSOT — one `InputRule` is BUILT from it, so an addition is one row.

Seven rules it earned:

- **"Unambiguous" is CHECKABLE, and that is what makes the list safe to grow.**
  The arbiter is the app's OWN shipped Hunspell dictionary — the same one the
  checker reads — so a `wrong` the dictionary ACCEPTS (a real word someone
  mistook for a typo) or a `right` it REJECTS fails CI, in the lower AND the
  derived Title-case spelling. `dependant` is deliberately absent: it is the
  standard British noun, and the failure direction of a wrong row is a rewrite
  of the user's prose.
- **The gate asks TWO rungs, because a construct is raw LaTeX BEFORE it is
  finished** ([typed-prose-gate.ts](../../../src/lib/tiptap/typed-prose-gate.ts)).
  MEASURED on the real stack: a SETTLED `\label{teh}` is ONE text node wearing
  `latexCommand`, which rung 1 (`isRawLatexMarkName`, the task-517 SSOT) sees;
  an IN-FLIGHT `\textsc{teh` is `["\textsc" latexCommand] ["{teh" NO MARKS]`,
  because `scanRawLatexSpans` fails CLOSED on an unbalanced group and claims
  the command NAME only. One keystroke later the brace closes and the same
  bytes ARE raw LaTeX — so **a verdict that depends on how far through a
  construct the user has typed is not a verdict**. Rung 2 is therefore the
  LOOSE scanner the grey `.latex-cmd` decoration and the `p-cmd-only` stamp
  already share (`matchCommandLength`, whose own comment says it "include[s]
  unclosed braces (user still typing)"): what the user is being SHOWN as a
  command is not prose.
- **Neither rung is redundant, and the divergence is a shipped fact rather than
  caution.** `matchCommandLength` caps a command at TWO braced arguments where
  the lexer's `scanRawLatexSpans` consumes the whole run — a cap task 349
  removed there and not here. Measured on
  `Alpha \addcontentsline{toc}{section}{teh} beta.`, the loose scan claims
  `[6, 36)` and stops before `teh` at 37, while the mark covers the run whole.
  So the 3-argument command is exactly where rung 1 is load-bearing, and it has
  its own leg (an invariant with no leg is a habit — "The tag half").
- **`\emph{teh}` — the task's own example — is the instructive NON-member.**
  `\emph` is MODELLED, so a parse turns it into the ITALIC mark: there is no
  raw LaTeX left to protect and correcting the word is right. What the example
  really names is the IN-FLIGHT `\emph{teh `, which rung 2 declines. Both are
  pinned, because the gate is about BYTES and not about which command they were
  once written with.
- **It asks the ONE authority for "this word is fine here."** A word in the
  paper dictionary, the global list or a `references.bib` name is not a typo —
  adding a word to your dictionary must stop Virgil CORRECTING it, not merely
  stop it underlining it. That is also why the flag rides the SpellcheckPort
  rather than a second provider: a document has exactly one answer to every
  question about words, and the corrector asks two the checker already owns.
- **Its own preference row, not a second meaning for `checkSpelling`.**
  Underlining a word and REWRITING it are different permissions, and a user may
  want either without the other. `autocorrectTypos`, Display group, default ON;
  a surface that declared no port at all (the Library reader, a bare
  `RichTextField`) corrects nothing — a surface that never stated an answer
  gets no silent rewriting.
- **The escape hatch is free and is the reason `undoable` matters.** TipTap's
  core keymap runs `undoInputRule` FIRST on Backspace, so one Backspace
  immediately after a correction restores the bytes the user actually typed;
  the replacement is otherwise an ordinary history entry, never
  `addToHistory: false`.

Keystroke sanctity: the gate runs inside an `InputRule` HANDLER, i.e. only
after its `find` has already matched, so it never touches the ordinary typing
path; it is O(the block's text) and walks no document.

CI: [autocorrect-typing.test.ts](../../../src/lib/tiptap/__tests__/autocorrect-typing.test.ts)
drives the REAL `buildEditorExtensions("main")` stack one character at a time
through the shipped `handleTextInput` prop — a single `insertContent` fires no
input rule at all, so every leg would pass vacuously on it. The leg with teeth
is the CENSUS
([autocorrect-table.test.ts](../../../src/lib/tiptap/__tests__/autocorrect-table.test.ts)):
the table was never the part that could misbehave, a second copy of it is, and
so is a hand-written alternation that stops tracking it, a consumer that
re-derives the gate, or an extension mounted with no port — all of which
type-check perfectly. Its needles read COMMENTS-STRIPPED source with a
SYNTHETIC canary, because `codeOnly` blanks string literals and the needles ARE
quoted text (the trap `_source-scan`'s own header records). Measured by
neutering each half in turn: no gate at all takes 4 legs, rung 2 alone 1, rung
1 alone 2, the accepted-word check 1, the preference 1, a planted second table
1, a mount with no port 1, and a second gate consumer 1.

**Owed, not claimed:** the preview minute. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real — type `teh ` in prose, then
`\label{teh}` and edit inside it.

### The paint half: the grey command span is a prose reader too (task 607)

The `.latex-cmd` DECORATION (`latex-command.ts`, `decorateBlock` /
`decorateTextNode`) answers "is this `\foo` LaTeX-in-prose?" — the same
question, so it asks this index's two predicates instead of its own: a block
that fails `blockCarriesProse` (`codeBlock`, `latexComment` — anything
`marks: ""`) gets no span, and neither does text failing `inlineIsProse`
(any raw-LaTeX mark: the command mark and verbatim carrier already render
their own span, and a `%` comment tail is never read as a command). Before,
the plugin skipped only `latexCommand`-marked text, so a command in a listing
or a comment block shrank to `0.9em` grey, and one inside a verbatim run
nested a second span (`0.81em`). Both checks are O(1) per block / per text
node, so the per-block rebuild's cost is unchanged.
CI: `latex-cmd-prose-only.test.ts` (real main stack; cold build + typed rebuild).
**Owed:** a preview glance at a listing containing `\foo` — not FSA-masked.
