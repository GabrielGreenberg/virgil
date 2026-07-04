"use client";

import { useEffect, useRef, useState } from "react";
import { readFile } from "@library/lib/library-storage";
import type { PdfPageState } from "@library/lib/pdf-pgmark-adapter";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  citekey: string | null;
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
 *  PDFViewerApplication.open() in the load effect still fires normally. */
const VIEWER_SRC = "/pdfjs/web/viewer.html?file=";

/** Minimal shape of the pdf.js eventBus we subscribe to. */
interface PdfEventBus {
  on: (name: string, handler: (...args: unknown[]) => void) => void;
  off: (name: string, handler: (...args: unknown[]) => void) => void;
}

/** Minimal shape of the bits of pdf.js's PDFViewerApplication we drive. */
interface PdfViewerApplication {
  initializedPromise?: Promise<void>;
  open: (args: { url: string; originalUrl?: string }) => Promise<void>;
  /** Total page count — 0 until the `pagesinit` event fires. */
  pagesCount?: number;
  /** Current 1-based page; getter + setter (set to navigate). */
  page?: number;
  eventBus?: PdfEventBus;
}

/**
 * Pure mapping from (blob object URL, citekey) -> the argument object passed
 * to PDFViewerApplication.open(). Extracted so the source-prop -> open()-arg
 * wiring can be unit-tested without a browser/iframe.
 *
 * `originalUrl` sets the viewer's title bar + download filename to a friendly
 * `<citekey>.pdf` rather than exposing the opaque blob: URL.
 */
export function pdfOpenArgs(
  objectUrl: string,
  citekey: string | null,
): { url: string; originalUrl?: string } {
  return citekey
    ? { url: objectUrl, originalUrl: `${citekey}.pdf` }
    : { url: objectUrl };
}

/**
 * Renders the source PDF for a paper inline via the **vendored pdf.js prebuilt
 * viewer** (F#10), restyled to Virgil tokens. Loads
 * `papers/<citekey>/<citekey>.pdf` from FSA, builds an object URL, and feeds it
 * to the same-origin viewer iframe via `PDFViewerApplication.open(...)` on the
 * iframe load event (more robust than a `?file=<blob>` hash — pdf.js #10435).
 *
 * If no PDF exists on disk (e.g., a paper indexed from a .docx with no PDF
 * alternate), shows a friendly message instead of an empty frame.
 */
export default function PdfView({ handle, citekey, onPdfPageStateChange }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Keep the latest callback in a ref so the page-state effect (which depends
  // on the blob URL + citekey, not the callback identity) doesn't re-subscribe
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

  // Read the PDF bytes off disk -> mint a blob object URL (unchanged FSA plumbing).
  useEffect(() => {
    setUrl(null);
    setMissing(false);
    if (!handle || !citekey) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      const file = await readFile(handle, `papers/${citekey}/${citekey}.pdf`);
      if (cancelled) return;
      if (!file) {
        setMissing(true);
        return;
      }
      createdUrl = URL.createObjectURL(file);
      setUrl(createdUrl);
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [handle, citekey]);

  // Drive the vendored viewer: await its initializedPromise, then open the blob.
  // Re-runs whenever the blob URL changes (new paper or re-read). We do NOT
  // revoke the blob URL here — the read effect above owns its lifecycle and
  // revokes on unmount/change, after the viewer has already buffered the bytes.
  useEffect(() => {
    if (!url) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    let cancelled = false;

    const openInViewer = async () => {
      const win = iframe.contentWindow as
        | (Window & { PDFViewerApplication?: PdfViewerApplication })
        | null;
      const app = win?.PDFViewerApplication;
      if (!app) return; // viewer script not ready yet; the onLoad handler retries
      try {
        await app.initializedPromise;
        if (cancelled) return;
        await app.open(pdfOpenArgs(url, citekey));
      } catch {
        // Swallow: a cancelled/replaced open (rapid paper switches) or a
        // mid-teardown viewer throws; the next effect run re-opens cleanly.
      }
    };

    // If the iframe already loaded (warm viewer, blob changed), open now.
    // Otherwise wait for load. Cover both via an onLoad listener + an eager try.
    const onLoad = () => {
      void openInViewer();
    };
    iframe.addEventListener("load", onLoad);
    // Eager attempt in case the iframe finished loading before this effect ran.
    void openInViewer();

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
    };
  }, [url, citekey]);

  // F#11(a) — lift the viewer's live page state UP. Subscribe to the viewer's
  // OWN eventBus (`pagesinit` → pagesCount known; `pagechanging` → current page
  // moved). This is the pdf.js viewer's internal bus, fully independent of the
  // TipTap editor — no `editor.on(...)` subscription, no keystroke-path work.
  // Re-runs per blob URL / citekey (= per paper). Cleans up its listeners on
  // unmount / paper switch / mode toggle (PdfView unmounts) via the return
  // block + a `cancelled` flag, so nothing leaks across the keep-alive app.
  useEffect(() => {
    if (!url) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
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

    const onPagesInit = () => emit();
    const onPageChanging = () => emit();

    const subscribe = async () => {
      const win = iframe.contentWindow as
        | (Window & { PDFViewerApplication?: PdfViewerApplication })
        | null;
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
      // No eager warm-emit here. The real count arrives via the `pagesinit`
      // listener, which fires on EVERY `app.open()` — including warm
      // paper-switches (pdf.js `PDFViewer.setDocument` dispatches `pagesdestroy`
      // then a fresh `pagesinit` for the new doc). The listener is attached
      // synchronously above, before the slow `app.open()` parse completes, so
      // it reliably catches the new document's count. Eagerly emitting
      // `a.pagesCount` here would instead surface the PREVIOUS document's stale
      // count on a warm switch (the iframe persists, and `app.open(newBlob)` —
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
      }
      // Reset the picker to the not-ready state so a stale page count from the
      // previous paper can't briefly show against the next paper's viewer.
      onPageStateRef.current?.({ pagesCount: 0, currentPage: 1 }, () => {});
    };
  }, [url, citekey]);

  if (!citekey) return null;

  if (missing) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontStyle: "italic",
          padding: 24,
          textAlign: "center",
        }}
      >
        No PDF on disk for <code style={{ marginLeft: 4 }}>{citekey}</code>.
      </div>
    );
  }

  if (!url) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        Loading PDF…
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      src={VIEWER_SRC}
      title={`${citekey}.pdf`}
      // borderRadius matches the framed-viewer pod so the iframe corners are
      // clipped to the rounded surface (parity with the docs compiled-PDF
      // iframe — some browsers don't clip iframe content to a parent's radius).
      style={{ width: "100%", height: "100%", border: "none", borderRadius: "var(--pod-radius)" }}
    />
  );
}
