"use client";

import { useCallback, useEffect, useRef } from "react";

interface TexFilePickerModalProps {
  folderName: string;
  texFiles: string[];
  onSelect: (filename: string) => void;
  onCreateNew: () => void;
  onCancel: () => void;
}

/** Sort .tex files: common names first, then alphabetical. */
function sortTexFiles(files: string[], folderName: string): string[] {
  const priority = [`${folderName}.tex`, "main.tex", "document.tex"];
  return [...files].sort((a, b) => {
    const ai = priority.indexOf(a);
    const bi = priority.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

export default function TexFilePickerModal({
  folderName,
  texFiles,
  onSelect,
  onCreateNew,
  onCancel,
}: TexFilePickerModalProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = listRef.current?.querySelector("button");
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel],
  );

  const sorted = sortTexFiles(texFiles, folderName);
  const isEmpty = sorted.length === 0;

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/20 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      onClick={handleBackdrop}
    >
      <div className="bg-[var(--surface,#ffffff)] border border-[var(--border,#e5e2dd)] rounded-xl shadow-xl w-full max-w-[360px] mx-4 overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-ink-body mb-0.5">
            {folderName}
          </h2>
          <p className="text-xs text-ink-subtle">
            {isEmpty
              ? "This folder has no .tex files yet."
              : "Choose a file to open"}
          </p>
        </div>
        {!isEmpty && (
          <div ref={listRef} className="px-3 pb-1 flex flex-col gap-0.5">
            {sorted.map((file) => (
              <button
                key={file}
                onClick={() => onSelect(file)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm text-ink-body rounded-lg hover:bg-surface-muted-strong focus:bg-surface-muted-strong focus:outline-none transition-colors"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-ink-muted shrink-0"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                {file}
              </button>
            ))}
          </div>
        )}
        <div
          className={`px-3 ${isEmpty ? "pt-0" : "pt-2 mt-1 border-t border-edge-subtle"} pb-3`}
        >
          <button
            onClick={onCreateNew}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm text-ink-body rounded-lg hover:bg-surface-muted-strong focus:bg-surface-muted-strong focus:outline-none transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-ink-muted shrink-0"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Create new document here
          </button>
        </div>
        <div className="flex items-center justify-end px-4 py-3 border-t border-[var(--border,#e5e2dd)] bg-surface-muted/60">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-ink-body bg-surface border border-edge-hover rounded-md hover:bg-surface-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
