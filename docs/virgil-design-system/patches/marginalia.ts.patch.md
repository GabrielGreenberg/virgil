# patches/marginalia.ts.patch.md

Sweep `MARKER_META` so each marker's color matches its panel theme's
accent. Apply as part of **Pass 6**.

The current `MARKER_META` rows have hand-rolled `color` / `bg` /
`selectedBg` / `border` quartets, with hex literals that (mostly)
match the panel theme but drift in places. After this patch, each
marker reads its accent from `DEFAULT_PANEL_COLORS` and derives the
quartet via `markerPaletteFromAccent`.

---

## Replace `MARKER_META` in `src/lib/marginalia.ts`

```ts
import { DEFAULT_PANEL_COLORS, markerPaletteFromAccent } from "@/lib/panel-theme";
import * as React from "react";
import {
  IconQuotations,
  IconNotes,
  IconArchive,
  IconRevisions,
  IconCutter,
  IconTodo,
  IconErrors,
} from "@/components/editor-layout/panel-icons";

const MARGIN_ICON_SIZE = 16;

const QuoteIcon    = React.createElement(IconQuotations, { size: MARGIN_ICON_SIZE, hideFrame: true });
const NoteIcon     = React.createElement(IconNotes,      { size: MARGIN_ICON_SIZE });
const ArchiveIcon  = React.createElement(IconArchive,    { size: MARGIN_ICON_SIZE });
const RevisionIcon = React.createElement(IconRevisions,  { size: MARGIN_ICON_SIZE });
const CutIcon      = React.createElement(IconCutter,     { size: MARGIN_ICON_SIZE });
const TodoIcon     = React.createElement(IconTodo,       { size: MARGIN_ICON_SIZE });
const ErrorIcon    = React.createElement(IconErrors,     { size: MARGIN_ICON_SIZE });

/** Build a MARKER_META row from a panel-theme accent. */
function meta(
  accentKey: keyof typeof DEFAULT_PANEL_COLORS,
  base: { label: string; panelId: PanelId; defaultSide: "left" | "right"; icon: React.ReactNode },
): MarkerMeta {
  const palette = markerPaletteFromAccent(DEFAULT_PANEL_COLORS[accentKey]);
  return { ...base, ...palette };
}

export const MARKER_META: Record<MarkerType, MarkerMeta> = {
  quote:    meta("quote",    { label: "Quotation", panelId: "quotations", defaultSide: "left",  icon: QuoteIcon }),
  note:     meta("note",     { label: "Note",      panelId: "notes",      defaultSide: "right", icon: NoteIcon }),
  archive:  meta("archive",  { label: "Archived",  panelId: "archive",    defaultSide: "right", icon: ArchiveIcon }),
  revision: meta("revision", { label: "Revision",  panelId: "revisions",  defaultSide: "right", icon: RevisionIcon }),
  cut:      meta("cut",      { label: "Cut",       panelId: "cutter",     defaultSide: "right", icon: CutIcon }),
  todo:     meta("todo",     { label: "Todo",      panelId: "todo",       defaultSide: "right", icon: TodoIcon }),
  error:    meta("footnote", { label: "Error",     panelId: "errors",     defaultSide: "right", icon: ErrorIcon }),
  // Note: error reuses the footnote rust accent intentionally — same
  // color family, distinguished by the icon glyph.
};
```

## What this changes per row

| Marker | Old `color` | New `color` | Old `selectedBg` | New `selectedBg` |
|---|---|---|---|---|
| quote | `#a16207` | `#a16207` (same) | `#fde68a` | derived |
| note | `#15803d` | same | `#bbf7d0` | derived |
| archive | `#5a7a99` | `#7191b0` (matches panel theme) | `#dbeafe` | derived |
| revision | `#9333ea` | same | `#e9d5ff` | derived |
| cut | `#b45757` | same | `#fecaca` | derived |
| todo | `#44403c` | same | `#d6d3d1` | derived |
| error | `#b45757` | same (via footnote) | `#fecaca` | derived |

Most markers don't visually change. The `archive` marker shifts from
the slightly-off `#5a7a99` to the canonical `#7191b0` — a deliberate
correction of one of the audit drifts.

## Verify

- Every marginalia gutter icon renders. Hover and selected states still
  read clearly.
- The `archive` marker's color now exactly matches the `archive` panel
  theme (it didn't quite before).
- No other visual changes.

## Follow-up

User-picked panel colors should also re-theme the marginalia marker
for that panel. The `Marginalia.tsx` consumer reads `MARKER_META` for
the resting palette but should prefer `markerPaletteFromAccent(userColor)`
when a user override is set. Wire this in the same pass:

```ts
// In Marginalia.tsx, where it currently does:
const meta = MARKER_META[marker.type];
const paletteHex = userColorForPanel[meta.panelId];
const palette = paletteHex ? markerPaletteFromAccent(paletteHex) : meta;
// then read palette.color, palette.bg, palette.selectedBg, palette.border
```
