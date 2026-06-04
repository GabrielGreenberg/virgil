<!-- last-verified: 54ced55 2026-06-03 -->
<!-- derives-from: docs/architecture/VIRGIL.md#document-discipline -->

# `check-coherence` — design sketch

**Status: implemented** as [`tools/check-coherence.mjs`](../../tools/check-coherence.mjs) (chip 5; smoke tests in `tools/check-coherence.smoke.mjs`, npm script `check:coherence`, wired into `/cleanup-virgil` step 2). This document remains the design of record; the **Staging** notes below track the as-built severities. It is the CI guard that validates the [rooted dependency graph](VIRGIL.md#the-rooted-dag) — it owns the **edge-validation** job in the [three-mechanism division of labor](VIRGIL.md#document-discipline) (`/cleanup-virgil` synchronizes code→docs; this script validates the graph's edges; the future dream phase ripples docs→skills).

This is a `.SKETCH.md` design doc, not a graph node: it carries `derives-from` (to model the convention) but no `covers-code`, and the script excludes `*.SKETCH.md` from the `covers-code`/drift checks (it describes a future tool, not current code).

---

## What it checks

The script does **not** carry a hardcoded list of docs. It **discovers** every graph node by globbing the repo for files whose head carries the header block (a line matching `<!-- derives-from:` or `<!-- covers-code:`). This is the same self-describing move as `covers-code`: add a doc with the header and it is automatically in scope; no central registry to maintain. (Excluded: `*.SKETCH.md` design docs.)

**Parse precisely, not by loose grep.** Header fields are recognized only in two structural positions: the **top-of-file header block** (the leading run of `<!--…-->` lines before the first heading) and the **first comment(s) directly under a `##`/`###` heading** (per-section `covers-code`). A naïve repo-wide grep for `covers-code:` also matches the convention's own *prose examples* and fenced code samples (e.g. `<!-- covers-code: ... -->` written inline to document the format, or `<!-- covers-code: <repo-root-relative-path> -->` in a code fence) — those are not headers and must be ignored. The parser therefore skips fenced code blocks and only reads comments in the two sanctioned positions. (This bit the bootstrap's hand-validation, which used loose grep and produced a spurious `...` path from a prose sentence — a concrete reason to parse structurally.)

| # | Check | Severity (as built) | What it asserts |
|---|---|---|---|
| 1 | **Edges resolve** | **error** | Every `derives-from` `path#anchor` resolves to an existing file and a heading whose GitHub slug matches the anchor; every `covers-code` path (doc-level and per-section) resolves to an existing file or directory. (The union invariant — doc-level ⊇ per-section — is a **warn**.) |
| 2 | **Type accounting** | **error** | Every exported type in `src/lib/types.ts` is accounted for in VIRGIL.md's [Public-type registry](VIRGIL.md#public-type-registry) section, or explicitly delegated to a named manifest doc. (Graduated to error: Phase 0 filled the registry.) |
| 3 | **Concept → code** | warn | Every code-identifier-shaped named concept in VIRGIL.md (e.g. `PANEL_REGISTRY`, `\vfid`, `apply_response.py`) appears at least once in the codebase. |
| 4 | **Drift candidates** | warn (always) | For each doc, commits touching its `covers-code` paths newer than its `last-verified` sha → flag as a drift candidate for the next `/cleanup-virgil` pass. |
| 5 | **Python shadow ↔ TS registry** | warn | The Python card/panel vocabulary in `editor/scripts/` (`apply_response.PANEL_TO_SIDECAR` keys, `create_card.ALL_KINDS`) reconciles with the TS SSOTs (`PANEL_REGISTRY`, `CardKind`, the `…State` types) — no shadow lists a removed/renamed/never-real member. |

### Check 1 — edges resolve (the load-bearing one)

For each discovered doc, parse the header block plus every per-section `<!-- covers-code: … -->` comment.

