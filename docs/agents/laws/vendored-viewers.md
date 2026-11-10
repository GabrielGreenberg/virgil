<!-- last-verified: 9ac1f766 2026-11-10 -->
<!-- derives-from: AGENTS.md#laws -->

# Vendored viewers: the WRAPPER owns the defaults, and the dist gets a CENSUS

> **A vendored third-party viewer's own defaults are not Virgil's.** Every
> Virgil-side preference about how it BEHAVES is stated ONCE at the wrapper's own
> open door and applied PER OPEN — never patched into the dist. And the vendored
> tree carries a **patch census**, because its hand edits are otherwise held
> together by prose telling a human to re-apply them after the next `unzip -o`.

This is the "the Library PDF viewer's outline sidebar opens by default" class
(task 498, Gabriel's own report). Virgil supplies configuration to two vendored
trees, and only one of them was censused.

Three rules it earned:

- **Per OPEN, not per MOUNT — because the iframe is WARM.** A `PdfView` whose
  `citekey` changes in place — the standalone paper tab (`PaperOuterView` →
  `RightDetail`, un-keyed) — switches papers in ONE viewer iframe, and nothing in
  pdf.js closes an open sidebar on a re-open: `reset()` switches to THUMBS without
  `forceOpen` and `setInitialView(NONE)` early-returns. So a sidebar opened on
  paper A stayed open on B, C, D… for the life of the tab — a fourth path,
  invisible to any reading of the vendored resolution ladder alone. The door
  therefore does two things ([`applyViewerDefaults`](../../../src/components/PdfViewer.tsx)): it un-defaults
  the option that would OPEN one, and it CLOSES one carried over. The two halves
  are guarded separately, because they answer different paths and a renamed
  vendored surface under one must not take the other down. (The Library Reader
  is the other lifetime: `ReaderLRU` gives each paper its own keyed keep-alive
  slot, so each paper has its own warm `PdfView` and no viewer is shared between
  papers — there the `close()` half is a harmless no-op.)
- **The warm switch is real only if the element SURVIVES it (task 612).** Until
  612 the rule above described a mount the code never built: the wrapper's
  "Loading PDF…" was an early RETURN that unmounted the iframe on every switch,
  so each paper booted a fresh pdf.js and the `close()` half guarded a race. And
  the blob URL and its citekey were two states, so the commit that revoked A's URL
  then re-ran the open with that dead URL titled `B.pdf` — pdf.js closed the
  document on screen to fail a fetch. Now the source is ONE state value
  (`{ citekey, url }`, minted together; the effects read it only while its citekey
  is the prop's), its URL is revoked only when a new source replaces it or on
  unmount, "Loading PDF…" / "No PDF on disk" are OVERLAYS over a hidden viewer,
  and the open is single-flight (eager attempt + `load` handler). Pinned by
  [`PdfView.switch.test.tsx`](../../../library/components/__tests__/PdfView.switch.test.tsx),
  whose defect leg runs OUTSIDE `act()`: `act` flushes the reset re-render before
  the stale open's microtask and so masks the pre-612 bug.
- **Un-default; do not bypass.** pdf.js resolves "sidebar view on load" in three
  tiers, and its stock `sidebarViewOnLoad` of `-1` (UNKNOWN) is precisely what
  unlocks the other two — a per-fingerprint `localStorage` restore and the PDF's
  own `/PageMode` (academic-publisher scans routinely carry `/UseOutlines`).
  Setting the option to `SidebarView.NONE` short-circuits both by their OWN
  conditions, so no vendored behaviour is bypassed and the page/zoom/scroll half
  of that same stored restore — read outside the `sidebarView === UNKNOWN` guard
  — is untouched. **Deliberately NOT generalized** to `scrollModeOnLoad` /
  `spreadModeOnLoad`, which ride the same tiers: nothing reports them and they
  restore a reading mode the user set on purpose (*match the fix to the true
  scope of the phenomenon*).
- **The census is what makes "wrapper-side" a checkable claim rather than an
  assertion.** [`PdfView.viewerDefaults.test.ts`](../../../library/components/__tests__/PdfView.viewerDefaults.test.ts)
  is the pdf.js sibling of `worker-kpse-contract` (task 454), and it is the only
  instrument that can see any of it — nothing here can DRIVE the viewer, and
  every behavioural test fakes the window. It pins the vendored tree at EXACTLY
  the three files `VIRGIL_VENDOR_NOTE.md` declares (allowlist = that set; a hit
  is re-apply-it or declare-it), that `viewer.mjs` carries no Virgil patch at
  all, and the runtime surface the door reaches for — `PDFViewerApplicationOptions`,
  the option and its `-1` default, the UNKNOWN gates on both later tiers,
  `pdfSidebar.close()`, and the fact that nothing upstream closes a sidebar on
  re-open. Measured by neutering each half in turn: the pre-498 absent door takes
  7 legs, the option half 4, the close half 4, folding the two guards into one
  try 1, a simulated re-vendor that drops the `<link>` line 2, a third vendored
  patch 3, and an un-gated `/PageMode` tier 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked — the Library PDF tab
works in the dev preview — so the check is cheap and real: open a paper whose PDF
carries `/PageMode /UseOutlines` (or open the sidebar by hand and switch papers)
and confirm it is closed on every open, and that the toggle still opens it.
And for 612: in the standalone paper tab, switch between two papers with PDFs —
no pdf.js loading error in the console, the title names the right paper, the
viewer is not re-booted (no blank flash beyond the overlay).

### The palette half (task 890)

The viewer's chrome COLOURS are a Virgil-side preference too, so the same door
owns them. `virgil-overrides.css` used to carry literal hexes "kept in sync with
globals.css" by prose; that sync had already drifted (manila `#dcdbd7` under the
shipped blue `#c5dbe2` bar) and could never follow the user's Colors prefs, which
live on the PARENT's `:root` and do not cross into an iframe. Now:

- **One token list**, `VIEWER_PALETTE_TOKENS` in `PdfViewer.tsx`. `applyViewerPalette`
  copies each LIVE parent value (`getComputedStyle(:root)`) onto the iframe root
  as `--virgil-<name>`, equality-bailed; an empty parent value is removed so the
  CSS fallback applies.
- **Two triggers, both event-driven:** every open (from `applyViewerDefaults`) and
  every palette write — `EditorLayout`'s `PREF_TO_CSS` effect fires
  `notifyChromePaletteChanged()` ([src/lib/chrome-palette-signal.ts](../../../src/lib/chrome-palette-signal.ts)),
  and each mounted `PdfViewer` re-copies into its warm viewer.
- **The CSS names no colour**: only `var(--virgil-*, <shipped default>)`, with
  alpha tints derived by `color-mix`. The census fails on a bare hex/`rgb()` in a
  declaration value, a `--virgil-*` not in the list, a read without a fallback, or
  a listed token nobody reads.
- **Pinned light.** `viewerCssTheme` is set to 1 for the record, but it is read
  once inside `initialize()` before the door can run, so the root class swap
  (`is-dark` → `is-light`) is what lands; every dark rule in `viewer.css` is gated
  `:where(html:not(.is-light))`, which the runtime-surface census now pins.

**Owed:** preview eyeball — Library → a paper with a PDF → toolbar stands on the
page's ground; change the document background in Preferences → the PDF toolbar
follows without reopening.

### The compiled half

The compiled pane used to hand its blob to a bare `<iframe>`, which meant Chrome's
own dark viewer. It now mounts the same [`PdfViewer`](../../../src/components/PdfViewer.tsx)
as the Library, with `role="compiled"`. There is one viewer; `role` is the whole
difference, and `PdfView` is only the Library's read of the file off disk.

A compiled paper is not a paper you are reading. Each compile is a new file of the
same document, and that one fact is what the role turns on:

- **The place carries, and pdf.js's memory cannot carry it.** `pdfjs.history` is
  keyed by fingerprint and holds 20 files, and pdfTeX writes a new `/ID` on every
  compile. Left alone, each compile would land on page 1 AND take a row, so twenty
  compiles would push every Library paper's reading position out. So on `pagesinit`,
  the one moment when the page count is known and the first view is not yet set,
  the wrapper sets `app.store = null` (every writer reads it as `store?.`) and sets
  `app.initialBookmark` from `compiledPlaces`, a session registry keyed by doc id.
  The page is clamped, because a revision can be shorter. A location is recorded
  only once `isInitialViewSet` holds, which is pdf.js's own gate on the same write.
- **Print and Download appear, on that role only.** Nothing else in the app offers
  them for the compiled PDF; a Library paper still has neither. `applyViewerDefaults`
  puts `COMPILED_VIEWER_CLASS` on the root, and `virgil-overrides.css` hides them
  under `:root:not(.virgil-compiled)`. Print goes through pdf.js, which rasterizes,
  so the role sets `printResolution` to 300; a download is the file itself.

One default earned by the embedded mount, on both roles: `viewer.mjs` turns an
embedded viewer's external links to `_top`, so a clicked link replaced Virgil itself.
The door sets the live `pdfLinkService.externalLinkTarget` to `BLANK` per open.

Around the viewer: the pane sits in a `PaneFreeze` (`anchor="right"`, the edge the
split's divider does not move), so a drag re-rasterizes once. `FramedViewerSurface`
lost its `dark` backdrop with Chrome's viewer and now stands on `--background`, the
colour the viewer paints around its pages. `PdfPaneOverlay` moved under the toolbar
(`top-12`; the toolbar is 40px), because the toolbar's controls are live under it.

Pinned by [`pdf-viewer-compiled.test.tsx`](../../../src/components/__tests__/pdf-viewer-compiled.test.tsx)
(the behaviour, on a faked viewer) and the census's "compiled role" legs (the
vendored surface it stands on).
