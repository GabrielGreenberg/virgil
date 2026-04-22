"use client";

import ErrorsPanel from "@/panels/Errors";
import type { LatexError } from "@/lib/latex-errors";

export interface ErrorsHostProps {
  errors: LatexError[];
  onJumpToLine: (line: number, column?: number) => void;
}

export function ErrorsHost(p: ErrorsHostProps) {
  return <ErrorsPanel errors={p.errors} onJumpToLine={p.onJumpToLine} />;
}
