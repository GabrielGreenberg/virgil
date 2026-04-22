"use client";

import { useEffect, useState } from "react";

interface Props {
  log: string | null;
  status: number | null;
  isCompiling: boolean;
}

export default function CodeEditorLogDrawer({ log, status, isCompiling }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (status != null && status !== 0) setOpen(true);
  }, [status]);

  const hasContent = log != null && log.length > 0;

  return (
    <div
      className="border-t border-edge-subtle bg-surface-muted shrink-0 flex flex-col"
      style={{ maxHeight: open ? "40%" : undefined }}
    >
      <button
        type="button"
        onClick={() => hasContent && setOpen((v) => !v)}
        disabled={!hasContent && !isCompiling}
        className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-medium text-stone-500 uppercase tracking-wide hover:bg-surface-muted-strong text-left disabled:cursor-default disabled:hover:bg-transparent"
      >
        <Chevron open={open} />
        <span>Compile log</span>
        {isCompiling && (
          <span className="text-ink-muted normal-case font-normal tracking-normal">
            compiling…
          </span>
        )}
        {!isCompiling && status != null && (
          <span
            className={`normal-case font-normal tracking-normal ${
              status === 0 ? "text-emerald-700" : "text-danger"
            }`}
          >
            {status === 0 ? "ok" : `status ${status}`}
          </span>
        )}
        {!isCompiling && status == null && (
          <span className="text-ink-muted normal-case font-normal tracking-normal">
            (no compile yet)
          </span>
        )}
      </button>
      {open && hasContent && (
        <pre className="flex-1 overflow-auto px-4 py-2 text-[11px] font-mono text-ink-body whitespace-pre-wrap m-0">
          {log}
        </pre>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={open ? "M2 6 L5 3 L8 6" : "M2 4 L5 7 L8 4"} />
    </svg>
  );
}
