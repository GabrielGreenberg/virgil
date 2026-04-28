"use client";

import type { ReactNode } from "react";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import type { PrintOptions, PrintPanelKey } from "@/lib/print";

interface PrintAppendicesProps {
  options: PrintOptions;
  /** Returns the panel's React node for the given panel kind. EditorLayout
   *  passes its own `renderPanelWithChrome` here so each appendix reuses
   *  the live panel's component tree (and data hooks) without
   *  re-implementing per-panel rendering. */
  renderPanel: (kind: PrintPanelKey) => ReactNode;
}

const PANEL_ORDER: PrintPanelKey[] = [
  "footnotes",
  "bibliography",
  "citations",
  "notes",
  "quotations",
  "examples",
  "todo",
  "archive",
  "revisions",
  "cutter",
  "errors",
];

export default function PrintAppendices({
  options,
  renderPanel,
}: PrintAppendicesProps) {
  return (
    <div className="print-only" aria-hidden="true">
      {PANEL_ORDER.filter((kind) => options.panels[kind]).map((kind) => (
        <section
          key={kind}
          data-print-appendix={kind}
          className="px-8 py-6"
        >
          <h2 className="text-lg font-semibold mb-3">
            {PANEL_REGISTRY[kind].label}
          </h2>
          <div className="print-appendix-body">{renderPanel(kind)}</div>
        </section>
      ))}
    </div>
  );
}
