"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearPanelColor,
  DEFAULT_PANEL_COLORS,
  PRESET_COLORS,
  setPanelColor,
  type PanelThemeKey,
} from "@/lib/panel-theme";
import { usePanelColor, useIsPanelColorOverridden } from "@/hooks/usePanelTheme";

/**
 * Color-picker swatch for per-panel theming. Renders a small color box that
 * reflects the current theme color; clicking opens a popover with preset
 * swatches + a "reset to default" action.
 *
 * Designed to sit next to the ViewToggle inside a panel's header menu.
 */
export default function PanelThemePicker({
  panelKey,
  label,
}: {
  panelKey: PanelThemeKey;
  label?: string;
}) {
  const current = usePanelColor(panelKey);
  const isOverridden = useIsPanelColorOverridden(panelKey);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const pick = useCallback(
    (hex: string) => {
      if (hex.toLowerCase() === DEFAULT_PANEL_COLORS[panelKey].toLowerCase()) {
        clearPanelColor(panelKey);
      } else {
        setPanelColor(panelKey, hex);
      }
      setOpen(false);
    },
    [panelKey],
  );

  const onReset = useCallback(() => {
    clearPanelColor(panelKey);
    setOpen(false);
  }, [panelKey]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onMouseDown={(e) => e.stopPropagation()}
        title={label ?? "Panel color"}
        className="w-5 h-5 rounded border border-edge-hover shadow-inner shrink-0 hover:ring-2 hover:ring-stone-200 transition-shadow"
        style={{ background: current }}
      />
      {open && (
        <div
          className="absolute right-0 top-full mt-1 bg-surface border border-[var(--border)] rounded-md shadow-lg p-2 z-[9999]"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-7 gap-1 w-[168px]">
            {PRESET_COLORS.map((c) => {
              const active = c.hex.toLowerCase() === current.toLowerCase();
              return (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => pick(c.hex)}
                  title={c.name}
                  className={`w-5 h-5 rounded border transition-transform hover:scale-110 ${active ? "ring-2 ring-offset-1 ring-stone-500" : "border-edge-hover"}`}
                  style={{ background: c.hex }}
                />
              );
            })}
          </div>
          {isOverridden && (
            <button
              type="button"
              onClick={onReset}
              className="mt-2 w-full text-[11px] text-ink-subtle hover:text-ink-body px-2 py-1 rounded hover:bg-surface-muted"
            >
              Reset to default
            </button>
          )}
        </div>
      )}
    </div>
  );
}
