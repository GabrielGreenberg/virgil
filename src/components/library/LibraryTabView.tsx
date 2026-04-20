"use client";

/**
 * Library tab — the "shadow tab" paired to a document.
 *
 * Branches on folder state:
 *   - loading         → spinner
 *   - no folder       → <LibraryFolderPicker />
 *   - needs permission → <LibraryPermissionGate />
 *   - ready           → list + detail split
 *
 * The underlying library is global (one folder, one manifest) but the
 * view is per-doc: filter/alignment badges reference the current doc's
 * references.bib, and notes are written into the doc's own sidecar.
 */

import { useEffect, useMemo, useState } from "react";
import {
  OPEN_LIBRARY_EVENT,
  type OpenLibraryEventDetail,
} from "./BibLibraryChip";
import { useLibrary } from "@/hooks/useLibrary";
import { useLibraryOverlay } from "@/hooks/useLibraryOverlay";
import { useCitations } from "@/hooks/useCitations";
import {
  alignItemToBib,
  bibKeySet,
} from "@/lib/library/library-alignment";
import { copyAllToInbox } from "@/lib/library/library-inbox";
import type {
  CitationAlignment,
  LibraryIndexItem,
} from "@/lib/library/library-types";
import { LibraryFolderPicker } from "./LibraryFolderPicker";
import { LibraryPermissionGate } from "./LibraryPermissionGate";
import { LibraryListRow } from "./LibraryListRow";
import { LibraryDetailPane } from "./LibraryDetailPane";

type FilterKind = "all" | "cited-here" | "unmatched-bib" | "processing" | "failed";

interface Props {
  docId: string;
}

