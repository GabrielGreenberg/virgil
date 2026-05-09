"use client";

// Library tab body. Delegates rendering to the LibraryApp transplanted
// from the standalone virgil-library project (now under /library/).
//
// Bridges Virgil's editor state into the Library subsystem via
// ProjectLibraryProvider so the built-in "Project Library" inner tab can
// show the open document's bib (with an optional cited-only filter).
//
// IMPORTANT: this component is fully CONTROLLED. The active doc-state
// must be passed in by the parent. There used to be an uncontrolled
// fallback that called `useFiles()` locally — but `useFiles` is not a
// singleton context, so a second instance got its own `currentDocId`
// and drifted away from the EditorLayout's instance. That was the
// "tab panels don't update on doc switch" bug. Always pass props.

import { useEffect, useMemo } from "react";
import LibraryApp from "@library/components/LibraryApp";
import type { UseLibraryTabsOptions } from "@library/hooks/useLibraryTabs";
import {
  ProjectLibraryProvider,
  type ProjectBibMeta,
} from "@library/lib/project-library-context";
import type { BibEntry } from "@library/lib/types";
import { useCitations } from "@/hooks/useCitations";
import { addEntriesToProjectBib, removeEntryFromProjectBib } from "@/lib/project-bib";
import type { FsaDocMeta } from "@/lib/doc-index";
import MyPapersPod from "./MyPapersPod";

interface Props {
  /** Optional scope/seed for the inner `useLibraryTabs`. Library outer
   *  tabs pass their own scope so panel state is isolated per outer tab. */
  tabsOptions?: UseLibraryTabsOptions;
  /** Forward to LibraryView. Defaults to true (inline Library tab);
   *  tear-out callers pass false. */
  showNavigator?: boolean;
  /** Authoritative open-tab list from EditorLayout's `useFiles`. */
  openTabs: FsaDocMeta[];
  /** Authoritative active docId from EditorLayout's `useFiles`. */
  currentDocId: string | null;
  /** Authoritative active doc meta from EditorLayout's `useFiles`. */
  currentDoc: FsaDocMeta | null;
  /** Switch the active doc without leaving the Library pane. */
  focusDoc: (docId: string) => void;
  /** Every known Virgil doc — feeds the My Papers pod's "Recent" popup
   *  and is excluded from the recent list when already open. */
  docs?: FsaDocMeta[];
  /** Open a known doc by id (mirrors the Virgil-bar `+` behavior). */
  onOpenRecent?: (id: string) => void;
  /** Trigger the native folder picker (FSA `showDirectoryPicker`). */
  onOpenFolder?: () => void;
  /** Open the "create new document" modal. */
  onCreateNew?: () => void;
  /** True when the dev-storage backend is in use (no FSA permission
   *  re-grant required when re-opening a recent doc). */
  devStorage?: boolean;
}

export function LibraryTabView({
  tabsOptions,
  showNavigator,
  openTabs,
  currentDocId,
  currentDoc,
  focusDoc,
  docs,
  onOpenRecent,
  onOpenFolder,
  onCreateNew,
  devStorage,
}: Props) {
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

  // Drag one or more entries onto a Project library tab → append them
  // to the doc's references.bib. The library subsystem can't import
  // `@/lib/storage`, so it dispatches a window event with the resolved
  // BibEntry list; the listener here owns the file write.
  // `addEntriesToProjectBib` does ONE read-modify-write per event, so
  // multi-row drops can't race against themselves. The function is
  // idempotent on key, so multiple LibraryTabView mounts (one per
  // scoped outer library tab) seeing the same event redundantly is
  // safe — the second call sees the entries already present and no-ops.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ docId?: string; bibEntries?: BibEntry[] }>)
        .detail;
      if (!detail?.docId || !detail.bibEntries?.length) return;
      void addEntriesToProjectBib(detail.docId, detail.bibEntries);
    };
    window.addEventListener("virgil-library-add-to-project-bib", handler);
    return () =>
      window.removeEventListener("virgil-library-add-to-project-bib", handler);
  }, []);

  // Three-dots menu in a Project library tab → remove the entry from
  // the doc's references.bib. The library subsystem dispatches the
  // event after a user-confirm; this listener owns the file write.
  // Idempotent across racing scoped LibraryTabView mounts.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ docId?: string; citekey?: string }>)
        .detail;
      if (!detail?.docId || !detail?.citekey) return;
      void removeEntryFromProjectBib(detail.docId, detail.citekey);
    };
    window.addEventListener("virgil-library-remove-from-project-bib", handler);
    return () =>
      window.removeEventListener("virgil-library-remove-from-project-bib", handler);
  }, []);

  // The singleton (unscoped) Library outer tab projects every open Virgil
  // doc as a per-doc Project library inner tab. Tear-out scoped instances
  // pass their own tabsOptions and ignore openDocs.
  const mergedTabsOptions = useMemo<UseLibraryTabsOptions | undefined>(() => {
    if (tabsOptions?.scope) return tabsOptions;
    return {
      ...tabsOptions,
      openDocs: openTabs.map((d) => ({
        id: d.id,
        label: docDisplayLabel(d),
      })),
      currentDocId,
      onActivateDoc: focusDoc,
    };
  }, [tabsOptions, openTabs, currentDocId, focusDoc]);

  // Render the My Papers pod only when the inline (unscoped) Library
  // tab is active AND the host has wired the picker callbacks. Tear-out
  // outer tabs (showNavigator=false) skip the navigator column entirely
  // so they also skip this pod.
  const myPapersPod =
    showNavigator !== false && onOpenRecent && onOpenFolder && onCreateNew ? (
      <MyPapersPod
        docs={docs ?? []}
        openTabs={openTabs}
        currentDocId={currentDocId}
        onOpenRecent={onOpenRecent}
        onOpenFolder={onOpenFolder}
        onCreateNew={onCreateNew}
        devStorage={!!devStorage}
      />
    ) : null;

  return (
    <ProjectLibraryProvider
      hasDoc={!!currentDocId}
      docLabel={currentDoc?.name}
      bibKeys={bibKeys}
      citedKeys={citedKeys}
      bibMeta={bibMeta}
    >
      <LibraryApp
        tabsOptions={mergedTabsOptions}
        showNavigator={showNavigator}
        belowNavigator={myPapersPod}
      />
    </ProjectLibraryProvider>
  );
}

function docDisplayLabel(doc: { name?: string; folderName?: string; texFilename?: string }): string {
  if (doc.name && doc.name !== doc.folderName) return doc.name;
  if (doc.folderName) return doc.folderName;
  return doc.texFilename ?? "Untitled";
}
