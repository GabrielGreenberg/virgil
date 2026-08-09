"use client";

/**
 * The "View Active / View Archives / View All" radio section that every card
 * panel drops into its three-dot (`ItemMenu`) header menu. Reads + writes the
 * shared `CardArchiveViewContext` (provided by EditorPane from the single
 * `useViewPrefs` instance), so it stays in lockstep with the `CardListPanel`
 * filter for the same panel. Distinct from the text-object Archive PANEL.
 */

import { MenuSeparator } from "@/components/menu/MenuChrome";
import { useCardArchiveView, type CardArchiveView } from "./card-archive-view";
import type { PanelKind } from "./types";

const OPTIONS: { mode: CardArchiveView; label: string }[] = [
  { mode: "active", label: "View Active" },
  { mode: "archived", label: "View Archives" },
  { mode: "all", label: "View All" },
];

export function CardViewModeMenuItems({ kind }: { kind: PanelKind }) {
  const { getView, setView } = useCardArchiveView();
  const current = getView(kind);
  return (
    <>
      <MenuSeparator />
      {OPTIONS.map((o) => {
        const selected = current === o.mode;
        return (
          <button
            key={o.mode}
            // mousedown (not click) so the option lands before ItemMenu's
            // click-outside dismissal fires — matches MenuDelete.
            onMouseDown={(e) => {
              e.preventDefault();
              setView(kind, o.mode);
            }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
              selected
                ? "text-ink-body font-medium"
                : "text-ink-muted hover:bg-surface-muted-strong"
            }`}
            aria-pressed={selected}
          >
            <span className="w-3 inline-flex justify-center">
              {selected ? (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : null}
            </span>
            {o.label}
          </button>
        );
      })}
    </>
  );
}
