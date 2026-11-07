"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { publicAssetUrl } from "@/lib/public-asset-url";
import { subscribeChromePalette } from "@/lib/chrome-palette-signal";
import { registerDocForget } from "@/lib/doc-forget";
import type { PdfPageState } from "@library/lib/pdf-pgmark-adapter";

/**
 * Which of the viewer's two jobs this mount does.
 *
 *   - `"reading"` — a paper in the Library. pdf.js's own per-file history keeps
 *     the place across sessions, and the toolbar is page navigation + zoom.
 *   - `"compiled"` — the writer's own typeset paper. Every compile is a NEW file
 *     of the SAME document, so three things change, all decided here: the place
 *     carries across a recompile, the compile stays out of pdf.js's history, and
 *     Print and Download are on the toolbar, because nothing else in the app
 *     offers them for this PDF.
 */
export type PdfViewerRole = "reading" | "compiled";

interface Props {
  /** The document's durable identity: a citekey, or a paper's doc id. A new
   *  `url` under the same `id` is a new revision of it. */
  id: string;
  /** The object URL to show, or null while there is nothing to show. The CALLER
   *  owns this URL's lifetime. */
  url: string | null;
  /** The name it goes by: the frame's title, and the file a download saves. */
  filename: string;
  role?: PdfViewerRole;
  /** Shown OVER the hidden viewer, which stays booted underneath. */
  notice?: ReactNode;
  /** F#11(a) — lift the live viewer page state UP to RightDetail so it can
   *  synthesize a `PgmarkPages` for the header PagePicker at parity with the
   *  text-mode picker. Fires once after `pagesinit` (pagesCount known) and on
   *  every `pagechanging`. Also exposes a `navigate(page)` callback bound to
   *  the viewer's `PDFViewerApplication.page` setter, so RightDetail can drive
   *  the picker's scroll-to-page without reaching into the iframe itself. */
  onPdfPageStateChange?: (
    state: PdfPageState,
    navigate: (page: number) => void,
  ) => void;
}

/** Path to the vendored pdf.js prebuilt viewer (public/pdfjs/web/viewer.html).
 *  Served same-origin, so the parent can reach contentWindow.PDFViewerApplication.
 *
 *  The trailing empty `?file=` suppresses pdf.js's sample-PDF auto-open: the
 *  viewer does `file = params.get("file") ?? AppOptions.get("defaultUrl")`, and
 *  `defaultUrl` is the bundled "compressed.tracemonkey-pldi-09.pdf" — which we
 *  excluded from the vendored tree, so on load it would 404. With `?file=`,
 *  `params.get("file")` returns "" (empty string, not null); `?? defaultUrl`
 *  only falls through on null/undefined, so `file` stays "" and the viewer's
 *  `if (file)` open-guard is falsy → no auto-open, no 404 flash. Our explicit
 *  PDFViewerApplication.open() in the load effect still fires normally.
 *
 *  Through `publicAssetUrl` (task 365) because this is a HAND-BUILT iframe src:
 *  Next prefixes nothing here, so the pre-365 root-absolute literal resolved to
 *  `<origin>/pdfjs/…` under the production `/virgil` basePath — outside the app,
 *  rendering the host's 404 page inside the pane. Byte-identical at the origin
 *  root, which is why dev could never see it. */
// Exported for the basePath contract test — the same "extract the one pure
// seam so it can be unit-tested without a browser/iframe" reason
// `pdfOpenArgs` below is exported for.
export const VIEWER_SRC = publicAssetUrl("/pdfjs/web/viewer.html?file=");

/** Minimal shape of the pdf.js eventBus we subscribe to. */
interface PdfEventBus {
  on: (name: string, handler: (...args: unknown[]) => void) => void;
  off: (name: string, handler: (...args: unknown[]) => void) => void;
}

/** Minimal shape of the pdf.js sidebar we reach for in `applyViewerDefaults`. */
interface PdfSidebar {
  /** No-op when already closed (`viewer.mjs` PDFSidebar.close early-returns). */
  close: () => void;
}

