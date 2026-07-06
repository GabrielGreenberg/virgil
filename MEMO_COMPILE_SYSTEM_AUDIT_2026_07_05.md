# Compile system — deep adversarial audit (2026‑07‑05)

Branch: `compile-audit`. Scope: the whole SwiftLaTeX compile surround (engine boot,
package fetch, orchestration, log parsing, error surfacing, PDF write/open, preamble
requirements, example round‑trip). **Report‑first** — only one fix landed so far (the
dev‑doc blocker, §1); everything else is diagnosis + fix direction awaiting your go.

## Method

- **Live**: reproduced the real failure in the running app (isolated preview on `:3400`,
  own dist dir, own copy `doc_compileaudit` — your `:3000` session and `doc_devtest`
  untouched). Drove the actual Compile button + a direct in‑page engine probe, pulled
  the real pdfTeX log, and fetched the actual package sources the mirror serves.
- **Static**: a background multi‑agent workflow (74 agents) fanned readers over 9 modules,
  then **adversarially verified every finding** (a second agent tried to refute each).
  Result: **39 confirmed, 26 rejected** (of 65 raw). Rejected claims were dropped.

Severity of confirmed findings: **1 critical · 9 high · 17 medium · 12 low** (critical is
the live‑only mirror‑dependence finding, §2‑A1).

---

## 1. The concrete win: the dev doc now compiles ✅ (flagship fix landed)

**Symptom** (your screenshot): `Compile failed. Status 1.` The real pdfTeX log ends:

```
! LaTeX Error: Environment xlist undefined.
l.138 \begin{xlist}
!  ==> Fatal error occurred, no output PDF file produced!
```

**Root cause — a codebase‑wide false belief, not bad sample data.** Virgil serializes a
nested example tier as `\begin{xlist}…\end{xlist}` and calls it *"expex's xlist
environment"* — in [latex-serializer.ts:590](src/lib/latex-serializer.ts),
[latex-parser.ts:2068](src/lib/latex-parser.ts),
[latex-requirements.ts:131](src/lib/latex-requirements.ts),
[example-refs.ts:60](src/lib/example-refs.ts), and the library skills. **But `xlist` is
not an expex environment.** I fetched the actual `expex.tex` the mirror serves (byte‑identical
to current CTAN, v5.1b) — **zero occurrences of `xlist`**. `xlist` is a `gb4e` construct.
So *every* Virgil example with a nested sub‑list is a fatal compile error.

**Fix (landed in this worktree).** Empirically, expex nests via a nested `\pex…\xe` inside an
`\a` item, and defining `\newenvironment{xlist}{\pex}{\xe}` makes Virgil's existing output
compile unchanged — verified live (status 0, PDF). So I added an `xlistenv` requirement to
the preamble SSOT ([latex-requirements.ts](src/lib/latex-requirements.ts)) that injects that
one line whenever the body uses `\begin{xlist}` (which already also pins `expex`). This
keeps Virgil's whole internal `xlist` convention (parser + serializer + refs unchanged) and
fixes **every existing doc** with no content rewrite.

**Verification.**
- Unit/integration: `latex-requirements.test.ts` **55/55** green (+5 new, incl. a real
  parse→serialize nested‑example round‑trip asserting the def is injected).
