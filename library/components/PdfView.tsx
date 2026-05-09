"use client";

import { useEffect, useState } from "react";
import { readFile } from "@library/lib/library-storage";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  citekey: string | null;
}

/**
 * Renders the source PDF for a paper inline via the browser's native PDF
 * viewer. Loads `papers/<citekey>/<citekey>.pdf` from FSA, builds an object
 * URL, and embeds it in an iframe filling the available space.
 *
 * If no PDF exists on disk (e.g., a paper indexed from a .docx with no
 * PDF alternate), shows a friendly message instead of an empty frame.
 */
export default function PdfView({ handle, citekey }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

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
      src={url}
      title={`${citekey}.pdf`}
      style={{ width: "100%", height: "100%", border: "none" }}
    />
  );
}
