"use client";

import { useEffect, useState } from "react";

/**
 * Shared collapsible "Compile log" body (P5). The single implementation of the
 * raw-log disclosure — the `<pre>` + status pill previously inlined in
 * `CodeEditorLogDrawer`. Rendered in BOTH the code-view drawer and the docked
 * Errors panel so the raw log is reachable OUTSIDE code view.
 *
 * `defaultOpenOnError` (drawer behavior) auto-opens the body when a compile
 * ends non-zero; the docked-panel host leaves it collapsed by default.
 */
export interface CompileLogDisclosureProps {
  log: string | null;
  status: number | null;
  isCompiling: boolean;
  /** Auto-open the body when status flips non-zero (the drawer's behavior). */
  defaultOpenOnError?: boolean;
  /** Wrapper className so each host can size/border it to fit. */
  className?: string;
  /** Max height applied while open (drawer wants 40%; panel a fixed px). */
  openMaxHeight?: string;
}

export default function CompileLogDisclosure({
  log,
  status,
  isCompiling,
  defaultOpenOnError = false,
  className,
  openMaxHeight,
}: CompileLogDisclosureProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (defaultOpenOnError && status != null && status !== 0) setOpen(true);
  }, [status, defaultOpenOnError]);

  const hasContent = log != null && log.length > 0;

  return (
    <div
      className={
        className ??
        "border-t border-edge-subtle bg-surface-muted shrink-0 flex flex-col"
      }
      style={{ maxHeight: open ? openMaxHeight ?? "40%" : undefined }}
    >
      <button
        type="button"
        onClick={() => hasContent && setOpen((v) => !v)}
        disabled={!hasContent && !isCompiling}
        className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-medium text-ink-subtle uppercase tracking-wide hover-on-light text-left disabled:cursor-default disabled:hover:bg-transparent"
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
              status === 0 ? "text-positive-strong" : "text-danger"
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
