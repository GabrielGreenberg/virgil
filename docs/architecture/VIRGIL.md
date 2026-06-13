<!-- last-verified: aa5e40f 2026-06-13 -->
<!-- derives-from: (root — verified against code) -->
<!-- covers-code: src/app, src/cards, src/components, src/hooks, src/lib, src/links, src/panels, src/text-objects, src/types, library, editor -->

# Virgil — Canonical Architecture

**This is the single rooted source of truth for "what Virgil is."** When anyone — a person, a future Claude session, a generated doc — needs the canonical conceptual account of Virgil, this is the answer. It exists once and only once.

> **Status: Phase 0 complete (2026-06-03).**
> This document was created frame-first. Its **confident sections** ([Document discipline](#document-discipline), [Ontology](#ontology), [Cowork pattern](#cowork-pattern), [Code organization](#code-organization)) are written from the frozen v1 design (`EDITOR_SKILLS_V1.html`, `EDITOR_SKILLS_BRAINSTORM.html`) and the verified agent docs. Its six **current-state sections** are now **all filled** from the Phase 0 code-archaeology pass: the **stable** three — [UUID marker emission](#uuid-marker-emission), [LaTeX round-trip vocabulary](#latex-round-trip-vocabulary), [Reserved-name inventory](#reserved-name-inventory); and the **card-layer** three — [Card-kind taxonomy](#card-kind-taxonomy), [Public-type registry](#public-type-registry), [Sidecar and panel inventory](#sidecar-and-panel-inventory) — extracted after the card-system refactor (Quotations → Reports) settled. Each forward-points to the **operational manifest** ([docs/workspace/](../workspace/INDEX.md)), which now holds the field-level detail (the two Phase 0 seed reports that first carried it have been retired into git history). **No `<!-- STUB: pending Phase 0 -->` section markers remain.**
>
> **How to read this doc:** start with [Document discipline](#document-discipline) — it explains the headers at the top of this file, the (now-retired) `<!-- STUB -->` convention, and how this doc relates to `docs/agents/*`, the operational manifest, and the skill set. Then read the section you came for.

---

## Document discipline

This section is meta: it is about *this document and its dependents*, not about Virgil's features. It is the specification of Virgil's rot-prevention discipline. Everything else in this file is governed by the rules stated here, and this file demonstrates them on itself (read its header block above).

### The problem this solves

"What Virgil is" is described in many places — the code, the type definitions, the design docs, the README, the agent docs, and (soon) an operational manifest, a UX library, and the skill prompts. Left alone, these **drift independently** and the system turns to mush: the README says one thing, the manifest another, the code a third, and no one knows which is authoritative.

The fix is to stop treating them as a flat pile and make them a **rooted dependency graph** with exactly one source of truth at the root (this document), so every other description has a known upstream it derives from, and a single mechanism can walk the graph and keep it honest.

### The three-layer model

```
Layer 1 — OPERATIONAL TRUTH (the code)
   src/lib/types.ts, the registries, hooks, TipTap extensions, the LaTeX
   parser/serializer, editor/scripts/. What the code does is what Virgil does.
      ↑ verified against (the code→doc edge: `last-verified`)
Layer 2 — CANONICAL ARCHITECTURE (this document)
   docs/architecture/VIRGIL.md — hand-crafted, conceptual, maintained against
   the code in perpetuity. THE answer to "what is Virgil." Exists once.
      ↑ derives from (the doc→doc edge: `derives-from`)
Layer 3 — DERIVATIVE DOCS (each has a clear upstream)
   docs/agents/*.md + AGENTS.md   (how to work on the codebase)
   docs/workspace/ → .claude/virgil/      (operational manifest — ships at runtime)
   docs/ux/        → .claude/virgil-ux/    (UX library — future)
   editor/skills/* → .claude/commands/editor/  (skill prompts — future)
   README.md
```

- **Layer 1 (code)** is the existing ground truth for behavior.
- **Layer 2 (this doc)** is the new piece: the canonical conceptual description. It is verified *against* Layer 1, but it is not generated from it — a human (or Claude) writes it, because the conceptual account is not mechanically derivable from the code.
- **Layer 3 (derivatives)** is everything else. Each derivative names its upstream so it can be regenerated or re-checked when the upstream moves. The `docs/agents/*` docs are derivatives with a **different audience**: this doc says *what Virgil is* (conceptual truth); the agent docs say *how to work on the codebase* (paths, line numbers, how-tos). They coexist; the agent docs point their `derives-from` at this doc.

### The header convention — the two axes of the graph

Every Layer-2 and Layer-3 doc carries a small header block of HTML comments at the very top of the file (before the first heading). Three fields, each on its own line, each independently greppable:

```markdown
<!-- last-verified: <short-sha> <YYYY-MM-DD> -->
<!-- derives-from: <repo-root-relative-path>#<anchor>[, <path>#<anchor>...] -->
<!-- covers-code: <repo-root-relative-path>[, <path>...] -->
```

The three fields are the edges of the dependency graph, plus the freshness stamp:

| Field | Edge | Meaning |
|---|---|---|
| `last-verified` | **code → doc** (vertical freshness) | The sha + date this doc's content was last checked against the code. Already the existing convention on `docs/agents/*`; unchanged. |
| `derives-from` | **doc → doc** (horizontal derivation) | The upstream doc(s) this one specializes. Turns the flat pile into a rooted DAG. The root (this file) derives from code, not a doc, written as `(root — verified against code)`. |
| `covers-code` | **doc → code** (scope of record) | The code paths this doc is doc-of-record for. Repo-root-relative so tooling resolves them without guessing. |

**Why `covers-code` is the deep unification.** Today, `/cleanup-virgil` step 2 hardcodes each doc's code-path list *in its own prose* — and that prose rots like any other duplicated knowledge. Moving the path list into a `covers-code` header makes each doc **self-describing**: `/cleanup-virgil` and the coherence script both read it mechanically, and there is one place to update when a doc's scope changes. The skill stops hand-maintaining a list; the docs carry their own scope.

**Multi-topic docs (this one) also carry per-section `covers-code`.** Because this spine is multi-topic, each `##` section carries its own `<!-- covers-code: ... -->` comment directly under the heading. The **doc-level** `covers-code` at the top of the file is the **union** of the per-section ones — coarse, for the release-time ratchet; the per-section ones are precise, for Phase 0 targeting and any future extraction of a section into its own sub-doc. Single-topic Layer-3 docs need only the doc-level header.

### The rooted DAG

```
                         Layer 1: the code (src/, library/, editor/)
                                        ▲
                                        │ last-verified (freshness)
                         ┌──────────────┴───────────────┐
                         │  docs/architecture/VIRGIL.md  │   ← THE ROOT
                         └──────────────┬───────────────┘
            derives-from ───────────────┼───────────────────────────┐
            ▼                ▼           ▼            ▼               ▼
      AGENTS.md +      docs/workspace/  docs/ux/   editor/skills/*  README.md
      docs/agents/*    (manifest)       (UX lib)   (skill prompts)
      (how-to-work)    [shipped]        [future]   [future]
```

Once it is a rooted DAG, the maintenance mechanisms compose without redundancy:

- **`/cleanup-virgil` walks it top-down** — the deterministic code→docs synchronizer. At each release it reviews the root first (diffing its `covers-code` paths against `last-verified`), then the derivatives, consulting each one's `derives-from` upstream. See `~/.claude/commands/cleanup-virgil.md` step 2.
- **The coherence script validates its edges** — a CI guard that checks every `derives-from`/`covers-code` path+anchor resolves, that the type surface is accounted for, and that named concepts exist in the code. See [check-coherence.SKETCH.md](check-coherence.SKETCH.md).
- **A future "dream phase" consumes its leaves** — the skill-improvement loop reads the updated manifest/UX docs and ripples changes into skill prompts (the `docs → skills` edge, out of scope here; see `EDITOR_SKILLS_V1.html` §14 and the brainstorm §19 "dream-phase ripple").

Each mechanism owns one edge type. None duplicates another. That is the point of rooting the graph.

### Stubs and the bootstrap state

This document was deliberately **bootstrapped before** the Phase 0 code-archaeology pass, rather than gated on it. The rationale (locked in planning):

- The conceptual content — ontology, cowork pattern — is **design-frozen** and known now; it does not need archaeology.
- The exhaustive current-state content (every card kind's fields, every sidecar's schema, every reserved name) **does** need archaeology, and writing it from memory would produce confident-wrong content. The brainstorm's own risk callout (§19) says it plainly: *"Don't ship a manifest with confident wrong content; it's better to have a stub."*
- So those sections exist **as headed stubs with their `covers-code` pointers in place**. This gives Phase 0 a structured target: it knows exactly which sections to fill and which code each describes, which de-risks the archaeology itself.

A stub section carries, directly under its heading:

```markdown
<!-- covers-code: <the paths Phase 0 should extract from> -->
<!-- STUB: pending Phase 0 -->
```

**`last-verified` does not certify stub sections.** The doc-level `last-verified` stamp certifies that the *confident* sections were checked against the code as of that sha. A section bearing `<!-- STUB: pending Phase 0 -->` is explicitly outside that claim until the stub is filled and the marker removed.

### Conceptual doc vs. operational manifest — the scope boundary

This document holds the **conceptual** account: *what* card kinds exist and how they relate; *what* the type surface is, in the large. It deliberately does **not** hold exhaustive per-field schemas. Those belong to the **operational manifest** (`docs/workspace/` → `.claude/virgil/`), which is partly machine-generated from `src/lib/types.ts`.

Rule of thumb: if a section would reproduce a JSON schema field-by-field, it instead states the concept, forward-points to the manifest, and (pre-Phase-0) carries the stub marker. This keeps the spine readable and keeps the single source of exhaustive schema truth in one place (the types + the generated manifest), not duplicated here.

---

## Ontology
<!-- covers-code: src/text-objects/text-object-registry.ts, src/lib/tiptap/atom-registry.ts, src/panels/_shared/types.ts, src/links/link-registry.ts, src/lib/tiptap, src/lib/latex-serializer.ts -->

*Conceptual; frozen in `EDITOR_SKILLS_V1.html` §2 and the brainstorm §20 decisions log. The exhaustive per-marker current-state lives in [UUID marker emission](#uuid-marker-emission) below; the per-kind card taxonomy remains stubbed pending the card refactor.*

Virgil's world is **the Document** and five primitives within it.

### The Document

The container and the scope. It is composed entirely of TextObjects. Cards, Atoms, and the other primitives exist *within* the Document but are not the Document. The Document is the world.

### The five primitives

| Primitive | What it is | Mobility |
|---|---|---|
| **TextObjects** | The structural atoms of text — paragraphs, headings, lists, list items, example items, atom blocks, and selection-backed linked ranges. Each is discrete and addressable. The single canonical abstraction for every graspable text unit; see [Code organization](#code-organization) and `TEXT_OBJECT_REGISTRY`. | Move, pop, drop freely. |
| **Atoms** | Inline elements *within* TextObjects, finer-grained than a TextObject but not themselves TextObjects — in-text citations (`\cite{}`), footnote markers (`\footnote{}`), refs (`\ref{}`), inline math (`$…$`). Often bidirectionally linked to a Card. | Text-bound: move with the surrounding characters; do not pop into Panels independently. **Realized** as the direct in-text *Atom grab* — drag the atom to a new inline cursor (`ATOM_REGISTRY` + `InlineAtomGrab`; see `docs/agents/architecture.md` → text-move gestures). |
| **Cards** | Almost everything else: notes, highlights, todos, footnotes, citations, reports, bibliography entries, comments, suggestions, examples, **Tasks**. Not a sub-type of TextObject — a parallel structure that connects to text via anchors and/or Atom links. | Move, pop, drop freely. |
| **Omni-View gutters** | The in-context rendering of Cards alongside the text they anchor to. The primary surface for seeing Cards in place. | — |
| **Panels** | Sidebar collections that list Cards of a given kind (Notes, Footnotes, Bibliography, the Inbox for Tasks). The secondary surface — browse, filter, bulk ops. | — |

**Uniform affordance:** all TextObjects and Cards can be moved, popped out as floating windows, and dropped back freely; Atoms have only text-bound mobility.

### Linkage: how Cards connect to text

Two distinct flavors — both are *properties of the Card*, not separate primitives:

- **Anchor** — a Card's one-way positional pointer to a TextObject. Coarse (paragraph-level). The Card knows its anchor; the TextObject does not directly know what is anchored to it. Notes and todos typically have only an anchor.
- **Atom link** — a Card's *bidirectional* relationship with an inline Atom. Both ends know about each other. Fine-grained. A footnote Card atom-links to its `\footnote{}` marker; a citation/bib Card atom-links to every `\cite{}` instance.

A Card may have only an anchor (a note), only Atom links (a bibliography Card with many `\cite{}` links and no paragraph of its own), or both (a footnote Card, anchored to a paragraph *and* atom-linked to a `\footnote{}` marker within it).

### UUIDs — the identity layer

Every TextObject, Atom, and Card carries a UUID for stable reference across edits, linkage resolution, and the move/pop/drop affordance. The user never sees them. The flavors (exhaustive emission points are enumerated in [UUID marker emission](#uuid-marker-emission)):

- `%!v:` at a block's line-end in the `.tex` → a **TextObject UUID** (paragraph, heading, list, list item, blockquote, code/atom block).
- `\vcid{}` → a **citation Atom UUID**; `\vfid{}` → a **footnote Atom UUID**.
- `\vexid{}` → an **example-block UUID**; `\vxid{}` → an **example-item UUID**.
- `\vlid{}…\vlidend{}` → a **linkedRange**'s paired boundary markers — its identity is the `linkedAnchor` mark's `anchorId`, also persisted to the `.tex` since Phase E.
- Cards carry their UUIDs in their sidecar JSON (`"id": "…"`).

### Tasks as a Card kind

A Task is a Card with lifecycle states the other kinds don't share (see [Cowork pattern](#cowork-pattern)). The Inbox is the Panel that surfaces Tasks; `ai-requests.json` is their sidecar. A Task may have an anchor, Atom links, both, or neither (a "review the whole doc" Task has no anchor).

---

## Cowork pattern
<!-- covers-code: src/lib/ai-request-bridge.ts, src/hooks/useDocNotificationStream.ts, src/hooks/useCollab.ts, src/lib/collab.ts, editor/scripts/apply_response.py, editor/scripts/_common.py, editor/scripts/create_card.py, editor/scripts/list_requests.py, editor/skills -->

*Conceptual; frozen in `EDITOR_SKILLS_V1.html` §5–9 and §12. Virgil calls no model itself — an external agent (Claude) reads the same `.tex`/`.bib` and writes JSON sidecars; the app polls and surfaces them. The skill set is currently the `editor/` bundle. The v1 redesign (mechanical primitives + chat-composed generative work) is specced in `EDITOR_SKILLS_V1.html`; its **mechanical substrate** — the `apply_response.py` contract (atomic multi-file writes, the pen, the named subcommands, the two-field status, per-Task safety levels) — is now **built and validated end-to-end through the footnote kind** (the per-subsection notes below mark what shipped vs what's still pending). Breadth across the remaining kinds, and the UI affordances, are in progress.*

### The two workflows

- **Workflow A — UI-initiated (note-card-based).** The user creates a note (paragraph-anchored, or selection/text-span-anchored) and AI-flags it. The card-flag bridge (`bridgeCardAiRequestFlag`, [src/lib/ai-request-bridge.ts](../../src/lib/ai-request-bridge.ts)) converts the flag into a Task in `ai-requests.json`. The agent drains via `/editor/review`. The note *is* the input — there is no separate "Virgil form." The same bridge also covers todos / cutter-comments / revision-comments (a different semantic class — *respond to this card* — same data path).
- **Workflow B — Claude chat.** The user addresses Virgil conversationally. Virgil resolves any ambiguity by **asking, never guessing** (anchor resolution puts the burden on whoever has the most context; chat-Claude must get disambiguating context from the user), then acts.

### Tasks vs Skills

A **Task** is the user-facing unit of work; a **Skill** is an internal unit. One Task may invoke many Skills; the user sees one Task in the Inbox, one outcome. Reporting is **per-Task** (a user-facing summary on the Task card, an inbox status flip, a chat reply, and a dev-dream memo), not per-Skill (Skills emit terse dev one-liners on stdout, never user-visible).

### Status and result vocabulary

Two fields, separating "where" from "how it ended":

- `status` (lifecycle): `pending` · `in-progress` · `complete` · `failed`.
- `result` (outcome; set only on a terminal status): `accepted` · `rejected` · `auto-applied` · `silent-applied` · `direct-created` · `refused` · `impossible` · `errored`.

The Inbox filters on `status` ("open vs done") and groups by `result` ("show me every silent change today"). *Shipped (apply_response v1 chip): `AiRequest` now carries this two-field `status` + `result` ([src/lib/types.ts](../../src/lib/types.ts)), and `apply_response.py` sets them. Legacy `draft` / `submitted` values still parse and read as open (≈ `pending`), so existing sidecars keep working. Still pending: an Inbox UI that surfaces `result` outcomes.*

### Safety levels (per-Task)

Every Task carries a safety level describing how aggressively the user wants the work landed. Policy lives on the Task, not the skill:

| Level | Behavior | `apply_response.py` subcommand |
|---|---|---|
| **1 — silent** | Change applied directly; no surfaced card. (`result: silent-applied`) | `write-silent` |
| **2 — change + comment** | Change applied; sibling comment explains it. (`result: auto-applied`) | `write-with-comment` |
| **3 — propose** | Drafted as a suggestion; doc unchanged until the user accepts. (`result: accepted \| rejected`) | `complete-task` |

Workflow A: the user picks the level on the AI-flagged note. Workflow B: Claude asks (no implicit default — except that a direct-create kind like `footnote` lands without a level when the user simply asks for it). **The catastrophic-operation exception:** preamble rewrites (`style-merge`) and document-wide citekey renames (`sync-bib-to-library`) always surface a one-time confirmation regardless of the requested level. *Shipped (apply_response v1 chip): `AiRequest.safetyLevel` exists, `apply_response.py` has the `write-silent` / `write-with-comment` / `complete-task` subcommands, and `create_card.py` dispatches by level. Still pending: the Workflow-A UI for picking a level on a note, and the catastrophic-op confirmation (footnotes aren't catastrophic, so it's designed-not-enforced here).*

### The editing lock (the pen)

When the agent is about to write files, it briefly takes the editing pen so the user can't be typing simultaneously and lose work. Fully scripted inside `apply_response.py` (no LLM, zero token cost): acquire = write `.virgil/pen-context.json` (`holder`, `acquired_at`, `expires_at` ≈ +30s, prior collab state) and enable collab if it was off; do the atomic write; release = restore prior collab state and delete the pen file. The TTL gives crash recovery without a heartbeat. Doc-level granularity; lock window is the sub-second commit phase only, not the thinking phase. State + constants in [src/lib/collab.ts](../../src/lib/collab.ts); UI via `useCollab`. *Shipped (apply_response v1 chip): `apply_response.py` now takes the pen — it writes `.virgil/pen-context.json` (TTL ≈ +30s) and flips `collab.json`'s `pen` to Claude-held + enables collab, restoring both on release (even when the wrapped write fails) — in the exact `CollabSidecar`/`CollabPenState` shape `useCollab`/`collab.ts` read. It only touches `collab.json` if the paper already has one, so a non-collab paper gets no fabricated file. Still pending: a live browser locked-UI E2E (the JSON shape is verified; the rendered "Virgil is editing" state is a follow-up needing the preview harness).*

### `apply_response.py` — the single sanctioned writeback

Skills never write files directly. They call `apply_response.py`, which owns the atomic *card-write + status-flip + notification + version-bump + pen-acquire/release* transaction. Subcommands: `complete-task` (Level 3 + direct-creates), `write-with-comment` (Level 2), `write-silent` (Level 1), `complete-only` (status flip, no card), `revert` (undo). The `--synthesize-task` flag creates the Task on the fly for chat-initiated (Workflow B) calls. Every subcommand shares one "write these N files atomically, roll back on failure" primitive wrapped by the pen dance: all the files land or none do. *Shipped (apply_response v1 chip): the named subcommands, the composable `--synthesize-task` flag, and the atomic N-file write-with-rollback (`_common.atomic_write`, generalized from `rename_citekey.py`'s `os.replace` writer) wrapped by the pen are built and validated end-to-end through the footnote kind. The legacy default-apply op / `--revert` / `--complete-only` are preserved so un-migrated skills keep working. The create-card fan-out then wired the full create-able `CardKind` set on this same contract (no contract change) — `footnote`/`citation` (atom-bearing, `\vfid`/`\vcid`), `note`/`todo`/`report`/`report-request` (sidecar-only, anchored), and the tex-only `example` (`\vexid`); see [docs/workspace/cards.md](../workspace/cards.md) for the createable-kind taxonomy and `editor/scripts/create_card.py` for the per-kind dispatch.*

### The loop, end to end

The agent writes `<sidecar>.json` (the new/changed card) + `ai-requests.json` (Task created or status flipped) atomically; [src/hooks/useDocNotificationStream.ts](../../src/hooks/useDocNotificationStream.ts) polls `virgil/notifications.json` and toasts the completion. The inbox doubles as the audit log — every change registers a completed entry, so there is one place to see what landed.

---

## Code organization
<!-- covers-code: src/app, src/cards, src/components, src/hooks, src/lib, src/links, src/panels, src/text-objects, src/types, library, editor -->

*An orienting map. The authoritative how-to-work-on-it detail lives in the `docs/agents/*` derivatives — this section is the conceptual index those docs specialize. Verified against `docs/agents/overview.md` + `architecture.md` (both `last-verified: aa5e40f`).*

### `src/` top-level map

- `src/app/` — Next.js 16 App Router root (static export): `globals.css`, manifest, layout, dev-only API routes. Almost pure scaffolding; real work is elsewhere.
- `src/cards/` — the card spine: `CARD_REGISTRY` (`card-registry.tsx`), the `CardKind`/`CardMeta` types (`types.ts`), the registry-derived predicates (`predicates.ts`), and `floats/` (the per-kind `toFloatable` builders). The card-system refactor's SSOT, mirroring `src/text-objects/`; absorbed the former `src/lib/cards/`.
- `src/components/` — React components. The canonical editor surface is `EditorPane.tsx` (used by both the main app and the Library Reader); `EditorLayout.tsx` is the shell wrapper (tabs, view-prefs, dialogs, the Virgil bar, the PDF/Code branches); `Editor.tsx` is the TipTap wrapper; `panel-primitives.tsx` holds `CARD_THEMES`; `MenuBar.tsx` is the docked menu pod.
- `src/floats/` — the `Floatable` contract (the float-subsystem presence that `CardMeta.toFloatable` returns).
- `src/hooks/` — ~50 state hooks (`useDocument`, `useCitations`, `useFootnotes`, `useViewPrefs`, `useCollab`, `usePoppedCards`, …).
- `src/lib/` — core logic: LaTeX parse/serialize, TipTap extensions, storage, types.
- `src/links/` — the unified link architecture (registry, resolvers, three-surface highlight reconcilers).
- `src/panels/` — one folder per panel + `_shared/` + `panel-registry.ts`.
- `src/text-objects/` — the TextObject abstraction: registry, grab handle, float bodies, drop adapters.
- `src/types/` — shared type definitions.

**Sibling subsystems at the repo root:** `library/` (the Library tab — its own components/hooks/lib/parser/store + Python skills; mounts the canonical `<EditorPane>`; reached via the `@library/*` alias) and `editor/` (the editor-side skill bundle — `/editor/review` umbrella + per-kind subskills + Python helpers under `editor/scripts/`; bridged into the app via [src/lib/ai-request-bridge.ts](../../src/lib/ai-request-bridge.ts)).

### The single sources of truth (registries)

Before adding a new panel, link kind, theme, or text-object kind, **extend the registry** — never create a parallel table.

| Concern | SSOT |
|---|---|
| Panel taxonomy | `PANEL_REGISTRY` in [src/panels/panel-registry.ts](../../src/panels/panel-registry.ts); `PanelKind` union in [src/panels/_shared/types.ts](../../src/panels/_shared/types.ts) |
| Card taxonomy | `CARD_REGISTRY` in [src/cards/card-registry.tsx](../../src/cards/card-registry.tsx); `CardKind` / `CardMeta` in [src/cards/types.ts](../../src/cards/types.ts) (`src/panels/_shared/types.ts` re-exports `CardKind`). The satellite tables (`CARD_KEY_PREFIXES`, labels, panel membership, `StackCardKind`) are registry-derived — never hand-kept. |
| Link kinds | `LINK_REGISTRY` in [src/links/link-registry.ts](../../src/links/link-registry.ts) |
| TextObject kinds | `TEXT_OBJECT_REGISTRY` in [src/text-objects/text-object-registry.ts](../../src/text-objects/text-object-registry.ts) |
| Card themes | `CARD_THEMES` in [src/components/panel-primitives.tsx](../../src/components/panel-primitives.tsx) |
| Type definitions | [src/lib/types.ts](../../src/lib/types.ts) |
| Design tokens | [src/app/globals.css](../../src/app/globals.css) + [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) |

### Persistence

- **Disk (File System Access API):** the single boundary is [src/lib/storage-fsa.ts](../../src/lib/storage-fsa.ts) — every read/write routes through it. On disk per paper: `<name>.tex` (source of truth), optional `<name>.bib`, and the `virgil/` sidecar folder.
- **IndexedDB:** preferences, tab state, folder handles, doc index — never paper content.

### LaTeX round-trip

Virgil does not compile LaTeX. It parses `.tex` into the editor model ([src/lib/latex-parser.ts](../../src/lib/latex-parser.ts)) and serializes back ([src/lib/latex-serializer.ts](../../src/lib/latex-serializer.ts)) while preserving the raw source. The accepted command vocabulary and the UUID-marker emission points are enumerated in [LaTeX round-trip vocabulary](#latex-round-trip-vocabulary) and [UUID marker emission](#uuid-marker-emission) below (and the manifest docs they forward-point to).

### The keystroke-sanctity invariant

A load-bearing performance contract (stated in `AGENTS.md`): **no plugin, hook, or effect may do work proportional to document size on each keystroke.** Structural work is event-driven from the per-transaction diff published by `DocStructureObserver` ([src/lib/tiptap/doc-structure/](../../src/lib/tiptap/doc-structure/)), consumed via the `DocStructureBus`. Card-source memos gate on the per-category counters from `useStructuralRevisions`, never on a raw `editor.on('update')` counter.

---

## Card-kind taxonomy
<!-- covers-code: src/cards/types.ts, src/cards/card-registry.tsx, src/cards/predicates.ts, src/panels/_shared/types.ts, src/panels/panel-registry.ts, src/components/panel-primitives.tsx, src/lib/types.ts -->

Cards are the primitive that covers almost everything that isn't text (see [Ontology](#ontology)). The canonical card vocabulary is the **`CardKind` union**, whose home moved to [src/cards/types.ts](../../src/cards/types.ts) beside `CARD_REGISTRY` ([src/panels/_shared/types.ts](../../src/panels/_shared/types.ts) re-exports it for ripple-minimization, mirroring `TextObjectKind` living beside `TEXT_OBJECT_REGISTRY`) — **16 symmetric kinds** as shipped:

`note` · `highlight` · `footnote` · `citation` · `example` · `todo` · `archive` · `report` · `report-request` · `revision-comment` · `revision-suggestion` · `cutter-comment` · `cutter-suggestion` · `bib` · `ai` · `error`.

`CardKind` is the **theming / keying / labeling** vocabulary, now rooted in a single SSOT: `CARD_REGISTRY` ([src/cards/card-registry.tsx](../../src/cards/card-registry.tsx)), a `Record<CardKind, CardMeta>` mirroring `TEXT_OBJECT_REGISTRY`. One `CardMeta` entry per kind carries `panel` / `keyPrefix` / `label` / `titleLabel` / `themeKey` / `anchored` / `markerType` / `lifecycle` / `stackable` / `toFloatable`. The formerly-parallel tables are now **registry-derived**, not separate SSOTs: `CARD_KEY_PREFIXES`, `CARD_TYPE_LABELS`, `CARD_TITLE_LABELS` are `Object.fromEntries` over `CARD_REGISTRY` ([src/panels/panel-registry.ts](../../src/panels/panel-registry.ts)); panel membership derives via `getPanelByCardKind` / `panelForCardKind` ([src/cards/predicates.ts](../../src/cards/predicates.ts)) from `CardMeta.panel` (the hand-kept polymorphic-panel map is **retired**); the `StackCardKind` union and `ANCHORED_CARD_KINDS` are likewise derived (`stackableCardKinds()` / `isAnchoredCardKind`). `CARD_THEMES` ([src/components/panel-primitives.tsx](../../src/components/panel-primitives.tsx)) remains the accent table, keyed by `CardMeta.themeKey`. Before adding a kind, add one `CARD_REGISTRY` entry — never a parallel table (see [Code organization → registries](#the-single-sources-of-truth-registries)).

How the kinds group:

- **Single-card panels** are registered with one card kind: Footnotes (`footnote`), Citations (`citation`), Bibliography (`bib`), Examples (`example`), Todo (`todo`), Archive (`archive`), Errors (`error`), Revisions (`revision-comment`). (Revisions additionally hosts `revision-suggestion`, which declares the same `revisions` panel via its `CardMeta.panel`.)
- **Polymorphic panels** host two kinds each (registered `card: null`; membership derived from each kind's `CardMeta.panel` via `cardKindsForPanel`): **Notes** (`note` + `highlight`), **Cutter** (`cutter-comment` + `cutter-suggestion`), **Reports** (`report` + `report-request`). The Reports panel is the newest — it replaced the Quotations panel in the card-system refactor (`quotation` removed; `report` / `report-request` added).
- **Homeless kind:** only `ai` (the **Task** — cross-cutting across every panel's inbox, surfaced by the Inbox) declares `panel: null`. Bare `suggestion` is **no longer a spine kind** — it survives only as the on-disk `RevisionCard`/`CutterCard.kind` data discriminator (see the nuance below).

How they relate to the [Ontology](#ontology) primitives: every Card connects to text by an **anchor** (paragraph-level, Mode A; or a text-range `linkedRange`, Mode B) and/or an **Atom link** (`footnote`→`\footnote{}`, `citation`/`bib`→`\cite{}`). A `footnote`/`citation` is Atom-linked; a `note`/`revision-comment`/`report` is anchored; `example` *is* a TextObject (its card is a sidecar shadow of an `exampleBlock`); `ai` (a Task) may have anchor, Atom links, both, or neither. Two kinds carry a real lifecycle — `ai` (the `status`/`result`/`safetyLevel` machine, see [Cowork pattern](#cowork-pattern)) and the suggestion kinds (`status` + `author`; Accept enqueues an out-of-band edit).

**One nuance worth stating at this altitude:** the spine `CardKind` is *not* the same as the `kind` discriminator stored on disk. The persisted `kind` uses a coarser set (`note`/`highlight`, `comment`/`suggestion`, `report`/`report-request`); the data layer was left **untouched** by the registry refactor (`RevisionCard`/`CutterCard.kind`, `revisions.json`/`cutter.json`, and the Python skill layer still say `comment`/`suggestion`). The spine's synthetic kinds (`revision-comment`/`cutter-comment`/`revision-suggestion`/`cutter-suggestion`) are bridged from the on-disk discriminator at the render/key/theme layer (`resolveCardKind`).

The exhaustive per-kind account — every kind's panel, sidecar + list-key, persisted discriminator, anchor/Atom-link relationship, lifecycle, and theme, plus the full Reports-panel and polymorphic-panel detail — is in the manifest's **[cards.md](../workspace/cards.md)** (the registry-shadow rot-vector lives in [gardening.md → the Python shadow-rot discipline](../workspace/gardening.md#the-python-shadow-rot-discipline)).

---

## Public-type registry
<!-- covers-code: src/lib/types.ts, src/panels/_shared/types.ts, src/links/_shared/types.ts -->

[src/lib/types.ts](../../src/lib/types.ts) is the type SSOT for the card / sidecar surface — **56** exported interfaces and type aliases as shipped. They fall into a few families: the **card interfaces** (`UserNote`, `HighlightCard`, `FootnoteRef`, `CitationRef`, `RevisionCard`, `ReportItem`, `CutterCard`, `ArchivedSnippet`, `TodoItem`, `ExampleRef`, …) and a `…State` wrapper per sidecar; the **Task surface** (`AiRequest`, `AiRequestKind`, `AiRequestStatus`, `AiRequestResult`, `AiRequestLink`, `AiRequestPayload`); the **notification** types (`DocNotification…`); the **bibliography** support types (`BibEntry`, `BibReviewRequest`, `BibSettings`, `AnnotationsState`); and a residue of **legacy** types from the pre-card review pipeline (`Suggestion`, `SessionState`, `ReviewRequest`, `ClaudeSuggestion`), four of which have no live consumer. (`UserComment` and `CommentsState` were removed in A1 gardening — `comments.json` was never wired into any panel.)

This is the target state for **coherence check (2)** ([check-coherence.SKETCH.md](check-coherence.SKETCH.md#check-2--type-accounting)): every exported type in `types.ts` must be accounted for — mapped to its concept and a doc-of-record — or explicitly delegated to a named manifest doc. With this section filled, that check graduates from warn-only to per-type error.

The full enumeration (all 58 exported types, with the dead types flagged) and the exhaustive field-level schemas are in the manifest's **[sidecars.md](../workspace/sidecars.md)** — its [Coverage index](../workspace/sidecars.md#coverage) names every type, grouped by family.

---

## Sidecar and panel inventory
<!-- covers-code: src/lib/storage-fsa.ts, src/lib/types.ts, src/panels/panel-registry.ts, src/panels -->

Two related inventories.

**Sidecars.** Every paper carries a `virgil/` folder (the single disk boundary is [src/lib/storage-fsa.ts](../../src/lib/storage-fsa.ts), `VIRGIL_SUBDIR`). It holds a handful of **infrastructure** sidecars shared across the app — `virgil.json` (paragraph titles + fingerprints), `editor-state.json`, `ai-requests.json` (the Task store), `notifications.json`, `collab.json`, `document-settings.json`, `version.txt` — and one **card sidecar per card-bearing panel** (`notes.json`, `todos.json`, `footnotes.json`, `citations.json`, `cutter.json`, `revisions.json`, `reports.json`, `examples.json`, `archive.json`, plus the bibliography support files `bib-settings.json` / `bib-review-requests.json` / `annotations.json`). A few legacy sidecars (`suggestions.json`, `comments.json`) survive from the pre-card era. Errors are *not* persisted — they re-derive from the live LaTeX lint. (The Reports refactor renamed `quotations.json` → `reports.json`.)

**Panels.** `PANEL_REGISTRY` ([src/panels/panel-registry.ts](../../src/panels/panel-registry.ts)) is the SSOT for the panel surface — **15** `PanelKind`s. Eleven host cards (eight registered with a single card kind, three polymorphic — see [Card-kind taxonomy](#card-kind-taxonomy)); the remaining four are tool surfaces (`outline`, `search`, `wordcount`, `omni`). Each registry entry declares the panel's label, folder, hosted card link, OmniView eligibility/side, and default strip side.

The exhaustive inventory — every sidecar with its purpose, list-key, and consuming hook (infrastructure / card / legacy / excluded non-sidecars); and every Panel with its hosted kinds — is in the manifest's **[sidecars.md](../workspace/sidecars.md)** (sidecar schemas) and **[structure.md](../workspace/structure.md)** (the paper-folder layout + panel surface). The per-card **user-actions** (keyboard, toolbar, drag/drop, context menus) remain deferred to the manifest's `actions.md` (forthcoming).

---

## UUID marker emission
<!-- covers-code: src/lib/tiptap, src/lib/latex-serializer.ts, src/lib/latex-parser.ts, src/text-objects/text-object-registry.ts -->

Virgil keeps a stable identity for every block and inline entity across `.tex` parse cycles by writing **invisible id markers** into the source. There are two id namespaces (minted in [src/lib/uuid.ts](../../src/lib/uuid.ts)): **short ids** — 4-char hex — for anything that appears in the `.tex`, and full **v4 entity ids** for sidecar-only data that never does. Every marker below is **Virgil-auto-managed** (generated by `assignUuids` and the serializer, stripped from the rendered display) — the user authors only the underlying content command (`\footnote{}`, `\citep{}`, `\section{}`, `\ex…\xe`) and never types or sees a marker.

The marker family:

- **`%!v:<hex>`** — a **TextObject** (block) id, a trailing line-end *comment* on every uuid-bearing block (paragraph, heading, list, list item, blockquote, code/atom block). `%!v:blank` marks an empty unidentified paragraph.
- **`\vfid{}`** / **`\vcid{}`** — a **footnote** / **citation** Atom id, emitted just before the `\footnote{}`/`\thanks{}` or cite command.
- **`\vexid{}`** / **`\vxid{}`** — an **example-block** / **example-item** id, emitted before `\ex`/`\pex` and `\a`.
- **`\vlid{}…\vlidend{}`** — paired boundary markers around a **linkedRange** (a `linkedAnchor` mark's span). The identity is the mark's `anchorId`; since Phase E the span is also persisted to the `.tex` via these markers (reassembled on parse by `applyLinkedAnchorBoundaries`).
- **`%!vtex:begin <id>` / `%!vtex:end <id>`** — sentinels bracketing a **texBlock**'s raw-LaTeX passthrough.

The conceptual single source for *which TextObject kind carries which marker* is the `sourceMarker` field on `TEXT_OBJECT_REGISTRY` ([src/text-objects/text-object-registry.ts](../../src/text-objects/text-object-registry.ts)); the `%!v:` regexes live in [src/lib/uuid.ts](../../src/lib/uuid.ts); id assignment + dedup (`assignUuids`) and macro injection (`ensureVirgilCommands`) both live in [src/lib/latex-serializer.ts](../../src/lib/latex-serializer.ts) — the six `\v*` macros get `\providecommand` no-ops injected so the `.tex` compiles outside Virgil.

The exhaustive per-marker emit/parse points and the auto-vs-authored table are in the manifest's **[identity.md](../workspace/identity.md)**.

---

## LaTeX round-trip vocabulary
<!-- covers-code: src/lib/latex-parser.ts, src/lib/latex-serializer.ts, src/lib/tiptap -->

Virgil does not compile LaTeX. `parseLatex()` ([src/lib/latex-parser.ts](../../src/lib/latex-parser.ts)) reads `.tex` → editor model; `serializeToLatex()` ([src/lib/latex-serializer.ts](../../src/lib/latex-serializer.ts)) writes it back, preserving the raw source. The honest current-state vocabulary:

- **Block constructs modeled:** the sectioning commands (`\part`…`\subparagraph`, levels 0–6, SSOT [src/lib/heading-types.ts](../../src/lib/heading-types.ts)), `\title`/`\author`/`\date`/`\maketitle`, display math `\[…\]`, the expex example family (`\ex`/`\pex`/`\a`/`\xlist`/`\begingl…\endgl`), `\includegraphics`, `\hrulefill`, and the environments `verbatim`, `quote`, `itemize`, `enumerate`, `figure`/`figure*`.
- **Inline constructs modeled:** `$…$` math; the marks `\textbf`/`\emph`/`\textit`/`\underline`/`\texttt`/`\textcolor[HTML]{…}`; `\footnote`/`\thanks`; the natbib + biblatex citation family (SSOT [src/lib/cite-commands.ts](../../src/lib/cite-commands.ts)); `\ref`/`\getref`/`\getfullref`; `\ldots`/`\LaTeX`/`\TeX`; escaped specials; `\\`.
- **Everything else passes through opaquely, byte-faithfully:** an unknown inline `\command{…}` is kept verbatim under the `latexCommand` mark (grey monospace), and an unknown `\begin{env}…\end{env}` (tables, `align`, `tikzpicture`, custom envs) is kept verbatim as a single grey-monospace block. This is how "render meaningfully while preserving the source" holds for *arbitrary* LaTeX.

Two honesty notes: `escapeLatex` escapes only `& % # _ ~ ^` and smart quotes — it deliberately leaves `\ { } $` as live syntax; and display math's *source* form is `\[…\]` (the `$$…$$` seen in the editor is a DOM/input-rule register, normalized on save). The library skills' [_latex-output.md](../../library/skills/_latex-output.md) constrains skill *output* to a curated subset — narrower than what the parser accepts.

The exhaustive parse/serialize tables (every block, inline, mark, and both opaque fallbacks) are in the manifest's **[latex.md](../workspace/latex.md)**.

---

## Reserved-name inventory
<!-- covers-code: src/lib/latex-serializer.ts, src/lib/tiptap, src/app/globals.css, src/lib/storage-fsa.ts -->

Every name Virgil reserves, so a user authoring their own `.tex` / preamble / files can't safely override it:

- **Injected macros** — Virgil injects `\providecommand` no-ops for **six** entity-id macros (`\vfid`, `\vcid`, `\vexid`, `\vxid`, `\vlid`, `\vlidend`) plus `\usepackage{xcolor}`, so the `.tex` compiles outside Virgil. SSOT: `ensureVirgilCommands` ([src/lib/latex-serializer.ts](../../src/lib/latex-serializer.ts)) + `CLASSIC_PREAMBLE` ([src/lib/document-styles.ts](../../src/lib/document-styles.ts)). (`\pgmark` is reserved too, but injected by the library indexer, not the editor.)
- **Comment conventions** — the `%!v:` block-anchor family and the `%!vtex:begin`/`%!vtex:end` texBlock sentinels (all `%!v`-prefixed).
- **CSS classes & `data-*` attributes** — the structural editor/card/panel hook namespace in [src/app/globals.css](../../src/app/globals.css) (`.tiptap`, `.linked-anchor`, `.expex-*`, `.dropmode-bar-*`, `.virgil-bar`, and the `data-card-*` / `data-link-*` / `data-print-*` families).
- **File/folder paths** — `virgil/` (the sidecar folder, SSOT [src/lib/storage-fsa.ts](../../src/lib/storage-fsa.ts)) with `figures-cache/` and `.history/`; the sibling `.virgil/` agent/library plumbing folder; and the infrastructure sidecars (`virgil.json`, `editor-state.json`, `ai-requests.json`, `notifications.json`, `collab.json`, `doc-settings.json`). *Card-sidecar filenames are deferred with the card refactor.*
- **v2-reserved overlay paths** — `~/.virgil-user/` and `<docpath>/.virgil/user-overrides/` are reserved **by design only** (present in the brainstorm + this doc, absent from all of `src/`); the deny-list enforcement is future work.

The exhaustive inventory — every injected string, comment regex, the full CSS/`data-*` families, and every reserved path and sidecar (stable vs. provisional) — is in the manifest's **[gardening.md](../workspace/gardening.md)** (including the user-overlay deny-list).

---

## Related documents

- **[docs/workspace/ (the operational manifest)](../workspace/INDEX.md)** — the Layer-3 field-level companion the six current-state sections above forward-point to (`identity.md`, `latex.md`, `gardening.md`, `cards.md`, `sidecars.md`, `structure.md`, …); each manifest doc carries a `derives-from` header pointing back at the matching section here. Its [INDEX](../workspace/INDEX.md) is the per-task reading protocol and the home for the field-level detail. It **absorbed and retired the two Phase 0 archaeology seed reports** (the stable-subsystem and card-layer current-state memos), which now live only in git history.
- **`docs/agents/*`** — the how-to-work-on-the-codebase derivatives (`overview.md`, `glossary.md`, `ui-chrome.md`, `main-text.md`, `architecture.md`), indexed by top-level `AGENTS.md`. They carry `derives-from` headers pointing back here.
- **`EDITOR_SKILLS_V1.html`** — the frozen v1 build target (the source for the confident [Ontology](#ontology) and [Cowork pattern](#cowork-pattern) content).
- **`EDITOR_SKILLS_BRAINSTORM.html`** — the design-intent record (the decisions log, §20; the method plan, §19).
- **`MEMO_V1_AND_ROT_PREVENTION.md`** — the rot-prevention strategy this document roots (Part 1).
- **[check-coherence.SKETCH.md](check-coherence.SKETCH.md)** — the design for the CI guard that validates this graph's edges.
