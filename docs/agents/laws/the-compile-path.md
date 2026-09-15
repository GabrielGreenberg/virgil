<!-- last-verified: 3a8f4892 2026-09-15 -->
<!-- derives-from: AGENTS.md#laws -->

# The compile path: downloaded work is DURABLE, and a slow compile SAYS SO

> **A compile that cannot finish inside one budget must still make PROGRESS, and
> every phase it spends minutes in must reach a pixel.** Virgil compiles in the
> browser: a first compile of a paper using tikz/pgf pulls 60–100 files from a
> third-party mirror over SERIAL SYNCHRONOUS XHR, one blocking round trip each.
> That is the app's single longest operation, and until task 454 it was also the
> only one with neither durability nor a voice.

This is the "Compile produces nothing after two minutes, with no error, no
indicator and an empty dark PDF pane" class (task 454, Gabriel's own dev doc).
Two independent defects, and the first is the one that made it unfixable by
clicking again:

- **A timed-out compile DISCARDED every package it had downloaded.** The bytes
  lived only in the worker's in-memory `texlive200_cache`; the write-through to
  IndexedDB rides `dumpNewCache`, which is a **request/response round trip** and
  therefore cannot run while the worker is blocked inside a synchronous pass —
  the one moment the bytes matter most is the one moment the worker can never
  answer. `captureNewAssets` was reachable only *after* a pass RESOLVED, and the
  timeout path went straight to `recover()` → `closeWorker()` → `self.close()`,
  tearing the whole worker scope down. So each retry restarted from the same
  fixed baseline (the vendored core bundle + whatever earlier *completed* passes
  had persisted), re-fetched the identical set, and timed out at the same point.
  **No forward progress between attempts, ever.**
- **Nothing said anything.** The compile's only moving pixel was a 16px spinner
  in the top bar — not on screen while the user watches the PDF pane, which is
  the surface they are waiting on and which rendered a bare dark surface. So
  "two minutes into downloading pgf" and "broken" were the same picture. Task
  392's law (*a gate that stops working SAYS SO, in one voice*) in the one
  subsystem that pass never reached.

Four mechanisms, and the first two are one idea:

- **STREAMING DURABILITY.** The worker posts each asset the instant it caches it
  (`__virgilStreamAsset` → `assetfetched`), and `attachAssetStream` writes it
  through immediately. A compile that times out now keeps 100% of what it
  fetched. **The channel had to be a second listener**: every per-call method in
  `PdfTeXEngine` swaps `latexWorker.onmessage`, and the compile handler
  early-returns on any `cmd !== "compile"`, so a message posted DURING a compile
  is dropped by that channel *by construction*. `installStreamChannel` uses
  `addEventListener("message", …)` once at boot, which no `onmessage` swap can
  clobber.
- **CONTINUATION.** A timeout that DOWNLOADED something is continued against the
  now-warmer cache rather than dead-ended; one that downloaded NOTHING is a real
  hang (a crashed worker, a stuck pass) and is reported at once, because
  continuing it would spend the whole budget re-hanging in silence. Bounded
  twice — `MAX_COLD_ATTEMPTS` and `TOTAL_COMPILE_BUDGET_MS` — since "keep going
  while it looks productive" with no ceiling is a hang wearing a retry's clothes.
- **A VOICE.** [compile-progress.ts](../../../src/lib/compile/compile-progress.ts) is the
  `useSyncExternalStore` store (the `unsaved-work` / `preservation-notice`
  shape), keyed **per document** because the service is a module singleton shared
  by every mounted `EditorPane` ("Per-doc services under multi-pane keep-alive").
  [CompilePaneStatus](../../../src/components/CompilePaneStatus.tsx) renders it: the live
  phase (naming the package and how many so far), or the last compile's FAILURE
  in the user's terms, or the honest "nothing yet" prompt. **"There is no
  pdfBlobUrl" is the same fact in all three states; only the record tells them
  apart.**