/** Minimal shape of the pdf.js link service we reach for in `applyViewerDefaults`. */
interface PdfLinkService {
  externalLinkTarget: number | null;
}

/** Minimal shape of the bits of pdf.js's PDFViewerApplication we drive. */
export interface PdfViewerApplication {
  initializedPromise?: Promise<void>;
  open: (args: { url: string; originalUrl?: string }) => Promise<void>;
  /** Total page count — 0 until the `pagesinit` event fires. */
  pagesCount?: number;
  /** Current 1-based page; getter + setter (set to navigate). */
  page?: number;
  eventBus?: PdfEventBus;
  /** Built during `initialize()`, so non-null once `initializedPromise` settles. */
  pdfSidebar?: PdfSidebar | null;
  /** Read by `addLinkAttributes` as each page's links render. */
  pdfLinkService?: PdfLinkService | null;
  /** A pending `page=…&zoom=…` that `setInitialView` consumes in place of the
   *  stored hash. */
  initialBookmark?: string | null;
  /** True once the first view is set; pdf.js's own gate on its history writes. */
  isInitialViewSet?: boolean;
  /** This document's row in `pdfjs.history`. Every writer reads it as `store?.`. */
  store?: unknown;
}

/** Minimal shape of the vendored viewer's AppOptions surface. `viewer.mjs`
 *  exposes it to its embedder as `window.PDFViewerApplicationOptions = AppOptions`. */
interface PdfViewerApplicationOptions {
  set: (name: string, value: unknown) => void;
}

/** The iframe's contentWindow, as far as this wrapper is entitled to know it. */
export type PdfViewerWindow = Window & {
  PDFViewerApplication?: PdfViewerApplication;
  PDFViewerApplicationOptions?: PdfViewerApplicationOptions;
};

/** pdf.js `SidebarView.NONE`. Named rather than spelled `0` at the call site,
 *  because `0` and the option's own stock default `-1` (`SidebarView.UNKNOWN`)
 *  are the whole distinction this door turns on. */
const SIDEBAR_VIEW_NONE = 0;

