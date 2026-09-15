<!-- last-verified: 3a8f4892 2026-09-15 -->
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

- **Per OPEN, not per MOUNT — because the iframe is WARM.** `PdfView` keeps ONE
  viewer iframe across paper switches, and nothing in pdf.js closes an open
  sidebar on a re-open: `reset()` switches to THUMBS without `forceOpen` and
  `setInitialView(NONE)` early-returns. So a sidebar opened on paper A stayed
  open on B, C, D… for the life of the tab — a fourth path, invisible to any
  reading of the vendored resolution ladder alone. The door therefore does two
  things ([`applyViewerDefaults`](../../../library/components/PdfView.tsx)): it un-defaults
  the option that would OPEN one, and it CLOSES one carried over. The two halves
  are guarded separately, because they answer different paths and a renamed
  vendored surface under one must not take the other down.
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
