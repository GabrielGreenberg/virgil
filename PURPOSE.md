# Virgil — Statement of Purpose

## What It Is

Virgil is a browser-based WYSIWYG text editor purpose-built for academic paper writing in LaTeX. It runs as a local Next.js app on the author's machine, saving all data to the local filesystem (`virgil-data/`).

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
- **Folder icon** opens a native system file dialog to import `.tex` files
- **Plus icon** creates a new blank document
- **Autosave** with debounced persistence to `virgil-data/doc_<id>/`
- Each document stores: `document.json` (TipTap JSON), `editor-state.json` (cursor/selection), `comments.json`, `suggestions.json`

### Comments System
- **User comments**: Select text in the editor, click "+ Comment" in the toolbar, type a comment in the right panel. The selected text is highlighted while composing.
- **Click-to-highlight**: Clicking a comment in the panel highlights the associated text region in the editor
- **Comment lifecycle**: Edit, Resolve, Delete. Resolved comments can be shown/hidden.
- **Resizable panel**: The comment panel has a drag handle (lozenge) for width adjustment
- **Collapsible**: Panel collapses to a thin icon strip; expand via panel icon or comment icon

### Claude Review (Cowork Model)
- **No API key required**. Reviews are initiated by the human operator from a Claude Code / Claude Cowork session.
- The Claude session reads the document files from `virgil-data/`, generates suggestions, and writes them to `suggestions.json` in the same format the UI expects.
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

- **Framework**: Next.js (App Router)
- **Editor**: TipTap (ProseMirror-based)
- **Styling**: Tailwind CSS v4
- **Storage**: Local filesystem via Node.js `fs` in API routes — all data lives in `virgil-data/`
- **No database, no auth, no cloud** — this is a single-user local tool

## File Structure

```
virgil-data/
  file-index.json          # list of all docs with metadata
  doc_<uuid>/
    document.json           # TipTap JSON content
    editor-state.json       # cursor position, selection
    comments.json           # user comments
    suggestions.json        # Claude review suggestions
    document.tex            # original imported .tex file (if imported)
```

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
