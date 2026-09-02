<!-- last-verified: cb8bc044 2026-09-02 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization, docs/architecture/VIRGIL.md#sidecar-and-panel-inventory, docs/architecture/VIRGIL.md#cowork-pattern -->
<!-- covers-code: src/lib/storage-fsa.ts, src/panels/panel-registry.ts, editor/scripts, library/lib/skill-sync.ts -->

# Structure (paper folder & write path) — operational manifest

> **When to load.** Any task that reads or writes files in a paper folder, or
> needs to know *where* a Card lives and *how* a change is committed. Per-sidecar
> JSON schemas are [sidecars.md](sidecars.md); the never-touch deny-list is
> [gardening.md](gardening.md).

Operational cut of [VIRGIL.md → Code organization](../architecture/VIRGIL.md#code-organization),
[Sidecar and panel inventory](../architecture/VIRGIL.md#sidecar-and-panel-inventory),
and [Cowork pattern](../architecture/VIRGIL.md#cowork-pattern). The single disk
boundary is `src/lib/storage-fsa.ts` — every read/write the app does routes
through it, so the reserved names below are authoritative. (One invariant the
boundary enforces: a read-only `library-paper:<citekey>` Reader doc *never*
persists — all writes short-circuit at the shared `enqueueDocWrite` funnel,
while reads still resolve the paper's handle on demand from the mounted
library; this is a Library-subsystem concern, not the paper-folder write path
below.)

## The paper folder

```
<paper>/
├── <name>.tex              ← the Document, the source of truth
├── <name>.bib              ← bibliography (optional)
├── virgil/                 ← Virgil's sidecars (Cards + infrastructure)
├── .virgil/                ← agent / library plumbing (DISTINCT from virgil/)
└── .claude/                ← Claude Code surface (commands, manifest, CLAUDE.md)
```

`virgil/` and `.virgil/` are **different folders** with different jobs — the
leading dot matters. Disk state outside the folder: IndexedDB holds preferences,
tab state, folder handles, the doc index — **never paper content**.

## The .tex and .bib

- **`<name>.tex`** is the source of truth for the Document body. A skill changes
  it through the write path below (its `texEdit` splice), **not** by reformatting
  the whole file. What the parser accepts/emits is [latex.md](latex.md); the
  invisible markers a skill must preserve are [identity.md](identity.md).
- **`<name>.bib`** holds bibliography entries. Citation Atoms reference its keys
  ([atoms.md](atoms.md)); bib Cards mirror it.

## The virgil/ sidecar folder

`virgil/` (`VIRGIL_SUBDIR`) holds the Cards and the app's per-paper infrastructure.
Two classes of file (schemas → [sidecars.md](sidecars.md)). Since task 363 the
complete write vocabulary — and what each file is WORTH — is declared once in
[src/lib/sidecar-value.ts](../../src/lib/sidecar-value.ts): a `tier` of `"view"`
(recomputable UI state; coalesced hard) or `"content"` (the user's writing; prompt
cadence), plus whether the doc-mount bundle pre-reads it. That table drives the
write cadence AND how a cloud-sync "conflicted copy" fork of the file is
reported — AGENTS.md, "The daemon half".

- **Infrastructure** (shared app state): `virgil.json` (paragraph titles +
  fingerprints), `editor-state.json` (last paragraph + folds),
  `ai-requests.json` (the **Task** store), `notifications.json`, `collab.json`
  (the pen / turn-taking state), `document-settings.json` (preamble style id),
  `version.txt` (the change counter the writeback bumps).
- **Card sidecars** (one per card-bearing panel): `notes.json`, `todos.json`,
  `footnotes.json`, `citations.json`, `cutter.json`, `revisions.json`,
  `reports.json`, `examples.json`, `archive.json`, plus the bibliography support
  files `bib-settings.json` / `bib-review-requests.json` / `annotations.json`.
  (`reports.json` was renamed from `quotations.json` in the card-system refactor;
  a few legacy `suggestions.json` / `comments.json` survive. **Errors are not
  persisted** — they re-derive from the live LaTeX lint.)

Also under `virgil/`: `figures-cache/` (rasterized `<sha>.webp` + `index.json`,
keyed by source-content sha) and `.history/` (timestamped shadow snapshots of
the `.tex` + `virgil.json` + `editor-state.json`, taken before each overwrite).
Three writers put slots there, all in the same shape: the routine pre-overwrite
snapshot, the unconditional forensic one a preservation refusal forces (task 357,
below), and — since task 364 — a disk/model **conflict** resolution, which archives
BOTH sides into one slot (the disk bundle under its own names plus the editor's
unsaved `.tex` as `unsaved-<tex>`) before either door applies, so recovering from a
conflict slot is recovering from any other.

The panel surface itself is `PANEL_REGISTRY` (`src/panels/panel-registry.ts`) —
15 panels, 11 hosting cards (7 single-kind, 4 polymorphic), 4 tool surfaces. A
skill targets a **sidecar**, not the Panel UI; per-kind Card detail is
[cards.md](cards.md).

## The .virgil/ plumbing folder

`.virgil/` is the agent/library sibling, **not** a Virgil sidecar store. It holds
queue / catalog / notification-inbox / library-pointer plumbing, and — the part
that matters to a skill running in the folder — **the synced helper scripts**:

```
.virgil/scripts/editor/*.py     ← apply_response.py, create_card.py, list_requests.py, …
.virgil/scripts/library/*.py    ← library pipeline helpers
.virgil/.skill-bundle-version.json
```

These land via the skill-sync engine (below). A skill calls the Python helpers
here; it does not reach into the repo's `editor/scripts/`.

**The sync is unfiltered and folder-blind:** every Virgil-managed folder gets
`.claude/commands/<silo>/` and `.virgil/scripts/<silo>/` for **all** silos —
paper folders included, and the library root included. So the presence of a
`.claude/commands/library/` directory says only that the PWA synced this folder;
it does **not** mean a library is mounted here. A skill asking "where am I?"
must ask `library_path.py --mode`, never a directory probe (task 475).

## The .claude/ folder

The Claude Code surface in the user's paper folder:

```
.claude/
├── CLAUDE.md               ← per-folder workspace guide (dispatcher)
├── commands/editor/*.md    ← the editor skills (synced)
├── commands/library/*.md   ← the library skills (synced)
└── virgil/                 ← THE OPERATIONAL MANIFEST (these docs, at runtime)
```

`.claude/virgil/` is where this manifest lives at runtime — the docs in
`docs/workspace/` ship here via the skill-bundle sync (see the last section).

## The write path

Skills **never write paper files directly.** Every Card write goes through one
contract — `apply_response.py` — which owns the atomic *card-write + status-flip +
notification + version-bump* transaction under the editing pen:

```
create-card --kind=<k>  →  create_card.py  →  apply_response.py <subcommand>
                                               ├─ acquire the editing pen (collab.json + pen-context.json, TTL ≈ +30s)
                                               ├─ atomic N-file write (card + .tex splice + .bib/settings/annotation + ai-requests + notification + version.txt) — all-or-nothing
                                               └─ release the pen (restore prior collab state; rewrite pen-context as `holder: null`, never delete — task 496)
```

Subcommand by the Task's `safetyLevel`:

| safetyLevel | subcommand | effect |
|---|---|---|
| _none_ (direct create) | `complete-task` | change lands; `result: direct-created` |
| `1` — silent | `write-silent` | lands, no surfaced card; `result: silent-applied` |
| `2` — change + comment | `write-with-comment` | lands + a sibling comment; `result: auto-applied` |
| `3` — propose | `complete-task --propose` | drafted only; `.tex` untouched; Task left awaiting review (`accepted`/`rejected`) |

Also: `complete-only` (status flip, no card — and, when the op carries paper-file
`*Edit`s, it lands those in the same atomic commit: `style-merge`'s preamble
rewrite + style-id flip, `answer-bib-review`'s `.bib` field edit / annotation,
`library-sync`'s `.bib` swap + citekey rename — none of these mutate a paper file
directly any more), `revert` (undo), and `--synthesize-task` (create the Task on the fly for
chat-initiated, Workflow-B calls). The conceptual model is
[VIRGIL.md → Cowork pattern](../architecture/VIRGIL.md#cowork-pattern); this
contract is **built and validated end-to-end through the footnote kind**, then
fanned out to the full create-able set — `note` / `todo` / `citation` / `report` /
`report-request` (and the tex-only `example`) — each a small, uniform addition on
the same contract (`editor/scripts/create_card.py`), **no contract change**.

## The preservation gate (the app's own writes)

Two writes the **user never asked for** touch the `.tex`: the load-writeback
(`readDocBundle` re-serializes the parsed model and writes it back on OPEN) and
`writeDocBundle` via `flushNow` (an anchor-UUID mint — one card gesture on a
uuid-less paragraph persists immediately, with no typing at all). A parser bug on
either destroys content with **zero user edits**, so both are gated (tasks 350-D
/ 357):

- **The measure is WORDS**, not characters — `measureContentWords`
  (`src/lib/tex-preservation.ts`), tokens `[A-Za-z0-9]+`, with Virgil's own
  markers (`%!v:`, `%!vtex:`, every `\v*` command + its argument) projected away
  on both sides. User comments are **not** projected away — since task 347 a `%`
  comment is content that round-trips.
- **Preamble and body are weighed SEPARATELY**, because the first save's
  shim-block injection is ~21 words of legitimate preamble growth that would
  otherwise mask a real body loss.
- **A shrink is a REFUSAL**, loud: nothing is written, the sidecar is untouched,
  the disk ledger is *not* stamped (a stamp would make the `DiskWatcher` report
  Virgil's own untaken write as an external change), and the first refusal takes
  an unconditional forensic snapshot into `virgil/.history/`.
- The `writeDocBundle` gate measures against the bytes the doc was **loaded**
  with (`retainLoadedCounts`) until a **real user edit** lands — defined
  positively as an *undoable* transaction (`isRealUserEdit`), since system writes
  like an anchor mint dispatch with `addToHistory: false`. After that the gate
  steps aside.
- A refusal is **a fact about the document**, not a log line: it publishes
  through `src/lib/preservation-notice.ts` into a write-protected posture plus a
  `PreservationNoticeBadge` in the status cluster.

**Stated scope** — the gate covers those two paths only. The code-pane re-parse,
the schema-mount probe, `writeTex`'s snapshot and **`apply_response.py`'s
region-replace are NOT covered.** A skill's own `.tex` splice has no such net, so
splice narrowly and never rewrite the whole file.

## What a skill may read and write

- **Read freely:** `<name>.tex`, `<name>.bib`, any `virgil/*.json`, the synced
  `.virgil/scripts/`. Reading is how a skill orients.
- **Write only through the contract:** Card sidecars, the `.tex` splice/rewrite,
  `references.bib`, `document-settings.json`, `annotations.json`, and the Task
  store all go through `apply_response.py` (the op-json `texEdit` / `bibEdit` /
  `renameCitekey` / `settingsEdit` / `annotationEdit`), never a raw write — that
  is what makes the change atomic, pen-protected, and audit-logged.
  (`renameCitekey` — chip 16 — rewrites every natbib `\cite*{}` in the `.tex` plus
  every `citations.json` card from `oldKey` → `newKey`, reusing
  `rename_citekey.py`'s rewriters; it rides the same atomic commit as a `bibEdit`
  `replace` so a library-swap of one entry is one all-or-nothing op. It cannot
  co-occur with `texEdit` — both rewrite the `.tex` from independent reads, so the
  contract refuses the combination.)
- **Never hand-edit:** `version.txt`, `notifications.json`, `collab.json`,
  `ai-requests.json` (the writeback owns these), or the invisible `.tex` markers
  ([identity.md](identity.md)). The full never-touch deny-list is
  [gardening.md](gardening.md).

## How the manifest reaches .claude/virgil/

The manifest source in `docs/workspace/` ships to each paper's `.claude/virgil/`
on the **same per-folder skill-bundle sync** that delivers the editor/library
skills and scripts — one extra bundle source, one extra route, no parallel
mechanism. Two pieces:

1. **The builder emits it.** `scripts/build-meta-bundle.mjs` — which stitches the
   three subsystem sub-bundles (`editor/build`, `library/build`, `virgil/build`)
   into the top-level meta-manifest — *also* sources the manifest itself: it copies
   `docs/workspace/*.md` into `public/skill-bundle/manifest/` and appends a
   `{ name: "manifest", version, files }` source. The manifest is Virgil-global
   (owned by no subsystem), so the meta-builder emits this one leg directly rather
   than reading a sub-builder's output. Its version is content-addressed (sha256
   over the docs) and folds into the meta-version hash.
2. **The sync engine routes it.** `library/lib/skill-sync.ts`'s `diskPathFor()`
   maps the `manifest` prefix to a single shared `.claude/virgil/<file>.md`.
   Unlike `claude-commands/` → `.claude/commands/<subsystem>/` and `scripts/` →
   `.virgil/scripts/<subsystem>/`, the manifest is **not** subsystem-scoped — there
   is one manifest per paper, not one per subsystem.

The content-addressed version stamp + refresh-toast mechanism
(`.virgil/.skill-bundle-version.json`) covers the manifest automatically: edit a
`docs/workspace/*.md`, rebuild, and the meta-version changes, so the next
doc-open re-syncs and toasts the refresh — no separate signal. (This realizes the
design intent in `EDITOR_SKILLS_BRAINSTORM.html` §2 "Where the manifest lives" and
the editor `AGENTS.md` "Future work → End-user folder sync" note.) The builder
output and the `diskPathFor` routing are unit-tested
(`library/lib/__tests__/skill-sync.test.ts`); the live browser doc-open →
`.claude/virgil/` round-trip is the one piece still to be exercised against a real
paper folder.
