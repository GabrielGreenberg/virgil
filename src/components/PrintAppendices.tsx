"use client";

import { useEffect, type ReactNode } from "react";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { PRINT_PANEL_ORDER, type PrintOptions, type PrintPanelKey } from "@/lib/print";
import { notifyAppendicesReady } from "@/lib/print-intent";

interface PrintAppendicesProps {
  options: PrintOptions;
  /** Returns the panel's React node for the given panel kind. EditorLayout
   *  passes its own `renderPanelWithChrome` here so each appendix reuses
   *  the live panel's component tree (and data hooks) without
   *  re-implementing per-panel rendering. */
  renderPanel: (kind: PrintPanelKey) => ReactNode;
}

export default function PrintAppendices({
  options,
  renderPanel,
}: PrintAppendicesProps) {
  // Ack the print-intent store one frame after commit, so runPrint's
  // await resolves only once the appendix DOM actually exists (perf Wave 0:
  // this tree mounts only during an active print).
  useEffect(() => {
    const raf = requestAnimationFrame(() => notifyAppendicesReady());
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="print-only" aria-hidden="true">
      {PRINT_PANEL_ORDER.filter((kind) => options.panels[kind]).map((kind) => (
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
