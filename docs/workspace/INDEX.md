<!-- last-verified: 694f789 2026-06-04 -->
<!-- derives-from: docs/architecture/VIRGIL.md#ontology -->
<!-- covers-code: editor/scripts -->

# Virgil operational manifest — reading protocol

This is the **dispatcher** for the manifest: the per-task knowledge Virgil's
mechanical skills load on demand. It is a *reading protocol*, not a table of
contents — for each kind of task it names exactly which docs to load. Skills
don't need to know what they need; they consult this INDEX. Loading is
index-directed: neither eager (load everything) nor lazy (each skill
self-discovers).

The manifest is the Layer-3 operational companion to the conceptual spine in
[VIRGIL.md](../architecture/VIRGIL.md): where the spine states the *concept* and
forward-points here, the manifest holds the *operational detail* (recognition
patterns, constraints, recipes). Source lives in `docs/workspace/`; it ships to
each paper's `.claude/virgil/` at runtime on the per-folder skill-bundle sync (see
[structure.md → how the manifest reaches `.claude/virgil/`](structure.md#how-the-manifest-reaches-claudevirgil)).

> **Build status.** The **foundational** docs (`ontology.md`, `identity.md`,
> `structure.md`, `atoms.md`, `latex.md`) and the **card-coupled** docs
> (`cards.md`, `sidecars.md`, `anchoring.md`, `gardening.md`) are written;
> `footnotes.md` is the first per-kind sliver. Only **`actions.md`** (the editing
> surface) is still forthcoming — it needs its own user-actions Phase 0 pass. The
> one line below that still names it is marked _(forthcoming)_.

## Reading protocol — what to load for a task

```
Modifying the document body (prose, structure, blocks)
  load: ontology.md, latex.md, identity.md#block-and-paragraph-ids,
        structure.md#the-write-path, gardening.md

Inserting or editing an inline element (footnote, citation, ref, math)
  load: atoms.md, identity.md#footnote-and-citation-ids, latex.md,
        anchoring.md, cards.md

Working with footnotes specifically
  load: footnotes.md, atoms.md#footnote,
        identity.md#footnote-and-citation-ids, structure.md#the-write-path

Working with citations or the bibliography
  load: atoms.md#citation, latex.md#citation-vocabulary,
        identity.md#footnote-and-citation-ids, cards.md, sidecars.md,
        structure.md

Creating or modifying any Card (note, todo, report, suggestion, …)
  load: cards.md, sidecars.md, anchoring.md,
        structure.md#the-write-path

Resolving where a Card attaches to text (anchors, Atom links)
  load: anchoring.md, identity.md

Judging what LaTeX Virgil will accept or preserve
  load: latex.md

A "how do I…" / "what is…" UX question from the user
  load: nothing here; consult the UX library (.claude/virgil-ux/) — forthcoming
```

## The docs

| Doc | Covers | Status |
|---|---|---|
| [ontology.md](ontology.md) | The Document + five primitives; Card-vs-text; linkage & UUIDs at a glance. Read first. | ✅ |
| [identity.md](identity.md) | Every UUID flavor + marker; who generates each; the id-equality link rule. | ✅ |
| [structure.md](structure.md) | Paper folder layout (`.tex` / `virgil/` / `.virgil/` / `.claude/`); the write path. | ✅ |
| [atoms.md](atoms.md) | Inline Atom kinds (footnote, citation, ref, math); Card linkage; mobility. | ✅ |
| [latex.md](latex.md) | What `parseLatex()` accepts/emits; the two opaque fallbacks; escaping; the curated output subset. | ✅ |
| [footnotes.md](footnotes.md) | Footnote-specific: the splice recipe, the `FootnoteRef` shape, the create flow. | ✅ (sliver) |
| [cards.md](cards.md) | Card-kind taxonomy; per-kind shape + linkage class; the Task Card. | ✅ |
| [sidecars.md](sidecars.md) | Per-sidecar JSON schemas — the `src/lib/types.ts` surface, field by field. | ✅ |
| [anchoring.md](anchoring.md) | Card→text linkage in full (Anchors AND Atom links); what invalidates each. | ✅ |
| `actions.md` | The editing surface: decorations, structural ops, card actions, keyboard. | _forthcoming_ |
| [gardening.md](gardening.md) | Cleanup conventions; orphan handling; the never-touch deny-list. | ✅ |

## The write path (every kind shares it)

All Card writes flow through one contract — skills never write paper files
directly. The diagram, the `safetyLevel` → subcommand mapping, and the pen /
atomic-write detail are in
[structure.md → the write path](structure.md#the-write-path). The conceptual model
is [VIRGIL.md → Cowork pattern](../architecture/VIRGIL.md#cowork-pattern).

## How this INDEX grows

This file is self-describing: it grows with the manifest. When a new manifest doc
lands, add it to **The docs** table and add (or extend) the reading-protocol
entries that should load it. Keep `load:` targets pointing at real section
anchors — a skill follows them literally.
