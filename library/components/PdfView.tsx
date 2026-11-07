"use client";

import { useEffect, useState } from "react";
import PdfViewer from "@/components/PdfViewer";
import { readFile } from "@library/lib/library-storage";
import type { PdfPageState } from "@library/lib/pdf-pgmark-adapter";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  citekey: string | null;
  /** See `PdfViewer`'s prop of the same name. */
  onPdfPageStateChange?: (
    state: PdfPageState,
    navigate: (page: number) => void,
  ) => void;
}

/** One PDF source: the blob object URL and the citekey that minted it. They are
 *  ONE fact (task 612) — kept as two states, a paper switch let the open effect
 *  pair the previous paper's (already revoked) URL with the new citekey. */
interface PdfDoc {
  citekey: string;
  url: string;
}

/**
 * A paper's source PDF, in the one `PdfViewer`. Loads
 * `papers/<citekey>/<citekey>.pdf` from FSA and builds an object URL; everything
 * about showing it is the viewer's.
 *
 * If no PDF exists on disk (e.g., a paper indexed from a .docx with no PDF
 * alternate), shows a friendly message instead of an empty frame. The viewer
 * stays mounted under that message, for as long as this has a citekey.
 */
export default function PdfView({ handle, citekey, onPdfPageStateChange }: Props) {
  // The last source read. It is NOT nulled on a citekey change — the previous
  // paper stays in the (hidden) viewer until the next one replaces it — so
  // everything that drives the viewer reads `liveDoc`, the source only while it
  // belongs to the current citekey.
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  // The citekey whose read produced no source, and why (derived against the
  // prop, so a switch away clears it without a reset write). "missing" = no
  // PDF on disk; "failed" = the read itself failed (permission, IO) — task
  // 1115: a failure is neither "Loading…" forever nor a false "No PDF".
  const [unreadable, setUnreadable] = useState<
    { citekey: string; kind: "missing" | "failed" } | null
  >(null);
  const liveDoc = doc && doc.citekey === citekey ? doc : null;
  const unreadableKind =
    citekey !== null && unreadable?.citekey === citekey ? unreadable.kind : null;

  // Read the PDF bytes off disk -> mint the source (URL + citekey, together).
  // This effect only MINTS; the URL's lifetime is owned by the effect below.
  useEffect(() => {
    if (!handle || !citekey) return;
    let cancelled = false;
    (async () => {
      let file: File | undefined;
      let kind: "missing" | "failed" = "missing";
      try {
        file = await readFile(handle, `papers/${citekey}/${citekey}.pdf`);
      } catch (e) {
        // The read door rejects only on a real failure; absence is `undefined`.
        console.warn(`[PdfView] couldn't read the PDF for ${citekey}:`, e);
        kind = "failed";
      }
      if (cancelled) return;
      if (!file) {
        // Drop the previous source too: nothing should keep driving (or
        // reporting page state for) a paper that is no longer the one shown.
        setDoc(null);
        setUnreadable({ citekey, kind });
        return;
      }
      setDoc({ citekey, url: URL.createObjectURL(file) });
      setUnreadable(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, citekey]);

  // A source's URL lives exactly as long as it is THE source: revoked when a
  // new source replaces it, or on unmount — never while it can still be opened.
  // (React runs this cleanup in the same commit that runs the open effect's
  // cleanup, before the open effect re-runs with the replacement.)
  useEffect(() => {
    if (!doc) return;
    return () => URL.revokeObjectURL(doc.url);
  }, [doc]);

  if (!citekey) return null;

  // Nothing to show yet (still reading) or nothing on disk: an OVERLAY over the
  // hidden viewer, so the iframe — and the booted pdf.js inside it — survives.
  const notice = unreadableKind === "missing" ? (
    <span style={{ fontStyle: "italic" }}>
      No PDF on disk for <code style={{ marginLeft: 4 }}>{citekey}</code>.
    </span>
  ) : unreadableKind === "failed" ? (
    <span style={{ fontStyle: "italic" }}>
      Couldn&rsquo;t read the PDF for <code style={{ marginLeft: 4 }}>{citekey}</code>.
    </span>
  ) : !liveDoc ? (
    "Loading PDF…"
  ) : null;

  return (
    <PdfViewer
      id={citekey}
      url={liveDoc?.url ?? null}
      filename={`${citekey}.pdf`}
      notice={notice}
      onPdfPageStateChange={onPdfPageStateChange}
    />
  );
}
