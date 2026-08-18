# MEMO: Preamble requirements SSOT + code-pane preamble durability (2026-07-02)

Two reported bugs, one disease: **the .tex preamble has no requirements model and no
unified write path.** Worktree: `.claude/worktrees/style-packages-codepane`
(branch `worktree-style-packages-codepane`, off local main `1b776636`).

## Bug 1 — standard styles missing packages (root cause, confirmed)

- All three reachable built-in style preambles are byte-identical to `CLASSIC_PREAMBLE`
  (`src/lib/document-styles.ts:21-37`): `classic`, `greenberg`
  (`GREENBERG_PREAMBLE_TODO = CLASSIC_PREAMBLE`, :39-42), `__emergency__`
  (`EMERGENCY_PREAMBLE = CLASSIC_PREAMBLE`, :46). Contents: article + inputenc[utf8] +
  amsmath + amssymb + xcolor + `\vfid/\vcid/\vexid` shims. **Nothing else.**
- Virgil EMITS (latex-serializer.ts): expex (`\ex/\pex…\xe` :493-575, `xlist` :609-618,
  `\begingl…\endgl` :638-655, `\getref/\getfullref` :462-468; also footnote bodies via
  footnote-content.ts:340-346), graphicx (`\includegraphics` :329-336, :519-527,
  :588-594, figure extras :293-327), natbib/biblatex cite commands verbatim (:718-721;
  dropdowns CitationCard.tsx:42-74; registry cite-commands.ts:31-62), tikz (verbatim
  figure-extras/texBlock passthrough).
- The only injector, `ensureVirgilCommands` (latex-serializer.ts:46-92), covers xcolor +
  7 `\v*id` shims; it is **skipped** on the no-options `DEFAULT_PREAMBLE` path (:737-739).
- Ground truth: `samples/annotation-history/document.tex:1-21` = inputenc + graphicx +
  xcolor + amsmath + amssymb + natbib + expex + tikz + shims + `\bibliographystyle{plainnat}`.
- Seeds only reach FRESH installs: `getStyleLibrarySync` (style-library.ts:53-78) seeds
  localStorage `virgil-style-library` once; `version` field read but never compared.
- Same disease in templates (document-templates.ts): no expex anywhere, no xcolor in ANY
  template, `blank` lacks graphicx/natbib.
- Adjacent: drift gate `docPreamble !== activeStyle.preamble` (ManageStylesModal.tsx:110-118,
  :168-185) reads every saved doc as drifted because injected shims never byte-match; the
  StyleApplyDialog custom-macro filter (:87) hardcodes only vfid/vcid/vexid.

## Bug 2 — code-pane preamble edits don't survive close/reopen (root cause, confirmed)

- CodeEditor mount does a ONE-TIME `readTex → extractPreambleAndPostamble` into refs
  (CodeEditor.tsx:130-155); bridge copies into closure vars (code-pane-bridge.ts:119-120).
- A code-pane preamble edit updates ONLY the closure (:176-180) and pushes the parsed BODY
  into TipTap (:202). The autosave that follows (`useDocument.ts` → `writeDocBundle`)
  **re-reads the OLD preamble from the on-disk .tex** (storage-fsa.ts:564-565,
  storage-dev.ts equivalent) — the new `\usepackage` line never reaches disk.
- The reverse sync (:216-248) re-serializes with the updated closure preamble, so the pane
  keeps DISPLAYING the edit — masking the loss until close (bridge disposed,
  CodeEditor.tsx:234-237) → reopen re-reads stale disk → edit gone.
- Adjacent divergence: style switch (useDocumentStyle.setStyle → writeTex) or external
  reload while the pane is open never refreshes the closure; the pane displays stale
  preamble thereafter.

## Design

### Part A — `src/lib/latex-requirements.ts`: one SSOT for what Virgil's LaTeX needs

A declarative registry, consumed by four sites:

1. **Requirement entries**: `{ id, kind: 'package'|'shim', injectLine, satisfiedRe }` for:
   xcolor, graphicx, expex, natbib, biblatex, tikz, and the 7 `\v*id` shims.
2. **Body-scan detection** `detectBodyRequirements(bodyLatex): Set<id>` — one regex pass
   over the SERIALIZED BODY at save time (never keystroke path): `\ex/\pex/\begingl/
   \getref/\getfullref/\begin{xlist}` → expex; `\includegraphics` → graphicx;
   `\begin{tikzpicture}` → tikz; cite command from cite-commands.ts → natbib XOR biblatex
   family (bare `\cite`/`\nocite` are kernel = neutral; if preamble already carries either
   bib package, never inject the other; both families used → natbib); `\textcolor` → xcolor.
   Escaped prose is safe: escapeLatex escapes backslashes, so an emitted `\includegraphics`
   is genuinely a command.
