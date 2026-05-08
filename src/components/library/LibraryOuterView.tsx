"use client";

import { useMemo } from "react";
import { LibraryTabView } from "./LibraryTabView";
import { CENTRAL_LIBRARY_ID } from "@library/lib/library-store";
import type { UseLibraryTabsOptions } from "@library/hooks/useLibraryTabs";
import type { FsaDocMeta } from "@/lib/doc-index";

interface Props {
  /** Library id (custom or Project) backing this outer tab. */
  libId: string;
  /** Authoritative open-tab list from EditorLayout's `useFiles`. */
  openTabs: FsaDocMeta[];
  /** Authoritative active docId from EditorLayout's `useFiles`. */
  currentDocId: string | null;
  /** Authoritative active doc meta from EditorLayout's `useFiles`. */
  currentDoc: FsaDocMeta | null;
  /** Switch the active doc without leaving the Library pane. */
  focusDoc: (docId: string) => void;
}

/**
 * Outer Virgil-bar library view. Renders the standard library 2-panel
 * layout but with an isolated panel-state scope keyed by libId, seeded
 * to show Central (left) + the selected library (right). The user can
 * extend the layout from there — add more inner tabs, drag, etc. — and
 * everything persists under scoped localStorage keys without touching
 * the inline Library tab's state.
 *
 * Doc-state props (currentDocId etc.) are threaded through to
 * LibraryTabView so the per-doc Project view stays in sync with the
 * EditorLayout's tab strip even when the user is on a torn-out
 * Library tab — no sibling `useFiles()` instance, no drift.
 */
export default function LibraryOuterView({
  libId,
  openTabs,
  currentDocId,
  currentDoc,
  focusDoc,
}: Props) {
  const tabsOptions = useMemo<UseLibraryTabsOptions>(
    () => ({
      scope: `outer:${libId}`,
      seed: {
        left: { openIds: [CENTRAL_LIBRARY_ID], activeId: CENTRAL_LIBRARY_ID },
        right: { openIds: [libId], activeId: libId },
      },
    }),
    [libId],
  );
  return (
    // key={currentDocId} forces the per-doc projection state inside
    // LibraryTabView (selection, scroll, expanded rows) to reset when
    // the user switches docs from the tab strip while viewing this
    // outer Library tab.
    <LibraryTabView
      key={currentDocId ?? "no-doc"}
      tabsOptions={tabsOptions}
      openTabs={openTabs}
      currentDocId={currentDocId}
      currentDoc={currentDoc}
      focusDoc={focusDoc}
    />
  );
}