- **kpse HARDENING**, and its status is stated honestly rather than promoted:
  upstream negative-caches a miss only on status **301** — its own dead CDN's
  sentinel — so a 404, a 429, a 5xx, a network error or the per-file timeout
  fell through UNCACHED and kpse re-issued a full blocking XHR every time it
  probed that name. Measured live, the shipped TeXlyre mirror *does* answer 301
  for a miss, so on the everyday path this was latent; what it covers is exactly
  the shape the report describes (an endless stream of non-200s that never
  terminates), and a worktree cannot determine which status Chrome surfaces for
  a 301 carrying no `Location`. Every non-200 is negative-cached now, a mirror
  circuit breaker (`__mirrorDown`) turns an unreachable mirror into a FAST NAMED
  failure instead of a grind, the per-file timeout drops from 150 s to 30 s, and
  `kpse_find_pk_impl` gains the offline short-circuit its sibling has had all
  along — found by the independent diagnosis, not by the report.
  **Negative-cached, but into the RIGHT table (task 573):** the first cut wrote
  every non-200 — and every offline / breaker short-circuit — into
  `texlive404_cache` / `pk404_cache`, module-level tables nothing ever clears in
  a worker that lives for the session. So the per-compile reset of the miss
  lists was defeated by the key-level cache: after reconnecting, a package that
  missed offline was never retried AND no longer named. Two claims, two tables —
  a DEFINITIVE miss (301/404/410) is durable for the worker's life, because an
  `\IfFileExists` probe of an absent file must not re-issue a blocking round trip
  every compile; a miss we merely could not RESOLVE goes in the per-compile
  `self.__transientMiss`, cleared in `prepareExecutionContext`. Pinned in
  `worker-kpse-contract`.

Five rules they earned:

- **Durability rides the channel the blocked side can still USE.** A worker
  parked in a synchronous frame can `postMessage` and cannot `onmessage`. Any
  design that asks it a question during its slowest phase is designed to fail
  exactly there.
- **`closeWorker` does not `terminate()`** — it posts `grace` and drops our
  reference, so a worker blocked mid-compile keeps running as an ORPHAN,
  still fetching, until its pass unwinds. So the teardown **keeps** the
  DURABILITY sink (those late bytes are precisely what the next attempt would
  re-download) and **drops** the PROGRESS sink (per-attempt bookkeeping — an
  orphan's fetches counted against the next attempt would make a dead hang look
  productive and keep the continuation loop running).
- **`dumpNewCache` is BOUNDED.** It cannot resolve while the worker is blocked,
  so an unbounded await wedges its caller on precisely the path — a hang — where
  someone is most likely to reach for it. No live caller does today; that is what
  makes it a latent trap rather than a defect.
- **A timeout message must not imply the work was thrown away**, because after
  this fix it wasn't. A productive timeout says how many packages are cached and
  that pressing Compile again carries on from there.
- **The progress channel reaches a terminal state on EVERY path out of the
  hook**, or the pane says "Compiling…" forever for a compile that has ended —
  including the throw path, the cancelled documentclass prompt and the
  stale-pipeline abort, none of which the service can see.

CI: [compile-convergence.test.ts](../../../src/lib/compile/__tests__/compile-convergence.test.ts)
drives the REAL `CompileService` against a fake engine that DOWNLOADS and then
hangs. **No pre-454 suite could see any of this**: `compile-service.test.ts`
drives one attempt and asserts its RESULT, and its fake engine has no download
channel at all, so "did the packages this attempt fetched survive?" is
unrepresentable in every one of its legs — which is exactly how a compile that
could never converge shipped green.
[worker-kpse-contract.test.ts](../../../src/lib/compile/__tests__/worker-kpse-contract.test.ts)
is the SOURCE census over the vendored worker and its wrapper, and it is the only
instrument that can see them: nothing in the repo can DRIVE that code (it needs a
real `Worker`, real WASM and a real synchronous cross-origin XHR), and every
behavioural suite mocks `@/lib/swiftlatex` — so a `git checkout` of the upstream
file would silently drop every patch with the whole suite still green.
[compile-pane-status.test.tsx](../../../src/components/__tests__/compile-pane-status.test.tsx)
pins WHICH WORDS reach the pane, which is a render fact no service or store test
can reach. Measured by neutering each half in turn: the pre-454 dead end takes 3
legs, the progress channel 4, and the pre-454 one-message pane 4.

**Residual, stated.** The per-file XHR timeout's effectiveness is unverified —
the vendored file's own patch comment records that a synchronous cross-origin
XHR *ignores* its timeout, which is an empirical claim someone hit and wrote
down, and which a worktree cannot re-check.

**The pgf/tikz residual this section used to record is CLOSED by task 520** —
see "The vendoring half" immediately below.

**Owed, not claimed:** the preview acceptance. Compile behaviour is NOT
FSA-masked — it runs in the dev preview — but a worktree cannot start the dev
server (Turbopack panics on the symlinked `node_modules`) and this run was
unattended, so `virgil-dev` → `doc_devtest` → Compile → a rendered PDF is owed
against clean `main`. What is proven here is the STRUCTURE: durability across a
timeout, bounded convergence, and the words that reach the pane.


### The vendoring half: a capture is the wrong instrument for a KNOWN closure

Same path, and the case where the mechanism that fills the offline bundle could
only be driven by the one thing a headless run cannot do (task 520). 454 made a
cold tikz compile SURVIVABLE — streamed packages persist, retries continue, the
pane narrates. This is the half that makes the wait DISAPPEAR.

