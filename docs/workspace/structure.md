<!-- last-verified: 71c5f42 2026-06-03 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization, docs/architecture/VIRGIL.md#sidecar-and-panel-inventory, docs/architecture/VIRGIL.md#cowork-pattern -->
<!-- covers-code: src/lib/storage-fsa.ts, src/panels/panel-registry.ts, editor/scripts, library/lib/skill-sync.ts -->

# Structure (paper folder & write path) — operational manifest

> **When to load.** Any task that reads or writes files in a paper folder, or
> needs to know *where* a Card lives and *how* a change is committed. Per-sidecar
> JSON schemas are the forthcoming `sidecars.md`; the never-touch deny-list is the
> forthcoming `gardening.md`.

Operational cut of [VIRGIL.md → Code organization](../architecture/VIRGIL.md#code-organization),
[Sidecar and panel inventory](../architecture/VIRGIL.md#sidecar-and-panel-inventory),
and [Cowork pattern](../architecture/VIRGIL.md#cowork-pattern). The single disk
boundary is `src/lib/storage-fsa.ts` — every read/write the app does routes
through it, so the reserved names below are authoritative.

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
Two classes of file (schemas → forthcoming `sidecars.md`):

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
`virgil.json` + `editor-state.json`).

The panel surface itself is `PANEL_REGISTRY` (`src/panels/panel-registry.ts`) —
15 panels, 11 hosting cards (8 single-kind, 3 polymorphic), 4 tool surfaces. A
skill targets a **sidecar**, not the Panel UI; per-kind Card detail is the
forthcoming `cards.md`.

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

## The .claude/ folder

The Claude Code surface in the user's paper folder:

```
.claude/
├── CLAUDE.md               ← per-folder workspace guide (dispatcher)
├── commands/editor/*.md    ← the editor skills (synced)
├── commands/library/*.md   ← the library skills (synced)
└── virgil/                 ← THE OPERATIONAL MANIFEST (these docs, at runtime)
```

`.claude/virgil/` is where this manifest is *meant* to live at runtime — the docs
in `docs/workspace/` ship here. **That leg is not yet wired** (see the last
section).

## The write path

Skills **never write paper files directly.** Every Card write goes through one
contract — `apply_response.py` — which owns the atomic *card-write + status-flip +
notification + version-bump* transaction under the editing pen:

```
create-card --kind=<k>  →  create_card.py  →  apply_response.py <subcommand>
                                               ├─ acquire the editing pen (collab.json + pen-context.json, TTL ≈ +30s)
                                               ├─ atomic N-file write (card + .tex splice + ai-requests + notification + version.txt) — all-or-nothing
                                               └─ release the pen (restore prior collab state)
```

Subcommand by the Task's `safetyLevel`:

| safetyLevel | subcommand | effect |
|---|---|---|
| _none_ (direct create) | `complete-task` | change lands; `result: direct-created` |
| `1` — silent | `write-silent` | lands, no surfaced card; `result: silent-applied` |
| `2` — change + comment | `write-with-comment` | lands + a sibling comment; `result: auto-applied` |
| `3` — propose | `complete-task --propose` | drafted only; `.tex` untouched; Task left awaiting review (`accepted`/`rejected`) |

Also: `complete-only` (status flip, no card — for skills that mutate the `.tex`
directly, like `style-merge`), `revert` (undo), and `--synthesize-task` (create
the Task on the fly for chat-initiated, Workflow-B calls). The conceptual model is
[VIRGIL.md → Cowork pattern](../architecture/VIRGIL.md#cowork-pattern); this
contract is **built and validated end-to-end through the footnote kind**, then
fanned out to the full create-able set — `note` / `todo` / `citation` / `report` /
`report-request` (and the tex-only `example`) — each a small, uniform addition on
the same contract (`editor/scripts/create_card.py`), **no contract change**.

## What a skill may read and write

- **Read freely:** `<name>.tex`, `<name>.bib`, any `virgil/*.json`, the synced
  `.virgil/scripts/`. Reading is how a skill orients.
- **Write only through the contract:** Card sidecars + the `.tex` splice + the
  Task store go through `apply_response.py`, never a raw write — that is what
  makes the change atomic, pen-protected, and audit-logged.
- **Never hand-edit:** `version.txt`, `notifications.json`, `collab.json`,
  `ai-requests.json` (the writeback owns these), or the invisible `.tex` markers
  ([identity.md](identity.md)). The full never-touch deny-list is the forthcoming
  `gardening.md`.

## How the manifest reaches .claude/virgil/

**Finding (investigated, not built here):** the manifest source in
`docs/workspace/` is **not yet wired** to reach a paper's `.claude/virgil/`. Two
gaps in the existing skill-bundle pipeline:

1. **No builder emits it.** The three sub-builders
   (`editor/build/build-editor-bundle.mjs`, `library/build/build-skill-bundle.mjs`,
   `virgil/build/build-virgil-bundle.mjs`), stitched by
   `scripts/build-meta-bundle.mjs`, each source only their subsystem's
   `skills/*.md` and `scripts/*.py`. None reads `docs/workspace/`, so the manifest
   never enters `public/skill-bundle/`.
2. **The sync engine has no `.claude/virgil/` destination.**
   `library/lib/skill-sync.ts`'s `diskPathFor()` recognizes exactly two
   bundle-relative prefixes — `claude-commands/` → `.claude/commands/<subsystem>/`
   and `scripts/` → `.virgil/scripts/<subsystem>/` (plus the special
   `library/CLAUDE.md` → `.claude/CLAUDE.md`). Nothing routes to `.claude/virgil/`.

So shipping the manifest needs **new wiring** (a later chip — out of scope here):
a builder leg that copies `docs/workspace/*.md` into the bundle under a new prefix,
plus a `diskPathFor` branch mapping that prefix to `.claude/virgil/`. The
content-addressed version stamp + refresh-toast mechanism
(`.virgil/.skill-bundle-version.json`) would then cover the manifest automatically
— no change needed there. (This matches the design intent in
`EDITOR_SKILLS_BRAINSTORM.html` §2 "Where the manifest lives" and the
editor `AGENTS.md` "Future work → End-user folder sync" note, the latter now
partly done for skills+scripts.)
