"use client";

import { useEffect, useRef, useState } from "react";
import { readFile } from "@library/lib/library-storage";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  citekey: string | null;
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

/** Minimal shape of the bits of pdf.js's PDFViewerApplication we drive. */
interface PdfViewerApplication {
  initializedPromise?: Promise<void>;
  open: (args: { url: string; originalUrl?: string }) => Promise<void>;
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
export default function PdfView({ handle, citekey }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

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
      style={{ width: "100%", height: "100%", border: "none" }}
    />
  );
}