- Live probe: the full real dev‑doc `.tex` + the injected def → **8‑page PDF**.
- Real Compile button (on the injected doc): 3 passes, **`document.pdf` 245 KB written to
  disk**, no error dialog. The only remaining log lines are non‑fatal (undefined‑citation
  warnings that resolve on pass 3 — all those keys *are* in `references.bib`; `nonexistent2026`
  is the sample's deliberate missing‑citation fixture; one cosmetic overfull hbox).

**Two caveats worth knowing:**
1. The injection happens at **save/serialize** time. An existing doc opened and compiled
   *without any edit* still reads the old on‑disk `.tex` (no def) → still fails until one
   edit triggers a save. The robust fix is to also run `ensurePreambleRequirements` inside
   the **compile pipeline** on the files it feeds the engine (see §2‑C, "compile should be
   self‑sufficient"). Recommended as a follow‑on.
2. A deeper alternative is to stop emitting `xlist` and emit native expex nesting. I chose
   the shim because it is minimal‑blast‑radius and fixes docs already on disk; the native
   route is a larger parser+serializer+refs change. Your call for the long term.

---

## 2. Findings, grouped by root‑cause class

Ordered by class, most‑severe first within each. `[H]/[M]/[L]` = confirmed severity.

### A. Total dependence on a live third‑party mirror — *even for the base format*  ← your #1

This is the deepest brittleness and directly answers "can we end the dependence on the
live package (fetch if online, run as‑is if offline)?" Today: **no** — and it's worse than
"packages."

- **[CRITICAL] The base LaTeX format is fetched from the mirror at compile time.** With a
  dead endpoint, even a one‑line document fails instantly with `I can't find the format
  file 'swiftlatexpdftex.fmt'!` (verified live). The worker never references
  `swiftlatexpdftex.fmt` in its code; it resolves it via kpse from
  `https://texlive.texlyre.org/pdftex/<fmt>/…`. Meanwhile the vendored **10 MB
  `public/swiftlatex/swiftlatexpdftex.fmt` is served (`HTTP 200`) but referenced nowhere in
  `src/` or the worker — dead weight.** ⇒ **Mirror down = nothing compiles at all**, not even
  a trivial doc. The upstream default endpoint baked into the worker
  (`texlive2.swiftlatex.com`) is itself dead.
- **[M] No persistent cache.** [swiftlatexpdftex.js] caches fetched files only in worker
  memory (JS maps + Emscripten memfs). The worker is re‑created on every page reload, so
  **every reload re‑downloads the format + all packages over serial *synchronous* XHR** —
  the measured **37 s first compile**. No offline capability whatsoever.
- **[M] Synchronous XHR ignores `xhr.timeout`.** `xhr.open('GET',url,false)` + `xhr.timeout=15e4`
  is a spec no‑op on sync requests, and there's no `ontimeout`. A stalled (not refused)
  mirror connection **blocks the worker indefinitely** (until the browser socket timeout),
  with no cancel. Combined with §D1 (no compile timeout) → permanent hang.

**Deep fix (the #1 ask), in one architecture:**
1. **Preload the vendored `.fmt` + a curated base‑package set into memfs at boot** (fetch
   same‑origin `/swiftlatex/…` in `swiftlatex.ts`, `writeMemFSFile` into the kpse cache root).
   → base LaTeX + the packages Virgil actually emits (expex, natbib, graphicx, amsmath,
   xcolor, tikz) always work **offline**.
2. **Persistent IndexedDB tier** keyed `cacheKey → {bytes, fileid}`. On kpse miss: check IDB
   → else XHR → write‑through to IDB. → second visit / offline‑for‑seen‑packages is instant;
   kills the 37 s cold start.
3. **online‑fetch / offline‑fallback with a real error**: try mirror when online, fall back
   to cache, and on a genuine miss surface a clear "package `X` unavailable offline" instead
   of the cryptic format error or a 150 s hang.

### B. Invalid LaTeX emitted / wrong package contract (compile‑breaking)

- **[H] `xlist` — FIXED** (§1). Root of a shared cross‑module false belief.
- **[H] Bib‑family mismatch silently drops the needed package.** Baseline preamble *always*
  ships `\usepackage{natbib}` ([latex-requirements.ts:320](src/lib/latex-requirements.ts)).
  Add a biblatex‑only citation (`\autocite`/`\parencite`/`\footcite` — all in the citation
  dropdown); `detectBodyRequirements` returns `{biblatex}`, but `ensurePreambleRequirements`
  sees natbib present and **deletes the biblatex requirement** ([:285](src/lib/latex-requirements.ts))
  → `\autocite` undefined → fatal, no warning. Symmetric for a biblatex preamble + a natbib‑only
  `\citep`. Fix: don't silently drop a family the body depends on — warn at save, or rewrite
  cite commands into the declared family.
- **[M] biblatex via `\RequirePackage` isn't rewritten to `backend=bibtex` nor counted for
  passes** → guaranteed biber‑not‑found ([useLatexCompile.ts:172](src/hooks/useLatexCompile.ts)).
  Broaden the three regexes to `\\(?:usepackage|RequirePackage)`.
- **[M] tikz detector only sees `\begin{tikzpicture}`** — misses `\tikz` inline shorthand,
  `tikzcd`, `pgfplots`, and never injects `\usetikzlibrary` ([latex-requirements.ts:134](src/lib/latex-requirements.ts)).

### C. Silent failure / success‑vs‑failure conflation — "green compile that's actually broken"

The single biggest *trust* problem: the app reports success on genuinely broken output.

- **[H] Pass‑count keyed on bibliography presence, not reference‑resolution need.**
  `passes = hasBibliography ? 3 : 1` ([useLatexCompile.ts:203](src/hooks/useLatexCompile.ts)).
  A doc with `\ref`/`\pageref`/`\tableofcontents`/`\listoffigures` or a manual
  `\begin{thebibliography}` but no `.bib` package gets **one pass** → `??` refs, empty ToC,
  `[?]` cites — and `status===0`, so it's reported as full success with errors cleared.
  (The dev doc only escapes this because it loads biblatex.) Fix: ≥2 passes whenever any
  reference‑resolution construct is present.
- **[H/M] bibtex failures never surface.** The worker runs `_compileBibtex()` and **discards
  its status**; a malformed `.bib`/missing entry/typo'd citekey still posts `status:0`. Virgil
  trusts `result.status===0`, clears errors, reports success — PDF full of `[?]`. Fix: parse
  bibtex/biber lines from the log even on status 0; thread bibtex status through the worker.
- **[M] `status != 0` with 0 parsed errors → panel shows nothing** (or "No errors"),
  contradicting the "Compile failed — see the Errors panel" alert. Hits exactly the xlist/abort/
  network cases (the log has no `!`‑prefixed line the parser recognizes, or a WASM
  `status:-254 "Engine crashed"`). Fix: synthesize a fallback error card from the status +
  log tail so the panel always matches the alert; broaden the parser (§H).
- **[M] A later‑pass failure discards a valid earlier‑pass PDF** and reports failure.
  The 3‑pass loop keys success on the *final* pass; a transient pass‑2/3 failure throws away
  a perfectly good pass‑1 PDF ([useLatexCompile.ts:205](src/hooks/useLatexCompile.ts)). Fix:
  retain last‑good result.
- **[H] Library / read‑only papers: successful compile shows "No compiled PDF."** Compile
  isn't gated for read‑only papers, `writePdf` silently returns early
  ([storage-dev.ts:542](src/lib/storage-dev.ts)), and the viewer reads disk (nothing there).
  Fix: drive the viewer from the in‑memory bytes, or gate Compile.
- **[L] Dev `writePdf` ignores the PUT response status** — a 500/507 disk write is swallowed
  while the UI reports success ([storage-dev.ts:546](src/lib/storage-dev.ts)).

### D. No recovery / robustness

- **[H] No compile timeout and the engine is never reset on hang/crash.** `compileLaTeX`'s
  promise is resolve‑only (no reject, no timeout) and the worker's `onerror` is a no‑op
  swallow. A WASM OOM/trap or a stalled package XHR (§A) leaves `await` hanging forever →
  `isCompiling` stuck true → **Compile button permanently disabled**; the Busy singleton then
  throws on every later call. Only a full reload recovers (→ re‑download everything). Fix:
  `Promise.race` timeout → `closeWorker()` + null the module `enginePromise`; make `onerror`
  reject the in‑flight compile.
- **[M] `loadEngine` boot failure rejects with `undefined`** → the user sees
  "Compile failed: undefined" ([PdfTeXEngine.js:108](public/swiftlatex/PdfTeXEngine.js)).

### E. Silent data corruption via encoding

- **[H] Non‑UTF‑8 sources are silently mangled.** Every text‑ext file is decoded with a
  default `new TextDecoder()` (utf‑8, non‑fatal) ([useLatexCompile.ts:167](src/hooks/useLatexCompile.ts)).
  A latin1/CP‑1252 `.bib`/`.tex` (author names like *Müller*, *Gödel*; `\usepackage[latin1]{inputenc}`)
  → every high byte becomes `U+FFFD` before the engine sees it, and a documentclass rewrite can
  **persist the corruption to disk**. Fix: pass bytes through unchanged unless a rewrite is
  needed; decode with `{fatal:true}` + raw‑byte fallback.

### F. Comment/verbatim‑unaware parsing — "detect vs rewrite disagree on what's live LaTeX"

- **[M] documentclass detect + rewrite read a *commented‑out* `\documentclass`.**
  `% \documentclass{book}` above the live `\documentclass{article}` → mismatch missed, and a
  confirmed class switch rewrites the **comment**, silently doing nothing
  ([document-class.ts:44](src/lib/document-class.ts), [useLatexCompile.ts:116](src/hooks/useLatexCompile.ts)).
- **[M] `\verb` regex has no word boundary** — `\verbatim`/`\verbdef` match as inline‑verb and
  swallow following text incl. real `\section`/`\chapter`, so section scanning misses them →
  bogus/missed mismatch ([document-class.ts:136](src/lib/document-class.ts)).

**Deep unify:** the preamble‑requirements module *already* solved comment/verbatim inertness
(`projectDetectableBody`). Extract it and share **one** projector across documentclass +
`\verb` + requirements, so all three agree on what counts as live LaTeX.

### G. Example round‑trip fragility (silent data loss on load/save)

- **[H] Spaced accent/special‑letter commands mis‑parsed as `\a` sub‑item boundaries.**
  `\a the word \v s means bear` (š), `\a \i stanbul`, `\d t` (ṭ) → the splitter treats
  `\v`/`\d`/`\i` as new item markers, **deletes the accent and splits the item**, then
  re‑serializes corrupted ([latex-parser.ts:2205](src/lib/latex-parser.ts)). Data loss on
  load. Fix: reuse `matchAccent`/`matchSpecialLetter` before treating `\x` as a marker.
- **[M] `parseExampleBodyAsBlocks` silently drops unknown block types** (e.g. `\[…\]` in a
  `\pex` preamble, a `tabular`) ([latex-parser.ts:2438](src/lib/latex-parser.ts)).
- **[L] Prose‑only `\pex` gains a spurious empty `\a`** on first save; **[L]** `\endgl` scan
  is un‑boundaryed/comment‑unaware.

### H. Error‑panel surfacing — the whole error UX is unreliable

- **[H] `dismissedErrorIds` is never pruned and isn't per‑doc.** `makeErrorId` is a pure
  content hash, so a dismissed error recurs with the same id and is **hidden forever**
  (status stays 1, panel says "All errors dismissed"); dismissals also **leak across docs**
  (the shell state isn't keyed per doc) ([EditorLayout.tsx:1487](src/components/EditorLayout.tsx)).
- **[M] The entire lint/snippet/anchor surface is empty until the code view is opened once**
  — it's derived from `codeEditorText`, which is null until `CodeEditor` mounts. A visual‑only
  user's error cards have no snippet and a dead jump target ([EditorLayout.tsx:1471](src/components/EditorLayout.tsx)).
- **[M] `makeErrorId` collisions** (same line+message, common at line 0) → React key clash +
  shared dismiss/select ([latex-errors.ts:44](src/lib/latex-errors.ts)).
- **[M] pdfTeX 79‑col log wrapping** breaks line‑number extraction and truncates messages —
  the parser only sees the first physical line ([parse-tex-log.ts:46](src/lib/parse-tex-log.ts)).
  No fixtures exist for `parse-tex-log`.
- **[L]** alert cites a "compile‑log drawer" that doesn't exist in the visual editor · **[L]**
  doc‑switch doesn't reset error state (`clearCompileErrors` is dead code) · **[L]** stale lint
  persists after a green compile · **[L]** parser false‑positives on `!`‑at‑col‑0, naive `l.N`
  capture breaks jump‑to‑source, duplicate "Emergency stop"/"Fatal error" cards.

### I. Dead / duplicated state (cleanup — also masks real bugs)

- **[L] EditorLayout keeps a parallel PDF state** (`latestPdfBytes`/`lastCompileTime`/`pdfStale`)
  that compile never populates → `switchToPdfView` always re‑reads disk and the stale‑PDF badge
  is dead code ([EditorLayout.tsx:418](src/components/EditorLayout.tsx)). **[L]** a blob URL is
  allocated+revoked every compile but never shown. **[L]** `suggestClasses` offers `slides`/`beamer`.

### Adjacent (not the compile system, seen in passing)

- During doc load I saw **hundreds of identical `/api/dev-library/.virgil/catalog-version.txt`
  + `_exists/.virgil` polls** — a Library‑subsystem loop, worth a separate look.

---

## 3. Recommended remediation sequence

1. **Land the xlist fix** (done here) + harden the **compile pipeline to run requirements
   injection on the files it feeds the engine** (fixes existing on‑disk docs without a save;
   §1 caveat 1 + §C "self‑sufficient compile").
2. **Class A (the #1 ask):** preload the vendored `.fmt` + core packages into memfs; add the
   IndexedDB persistent tier; online‑fetch/offline‑fallback. Biggest reliability + speed win.
3. **Class C + D:** never report success on broken output (pass‑count by ref‑need, surface
   bibtex + status!=0/0‑error fallbacks, retain last‑good PDF); add a compile timeout +
   engine reset so a hang is recoverable.
4. **Class F unify:** one shared comment/verbatim projector across documentclass/verb/requirements.
5. **Class E, G, B‑remainder, H, I** as follow‑ups.

## Environment notes (for the next session)

- Isolated preview config `virgil-dev-audit` added to `.claude/launch.json` (own dist dir
  `.next-preview-audit`); `virgil-data`/`node_modules` symlinked into this worktree.
- Isolated audit doc: `virgil-data/doc_compileaudit` (id `compileaudit01`) — a copy of the
  dev doc; the def was hand‑injected into its `.tex` for the button‑compile demo. Your real
  `doc_devtest` and `:3000` session were never touched.
- Full per‑finding scenarios + fix sketches: workflow output at
  `…/tasks/wck7dxalp.output` (`.result.confirmed`).
