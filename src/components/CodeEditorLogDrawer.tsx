"use client";

import CompileLogDisclosure from "./CompileLogDisclosure";

interface Props {
  log: string | null;
  status: number | null;
  isCompiling: boolean;
}

/**
 * The code-view compile-log drawer. Now a thin wrapper over the shared
 * `CompileLogDisclosure` (P5) so the drawer and the docked Errors-panel
 * disclosure share ONE implementation. Keeps the drawer's auto-open-on-nonzero
 * behavior via `defaultOpenOnError`.
 */
export default function CodeEditorLogDrawer({ log, status, isCompiling }: Props) {
  return (
    <CompileLogDisclosure
      log={log}
      status={status}
      isCompiling={isCompiling}
      defaultOpenOnError
    />
  );
}