/**
 * **Virgil's own defaults for the vendored pdf.js viewer, stated ONCE and
 * applied PER OPEN.** The vendored tree carries exactly two hand-authored
 * patches, declared in `public/pdfjs/VIRGIL_VENDOR_NOTE.md`, and a patch
 * census (`library/components/__tests__/PdfView.viewerDefaults.test.ts`, task 498) pins that set
 * EXACTLY: a third vendored patch goes RED, and a re-vendor (`unzip -o`) would
 * drop it anyway. That is why every Virgil-side preference about how that
 * viewer BEHAVES belongs here, on the wrapper's own open path, rather than in
 * the dist. This is the named place: the next such default is added to this
 * function, not to a third patch.
 *
 * It states five things: a PDF's external links open in a new window, a compiled
 * paper prints at 300 dpi, the viewer is pinned LIGHT, its chrome is painted
 * from Virgil's LIVE palette (`applyViewerPalette`, task 890 — all four below
 * the sidebar lines), and — the long story here — **the sidebar
 * (outline/thumbnails) opens CLOSED.**
 * pdf.js resolves "sidebar view on load" in three tiers (`viewer.mjs` ~:13946),
 * and its stock `sidebarViewOnLoad` default of `-1` (UNKNOWN) is precisely what
 * unlocks the other two:
 *
 *   1. `AppOptions.get("sidebarViewOnLoad")` — stock `-1`;
 *   2. a per-fingerprint `localStorage["pdfjs.history"]` restore — sticky
 *      forever once the user opened the sidebar on that document once;
 *   3. the PDF's own `/PageMode` — academic-publisher scans (JSTOR, Springer,
 *      Acrobat re-saves) routinely carry `/PageMode /UseOutlines`, which
 *      force-opens the outline on every fresh open.
 *
 * Setting the option to `SidebarView.NONE` short-circuits tiers 2 and 3 by
 * their OWN conditions — both are gated on the option still reading UNKNOWN —
 * so no vendored behaviour is bypassed, only un-defaulted. The page/zoom/scroll
 * half of that same stored-history restore is untouched: it is read outside the
 * `sidebarView === UNKNOWN` guard.
 *
 * The `close()` is the second half and is NOT redundant. A `PdfView` whose
 * `citekey` changes in place — the standalone paper tab — switches papers in
 * ONE warm iframe (the lifetime note on the component, task 612), and nothing
 * in pdf.js ever closes an open sidebar on a re-open: `reset()` switches to
 * THUMBS without `forceOpen`, and `setInitialView(NONE)` early-returns. So a
 * sidebar opened on paper A would otherwise stay open on B, C, D… for the life
 * of the tab. The option stops the OPEN; `close()` retires an open one. (The
 * Library Reader keeps one instance PER PAPER in a keyed keep-alive slot, so
 * there no viewer is shared between papers; `close()` is a no-op there.)
 *
 * The two halves are guarded SEPARATELY, on purpose: they answer different
 * paths (a fresh open vs. a carried-over one), so a vendored surface that has
 * been renamed under one of them must not take the other down with it.
 *
 * Called after `initializedPromise` settles — which is what makes it safe:
 * `initialize()` awaits the preference read before resolving (`viewer.mjs`
 * ~:13227 before ~:13256), so nothing clobbers the option afterwards, and
 * `pdfSidebar` is built by then. And it is read at document-open time, so a
 * per-open set covers every warm switch.
 *
 * **Deliberate product cost:** a user who opens the outline and then switches
 * papers loses it. That is the reported ask ("closed by default"), and it is a
 * choice — the toggle button still works, so this is a DEFAULT, not a lockout.
 *
 * **Deliberately NOT forced:** `scrollModeOnLoad` / `spreadModeOnLoad`, which
 * ride the same stored-history and `/PageLayout` tiers. Nothing reports them,
 * and unlike the sidebar they restore a per-document reading mode the user set
 * from the toolbar on purpose — matching a fix to the true scope of the
 * phenomenon rather than to the broadest blast radius.
 */
export function applyViewerDefaults(
  win: PdfViewerWindow | null | undefined,
  role: PdfViewerRole = "reading",
): void {
  try {
    win?.PDFViewerApplicationOptions?.set("sidebarViewOnLoad", SIDEBAR_VIEW_NONE);
  } catch {
    // A re-vendor that renamed/removed the option: the `close()` below still
    // covers the warm-switch carryover, so fall through rather than bail.
  }
  try {
    win?.PDFViewerApplication?.pdfSidebar?.close();
  } catch {
    // Torn-down viewer mid-switch — the next open re-applies.
  }
  // pdf.js defaults an EMBEDDED viewer's external links to `_top`, so a clicked
  // link in a PDF would replace Virgil itself with the linked page. Links render
  // after this door, so the live service is the place to say it; the option was
  // already read inside `initialize()`.
  try {
    const links = win?.PDFViewerApplication?.pdfLinkService;
    if (links) links.externalLinkTarget = LINK_TARGET_BLANK;
  } catch {
    // Torn-down viewer mid-switch — the next open re-applies.
  }
  if (role === "compiled") {
    // Read as a print starts. pdf.js rasterizes what it prints, and its stock
    // 150 dpi is coarse for a page of text.
    try {
      win?.PDFViewerApplicationOptions?.set("printResolution", COMPILED_PRINT_DPI);
    } catch {
      // Renamed by a re-vendor — a print still works, at the stock resolution.
    }
  }
  // Virgil is light-only (`layout.tsx` `colorScheme: "light"`), so the viewer is
  // pinned light rather than left on pdf.js's stock `viewerCssTheme: 0`
  // (follow the OS). The option is read ONCE, inside `initialize()` — before
  // this door can run — so it is set for the record, and the root CLASS it would
  // have produced is what actually lands: every dark rule in `viewer.css` is
  // gated `:where(html:not(.is-light))` under `prefers-color-scheme: dark`.
  try {
    win?.PDFViewerApplicationOptions?.set("viewerCssTheme", VIEWER_CSS_THEME_LIGHT);
  } catch {
    // Renamed by a re-vendor — the class below is the half that lands anyway.
  }
  try {
    const root = win?.document?.documentElement;
    root?.classList.remove("is-dark");
    root?.classList.add("is-light");
    // The one thing the viewer's stylesheet needs to know: `virgil-overrides.css`
    // shows Print and Download only under this class.
    root?.classList.toggle(COMPILED_VIEWER_CLASS, role === "compiled");
  } catch {
    // Torn-down viewer mid-switch — the next open re-applies.
  }
  applyViewerPalette(win);
}

