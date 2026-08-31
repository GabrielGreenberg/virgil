"use client";

import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";
import {
  PRINT_FONT_LABELS,
  PRINT_FONT_SIZES,
  PRINT_PANEL_ORDER,
  runPrint,
  type PrintElementKey,
  type PrintOptions,
  type PrintPanelKey,
} from "@/lib/print";
import { PANEL_REGISTRY } from "@/panels/panel-registry";

interface PrintDialogProps {
  open: boolean;
  onClose: () => void;
  options: PrintOptions;
  onOptionsChange: (next: PrintOptions) => void;
  /** Whether marginalia margins are currently rendered live. When false
   *  the print toggle for marginalia is disabled (the margins can't be
   *  conjured into the DOM at print time). */
  marginaliaLive: boolean;
}

const ELEMENT_GROUPS: {
  legend: string;
  rows: { key: PrintElementKey; label: string }[];
}[] = [
  {
    legend: "Document",
    rows: [
      { key: "title", label: "Title / author" },
      { key: "sectionNumbers", label: "Section numbers" },
      { key: "latexComments", label: "LaTeX comments" },
    ],
  },
  {
    legend: "Apparatus",
    rows: [
      { key: "footnoteMarkers", label: "Footnote markers" },
      { key: "citations", label: "Citations" },
      { key: "examples", label: "Examples" },
      { key: "displayMath", label: "Display math" },
    ],
  },
  {
    legend: "Margin",
    rows: [
      { key: "marginalia", label: "Marginalia markers" },
      { key: "linkedAnchorUnderlines", label: "Linked-anchor underlines" },
    ],
  },
];

// Derived from the printable-panel SSOT (PRINT_PANEL_ORDER); labels come from
// PANEL_REGISTRY[k].label — no hand-written duplication. `reports` (and any
// future printable panel) appears here by construction.
const PANEL_ROWS: { key: PrintPanelKey; label: string }[] = PRINT_PANEL_ORDER.map(
  (key) => ({ key, label: PANEL_REGISTRY[key].label }),
);

export default function PrintDialog({
  open,
  onClose,
  options,
  onOptionsChange,
  marginaliaLive,
}: PrintDialogProps) {
  const setElement = (key: PrintElementKey, value: boolean) =>
    onOptionsChange({
      ...options,
      elements: { ...options.elements, [key]: value },
    });
  const setPanel = (key: PrintPanelKey, value: boolean) =>
    onOptionsChange({
      ...options,
      panels: { ...options.panels, [key]: value },
    });
  const setFontSize = (rem: number) =>
    onOptionsChange({ ...options, fontSizeRem: rem });

  const handlePrint = async () => {
    onClose();
    // Defer one frame so React commits the close (and unmounts the dialog
    // overlay) before we open the OS print sheet.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    runPrint(options);
  };

  return (
    <SystemDialog
      open={open}
      onClose={onClose}
      size="md"
      labelledBy="print-dialog-title"
    >
      <SystemDialogHeader
        title="Print"
        titleId="print-dialog-title"
        subtitle="Choose what to include."
      />
      <SystemDialogBody className="space-y-3">
        {ELEMENT_GROUPS.map((group) => (
          <fieldset key={group.legend}>
            <legend className="text-xs text-ink-subtle mb-1">
              {group.legend}
            </legend>
            <div className="space-y-1">
              {group.rows.map((row) => {
                const isMarginalia = row.key === "marginalia";
                const disabled = isMarginalia && !marginaliaLive;
                return (
                  <PrintCheckbox
                    key={row.key}
                    label={row.label}
                    checked={options.elements[row.key]}
                    onChange={(v) => setElement(row.key, v)}
                    disabled={disabled}
                    title={
                      disabled
                        ? "Enable marginalia in the editor first."
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </fieldset>
        ))}

        <fieldset>
          <legend className="text-xs text-ink-subtle mb-1">
            Include panels as appendices
          </legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {PANEL_ROWS.map((row) => (
              <PrintCheckbox
                key={row.key}
                label={row.label}
                checked={options.panels[row.key]}
                onChange={(v) => setPanel(row.key, v)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs text-ink-subtle mb-1">Font size</legend>
          <div className="flex items-center gap-1">
            {PRINT_FONT_SIZES.map((size, i) => {
              const active = Math.abs(options.fontSizeRem - size) < 0.001;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => setFontSize(size)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    active
                      ? "bg-[var(--control-selected)] text-white border-[var(--control-selected)]"
                      : "bg-surface border-edge-subtle text-ink-body hover-on-light"
                  }`}
                >
                  {PRINT_FONT_LABELS[i]}
                </button>
              );
            })}
            <span className="ml-2 text-xs text-ink-muted tabular-nums">
              {options.fontSizeRem.toFixed(2)}rem
            </span>
          </div>
        </fieldset>
      </SystemDialogBody>
      <SystemDialogFooter>
        <SystemDialogButton variant="secondary" onClick={onClose}>
          Cancel
        </SystemDialogButton>
        <SystemDialogButton variant="primary" autoFocus onClick={handlePrint}>
          Print
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}

function PrintCheckbox({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      data-hint={title}
      className={`flex items-center gap-2 text-xs text-left w-full px-1 py-0.5 rounded ${
        disabled ? "opacity-40 cursor-not-allowed" : "hover-on-light"
      }`} aria-label={title}
    >
      <span
        className={`flex items-center justify-center w-4 h-4 rounded border ${
          checked
            ? "bg-[var(--accent)] border-[var(--accent)]"
            : "bg-surface border-edge-strong"
        }`}
      >
        {checked && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <span className="text-ink-body">{label}</span>
    </button>
  );
}
