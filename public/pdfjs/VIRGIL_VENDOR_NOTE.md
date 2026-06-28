# Vendored pdf.js prebuilt viewer (Virgil F#10)

This directory is Mozilla's **prebuilt** pdf.js viewer (NOT `node_modules/pdfjs-dist`,
which ships only `pdf.mjs`/`pdf.worker.mjs` and no `viewer.html`). It is committed
to the repo and served same-origin at `/pdfjs/web/viewer.html`, so the parent app
can drive `contentWindow.PDFViewerApplication`. Consumed by
`library/components/PdfView.tsx`.

## Current version

pdf.js **4.10.38** (matches `pdfjs-dist` in `package.json`).

## Re-vendoring on a version bump

1. Download the matching release zip from
   `https://github.com/mozilla/pdf.js/releases/download/v<VER>/pdfjs-<VER>-dist.zip`
2. Extract over `public/pdfjs/`, excluding the dev sourcemaps and the bundled
   sample PDF to keep the tree lean:
   ```
   unzip -o pdfjs-<VER>-dist.zip -d public/pdfjs/ -x "*.map" "web/compressed.tracemonkey-pldi-09.pdf"
   ```
3. **Re-apply the ONE Virgil edit to `web/viewer.html`** — a single
   `<link rel="stylesheet" href="virgil-overrides.css">` right after the
   `viewer.css` link (search the file for `VIRGIL OVERRIDE`).
4. Keep `web/virgil-overrides.css` (the Virgil-token toolbar restyle) and this note.
5. Verify the new dist's CSS var names / toolbar button IDs still match the
   overrides file; pdf.js occasionally renames them across majors.

## The two hand-authored files (everything else is unmodified Apache-2.0 dist)

- `web/virgil-overrides.css` — toolbar restyle + hide annotate/print/editor groups.
- the single `<link>` line in `web/viewer.html`.
