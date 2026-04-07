"use client";

import { useState, useCallback, type ReactNode } from "react";
import { PANEL, Chevron } from "./panel-primitives";

/**
 * A single sub-section inside the OmniView. Holds one of the existing
 * side panels (FootnotePanel, CitationsPanel, NotesPanel, etc.). The
 * section has its own collapse/expand toggle; when expanded, the
 * section takes a share of the OmniView's vertical space and the
 * wrapped panel renders with all of its original functionality and
 * its own header (including its own view toggle).
 */
export interface OmniSection {
  /** Stable id for this section — used for expand/collapse state. */
  id: string;
  /** Short label shown in the collapsed-section header. */
  label: string;
  /** Badge count shown next to the label. */
  count?: number;
  /** Renders the actual sub-panel. Only called when the section is expanded. */
  render: () => ReactNode;
}

interface OmniViewPanelProps {
  side: "left" | "right";
  sections: OmniSection[];
}

/**
 * OmniView aggregates multiple side panels into a single stacked view.
 *
 * Each section can be collapsed to a slim header bar; expanded sections
 * share the remaining vertical space equally (flex: 1 1 0). This way
 * the user can see several panels at once, or focus on just one by
 * collapsing the others.
 *
 * The wrapped panels keep their full original functionality — their
 * own headers, view toggles, click handlers, drag-and-drop, and so on
 * — because we're rendering the real panel components as-is.
 */
export default function OmniViewPanel({ side, sections }: OmniViewPanelProps) {
  const storageKey = `virgil-omni-collapsed-${side}`;

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });

  const toggle = useCallback(
    (id: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {}
        return next;
      });
    },
    [storageKey],
  );

  const expandedCount = sections.filter((s) => !collapsed.has(s.id)).length;

  return (
    <div className="w-full h-full bg-[var(--background)] flex flex-col overflow-hidden min-h-0">
      {/* OmniView title strip — compact, above all sub-sections */}
      <div className={`${PANEL.header} flex items-center`}>
        <h3 className="text-sm font-semibold text-stone-700">
          OmniView
          <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">
            ({side === "left" ? "left" : "right"})
          </span>
        </h3>
      </div>

      {/* Stacked sub-sections. When all are expanded, each gets an
          equal share of the remaining vertical space via flex: 1 1 0.
          Collapsed sections show just their header bar. */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {sections.map((section) => {
          const isCollapsed = collapsed.has(section.id);
          return (
            <div
              key={section.id}
              className="flex flex-col min-h-0 border-t border-[var(--border)] first:border-t-0"
              style={
                isCollapsed
                  ? { flex: "0 0 auto" }
                  : { flex: "1 1 0", minHeight: 0 }
              }
            >
              {/* Collapsed-section header bar — single line. When the
                  section is expanded, the wrapped panel renders its OWN
                  header, so we hide this bar entirely to avoid duplicate
                  titles. Only show our bar when collapsed. */}
              {isCollapsed && (
                <button
                  onClick={() => toggle(section.id)}
                  className="shrink-0 flex items-center gap-1.5 w-full px-3 py-1.5 text-left bg-stone-50/50 hover:bg-stone-100 transition-colors"
                >
                  <Chevron expanded={false} />
                  <span className="text-xs font-semibold text-stone-700">
                    {section.label}
                  </span>
                  {section.count != null && section.count > 0 && (
                    <span className="text-[11px] font-normal text-[var(--muted)]">
                      ({section.count})
                    </span>
                  )}
                </button>
              )}

              {/* Expanded sub-panel. We render the real panel component,
                  wrapped in a container that gives it a bounded height.
                  A thin gutter button in the wrapper lets users collapse
                  the section without having to find its own header. */}
              {!isCollapsed && (
                <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
                  {/* Tiny collapse affordance — anchored top-right of the
                      sub-panel, overlays the real panel header. */}
                  <button
                    onClick={() => toggle(section.id)}
                    title={`Collapse ${section.label}`}
                    aria-label={`Collapse ${section.label}`}
                    className="absolute top-1 right-1 z-10 p-1 rounded text-[var(--muted)] hover:text-stone-700 hover:bg-stone-100 transition-colors"
                    style={{ transform: "rotate(90deg)" }}
                  >
                    <Chevron expanded={true} />
                  </button>
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {section.render()}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {expandedCount === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--muted)] italic">
            All sections collapsed — click a header to expand.
          </div>
        )}
      </div>
    </div>
  );
}
