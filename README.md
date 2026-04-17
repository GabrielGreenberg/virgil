# Virgil

**Visual LaTeX editor for academic writing. Designed for AI compatibility.**

Virgil is a browser-based editor for `.tex` papers. It runs entirely
client-side, keeps your files on your own disk, and is built to be worked
on alongside Claude (or any coding agent) without giving up plain-text
LaTeX.

## Visual, not WYSIWYG

Virgil is *not* a WYSIWYG LaTeX editor. It does not compile LaTeX, does
not produce a PDF, and does not try to render your paper the way the
typesetter will. There is no preview pane.

What it *does* do is render LaTeX source **meaningfully** while you
write — italics look italic, footnotes sit in the margin, math displays
in its own color, section headings use a real heading hierarchy, `\ref`
resolves to the number you're pointing at. The LaTeX source underneath
is preserved exactly; clicking an inline element opens an editor on the
raw command.

Think of it as the difference between reading your paper in a terminal
and reading it in a typeset proof. Virgil is neither — it's a workspace
that respects LaTeX as the source of truth while giving you a
comfortable surface to write on.

## Designed for AI compatibility

Virgil doesn't ship an API key or call any model itself. Instead, it's
built for a **cowork** pattern: your AI assistant (Claude Code, Claude
Cowork, or any agent with filesystem access) reads the same `.tex` and
`.bib` files Virgil reads, then writes structured JSON sidecars into the
paper's `virgil/` folder. Virgil picks them up and surfaces them in the
editor.

Concretely, an agent can:

- Drop line-edit proposals into `suggestions.json` → they appear in the
  **Suggestion panel** with accept/reject/skip controls (`y`/`n`/`s`)
  and a progress bar.
- Post messages to `revisions.json` → they thread into **revision
  dialogues**, either paper-wide or anchored to a selection.
- Answer panel-scoped requests via `ai-requests.json` → the footnote,
  note, quotation, citation, and todo panels each have "ask" affordances
  that queue requests for an agent to resolve.
- Respond to `bib-review-requests.json` → per-entry field and notes
  reviews flow back into bibliography cards.

Every AI exchange is a file on disk that you can read, diff, and
version-control. No account, no key, no cloud round-trip.

## Capabilities

### LaTeX-aware editor

- **Inline rendering** for `\textbf`, `\emph`, `\textit`, `\underline`,
  `$…$` math (purple monospace), `\footnote` (superscript), `%` comments
  (subdued blue), bullet and numbered lists.
- **Click-to-edit** on every rendered element — math, footnotes,
  comments, citations all open an inline editor on the underlying
  command.
- **Section hierarchy** through a dropdown (Section / Subsection /
  Subsubsection) rather than generic heading levels.
- **Section numbering** with live `\label{}` / `\ref{}` resolution —
  `\ref` displays the current number of its target.
- **Command execution**: type `\commandname` + Enter to insert or
  convert the surrounding block.
- **Focus mode**: lock a single section for distraction-free editing;
  sidebars and other sections dim out.

### Panels

The sidebar is a configurable set of panels. Each side of the editor
can show a different subset, and the **Omni View** can display several
at once, either as a list or inline with the text they're anchored to.

- **Footnotes** — edit, word-count, and drag to the margin.
- **Citations** — browse parsed `.bib` entries, drag into text, pick the
  citation command (natbib and biblatex families both supported).
- **Bibliography** — the formatted reference list for the commands
  actually used in the paper.
- **Notes** — marginal notes anchored to paragraphs.
- **Quotations** — manage quote groups; anchor to the margin.
- **Todos** — per-paper checklist with margin anchors.
- **Archive** — snippets of removed prose; drag back to restore.
- **Search** — full-text with section-path and paragraph-title
  breadcrumbs.
- **Outline** — collapsible section tree with numbering and a
  position indicator.
- **Word count** — live totals broken down by category (main text,
  headers, captions, footnotes, other) and per-section.
- **Suggestions** — Claude's line edits with accept/reject/skip.
- **AI window** — dashboard for every outstanding AI request across
  panels.
- **Preferences** — panel visibility per side, word-count config,
  editor options.

### Citations & bibliography

