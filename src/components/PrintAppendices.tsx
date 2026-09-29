"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { PRINT_PANEL_ORDER, type PrintOptions, type PrintPanelKey } from "@/lib/print";
import {
  getPrintActivation,
  getPrintIntent,
  notifyAppendicesReady,
  subscribePrintIntent,
} from "@/lib/print-intent";

const isPrintActive = () => getPrintIntent().active;

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
  // Ack each print ACTIVATION one frame after the commit that rendered it,
  // so runPrint's await resolves only once the appendix DOM for these
  // options exists. Keyed on the activation, not the mount (task 845): with
  // the print gate OFF this tree is mounted long before any print, and with
  // it ON a second request while an intent is still active doesn't remount.
  const activation = useSyncExternalStore(
    subscribePrintIntent,
    getPrintActivation,
    getPrintActivation,
  );
  const active = useSyncExternalStore(subscribePrintIntent, isPrintActive, isPrintActive);
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => notifyAppendicesReady());
    return () => cancelAnimationFrame(raf);
  }, [active, activation]);

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
