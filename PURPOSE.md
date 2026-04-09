# Virgil — Statement of Purpose

## What It Is

Virgil is a browser-based WYSIWYG text editor purpose-built for academic paper writing in LaTeX. It runs as a fully client-side Next.js app, saving all data to the user's own disk via the browser's File System Access API. There is no backend, no upload, no account.

## Core Design Philosophy

Virgil is **not** a LaTeX compiler or previewer. It is an **editing environment** that understands LaTeX conventions and renders them in a readable, WYSIWYG way while preserving the underlying LaTeX source. The goal is to make the writing and revision process comfortable — like writing in a word processor, but with LaTeX semantics intact.

## Key Features

### Editor
- **TipTap-based rich text editor** with a clean, light-mode academic aesthetic
- **LaTeX-aware rendering**: `\textit{}` renders as italics, `\footnote{}` renders as superscript markers, `% comments` render in subdued blue, `$math$` renders in purple monospace, bullet/numbered lists render WYSIWYG
- **All LaTeX elements are click-to-edit**: clicking a math node, footnote, or comment opens an inline editor to modify the underlying LaTeX content
- **Section hierarchy** via a dropdown selector (Section / Subsection / Subsubsection) rather than generic H1/H2/H3
- **Font choices**: Inter for UI, Playfair Display for the "VIRGIL" wordmark, Source Serif 4 for prose, Geist Mono for code/math

### File Management
- **Multi-tab interface** with rounded tabs, close (X) buttons, double-click to rename
- **Folder icon** opens the browser's directory picker to register an existing paper
- **Plus icon** prompts for a paper name, then opens the directory picker to choose where to create it
- **Autosave** with debounced persistence to the picked folder, serialized through a per-doc write queue
- Each paper's folder contains the user's `.tex` file, optional sibling `.bib`, and a `virgil/` subdir for sidecar metadata (`virgil.json`, `editor-state.json`, `revisions.json`, `citations.json`, `notes.json`, `footnotes.json`, etc.)

### Comments System
- **User comments**: Select text in the editor, click "+ Comment" in the toolbar, type a comment in the right panel. The selected text is highlighted while composing.
- **Click-to-highlight**: Clicking a comment in the panel highlights the associated text region in the editor
- **Comment lifecycle**: Edit, Resolve, Delete. Resolved comments can be shown/hidden.
- **Resizable panel**: The comment panel has a drag handle (lozenge) for width adjustment
- **Collapsible**: Panel collapses to a thin icon strip; expand via panel icon or comment icon

### Claude Review (Cowork Model)
- **No API key required**. Reviews are initiated by the human operator from a Claude Code / Claude Cowork session.
- The Claude session reads the document files from the paper's folder on disk, generates suggestions, and writes them to `virgil/suggestions.json` in the same format the UI expects.
- The UI picks up suggestions and presents them in a **suggestion panel** with:
  - Explanation of the suggestion
  - Original text (red, struck through)
  - Suggested replacement (green)
  - Space for the author's own revision
  - Space for a note
  - Skip / Reject / Accept buttons (with keyboard shortcuts: s / n / y)
- A **progress bar** at the top tracks completion through all suggestions
- Accepting a suggestion replaces the text in the editor; rejecting preserves the original

## Architecture

- **Framework**: Next.js 16 with `output: "export"` — fully static site, no server
- **Editor**: TipTap (ProseMirror-based)
- **Styling**: Tailwind CSS v4
- **Storage**: Browser File System Access API (FSA) for the user's `.tex` and `.bib` files; IndexedDB (via `idb-keyval`) for the doc index, tab state, and folder handles
- **Single boundary**: `src/lib/storage-fsa.ts` is the only place that touches disk; hooks call into it instead of fetching from any server
- **Browser requirement**: Chromium-based browsers only (Chrome, Edge, Brave, Arc, Opera, Vivaldi). FSA is not implemented in Firefox or Safari.
- **No database, no auth, no cloud, no upload** — single-user local tool, files stay on the user's disk

## File Structure

Each paper lives in its own folder, picked once via the browser's directory
picker. Virgil's metadata sits in a `virgil/` subfolder next to the `.tex`:

```
my-paper/
  main.tex                 # the user's LaTeX source
  references.bib           # optional, sibling .bib
  virgil/
    virgil.json            # paragraph UUID sidecar
    editor-state.json      # cursor position, selection
    revisions.json         # cowork dialogue (general + text revisions)
    citations.json         # citation refs and bib package config
    notes.json             # marginal notes
    footnotes.json         # persistent footnote state
    suggestions.json       # Claude review suggestions
    quotations.json        # quotation groups
    todos.json             # per-paper todos
    annotations.json       # bib entry annotations
    archive.json           # archived snippets
    bib-settings.json      # general bib + entry requests
    bib-review-requests.json
    ai-requests.json       # parallel AI request store
```

The list of registered papers, the open tabs, the active tab, and the
opaque folder handles all live in IndexedDB under the `virgil` database.

## Visual Design

- **Light mode only** with a warm off-white palette (`#faf9f7` background, white surfaces)
- Earthy brown accent color (`#7c5e3c`) for branding and primary actions
- LaTeX comments in subdued blue (`#7191b0` on `#f0f5fa`)
- Footnotes in subdued red (`#b45757` on `#fef2f2`)
- Math in purple (`#6b4fa0` on `#f0eeeb`)
- The logo is a pen-and-hands illustration (stored as `public/logo.png`)

## What It Is Not

- Not a LaTeX compiler — no PDF output
- Not a collaborative editor — single user only
- Not a cloud service — everything is local
- Not a code editor — optimized for prose, not syntax highlighting