- Reads a sibling `.bib` via [`citation-js`](https://citation.js.org/).
- **natbib**: `cite`, `citet`, `citep`, `citealt`, `citeauthor`,
  `citeyear`, `citeyearpar`, `nocite`, and multi-cite forms.
- **biblatex**: `textcite`, `parencite`, `autocite`, `footcite`,
  `smartcite`, `fullcite`, `citetitle`, `citedate`, `citeurl`, plus the
  `s`-suffix multi-cite variants.
- Per-entry AI review requests (fields, notes) flow through
  `bib-review-requests.json`.

### File management

- **Multi-paper tabs** — rounded tabs, X to close, double-click to
  rename.
- **Folder** icon registers an existing paper; **Plus** creates a new
  one.
- **Autosave** through a per-document write queue; nothing leaves your
  disk.
- The list of registered papers, open tabs, and folder handles lives in
  a per-origin IndexedDB store so reloads restore the workspace.

## How it stores files

Virgil uses the browser's [File System Access
API](https://wicg.github.io/file-system-access/) to read and write files
directly on your disk. There is no backend, no database, and nothing
uploaded. Each paper lives in its own folder:

```
my-paper/
├── main.tex                 ← your LaTeX source
├── references.bib           ← optional, sibling .bib
└── virgil/                  ← Virgil's per-paper metadata
    ├── virgil.json          ← paragraph UUID sidecar
    ├── editor-state.json    ← cursor, selection
    ├── revisions.json       ← AI dialogue (general + text-anchored)
    ├── suggestions.json     ← AI line edits
    ├── ai-requests.json     ← panel-scoped AI requests
    ├── citations.json       ← citation refs and bib package config
    ├── bib-settings.json    ← bib package + entry generation requests
    ├── bib-review-requests.json
    ├── notes.json           ← marginal notes
    ├── footnotes.json       ← footnote state
    ├── quotations.json      ← quotation groups
    ├── todos.json           ← per-paper todos
    ├── archive.json         ← archived snippets
    └── annotations.json     ← bib entry annotations
```

Every sidecar is plain JSON — readable, diff-able, and safe to commit.

## Browser requirement

Virgil requires a Chromium-based browser: Chrome, Edge, Brave, Arc,
Opera, Vivaldi. Firefox and Safari do not implement the File System
Access API and won't work. This is a browser limitation — any fallback
would either upload your files (defeating the point) or hide them in
browser-private storage (where LaTeX tooling can't touch them).

FSA permission grants are reset on every reload by spec. You'll see one
click-to-grant per paper per session.

## Development

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. On first load the workspace is empty —
click **Open** to point at an existing paper folder, or **+** to name
and create a new one.

## Building

```bash
npm run build
```

Produces a fully static site in `out/`. No Node runtime, no API routes,
nothing to serve dynamically. Drop `out/` on any static host.

### Deploying under a subdirectory

If you're embedding Virgil at a path like
`https://example.com/tools/virgil/` rather than at the origin root, set
`NEXT_PUBLIC_BASE_PATH` at build time:

```bash
NEXT_PUBLIC_BASE_PATH=/tools/virgil npm run build
```

That single env var threads through `next.config.ts`, the manifest's
`start_url`/`scope`/icon paths, and the service-worker registration.

⚠️ Pick the final URL once. Browser storage (IndexedDB, FSA permission
grants) is scoped to origin + path, so changing `basePath` after launch
invalidates everyone's stored folder handles.

## Architecture

- **Framework**: Next.js 16 (App Router, `output: "export"`)
- **Editor**: TipTap (ProseMirror)
- **Styling**: Tailwind CSS v4
- **Storage**: File System Access API for user files; IndexedDB (via
  `idb-keyval`) for the doc index, tab state, and folder handles
- **Persistence boundary**: `src/lib/storage-fsa.ts` is the only place
  that touches disk
- **Bib parsing**: `citation-js` in the browser

## What Virgil is not

- Not a LaTeX compiler — no PDF output, no preview pane
- Not a collaborative editor — single user, single machine
- Not a cloud service — nothing is uploaded
- Not a code editor — optimized for prose, not for syntax work on the
  preamble

## License

Virgil is licensed under the
[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/).
See [LICENSE](LICENSE) for the full text.

In short: you can freely use, modify, and distribute Virgil for any
**noncommercial** purpose — personal writing, academic research,
teaching, hobby projects, use inside a charitable or educational
organization. **Commercial use requires a separate license** — email
<gabriel.greenberg@gmail.com> to arrange one.

This is a source-available license, not an OSI-approved open-source
license.