/** pdf.js `viewerCssTheme` value for "always light" (0 = follow OS, 2 = dark). */
const VIEWER_CSS_THEME_LIGHT = 1;

/** pdf.js `LinkTarget.BLANK`: an external link opens in a new window. */
const LINK_TARGET_BLANK = 2;

/** Sharp enough for a page of text, without pdf.js's rasterizing costing a
 *  long paper its memory. */
const COMPILED_PRINT_DPI = 300;

/** The root class under which the viewer's stylesheet shows Print and Download. */
export const COMPILED_VIEWER_CLASS = "virgil-compiled";

/** Where the reader is, in pdf.js's own terms (`updateviewarea`'s `location`). */
export interface ViewerPlace {
  pageNumber: number;
  /** A percentage, or a keyword such as `page-width`. */
  scale: number | string;
  left: number;
  top: number;
}

/**
 * **The reader's place in each compiled paper, for the session.** A registry
 * keyed by the document's id, because N papers stay mounted at once and this
 * outlives the pane: closing the PDF and reopening it remounts the viewer.
 *
 * It exists because pdf.js's own memory cannot serve a compile. That memory,
 * `pdfjs.history`, is keyed by the file's fingerprint and holds 20 files, and
 * pdfTeX stamps every compile with a new `/ID`. So each compile would look like
 * a stranger's file: the reader would land on page 1, and twenty compiles would
 * push every Library paper's reading position out of the same 20 rows.
 */
const compiledPlaces = new Map<string, ViewerPlace>();

/** A paper removed or reset under its id starts again from the top. */
registerDocForget("compiled-places", (docId) => {
  compiledPlaces.delete(docId);
});

/** A place as the `page=…&zoom=…` hash pdf.js opens at. The page is clamped: a
 *  revision can be shorter than the one the reader was in. */
export function placeBookmark(place: ViewerPlace, pagesCount: number): string {
  const page = Math.min(place.pageNumber, Math.max(pagesCount, 1));
  return `page=${page}&zoom=${place.scale},${place.left},${place.top}`;
}

/** Take a new compiled revision out of `pdfjs.history` and set it to open where
 *  the reader last was. Called on `pagesinit` (see the effect that calls it). */
export function carryCompiledPlace(app: PdfViewerApplication, id: string): void {
  app.store = null;
  const place = compiledPlaces.get(id);
  if (place) app.initialBookmark = placeBookmark(place, app.pagesCount ?? 1);
}

/**
 * **The Virgil tokens the viewer's chrome is painted from** (task 890). The
 * viewer is a separate document that cannot inherit `globals.css` — nor the
 * user's Colors preferences, which `EditorLayout` writes onto the PARENT's
 * `:root` at runtime — so the wrapper copies each LIVE value across as
 * `--virgil-<name>` on the iframe's root, and `virgil-overrides.css` consumes
 * only those (each with a fallback for the pre-copy frame). One list, read by
 * both sides: the census in `PdfView.viewerDefaults.test.ts` fails if the CSS
 * names a `--virgil-*` token that is not here, or carries a bare hex.
 */
