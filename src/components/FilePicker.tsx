"use client";

import Image from "next/image";
import type { DocMeta } from "@/lib/types";

interface FilePickerProps {
  docs: DocMeta[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}

export default function FilePicker({ docs, onOpen, onCreate, onDelete }: FilePickerProps) {
  const sorted = [...docs].sort(
    (a, b) => new Date(b.lastModifiedAt).getTime() - new Date(a.lastModifiedAt).getTime()
  );

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[var(--background)]">
      <div className="flex items-center gap-3 mb-8">
        <Image src="/logo.png" alt="Virgil" width={56} height={56} className="opacity-85" />
        <h1
          className="text-[var(--accent)] text-3xl tracking-widest"
          style={{ fontFamily: "var(--font-display), Playfair Display, serif" }}
        >
          VIRGIL
        </h1>
      </div>

      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-stone-600 text-sm font-medium">Your Documents</h2>
          <button
            onClick={onCreate}
            className="px-3 py-1.5 rounded text-sm bg-[var(--accent)] text-white hover:opacity-90 transition-colors"
          >
            + New Document
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-12 text-[var(--muted)]">
            <p className="text-sm">No documents yet.</p>
            <p className="text-xs mt-1">Click &quot;+ New Document&quot; to get started.</p>
          </div>
        ) : (
          <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-white">
            {sorted.map((doc, i) => (
              <div
                key={doc.id}
                className={`flex items-center justify-between px-4 py-3 hover:bg-stone-50 cursor-pointer transition-colors ${
                  i < sorted.length - 1 ? "border-b border-[var(--border-light)]" : ""
                }`}
                onClick={() => onOpen(doc.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-stone-800 font-medium truncate">
                    {doc.name}
                  </div>
                  <div className="text-xs text-[var(--muted-light)] mt-0.5">
                    {new Date(doc.lastModifiedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${doc.name}"?`)) {
                      onDelete(doc.id);
                    }
                  }}
                  className="text-xs text-[var(--muted-light)] hover:text-red-500 ml-3 transition-colors"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
