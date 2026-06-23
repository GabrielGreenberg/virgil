"use client";

import { useMemo } from "react";
import { useLibraryHandle } from "@library/hooks/useLibraryHandle";
import { useCatalogItems, refreshCatalogStore } from "@library/lib/catalog-store";
import { useMasterBib } from "@library/hooks/useMasterBib";
import LibraryFolderPicker from "@library/components/LibraryFolderPicker";
import LibraryPermissionGate from "@library/components/LibraryPermissionGate";
import PaperFileBody from "@library/components/PaperFileBody";
import type { BibEntry } from "@library/lib/types";

interface Props {
  /** Citekey backing this outer tab. */
  citekey: string;
}

/**
 * Outer Virgil-bar paper viewer. Renders the paper full-width across
 * the manila canvas. The icon strips pin to the outer edges of the
 * canonical `EditorPane`'s row, and the panel/editor boundary uses
 * the same `PanelColumn` drag-gap as the main editor — Reader
 * inherits the unified affordance.
 */
export default function PaperOuterView({ citekey }: Props) {
  const lib = useLibraryHandle();

  if (lib.state.kind === "loading") {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ color: "var(--muted)" }}
      >
        Loading…
      </div>
    );
  }
  if (lib.state.kind === "none") {
    return <LibraryFolderPicker onPick={lib.pick} />;
  }
  if (lib.state.kind === "needs-permission") {
    return (
      <LibraryPermissionGate onGrant={lib.grant} onReset={lib.reset} />
    );
  }
  return <ReadyView handle={lib.state.handle} citekey={citekey} />;
}

function ReadyView({
  handle,
  citekey,
}: {
  handle: FileSystemDirectoryHandle;
  citekey: string;
}) {
  // Shared catalog poll (catalog-store) rather than a second per-view loop.
  const { entries: catalogEntries } = useCatalogItems();
  const { entries: bibEntries, reload: reloadBib } = useMasterBib(handle);

  const bibByKey = useMemo(() => {
    const m = new Map<string, BibEntry>();
    for (const e of bibEntries) m.set(e.key, e);
    return m;
  }, [bibEntries]);

  return (
    <div
      className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <PaperFileBody
        handle={handle}
        citekey={citekey}
        entries={catalogEntries}
        bibByKey={bibByKey}
        onBibChanged={() => {
          void reloadBib();
          void refreshCatalogStore();
        }}
        // Standalone outer paper tab — no LibraryView panel context. Give
        // it its own isolated view-session scope so its reader scroll
        // persists independently of any inline-Library paper view.
        scope={`outer:paper:${citekey}`}
        panel="left"
      />
    </div>
  );
}
