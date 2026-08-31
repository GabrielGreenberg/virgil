// @vitest-environment node
/**
 * TASK 498 — VIRGIL'S OWN DEFAULTS FOR THE VENDORED pdf.js VIEWER.
 *
 * Two halves, because the defect has two halves and each needs a different
 * instrument.
 *
 * **The door** (`applyViewerDefaults`) is the wrapper-side SSOT for "what
 * Virgil wants from the vendored viewer", applied PER OPEN. Its behavioural
 * legs run against a fake window: the real thing needs an iframe, a same-origin
 * document and a parsed PDF, none of which exists in vitest.
 *
 * **The vendored contract** is a SOURCE census over `public/pdfjs/web/`, and it
 * is the only instrument that can see any of it — nothing in this repo can
 * DRIVE the viewer, and every behavioural test of `PdfView` fakes the window.
 * Its reason to exist is the re-vendor: `VIRGIL_VENDOR_NOTE.md` tells a human to
 * `unzip -o` a new dist over the tree and then re-apply one hand edit by hand,
 * which is exactly how an invariant kept in prose drifts. Two things would then
 * break in silence, with every other suite in the repo green:
 *
 *  1. the single `<link rel="stylesheet" href="virgil-overrides.css">` line is
 *     overwritten, and the entire Virgil toolbar restyle disappears;
 *  2. the runtime surfaces this wrapper reaches for — `PDFViewerApplicationOptions`,
 *     the `sidebarViewOnLoad` option, the UNKNOWN gates that make setting it
 *     sufficient, `pdfSidebar.close()` — are renamed or restructured, and the
 *     sidebar quietly opens by default again.
 *
 * This is the pdf.js sibling of `src/lib/compile/__tests__/worker-kpse-contract.test.ts`
 * (task 454), which the 498 diagnosis named as the thing pdf.js did not have.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { applyViewerDefaults, type PdfViewerWindow } from "../PdfView";

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/** pdf.js `SidebarView`. NONE is what the door must set; UNKNOWN is the stock
 *  default whose presence is precisely what unlocks the other two tiers. */
const SIDEBAR_VIEW_NONE = 0;
const SIDEBAR_VIEW_UNKNOWN = -1;

function fakeWindow(opts?: {
  setThrows?: boolean;
  noOptions?: boolean;
  noSidebar?: boolean;
  closeThrows?: boolean;
}) {
  const set = vi.fn<(name: string, value: unknown) => void>(() => {
    if (opts?.setThrows) throw new Error("renamed by a re-vendor");
  });
  const close = vi.fn(() => {
    if (opts?.closeThrows) throw new Error("torn down mid-switch");
  });
  const win = {
    PDFViewerApplication: opts?.noSidebar ? {} : { pdfSidebar: { close } },
    PDFViewerApplicationOptions: opts?.noOptions ? undefined : { set },
  } as unknown as PdfViewerWindow;
  return { win, set, close };
}