export const VIEWER_PALETTE_TOKENS = [
  "--background",
  "--border-light",
  "--foreground",
  "--surface",
  "--muted",
  "--control-selected",
  "--pod-panel",
] as const;

/** `--background` → `--virgil-background`: the name a token goes by in the iframe. */
export function viewerPaletteVar(token: (typeof VIEWER_PALETTE_TOKENS)[number]): string {
  return `--virgil-${token.slice(2)}`;
}

/**
 * Copy the parent's LIVE palette onto the viewer's root. Called on every open
 * (from `applyViewerDefaults`) and whenever the palette changes
 * (`subscribeChromePalette`) — event-driven, O(token count), never per frame.
 * A token the parent leaves empty is REMOVED in the iframe, so the CSS fallback
 * applies rather than an empty value. `source` is injectable for tests.
 */
export function applyViewerPalette(
  win: PdfViewerWindow | null | undefined,
  source: Pick<CSSStyleDeclaration, "getPropertyValue"> | null = typeof document !== "undefined"
    ? getComputedStyle(document.documentElement)
    : null,
): void {
  if (!source) return;
  let style: CSSStyleDeclaration | undefined;
  try {
    style = win?.document?.documentElement?.style;
  } catch {
    return; // Torn-down viewer mid-switch.
  }
  if (!style) return;
  for (const token of VIEWER_PALETTE_TOKENS) {
    const value = source.getPropertyValue(token).trim();
    const name = viewerPaletteVar(token);
    if (value) {
      if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
    } else {
      style.removeProperty(name);
    }
  }
}

/**
 * Pure mapping from (blob object URL, filename) -> the argument object passed
 * to PDFViewerApplication.open(). Extracted so the source-prop -> open()-arg
 * wiring can be unit-tested without a browser/iframe.
 *
 * `originalUrl` is the name pdf.js knows the file by, rather than the opaque
 * blob: URL. It is what a compiled paper's Download saves it as.
 */
export function pdfOpenArgs(
  objectUrl: string,
  filename: string,
): { url: string; originalUrl: string } {
  return { url: objectUrl, originalUrl: filename };
}
/** One revision of one document. The URL and the id are ONE fact (task 612):
 *  the effects below only ever read them together. */
interface PdfSource {
  id: string;
  url: string;
  filename: string;
}

/**
 * **The one PDF viewer** (F#10): the vendored pdf.js prebuilt viewer in a
 * same-origin iframe, restyled to Virgil tokens, fed by
 * `PDFViewerApplication.open(...)` on the iframe load event (more robust than a
 * `?file=<blob>` hash — pdf.js #10435). Two surfaces mount it and neither knows
 * pdf.js: the Library's paper pane (`PdfView`, which reads the file off disk)
 * and the compiled pane in `EditorLayout` (which is handed the compile's blob).
 * What differs between them is stated by `role`, not by a second viewer.
 *
 * **Viewer lifetime (task 612).** The `<iframe>` stays mounted for as long as
 * this instance does; a `notice` is an OVERLAY over a hidden viewer, never a
 * swap of the element. So a `url` that changes in place — another paper, or a
 * recompile of this one — opens in ONE warm viewer, and pdf.js boots once per
 * instance. The real mounts:
 *   - **standalone paper tab** (`PaperOuterView` → `RightDetail`, un-keyed): the
 *     citekey changes in place, so this is the warm-switch path — and the one
 *     `applyViewerDefaults`'s `close()` half exists for;
 *   - **Library Reader** (`ReaderLRU`): each paper sits in its own keyed
 *     keep-alive slot, so each paper has its own instance and its citekey never
 *     changes; the viewer stays warm for THAT paper only;
 *   - **compiled pane**: mounted while the pane is open, so a recompile is a
 *     warm open of the same `id`.
 */