The bundle had ONE producer, `build-tex-bundle.mjs`, and it takes a **live
capture**: a browser, a warmed worker, and a document that happens to exercise
the packages you want. That is exactly right for the assets it was built for —
a font, a map or an encoding is filed under a numeric kpse format code pdfTeX
assigns at RUNTIME, so those keys cannot be hand-authored. It is exactly wrong
for "vendor this package family", where the format code is KNOWN (kpse `tex` =
26 — corroborated by every `.sty`/`.cls`/`.cfg`/`.def`/`.fd`/`.clo` row the
original capture produced) and the closure is derivable from the sources
themselves. So the family nobody had vendored was the family nobody COULD
vendor without an afternoon of hand-copying, and 454 filed it as a routed
decision for exactly that reason.

> **A DECLARED family — seeds, plus the two things a source scan cannot infer —
> is resolved against the mirror by a script; the RESULT is the checked-in
> bundle.** Both producers write through ONE door
> ([tex-bundle-manifest.mjs](../../../scripts/lib/tex-bundle-manifest.mjs)), which merges
> **by family**: each replaces exactly its own rows and carries every other
> family's through. Adding the next family is an entry in
> [tex-bundle-families.mjs](../../../scripts/tex-bundle-families.mjs), not an afternoon.

Seven rules it earned:

- **The scan is a PROPOSAL and the declaration is where the imprecision is
  REVIEWED.** TeX is Turing-complete and its loads are conditional, so no source
  scan is exact — which is survivable only because both error directions fail
  open (a missed file streams from the mirror exactly as today; an extra file is
  wasted bytes) and *nothing here can make a compile fail that previously
  succeeded*. What the declaration buys is that the imprecision lands as a DIFF
  in the generated manifest rather than being re-decided by a regex on every run.
