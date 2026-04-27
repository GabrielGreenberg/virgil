"use client";

import type { ExampleInfo } from "@/components/Editor";
import {
  PanelCard,
  BadgeLabel,
  CardTargetIcon,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";

export interface ExampleCardProps {
  example: ExampleInfo;
  isSelected: boolean;
  onSelect: () => void;
  onJump: () => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
}

/** Panel card for a single `\ex` / `\pex` block. Examples live in the
 *  main editor — this card is a catalog entry that shows the number, tag,
 *  label, and a preview, with a jump-to-target icon. */
export function ExampleCard({
  example,
  isSelected,
  onSelect,
  onJump,
  onTogglePopout,
  isPoppedOut,
}: ExampleCardProps) {
  const theme = useCardTheme("example");
  const bodyStyle = usePanelBodyStyle("example");
  const kindLabel = example.kind === "multi" ? "\\pex" : "\\ex";

  return (
    <PanelCard
      theme={theme}
      selected={isSelected}
      onClick={onSelect}
      onTogglePopout={onTogglePopout}
      isPoppedOut={isPoppedOut}
      data-link-card={`example:${example.exampleId}`}
    >
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-light)]"
        style={{ backgroundColor: isSelected ? theme.headerSelected : theme.headerDefault }}
      >
        <BadgeLabel
          label={example.number || "?"}
          theme={theme}
        />
        <div className="flex flex-col min-w-0 flex-1">
          <div
            className="text-[10px] tracking-wide uppercase font-mono"
            style={{ color: theme.titleColor }}
          >
            {kindLabel}
            {example.subLabelRange ? ` · ${example.subLabelRange}` : ""}
          </div>
          {(example.tag || example.label) && (
            <div
              className="text-[11px] truncate font-mono"
              style={{ color: theme.titleColor }}
              title={[example.tag && `<${example.tag}>`, example.label && `\\label{${example.label}}`]
                .filter(Boolean)
                .join(" ")}
            >
              {example.tag && <span>&lt;{example.tag}&gt;</span>}
              {example.tag && example.label ? " " : ""}
              {example.label && <span>\label{"{" + example.label + "}"}</span>}
            </div>
          )}
        </div>
        <CardTargetIcon
          selected={isSelected}
          onClick={(e) => {
            e.stopPropagation();
            onJump();
          }}
          title="Jump to example"
        />
      </div>
      <div
        className="px-3 py-2 text-xs text-ink-body leading-snug line-clamp-3"
        style={{ fontFamily: "var(--font-serif), Georgia, serif", ...bodyStyle }}
      >
        {example.preview || (
          <span className="italic text-ink-muted">Empty</span>
        )}
      </div>
    </PanelCard>
  );
}