describe("applyViewerDefaults — the sidebar opens CLOSED", () => {
  it("sets sidebarViewOnLoad to SidebarView.NONE, not the stock UNKNOWN", () => {
    // The whole fix turns on this one value: pdf.js gates BOTH the stored-history
    // restore and the /PageMode mapping on the option still reading UNKNOWN, so
    // any non-UNKNOWN value short-circuits them by their own conditions.
    const { win, set } = fakeWindow();
    applyViewerDefaults(win);
    expect(set).toHaveBeenCalledWith("sidebarViewOnLoad", SIDEBAR_VIEW_NONE);
    expect(set).not.toHaveBeenCalledWith("sidebarViewOnLoad", SIDEBAR_VIEW_UNKNOWN);
  });

  it("closes an already-open sidebar — the warm-iframe carryover", () => {
    // PdfView keeps ONE iframe across paper switches and nothing in pdf.js
    // closes an open sidebar on re-open (`reset()` switches to THUMBS without
    // forceOpen; `setInitialView(NONE)` early-returns). Without this half a
    // sidebar opened on paper A stays open on B, C, D… for the life of the tab.
    const { win, close } = fakeWindow();
    applyViewerDefaults(win);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("applies PER OPEN, so every warm paper switch is covered", () => {
    const { win, set, close } = fakeWindow();
    applyViewerDefaults(win);
    applyViewerDefaults(win);
    applyViewerDefaults(win);
    expect(set).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(3);
  });

  it("does NOT force scrollModeOnLoad or spreadModeOnLoad", () => {
    // A DECIDED scope, pinned so a later "tidy" that generalizes to the two
    // sibling options is a decision someone makes on purpose. They ride the
    // same stored-history and /PageLayout tiers, nothing reports them, and
    // unlike the sidebar they restore a reading mode the user set deliberately.
    const { win, set } = fakeWindow();
    applyViewerDefaults(win);
    const names = set.mock.calls.map((c) => c[0]);
    expect(names).toEqual(["sidebarViewOnLoad"]);
  });
});

describe("applyViewerDefaults — the two halves are guarded SEPARATELY", () => {
  it("still closes when the option surface is gone", () => {
    const { win, close } = fakeWindow({ noOptions: true });
    expect(() => applyViewerDefaults(win)).not.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("still closes when setting the option THROWS", () => {
    // A re-vendor that renamed the option must not take the warm-iframe half
    // down with it — they answer different paths.
    const { win, close } = fakeWindow({ setThrows: true });
    expect(() => applyViewerDefaults(win)).not.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("still sets the option when the sidebar is absent or throws", () => {
    const a = fakeWindow({ noSidebar: true });
    expect(() => applyViewerDefaults(a.win)).not.toThrow();
    expect(a.set).toHaveBeenCalledWith("sidebarViewOnLoad", SIDEBAR_VIEW_NONE);

    const b = fakeWindow({ closeThrows: true });
    expect(() => applyViewerDefaults(b.win)).not.toThrow();
    expect(b.set).toHaveBeenCalledWith("sidebarViewOnLoad", SIDEBAR_VIEW_NONE);
  });

  it("is a no-op on a window that is not there yet", () => {
    // The open effect calls this after `initializedPromise`, but the iframe can
    // be torn down mid-switch; a throw here would skip `app.open()` entirely.
    expect(() => applyViewerDefaults(null)).not.toThrow();
    expect(() => applyViewerDefaults(undefined)).not.toThrow();
    expect(() => applyViewerDefaults({} as PdfViewerWindow)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The vendored contract (source census)
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..", "..", "..");
const PDFJS = join(ROOT, "public", "pdfjs");
const VIEWER = readFileSync(join(PDFJS, "web", "viewer.mjs"), "utf8");
const VIEWER_HTML = readFileSync(join(PDFJS, "web", "viewer.html"), "utf8");

/** The three files `VIRGIL_VENDOR_NOTE.md` declares as ours — the note itself
 *  plus the two hand-authored artifacts. Everything else under `public/pdfjs/`
 *  is unmodified Apache-2.0 dist. Repo-relative to `public/pdfjs/`. */
const DECLARED_VIRGIL_ARTIFACTS = [
  "VIRGIL_VENDOR_NOTE.md",
  "web/viewer.html",
  "web/virgil-overrides.css",
] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe("vendored pdf.js — the patch census", () => {
  it("carries EXACTLY the declared hand-authored artifacts, and no others", () => {
    // The leg with teeth. A re-vendor (`unzip -o` over the tree) drops the one
    // `<link>` line and the toolbar restyle vanishes with every suite green;
    // conversely a THIRD vendored patch — the thing 498 was routed away from —
    // would be dropped by the NEXT re-vendor just as silently. Allowlist is the
    // declared set; a hit is either re-apply-it or declare-it in the note.
    const marked = walk(PDFJS)
      .filter((p) => /virgil/i.test(readFileSync(p, "utf8")))
      .map((p) => relative(PDFJS, p).split(/[\\/]/).join("/"))
      .sort();
    expect(marked).toEqual([...DECLARED_VIRGIL_ARTIFACTS].sort());
  });

  it("keeps the single override link in viewer.html, marked so a human can find it", () => {
    expect(VIEWER_HTML).toContain("VIRGIL OVERRIDE");
    const links = VIEWER_HTML.match(/virgil-overrides\.css/g) ?? [];
    expect(links).toHaveLength(1);
  });

  it("leaves viewer.mjs unmodified — no Virgil patch in the dist JS", () => {
    // The wrapper-side design decision, made checkable rather than asserted:
    // pdf.js has no per-patch census the way the swiftlatex worker does, so
    // Virgil's viewer defaults live in PdfView.tsx and NOT in here.
    expect(VIEWER).not.toMatch(/virgil/i);
  });
});

describe("vendored pdf.js — the runtime surface applyViewerDefaults reaches for", () => {
  it("still exposes AppOptions to its embedder as window.PDFViewerApplicationOptions", () => {
    expect(VIEWER).toMatch(/window\.PDFViewerApplicationOptions\s*=\s*AppOptions/);
  });

  it("still declares sidebarViewOnLoad, defaulting to SidebarView.UNKNOWN (-1)", () => {
    // The default is the whole reason the door exists: -1 is what unlocks the
    // stored-history and /PageMode tiers below.
    expect(VIEWER).toMatch(/sidebarViewOnLoad:\s*\{/);
    expect(VIEWER).toMatch(/sidebarViewOnLoad:\s*-1/);
    expect(VIEWER).toMatch(/SidebarView\s*=\s*\{\s*UNKNOWN:\s*-1,\s*NONE:\s*0/);
  });

  it("still resolves the sidebar view from that option FIRST", () => {
    expect(VIEWER).toMatch(/sidebarView\s*=\s*AppOptions\.get\("sidebarViewOnLoad"\)/);
  });

  it("still gates BOTH later tiers on the option reading UNKNOWN", () => {
    // This is the property that makes setting one option sufficient. If a
    // re-vendor un-gates either tier, the option stops short-circuiting it and
    // the sidebar opens again — with nothing else in the repo able to notice.
    expect(VIEWER).toMatch(
      /sidebarView === SidebarView\.UNKNOWN\)\s*\{\s*sidebarView = stored\.sidebarView/,
    );
    expect(VIEWER).toMatch(
      /pageMode && sidebarView === SidebarView\.UNKNOWN\)\s*\{\s*sidebarView = apiPageModeToSidebarView\(pageMode\)/,
    );
  });

  it("still hangs a pdfSidebar with a close() off PDFViewerApplication", () => {
    expect(VIEWER).toMatch(/pdfSidebar:\s*null/);
    expect(VIEWER).toMatch(/this\.pdfSidebar = new PDFSidebar\(/);
    expect(VIEWER).toMatch(/close\(evt = null\)\s*\{\s*if \(!this\.isOpen\)/);
  });

  it("still NEVER closes an open sidebar on re-open — which is why close() is the second half", () => {
    // `setInitialView(NONE|UNKNOWN)` dispatches and returns; `reset()` switches
    // to THUMBS without forceOpen. Neither closes. If upstream ever changes
    // that, this leg fails and the close() half becomes redundant — worth
    // knowing either way.
    const start = VIEWER.indexOf("setInitialView(view = SidebarView.NONE)");
    expect(start).toBeGreaterThan(-1);
    const body = VIEWER.slice(start, VIEWER.indexOf("switchView(view, forceOpen", start));
    expect(body).toMatch(/view === SidebarView\.NONE \|\| view === SidebarView\.UNKNOWN/);
    expect(body).not.toMatch(/this\.close\(/);

    const resetStart = VIEWER.indexOf("  reset() {\n    this.isInitialViewSet = false;");
    expect(resetStart).toBeGreaterThan(-1);
    const resetBody = VIEWER.slice(resetStart, resetStart + 500);
    expect(resetBody).toMatch(/switchView\(SidebarView\.THUMBS\)/);
    expect(resetBody).not.toMatch(/this\.close\(/);
  });

  it("still restores page/zoom/scroll OUTSIDE the sidebarView gate", () => {
    // The `Done when` half that must NOT change: forcing the sidebar closed
    // may not cost the per-paper page/zoom/scroll restore, which is read before
    // (and independently of) the `sidebarView === UNKNOWN` branch.
    const start = VIEWER.indexOf('hash = `page=${stored.page}');
    expect(start).toBeGreaterThan(-1);
    const gate = VIEWER.indexOf("sidebarView === SidebarView.UNKNOWN", start);
    expect(gate).toBeGreaterThan(start);
  });
});