- **TALKING about a load is not a load, and that is 1.0 MB of the answer.**
  Measured on the shipped sources, the naive scan resolves 2.16 MB where the
  real closure is 1.16 MB. Two rules recover the difference: `\string\usepackage{fp}`
  PRINTS the call rather than performing it (which is a fact about TeX, so the
  rule covers every loader instead of a list of the ones someone remembered —
  and it is what answers pgf's dozen `\tikzerror{You need to say
  \string\usetikzlibrary{calc}}` branches), and a `\DeclareOption{table}{…}`
  body runs only if the caller passes that option (which is where xcolor's
  `colortbl` → `array`, `color` and `pdfcolmk` came from; Virgil emits bare
  `\usepackage` lines).
- **A THIRD rule was written and DELETED, and finding it took a neuter rather
  than a reading.** Dropping any line carrying an `…error`/`…warning`/`…typeout`
  macro changed the closure by ZERO files with the two above in place — every
  diagnostic in this corpus that names a load names it with `\string`, because
  that is how TeX prints a control sequence. It was also the only rule that
  could lose a REAL load, being line- rather than construct-granular. **A rule
  that does nothing is worse than no rule: the next reader trusts it.** Its
  would-be defect leg passed under its own neuter, which is what exposed it.
- **The two things a scan cannot infer are the two things the declaration
  states.** A MACRO is not a filename (`\input\pgfsysdriver` — so pdfTeX's
  driver, `pgfsys-pdftex.def`, is a declared SEED), and what the FORMAT already
  carries is invisible from the sources.
- **…and "the format has it" is not a reason on its own — what matters is
  whether the LOAD SITE EXECUTES.** This fix's own first cut excluded
  `expl3.sty` on the strength of the format preloading expl3, reasoning that
  `\RequirePackage{expl3}` would be answered by `\@ifpackageloaded`. It is not:
  measured in the `.fmt` bytes, `ver@expl3-code.tex` occurs and `ver@expl3.sty`
  does NOT, while sibling `\ver@<pkg>.sty` markers do — so the format loaded
  expl3 by `\input expl3-code.tex`, never through the package wrapper, and
  xparse's unconditional `\RequirePackage{expl3}` (reached from every
  `\begin{forest}` paper) went straight to kpse. The exclusion cost ONE serial
  blocking mirror fetch on exactly the compile this family exists to speed up.
  `expl3.sty` is vendored (4.4 KB); only its 1.05 MB payload is excluded, and
  for a reason that is in the loader's own source rather than in the format's:
  `expl3.sty` gates `{\input{expl3-code.tex}}` behind a `\csname tex\string
  _let:D\endcsname` test, so with the code already loaded `\@gobble` swallows
  it. The neighbouring `etex` rows are the same shape and were re-worded with
  their real mechanism (both call sites are gobbled on a 2015+ kernel), because
  one wrong sentence in that table had already produced one wrong exclusion.
- **One cacheKey has one OWNER, so a closure that OVERLAPS is not a closure that
  DUPLICATES.** forest's closure begins with all of tikz's; the overlap is still
  fetched (its references are how the graph is walked) and the first family to
  declare it keeps the row. Only the LABEL depends on declaration order; the set
  of vendored bytes does not.
- **…so `--all` REBUILDS ownership rather than merging into it**, or "trimming a
  family is one config edit" is false in two directions. Clearing only the
  STALE families leaves the other half live: a key cannot be RE-ASSIGNED,
  because the writer's one-key-one-owner rule reads the manifest and rejects the
  new owner's rows — so re-declaring a family another has since absorbed
  silently loses that closure. Both were found by driving the round trip in the
  direction the first cut did not: undeclare the FIRST family, not the last.
  With the rebuild, both directions are exact — 174 rows → 145 → 174 dropping
  `forest`, 174 → 172 → 174 dropping `pgf-tikz`, bundle byte-identical each
  time. The clearing pass does not prune, since the bytes are about to be
  re-resolved.
- **`family` is a column with a READER, or it would be a dead facet.** The
  producers read it to replace exactly their own rows — without which a family
  whose closure SHRINKS leaves orphan rows, and orphan bytes, in the bundle
  forever. Proven in practice: tightening the scan mid-task pruned the 16
  over-fetched files on the next run.
- **Lifting the writers into a shared door nearly DRAINED the census that
  governs them.** `public-asset-url-ssot`'s task-365 leg greps
  `build-tex-bundle.mjs` for `swPath` and for `bundlePaths.push` — and after the
  refactor that file has neither, so the leg would have gone green while
  enforcing nothing. It is RENEGOTIATED in place onto the shared writer and
  WIDENED (both producers must go through it and neither may spell its own
  strip), because *a wrapper relocates an obligation to its callers; it never
  absorbs one* — task 331's rule, arriving at a census instead of a splice site.

**Measured.** pgf/tikz: **63 files, 1.16 MB** (8 more of its closure was already
vendored by the `core` capture). forest: **29 files, 1.10 MB** on top —
1.5× what task 454's sizing predicted for it, because that estimate counted
`forest.sty` as a LEAF where its real closure pulls xparse, etoolbox, environ,
inlinedef, elocalloc, pgfopts and tikz's `shapes`/`fit`/`calc`/`intersections`
libraries. Together **+2.26 MB over 92 files**, taking the engine payload from
17.65 MB to 19.91 MB (+12.8 %) — the ~13 % 454 predicted, on a different
baseline. That cost is paid ONCE at install, into the service worker's
precache, and it replaces a per-paper wait of 60–100 serial blocking round trips.

CI: [tex-bundle-integrity.test.ts](../../../src/lib/__tests__/tex-bundle-integrity.test.ts).
Its legs with teeth are the AGREEMENT ones, because the bundle's two consumers
fail in OPPOSITE, SILENT ways: a `CORE_MANIFEST` row whose bytes are absent
fetches a 404 that `fetchBundledBytes` swallows and the package then streams —
i.e. exactly the wait this closes, with nothing visibly wrong — while a path the
SW precaches that the engine never seeds is dead weight and one the engine seeds
that the SW never precaches is missing when the user goes offline. So the two
tables and the bytes on disk are asserted as three views of ONE set. Measured by
neutering each half in turn: a missing byte, an orphan byte, a dropped SW path
and a duplicate cacheKey each take 1 leg; the `\string` rule 1, the
`\DeclareOption` blanker 1, and the escaped-`%` branch of the comment stripper 1
(that last one matters in the direction that COSTS — without it the scan cuts at
`\%` and silently never follows the real load after it).

Beside them the WRITER's own legs, which exist because its paths are module
constants and its decision was therefore untestable until `parseManifestRows`
and `mergeFamilyRows` were extracted from it — leaving the change's central
claim neuterable with the whole repo suite green, and the damage landing on the
next run of the OTHER producer. Measured: a writer that forgets other families
takes 4 legs, a prune keyed on one family's fileids 1, dropping
one-key-one-owner 1, losing the legacy family-less row rule 1, and an undeduped
SW list 1. `FORMAT_TEX` is anchored to the live capture's own `26/article.cls`
rather than to itself — every closure leg builds its expected key from that
constant, so without the anchor a drift to 27 would leave all of them green
while the entire bundle sat at keys the worker never asks for.

**Owed, not claimed:** done-when 5, the live capture that confirms the estimate.
Compile behaviour is not FSA-masked but a worktree cannot start the dev server,
so against clean `main`: clear the compile cache (IndexedDB), compile a tikz and
a forest document, and confirm the progress pane reports ZERO mirror downloads
for those families. **A straggler streaming IS the capture** — add its reqname
to the family's seeds and re-run `node scripts/vendor-tex-family.mjs --all`.