export default function PdfViewer({
  id,
  url,
  filename,
  role = "reading",
  notice,
  onPdfPageStateChange,
}: Props) {
  const source = useMemo<PdfSource | null>(
    () => (url ? { id, url, filename } : null),
    [id, url, filename],
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Keep the latest callback in a ref so the page-state effect (which depends
  // on the live source, not the callback identity) doesn't re-subscribe
  // when the parent re-renders with a fresh closure.
  const onPageStateRef = useRef(onPdfPageStateChange);
  // Sync the latest callback into the ref AFTER render (an effect, not a
  // during-render write) so the page-state effect reads the freshest closure
  // without re-subscribing — and without tripping react-hooks/refs. The
  // eventBus callbacks fire asynchronously (after paint + effect flush), so
  // the ref is always current by the time emit() runs.
  useEffect(() => {
    onPageStateRef.current = onPdfPageStateChange;
  });

  // Follow the user's Colors preferences live (task 890): every open copies the
  // palette (applyViewerDefaults), and a palette write in the parent re-copies
  // it into the warm viewer without a reopen. Event-driven, O(token count).
  useEffect(
    () =>
      subscribeChromePalette(() => {
        applyViewerPalette(iframeRef.current?.contentWindow as PdfViewerWindow | null);
      }),
    [],
  );

  // Drive the vendored viewer: await its initializedPromise, then open the blob.
  // Re-runs whenever the live source changes (new paper, re-read, recompile) —
  // and only ever opens a URL under the id that minted it.
  useEffect(() => {
    if (!source) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    let cancelled = false;
    // Single-flight: the eager attempt and the `load` handler can both clear
    // `initializedPromise`; only the first may reach `app.open()`.
    let opened = false;

    const openInViewer = async () => {
      const win = iframe.contentWindow as PdfViewerWindow | null;
      const app = win?.PDFViewerApplication;
      if (!app) return; // viewer script not ready yet; the onLoad handler retries
      try {
        await app.initializedPromise;
        if (cancelled || opened) return;
        opened = true;
        // Virgil's own viewer defaults, per open — see applyViewerDefaults.
        // AFTER init (the option can no longer be clobbered by the preference
        // read, and pdfSidebar exists) and BEFORE open (the option is read
        // while the document opens, and the close must precede the re-open).
        applyViewerDefaults(win, role);
        await app.open(pdfOpenArgs(source.url, source.filename));
      } catch {
        // Swallow: a cancelled/replaced open (rapid paper switches) or a
        // mid-teardown viewer throws; the next effect run re-opens cleanly.
      }
    };

    // Warm viewer (a paper switch in place): the iframe loaded long ago, so the
    // eager attempt opens now. Cold mount: the viewer script is not up yet, so
    // the eager attempt returns and the `load` handler opens.
    const onLoad = () => {
      void openInViewer();
    };
    iframe.addEventListener("load", onLoad);
    void openInViewer();

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
    };
  }, [source, role]);

  // F#11(a) — lift the viewer's live page state UP. Subscribe to the viewer's
  // OWN eventBus (`pagesinit` → pagesCount known; `pagechanging` → current page
  // moved). This is the pdf.js viewer's internal bus, fully independent of the
  // TipTap editor — no `editor.on(...)` subscription, no keystroke-path work.
  // Re-runs per live source (= per paper). Cleans up its listeners on
  // unmount / paper switch / mode toggle (PdfView unmounts) via the return
  // block + a `cancelled` flag, so nothing leaks across the keep-alive app.
  useEffect(() => {
    if (!source) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const compiled = role === "compiled";
    let cancelled = false;
    let bus: PdfEventBus | null = null;
    let app: PdfViewerApplication | null = null;
    let subscribed = false;

    const emit = () => {
      if (cancelled || !app) return;
      const pagesCount = app.pagesCount ?? 0;
      const currentPage = app.page ?? 1;
      onPageStateRef.current?.({ pagesCount, currentPage }, (page: number) => {
        // Navigate by setting the viewer's 1-based page. Guard against a
        // teardown race where the app/iframe is gone.
        if (cancelled || !app) return;
        try {
          app.page = page;
        } catch {
          /* viewer torn down mid-navigate — ignore */
        }
      });
    };

    // `pagesinit` is the one moment that is both soon enough and late enough for
    // a compiled revision: the page count is known, and pdf.js has not yet set
    // its first view. Nothing it does before this writes to its history.
    const onPagesInit = () => {
      if (compiled && app) carryCompiledPlace(app, source.id);
      emit();
    };
    const onPageChanging = () => emit();
    const onViewArea = (...args: unknown[]) => {
      // `isInitialViewSet` is pdf.js's own gate on its history write: until it
      // holds, the location is the page-1 default, not where anyone was.
      if (!compiled || !app?.isInitialViewSet) return;
      const location = (args[0] as { location?: ViewerPlace } | undefined)?.location;
      if (location) compiledPlaces.set(source.id, location);
    };

    const subscribe = async () => {
      const win = iframe.contentWindow as PdfViewerWindow | null;
      const a = win?.PDFViewerApplication;
      if (!a) return; // viewer script not ready; the load handler retries
      try {
        await a.initializedPromise;
      } catch {
        return;
      }
      if (cancelled) return;
      const b = a.eventBus;
      if (!b) return;
      app = a;
      bus = b;
      // Synchronous re-entry guard: this effect arms `subscribe()` twice (an
      // eager `void subscribe()` + the iframe `load` handler), and on a cold
      // mount both can clear the `await a.initializedPromise` above. pdf.js
      // `EventBus.on` is a plain push with no dedup, while the cleanup's
      // `bus.off(...)` removes only ONE matching entry — so a double subscribe
      // would leak a listener across the keep-alive app (and emit twice per
      // page change). Because there is NO `await` between here and the
      // `bus.on(...)` calls, the first invocation past the await sets the flag
      // and subscribes; any concurrent second invocation returns here.
      if (subscribed) return;
      subscribed = true;
      bus.on("pagesinit", onPagesInit);
      bus.on("pagechanging", onPageChanging);
      bus.on("updateviewarea", onViewArea);
      // No eager warm-emit here. The real count arrives via the `pagesinit`
      // listener, which fires on EVERY `app.open()` — including warm
      // paper-switches (pdf.js `PDFViewer.setDocument` dispatches `pagesdestroy`
      // then a fresh `pagesinit` for the new doc). The listener is attached
      // synchronously above, before the slow `app.open()` parse completes, so
      // it reliably catches the new document's count. Eagerly emitting
      // `a.pagesCount` here would instead surface the PREVIOUS document's stale
      // count on a warm switch (the iframe persists across an in-place citekey
      // change — see the lifetime note on the component — and `app.open(newBlob)` —
      // kicked off by the separate open effect — has not finished yet), causing
      // a brief wrong "p. N / OLD_TOTAL" flash before `pagesinit` corrects it.
    };

    const onLoad = () => {
      void subscribe();
    };
    iframe.addEventListener("load", onLoad);
    void subscribe();

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
      if (bus) {
        bus.off("pagesinit", onPagesInit);
        bus.off("pagechanging", onPageChanging);
        bus.off("updateviewarea", onViewArea);
      }
      // Reset the picker to the not-ready state so a stale page count from the
      // previous paper can't briefly show against the next paper's viewer.
      onPageStateRef.current?.({ pagesCount: 0, currentPage: 1 }, () => {});
    };
  }, [source, role]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <iframe
        ref={iframeRef}
        src={VIEWER_SRC}
        title={filename}
        aria-hidden={notice ? true : undefined}
        // borderRadius matches the framed-viewer pod so the iframe corners are
        // clipped to the rounded surface — some browsers don't clip iframe
        // content to a parent's radius.
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          borderRadius: "var(--pod-radius)",
          // Hidden, not unmounted: it may still hold the previous paper.
          visibility: notice ? "hidden" : "visible",
        }}
      />
      {notice && (
        <div
          role="status"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            padding: 24,
            textAlign: "center",
          }}
        >
          {notice}
        </div>
      )}
    </div>
  );
}
