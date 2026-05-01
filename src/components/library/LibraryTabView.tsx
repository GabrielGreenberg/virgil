"use client";

// Library tab body. Delegates rendering to the LibraryApp transplanted
// from the standalone virgil-library project (now under /library/).
//
// Bridges Virgil's editor state into the Library subsystem via
// ProjectLibraryProvider so the built-in "Project Library" inner tab can
// show the open document's bib (with an optional cited-only filter).

import { useMemo } from "react";
import LibraryApp from "@library/components/LibraryApp";
import {
  ProjectLibraryProvider,
  type ProjectBibMeta,
} from "@library/lib/project-library-context";
import { useFiles } from "@/hooks/useFiles";
import { useCitations } from "@/hooks/useCitations";

export function LibraryTabView() {
  const { currentDocId, currentDoc } = useFiles();
  const { bibEntries, citations } = useCitations(currentDocId);

  const bibKeys = useMemo(() => bibEntries.map((e) => e.key), [bibEntries]);

  // Per-key metadata so the Project tab can synthesize a row for entries
  // that exist in the doc's .bib but aren't yet indexed in the library.
  const bibMeta = useMemo(() => {
    const out = new Map<string, ProjectBibMeta>();
    for (const e of bibEntries) {
      const f = e.fields ?? {};
      const yearNum = f.year ? Number(f.year) : undefined;
      out.set(e.key, {
        title: f.title,
        // BibTeX author fields are conventionally "A and B and C"; split
        // best-effort. Fall back to the raw string if it doesn't look
        // multi-author so the row still shows something useful.
        authors: f.author
          ? f.author.includes(" and ")
            ? f.author.split(/\s+and\s+/)
            : [f.author]
          : undefined,
        year: yearNum && !Number.isNaN(yearNum) ? yearNum : undefined,
        doi: f.doi,
      });
    }
    return out;
  }, [bibEntries]);

  // Citations carry one or more keys per `\cite{a,b,c}` command.
  const citedKeys = useMemo(() => {
    const out = new Set<string>();
    for (const c of citations) for (const k of c.keys) out.add(k);
    return Array.from(out);
  }, [citations]);

  return (
    <ProjectLibraryProvider
      hasDoc={!!currentDocId}
      docLabel={currentDoc?.name}
      bibKeys={bibKeys}
      citedKeys={citedKeys}
      bibMeta={bibMeta}
    >
      <LibraryApp />
    </ProjectLibraryProvider>
  );
}
