"use client";

/**
 * Library tab — v1 is intentionally minimal.
 *
 * Folder-state branching (picker / permission / ready) is preserved from the
 * earlier design, but the ready-state body is now a flat list of PDFs at the
 * root of the library folder plus a drag-and-drop area. Cowork's manifest
 * pipeline is not yet wired; when it comes online the list will gain rows
 * for processed items alongside these raw files.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLibrary } from "@/hooks/useLibrary";
import {
  copyPdfsToLibrary,
  listLibraryPdfs,
  type LibraryFile,
} from "@/lib/library/library-files";
import { LibraryFolderPicker } from "./LibraryFolderPicker";
import { LibraryPermissionGate } from "./LibraryPermissionGate";

export function LibraryTabView() {
  const library = useLibrary();

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

  return <LibraryReady handle={library.folderState.handle} />;
}

function LibraryReady({ handle }: { handle: FileSystemDirectoryHandle }) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const list = await listLibraryPdfs(handle);
      setFiles(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [handle]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ingestFiles = useCallback(
    async (incoming: readonly File[]) => {
      setError(null);
      setBusy(true);
      try {
        await copyPdfsToLibrary(handle, incoming);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [handle, refresh],
  );

  // dragenter/dragleave fire for each nested element, so count them to
  // avoid flicker when the pointer crosses child boundaries.
  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length === 0) return;
      void ingestFiles(dropped);
    },
    [ingestFiles],
  );

  const handlePickClick = useCallback(async () => {
    setError(null);
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
    try {
      const fhs = await picker({
        multiple: true,
        types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
      });
      const picked = await Promise.all(fhs.map((fh) => fh.getFile()));
      await ingestFiles(picked);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [ingestFiles]);

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden relative"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="px-4 py-2 border-b border-edge-subtle flex items-center gap-2 shrink-0">
        <span className="text-sm text-ink-body truncate">
          {handle.name}
        </span>
        <span className="text-[11px] text-ink-subtle">
          {files.length} {files.length === 1 ? "PDF" : "PDFs"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={handlePickClick}
            className="text-[11px] text-[var(--accent)] hover:bg-[var(--accent-light)] px-2 py-0.5 rounded border border-[var(--accent)]/40 disabled:opacity-60"
            title="Pick PDFs to copy into the library"
          >
            {busy ? "Copying…" : "+ PDF"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-[11px] text-ink-subtle hover:text-ink-body px-1.5 py-0.5 rounded hover-on-light"
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="px-4 py-2 text-[11px] text-danger border-b border-edge-subtle">
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        {files.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-ink-muted text-center max-w-sm">
              Drop PDFs anywhere in this pane to add them to your library.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-edge-subtle">
            {files.map((f) => (
              <li
                key={f.name}
                className="px-4 py-2 text-sm text-ink-body hover-on-light flex items-center gap-2"
              >
                <IconPdf />
                <span className="truncate" title={f.name}>
                  {f.name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--accent-light)]/70 ring-2 ring-drag-target ring-inset">
          <span className="text-sm font-medium text-[var(--accent)]">
            Drop PDFs to add to library
          </span>
        </div>
      ) : null}
    </div>
  );
}

function IconPdf() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-ink-muted"
    >
      <path d="M3 1.5h6.5L13 5v9.5H3z" />
      <path d="M9.5 1.5V5H13" />
    </svg>
  );
}