export function LibraryTabView({ docId }: Props) {
  const library = useLibrary();
  const { bibEntries } = useCitations(docId);
  const overlay = useLibraryOverlay(docId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKind>("all");

  // When the Bibliography panel (or any other caller) dispatches a
  // "virgil-open-library" event with an itemId or citekey, select that
  // item here. EditorLayout handles switching the active pane; this
  // listener just picks the right row.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenLibraryEventDetail>).detail;
      if (!detail) return;
      const targetId = detail.itemId
        ?? library.manifest.items.find((it) => it.citekey === detail.citekey)?.id;
      if (!targetId) {
        // No matching item — probably a "no PDF" chip click. Land the
        // user on the Unmatched filter so they can see the gap.
        setFilter("unmatched-bib");
        return;
      }
      setSelectedId(targetId);
      // Make sure the target is visible — reset to "All" if the current
      // filter would hide it.
      setFilter("all");
    };
    window.addEventListener(OPEN_LIBRARY_EVENT, handler);
    return () => window.removeEventListener(OPEN_LIBRARY_EVENT, handler);
  }, [library.manifest.items]);

  // Scroll the selected row into view whenever the selection changes.
  useEffect(() => {
    if (!selectedId) return;
    const row = document.querySelector(
      `[data-library-item="${CSS.escape(selectedId)}"]`,
    );
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const bibKeys = useMemo(() => bibKeySet(bibEntries), [bibEntries]);

  const alignmentById = useMemo(() => {
    const out = new Map<string, CitationAlignment>();
    for (const it of library.manifest.items) {
      out.set(it.id, alignItemToBib(it, bibKeys));
    }
    return out;
  }, [library.manifest.items, bibKeys]);

  const filteredItems = useMemo(() => {
    const all = library.manifest.items;
    switch (filter) {
      case "all":
        return all;
      case "cited-here":
        return all.filter(
          (i) => alignmentById.get(i.id) === "cited-here",
        );
      case "unmatched-bib":
        // Items with a citekey that isn't in the bib, OR items with no
        // citekey yet — either way, this doc can't bind them.
        return all.filter(
          (i) => alignmentById.get(i.id) !== "cited-here",
        );
      case "processing":
        return all.filter(
          (i) =>
            i.status === "pending" ||
            i.status === "extracting" ||
            i.status === "ocring",
        );
      case "failed":
        return all.filter((i) => i.status === "failed");
    }
  }, [library.manifest.items, alignmentById, filter]);

  // Auto-select first item if nothing selected yet, or if current selection
  // has disappeared from the list.
  const selectedItem: LibraryIndexItem | null = useMemo(() => {
    const hit = filteredItems.find((i) => i.id === selectedId);
    return hit ?? filteredItems[0] ?? null;
  }, [filteredItems, selectedId]);

  // --- Branch on folder state ---

  if (library.folderState.kind === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-ink-muted">
        Loading library…
      </div>
    );
  }

  if (library.folderState.kind === "none") {
    return (
      <LibraryFolderPicker
        onPicked={(handle) => {
          library.pickFolder(handle).catch(() => {});
        }}
      />
    );
  }

  if (library.folderState.kind === "needs-permission") {
    return (
      <LibraryPermissionGate
        handle={library.folderState.handle}
        onGranted={() => {
          library.permissionGranted().catch(() => {});
        }}
      />
    );
  }

  const libraryHandle = library.folderState.handle;
  const items = filteredItems;
  const counts = countByFilter(library.manifest.items, alignmentById);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left rail: filter bar + list */}
      <div className="w-[340px] border-r border-edge-hover flex flex-col shrink-0 bg-surface/30">
        <div className="px-3 py-2 border-b border-edge-hover flex items-center gap-2 flex-wrap">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label="All"
            count={counts.all}
          />
          <FilterChip
            active={filter === "cited-here"}
            onClick={() => setFilter("cited-here")}
            label="Cited here"
            count={counts.citedHere}
          />
          <FilterChip
            active={filter === "unmatched-bib"}
            onClick={() => setFilter("unmatched-bib")}
            label="Unmatched"
            count={counts.unmatched}
          />
          <FilterChip
            active={filter === "processing"}
            onClick={() => setFilter("processing")}
            label="Processing"
            count={counts.processing}
          />
          <FilterChip
            active={filter === "failed"}
            onClick={() => setFilter("failed")}
            label="Failed"
            count={counts.failed}
          />
          <div className="ml-auto flex items-center gap-1">
            <AddPdfButton
              libraryHandle={libraryHandle}
              onAdded={() => library.refresh().catch(() => {})}
            />
            <button
              type="button"
              onClick={() => library.refresh().catch(() => {})}
              title={library.lastReadAt ? `Last read: ${library.lastReadAt}` : "Never read"}
              className="text-[11px] text-ink-subtle hover:text-ink-body px-1.5 py-0.5 rounded hover:bg-surface/60"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {items.length === 0 ? (
            <EmptyList manifestEmpty={library.manifest.items.length === 0} />
          ) : (
            items.map((item) => (
              <LibraryListRow
                key={item.id}
                item={item}
                selected={selectedItem?.id === item.id}
                alignment={alignmentById.get(item.id) ?? "unresolved"}
                onSelect={() => setSelectedId(item.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right pane: detail */}
      <div className="flex-1 overflow-hidden">
        {selectedItem ? (
          <LibraryDetailPane
            libraryHandle={libraryHandle}
            item={selectedItem}
            notes={overlay.getItemNotes(selectedItem.id)}
            onNotesChange={(n) => overlay.setItemNotes(selectedItem.id, n)}
            revision={library.revision}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-ink-muted">
            Select an item to see its details.
          </div>
        )}
      </div>
    </div>
  );
}

function AddPdfButton({
  libraryHandle,
  onAdded,
}: {
  libraryHandle: FileSystemDirectoryHandle;
  onAdded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      // showOpenFilePicker is the FSA equivalent of <input type="file">
      // but returns FileSystemFileHandle — we only need the File object
      // since we're copying into the library folder, not persisting the
      // source handle.
      const picker = (window as unknown as {
        showOpenFilePicker?: (opts: {
          multiple?: boolean;
          types?: Array<{ description?: string; accept: Record<string, string[]> }>;
        }) => Promise<FileSystemFileHandle[]>;
      }).showOpenFilePicker;
      if (!picker) {
        setError("This browser doesn't support file picking.");
        return;
      }
      const fileHandles = await picker({
        multiple: true,
        types: [
          {
            description: "PDF",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      const files = await Promise.all(fileHandles.map((fh) => fh.getFile()));
      await copyAllToInbox(libraryHandle, files);
      onAdded();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={handleClick}
        title="Copy a PDF into the library inbox"
        className="text-[11px] text-[var(--accent)] hover:bg-[var(--accent-light)] px-1.5 py-0.5 rounded border border-[var(--accent)]/40 disabled:opacity-60"
      >
        {busy ? "Copying…" : "+ PDF"}
      </button>
      {error ? (
        <span className="text-[11px] text-red-600" title={error}>error</span>
      ) : null}
    </>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
        active
          ? "bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]"
          : "bg-transparent text-ink-subtle border-edge-hover hover:text-ink-body hover:bg-surface/60"
      }`}
    >
      {label}
      <span className="ml-1 opacity-70">{count}</span>
    </button>
  );
}

function EmptyList({ manifestEmpty }: { manifestEmpty: boolean }) {
  return (
    <div className="p-4 text-xs text-ink-muted leading-relaxed">
      {manifestEmpty ? (
        <>
          <p>Your library folder is empty, or Cowork hasn&apos;t written a
            manifest yet.</p>
          <p className="mt-2">
            Drop PDFs into the folder — or use Add PDF — and Cowork will
            process them and publish a{" "}
            <span className="font-mono">library-index.json</span>.
          </p>
        </>
      ) : (
        <p>No items match this filter.</p>
      )}
    </div>
  );
}

function countByFilter(
  items: readonly LibraryIndexItem[],
  alignmentById: ReadonlyMap<string, CitationAlignment>,
) {
  let citedHere = 0;
  let unmatched = 0;
  let processing = 0;
  let failed = 0;
  for (const i of items) {
    const a = alignmentById.get(i.id);
    if (a === "cited-here") citedHere++;
    else unmatched++;
    if (
      i.status === "pending" ||
      i.status === "extracting" ||
      i.status === "ocring"
    ) {
      processing++;
    }
    if (i.status === "failed") failed++;
  }
  return { all: items.length, citedHere, unmatched, processing, failed };
}
