# Virgil

A WYSIWYG LaTeX editor that runs entirely in your browser. No server, no
account, no upload — your `.tex` and `.bib` files stay on your own disk.

## How it stores files

Virgil uses the browser's [File System Access API](https://wicg.github.io/file-system-access/)
to read and write files directly on your disk. There is no backend, no
database, and nothing is uploaded anywhere. Each paper lives in its own
folder, picked once via the browser's directory picker:

```
my-paper/
├── main.tex                  ← your LaTeX source
├── references.bib            ← optional, sibling .bib
└── virgil/                   ← Virgil's per-paper metadata
    ├── virgil.json           ← paragraph UUID sidecar
    ├── editor-state.json
    ├── revisions.json
    ├── citations.json
    ├── notes.json
    ├── footnotes.json
    └── ... (everything else)
```

A small per-origin IndexedDB store remembers which folders you've opened
and which tabs were active, so reloads restore the same workspace. The
browser persists the folder handles for you.

## Browser requirement

Virgil needs a Chromium-based browser (Chrome, Edge, Brave, Arc, Opera,
Vivaldi). Firefox and Safari do not implement the File System Access API
and won't work. The notice on first load will tell you so.

This is a browser limitation, not a Virgil one — there is no fallback
that doesn't either upload your files (defeating the point) or hide them
in browser-private storage (where they're inaccessible to LaTeX
tooling).

Per-paper permission grants are reset on every reload, by spec. You'll
see one click-to-grant button per paper per session.

## Development

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The first time you load it the workspace
is empty — click `Open` to point at an existing paper folder, or `+` to
type a name and create a new one.

## Building

```bash
npm run build
```

Produces a fully static site in `out/`. There's no Node runtime, no API
routes, nothing to serve dynamically. Drop `out/` on any static host.

### Deploying under a subdirectory

If you're embedding Virgil at a path like `https://example.com/tools/virgil/`
rather than at the origin root, set `NEXT_PUBLIC_BASE_PATH` at build time:

```bash
NEXT_PUBLIC_BASE_PATH=/tools/virgil npm run build
```

That single env var threads through `next.config.ts`, the manifest's
`start_url`/`scope`/icon paths, and the service-worker registration. No
code changes needed.

⚠️ Pick the final URL once. Browser storage (IndexedDB, FSA permission
grants) is scoped to origin + path, so changing `basePath` after launch
invalidates everyone's stored folder handles.

## Architecture

- **Framework**: Next.js 16 (App Router, `output: "export"`)
- **Editor**: TipTap (ProseMirror)
- **Storage**: File System Access API for user files; IndexedDB
  (via `idb-keyval`) for the doc index, tab state, and folder handles
- **Persistence layer**: `src/lib/storage-fsa.ts` is the single
  boundary between hooks and disk
- **Bib parsing**: `citation-js` in the browser