- **`derives-from`:** split on commas; for each `path#anchor`, assert `path` exists and `anchor` matches the slug of some `##`/`###` heading in that file. Slug rule = GitHub's: lowercase, strip non-`[a-z0-9 -]`, spaces→`-`. The root sentinel `(root — verified against code)` is recognized and skipped.
- **`covers-code`:** for each path, assert it exists (file or directory). Also assert the doc-level `covers-code` is the union of (⊇) the per-section ones — a section covering a path the doc-level header omits is a warning (the union invariant from [Document discipline](VIRGIL.md#the-header-convention--the-two-axes-of-the-graph)).

This is an **error** from day one: unresolved edges defeat the entire purpose of rooting the graph, and they are unambiguous (a path either exists or it doesn't).

### Check 2 — type accounting

Parse `src/lib/types.ts` with the **TypeScript compiler API** (`ts.createSourceFile`, walk for `isInterfaceDeclaration`/`isTypeAliasDeclaration`/`isEnumDeclaration` with an `export` modifier) → the set of exported type names. Parse VIRGIL.md's Public-type registry section for backtick-quoted type names, plus an allowlist of names annotated as delegated (e.g. a `delegated-to: docs/workspace/sidecars.md` line). A type in neither set is unaccounted.

**Staging (as built):** Phase 0 (chip 4) filled the registry section and removed its stub marker, so the check runs as designed: **per-type error** on any genuinely-unaccounted type. The graduation trigger has fired. One implementation note: VIRGIL.md's registry section names ~25 types directly but **delegates the full 58-type enumeration** to the manifest's `sidecars.md` (its [Coverage](../workspace/sidecars.md#coverage) index) via a prose link. The script follows any `.md#anchor` link inside the registry section and harvests backtick type-names from the linked section too — so the delegation resolves mechanically and all 58 exported types are accounted (the check currently passes clean). (Through chip 9 this delegated to a Phase 0 seed report; chip 10 retired the seeds and repointed it to the manifest.)

### Check 3 — concept → code

"Named concept" is defined narrowly to stay tractable and low-noise: **code-identifier-shaped tokens in backticks** — `CONSTANT_CASE`, `camelCase`/`PascalCase` identifiers, `*.py`/`*.ts` filenames, and LaTeX macros (`\v…`). For each, search the repo (ripgrep, scoped: macros under `src/lib`, identifiers under `src/`/`library/`/`editor/`). Zero hits → finding. This check is **advisory by design** — it catches the obvious "doc names a symbol that was renamed/deleted" case, not all conceptual drift.

**Staging (as built):** warn-only (every token is emitted as a warning; the "lean error" idea was dropped — even a high-confidence miss should nudge, not block CI). Phase 0 reconciled the stub sections with shipped code, so the check currently passes clean — every `\v…` macro, `CONST_CASE`/`camelCase` symbol, and `*.ts`/`*.py` filename named in VIRGIL.md resolves. Two scope decisions held in the build: only `\v`-prefixed macros are checked (per the spec), and **data-file names (`*.json`/`*.css`) are out of scope** — they're string-referenced runtime artifacts, not source identifiers, so checking them as files produced only noise (`quotations.json`, `notifications.json`, …). Warn-only is retained as the right default for the day a future doc names a not-yet-built symbol.

### Check 4 — drift candidates

For each doc with a `last-verified: <sha>`, run `git log --oneline <sha>..HEAD -- <covers-code paths>`. Any commits → the doc is a drift candidate. For multi-topic docs, run per-section using the section's own `covers-code` so the report says *which* section drifted. Sections marked `<!-- STUB: pending Phase 0 -->` are skipped (their freshness claim is void until filled). **Always a warning, never an error:** drift is expected between releases and is *resolved* by `/cleanup-virgil`, not by blocking a PR. This check's value is feeding the cleanup pass a precise punch-list.

### Check 5 — Python shadow ↔ TS registry

The `editor/scripts/` Python helpers run outside the app and can't import the TS registries, so they **hand-duplicate** two slices of the card/panel vocabulary. These are **shadows** of TS SSOTs and rot independently — the Quotations → Reports merge had to hand-reconcile one (`PANEL_TO_SIDECAR`) and left the other (`create_card.ALL_KINDS`) stale (it still lists the removed `quotation` + the never-real `annotation` and omits `report`/`report-request`). This check is the guard that would have caught both. See [gardening.md → the Python shadow-rot discipline](../workspace/gardening.md#the-python-shadow-rot-discipline) for the full account of the two shadows.

**Inputs.** Two plain Python literals, extracted by **regex over the `.py` source** (both are flat dict/set literals — no Python runtime needed):

- `PANEL_TO_SIDECAR = { "<panel>": ("<file>.json", "<list-key>"), … }` in `editor/scripts/apply_response.py`.
- `ALL_KINDS = { "<kind>", … }` in `editor/scripts/create_card.py`.

The TS side reuses check 2's TypeScript-compiler parse of `src/lib/types.ts` (for `AiRequestLink["panel"]` and the `…State` interfaces) plus a parse of `src/panels/panel-registry.ts` (`PANEL_REGISTRY` keys) and `src/panels/_shared/types.ts` (`CardKind`).

**Assertions:**

1. **`ALL_KINDS` ⊆ `CardKind`** — every member is a real `CardKind`. (`ALL_KINDS` is the *create-able* subset, so it need not equal `CardKind`; but a member outside the union is a removed/never-real kind.) This caught the `quotation` (removed) + `annotation` (never-real) staleness; the create-card fan-out reconciled `ALL_KINDS` to its implemented set (`footnote`/`citation`/`note`/`todo`/`report`/`report-request`/`example`), so this assertion is now an **error** — a member outside `CardKind` is a hard re-drift.
2. **`PANEL_TO_SIDECAR` keys are valid card-writeback panels** — each key, after de-aliasing `todos`→`todo` (the `AiRequestLink.panel` value `todos` vs the `PanelKind` `todo`; see [sidecars.md → the Task store](../workspace/sidecars.md#the-task-store-ai-requestsjson)), resolves to a `PANEL_REGISTRY` panel that hosts a card. Conversely, a card panel a skill can write to that is **missing** from `PANEL_TO_SIDECAR` is a warning (a new card panel the writeback forgot — the inverse of the `quotations`→`reports` slip), **unless** it is on the documented **writeback-exempt allowlist** (`WRITEBACK_EXEMPT_PANELS` = `archive` / `bibliography` / `errors` / `examples` — intentional non-targets, rationale below); a stale allowlist entry (a panel now mapped, or not a card panel) is itself flagged.
3. **`PANEL_TO_SIDECAR` list-keys match the `…State` shape** — for each entry, the list-key is a real array field on the panel's `…State` interface (e.g. `reports → ReportsState.cards`, `footnotes → FootnotesState.footnotes`). This is the check that would have caught the historical `notes → "notes"` dead-key bug (the browser reads `NotesState.cards`). Filenames are cross-checked against the panel hook's `usePersistentState(…, "<file>.json", …)` call (v1 lighter form: assert the filename is referenced somewhere under `src/hooks`).

**The deep fix (north star).** The (panel → filename, list-key) triple has **no single TS SSOT** today — it's spread across `PANEL_REGISTRY` (panel names) and each panel's hook (filename + list-key). The durable cure is to lift that triple into one TS registry the manifest can emit, so the Python shadow is **generated/validated against one source** rather than hand-kept. Until then, this check is the interim guard; assertion 3 stays heuristic.

**The writeback-exempt allowlist.** Four card-hosting panels are intentionally **not** `apply_response` writeback targets — "hosts a card" (`PANEL_REGISTRY`) over-approximates "is a skill-writeback target", so their absence from `PANEL_TO_SIDECAR` is by design. The create-card fan-out chip turned the soft *"verify intentionally not writeback targets"* warning into a hard, documented allowlist (`WRITEBACK_EXEMPT_PANELS` in `check-coherence.mjs`), each entry justified:

- **`errors`** — not persisted; re-derived from the LaTeX lint each pass (no sidecar).
- **`bibliography`** — backed by the `.bib` file, not a `virgil/` sidecar; `find-citation` + the bib skills own it, so it has no `PANEL_TO_SIDECAR` row.
- **`archive`** — snippets are user-cut text; no skill mechanically authors archive cards.
- **`examples`** — `examples.json` is an app-derived **shadow** of the `.tex` (`useExamples.syncFromEditor` reconciles it on every parse); `create-card --kind=example` writes the `.tex` `\vexid…\ex…\xe` block (`create_card.py` `_create_example`), not the sidecar — so `examples` is correctly absent.

Only a card panel absent **and** not on the allowlist is a real finding (a forgotten writeback target — the inverse of the `quotations`→`reports` slip). The allowlist is self-checking: an exempt panel that is no longer absent (now mapped, or not a card panel) is flagged as stale.

**Staging (as built, post-create-card-fan-out):** **assertion 1 is now an error** — the fan-out reconciled `ALL_KINDS` to its implemented create-able set, so a member outside `CardKind` is a hard re-drift (the `quotation` + `annotation` staleness is gone). The inverse warning is **clean** via the allowlist above. Assertion 3 (list-key/filename) stays a heuristic **warn**, hardening as the (panel → filename, list-key) triple is centralized into one TS SSOT (the north-star above).

---

## I/O contract

```
node tools/check-coherence.mjs [--json] [--strict] [--since <sha>]
```

| Flag | Effect |
|---|---|
| (none) | Human-readable report grouped by check (`✓`/`⚠`/`✗` lines), summary footer. |
| `--json` | Machine-readable report on stdout (schema below); nothing else on stdout. |
| `--strict` | Promote every warning to an error (the hardening switch — CI flips this on once Phase 0 fills the stubs). |
| `--since <sha>` | Override the drift baseline for check 4 (default: each doc's own `last-verified`). |

**Exit codes:** `0` = clean (no errors; warnings allowed) · `1` = violations (≥1 error) · `2` = internal error (bad args, git/parse failure — distinct from a content violation so CI can tell "the check broke" from "the docs are wrong").

**JSON schema:**

```json
{
  "ok": false,
  "summary": { "errors": 1, "warnings": 4, "docsScanned": 7 },
  "findings": [
    { "check": "edges", "severity": "error",
      "doc": "docs/agents/main-text.md", "section": null,
      "detail": "derives-from anchor '#latex-vocab' not found in docs/architecture/VIRGIL.md" },
    { "check": "drift", "severity": "warn",
      "doc": "docs/agents/architecture.md", "section": "Persistence layers",
      "detail": "3 commits touch covers-code since e86a264" }
  ]
}
```

The human format is the same findings, rendered grouped by check with a one-line summary; both come from one in-memory findings array so they never diverge.

---

## CI hook

A sibling workflow `.github/workflows/coherence.yml` (as built). **Trigger reality:** this repo merges via git **worktrees, not pull requests**, and publishes on *push to main* (see `deploy.yml`). A `pull_request`-only trigger — the original sketch — would **never fire here**. So the live path is **`push: [main]`** (the check runs post-merge, the same model as the deploy); `pull_request` is kept too so the guard fires before merge if a PR flow is ever adopted, and `workflow_dispatch` allows a manual run. The actions/node versions match `deploy.yml` (`checkout@v6`, `setup-node@v6`, node 24):

```yaml
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
jobs:
  coherence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }   # check 4 needs history for `git log <sha>..HEAD`
      - uses: actions/setup-node@v6
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: node tools/check-coherence.smoke.mjs      # the checker's own smoke tests
      - run: node tools/check-coherence.mjs            # checks 1+2 gate; 3/4/5 warn
      # - run: node tools/check-coherence.mjs --strict  # post-Phase-0 hardening
```

The npm scripts (`check:coherence`, `test:coherence`) and the `/cleanup-virgil` step-2 wiring are the **live local path** — a maintainer runs `npm run check:coherence` before a release and acts on the check-4 drift candidates.

---

## Language recommendation: `.mjs` in `tools/`

**Recommendation: Node ESM (`tools/check-coherence.mjs`).** Justification:

1. **`tools/` is already `.mjs`** — `check-prefs-coverage.mjs`, `promote-defaults.mjs` live there. This is the established home for repo-maintenance scripts. (`editor/scripts/` is Python, but those are *paper-runtime* helpers shipped to end users via the skill bundle; a dev-time CI check is not that — it is maintenance tooling and belongs with its peers in `tools/`.)
2. **Check 2 wants the TypeScript compiler API.** Robustly enumerating the exported types of `src/lib/types.ts` means parsing TypeScript, not regex-scraping it (the file has re-exports, unions, and `@deprecated` members that a regex mishandles). `typescript` is already a dependency of this Next.js/TS repo, and `ts.createSourceFile` is a JS-native API — trivial from Node, awkward from Python.
3. **CI is Node-based.** `deploy.yml` already runs `npm` on `actions/setup-node`; a Node script needs no new toolchain in CI.

Checks 1, 3, 4 are fs + regex + `git log` (via `node:child_process`) — all comfortable in Node. Check 5 adds a regex scrape of two flat Python literals (`PANEL_TO_SIDECAR`, `ALL_KINDS`) — no Python runtime — and reuses check 2's `typescript` parse for the TS side. The only non-trivial dependency is `typescript`, already present.

---

## Staging: warn-first, harden as content lands

Phase 0 (chip 4) is **complete** — the type registry is filled and all six current-state sections are reconciled with shipped code, with no `<!-- STUB -->` markers left — and the script is built (chip 5). The original warn-first rationale (a wall of red on day one trains people to ignore the check) still governs the checks that remain warn-only. The as-built severities:

- **Check 1 (edges):** error from day one. The graph's edges must resolve — that is the invariant the whole discipline rests on. (The softer union invariant — doc-level `covers-code` ⊇ per-section — is a warn; VIRGIL.md currently trips it, since its coarse doc-level list isn't a strict superset of its sections.)
- **Check 4 (drift):** warn forever. Drift is informational; `/cleanup-virgil` resolves it at the release boundary.
- **Check 2 (types):** **error** (graduated). Phase 0 filled the registry and removed the `<!-- STUB -->` marker, so per-type erroring on genuinely-unaccounted types is live. The script no longer keys off the marker (there are none); check 2 is wired as a per-type error directly, and currently passes clean (58/58 accounted via the §2 delegation).
- **Check 3 (concepts):** **warn**. Passes clean today (Phase 0 reconciled the named symbols); warn-only retained as the right default for forward-looking symbols a future doc may name.
- **Check 5 (Python shadow):** **mixed (as built, post-create-card-fan-out).** The `ALL_KINDS ⊆ CardKind` assertion is now an **error** — the fan-out chip reconciled `ALL_KINDS` to its implemented create-able set, so the `quotation`/`annotation` staleness is gone and a future bad member hard-fails CI. The absent-panel **inverse** resolves clean via the documented `WRITEBACK_EXEMPT_PANELS` allowlist (`archive`/`bibliography`/`errors`/`examples`). Assertion 3 (list-key/filename) stays a heuristic **warn**, hardening as the (panel → filename, list-key) triple is centralized into a single TS SSOT.
