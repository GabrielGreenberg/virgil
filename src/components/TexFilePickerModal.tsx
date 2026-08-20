"use client";

import { useRef } from "react";
import SystemDialog, {
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";

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

  const sorted = sortTexFiles(texFiles, folderName);
  const isEmpty = sorted.length === 0;

  return (
    // No cued default, deliberately: the real answers are the file rows in the
    // BODY, and `initialFocus` puts the caret on the first of them, so Enter
    // opens that file. Cueing "Cancel" would make Return dismiss the picker.
    <SystemDialog
      open
      onClose={onCancel}
      size="md"
      noCuedDefault
      initialFocus={() =>
        listRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
      }
    >
      <SystemDialogHeader
        title={folderName}
        subtitle={
          isEmpty
            ? "This folder has no .tex files yet."
            : "Choose a file to open"
        }
      />
      {!isEmpty && (
        <div ref={listRef} className="px-3 pb-1 flex flex-col gap-0.5">
          {sorted.map((file) => (
            <button
              key={file}
              onClick={() => onSelect(file)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm text-ink-body rounded-lg hover-on-light focus:bg-surface-muted-strong focus:outline-none"
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
          className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm text-ink-body rounded-lg hover-on-light focus:bg-surface-muted-strong focus:outline-none"
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
      <SystemDialogFooter>
        <SystemDialogButton onClick={onCancel}>Cancel</SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}