3. **`ensurePreambleRequirements(preamble, required)`** replaces/generalizes
   `ensureVirgilCommands`: idempotent injection before `\begin{document}`, packages before
   shims, shims + xcolor always ensured (today's behavior preserved). Called on **every**
   serialize — including the no-options `DEFAULT_PREAMBLE` path (fixes the skipped-shims gap).
4. **Baseline block** `VIRGIL_BASELINE_PACKAGES` (inputenc, graphicx, xcolor, amsmath,
   amssymb, natbib, expex — matching the sample ground truth; tikz/biblatex stay
   needs-driven only) + a `buildPreamble(documentclass, extras)` helper. `CLASSIC_PREAMBLE`
   and the four templates are rebuilt FROM this block (templates keep their
   geometry/hyperref extras; article-bib's natbib now baseline).
5. **`stripAutoInjectedLines(preamble)`** — exact-line (trimmed) removal of registry inject
   lines + blank-run collapse. Used by the ManageStylesModal drift gate (compare normalized
   forms) and to derive StyleApplyDialog's custom-macro exclusion set from the registry.

**Seed migration**: bump the style-library version; on `getStyleLibrarySync`, upgrade any
`origin: "seed"` style whose preamble is byte-identical to a KNOWN legacy seed blob
(untouched seeds upgrade; user-edited seeds untouched); persist bumped version.

**Dev parity**: storage-dev load-writeback uses `resolveStyle(settings.styleId)` like fsa.

### Part B — preamble edits commit to the canonical owner (disk) at code-flush time

Disk stays the single canonical preamble owner; the fix routes code-pane preamble edits
into the existing serialized bundle-write pipeline:

1. `writeDocBundle(h, content, opts?: { delimiters?: { preamble, postamble } })` in
   storage-fsa + storage-dev (+ the `@/lib/storage` facade): when passed, SKIP the disk
   re-read and use the provided delimiters (still through serializeToLatex → requirements
   pass; ledger stamped as today; same "bundle" queue subkey → ordered vs autosaves).
2. Bridge option `persistDelimiters?: (d) => void`, called in `flushCodeToTipTap` when the
   re-extracted delimiters differ from tracked (:176-180) — fires the immediate bundle
   write with override; subsequent autosaves re-read the NEW preamble from disk. No
   long-lived override state, no authority ambiguity.
3. Wiring: EditorLayout (CodeEditor render, ~:3862-3888) threads a callback down; the
   callback enqueues `writeDocBundle(handle, editor.getJSON(), { delimiters })` via the
   doc's save machinery (useDocument), and updates CodeEditor's preamble/postamble refs.
4. Divergence fix: a per-doc `virgil:tex-delimiters-changed` CustomEvent dispatched by
   useDocumentStyle.setStyle (after writeTex) and the external-change Reload path;
   CodeEditor listens → re-read disk delimiters → update refs + `bridge.setDelimiters()`
   (new method: update closure + forced reverse sync).

### Explicitly out of scope
- Authoring a real Greenberg preamble (placeholder stays, now with correct baseline).
- swiftlatex compile-backend changes (biber/bibtex rewrite untouched).

## Work packages (sequential — shared files)

- **WP-A (Bug 1)**: latex-requirements.ts (new) · latex-serializer.ts (ensure→registry,
  always-run, body-scan hookup) · document-styles.ts · document-templates.ts ·
  style-library.ts (version migration) · ManageStylesModal.tsx + StyleApplyDialog.tsx
  (normalized drift compare, registry-derived filter) · storage-dev.ts (style parity) ·
  unit tests.
- **WP-B (Bug 2)**: storage-fsa.ts + storage-dev.ts + storage facade (delimiters opt) ·
  code-pane-bridge.ts (persistDelimiters + setDelimiters) · CodeEditor.tsx ·
  EditorLayout.tsx/useDocument.ts wiring · delimiters-changed event (setStyle + reload) ·
  unit tests.
- **WP-C**: full vitest run + fix fallout (roundtrip/preamble byte expectations updated
  thoughtfully, not blindly) · adversarial review of the diff · live preview verification
  (from main checkout post-merge — worktree symlinked node_modules panics Turbopack).

## Test plan

- Requirements: detection matrix per construct; injection idempotence (double-serialize
  stable); natbib/biblatex exclusivity; strip/normalize round-trip.
- Serializer: exampleBlock doc + ClassIC preamble → exactly one `\usepackage{expex}`;
  no-options path now injects shims (regression).
- Style library: legacy untouched seed upgrades on version bump; edited seed preserved.
- Storage: writeDocBundle honors delimiters override; ledger stamped (extend
  storage-fsa-load-writeback.test.ts patterns; vi.mock("@/lib/storage") + jsdom per
  vitest gotcha).
- Bridge: preamble edit in code text → persistDelimiters called with new value; body-only
  edit → not called; reverse sync uses updated closure.

## Risks

- Existing tests asserting CLASSIC_PREAMBLE/template bytes will need updates.
- Injection MUST be idempotent or every save appends (double-serialize test guards).
- Style-library migration must never touch user-edited styles (byte-equality gate).
- Code-pane immediate bundle write uses the just-parsed TipTap JSON — body freshness OK;
  parse-failure path (mid-edit `\begin{document}`) keeps previous delimiters (extraction
  returns null) and persists nothing.
