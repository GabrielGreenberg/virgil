# Report margin marker shows two lines, not the full report icon — 2026-06-30

Bug-catcher session. Single item. Research only — **no code edited** (checkout is
live-driven on `pending-ai-changes`; HEAD 8400da1c at diagnosis). For the cleaning session.

## Status: `ROOT-CAUSE-FOUND` (high confidence, trivial fix)

**Symptom:** the Report card's marginalia marker renders only two short lines (a
`=`), not the full report icon (the document/balloon + lines) used in the Reports panel.

## Root cause — report is the only frame-stripped margin marker

The report marker's glyph is built at [marginalia.ts:280](src/lib/marginalia.ts#L280):
```ts
const ReportIcon = React.createElement(IconReports, { size: MARGIN_ICON_SIZE, hideFrame: true });
```
`IconReports` ([panel-icons.tsx:224-239](src/components/editor-layout/panel-icons.tsx#L224)) draws a squircle speech-balloon **outline + tail** guarded by `{!hideFrame && (…path…)}` (`:228-233`) plus two text `<line>`s (`:235-236`). With `hideFrame: true` the balloon path is dropped, leaving **only the two lines** — exactly the symptom.

Every **other** margin marker builds from its full panel icon with **no** frame-strip ([marginalia.ts:275-281](src/lib/marginalia.ts#L275)): `NoteIcon`/`ArchiveIcon`/`RevisionIcon`/`CutIcon`/`TodoIcon`/`ErrorIcon` all render their complete glyph. **Report is the lone exception** — a report-only `hideFrame: true` special-case. (The panel strip uses `IconReports` without `hideFrame` — [panel-icons.tsx:388](src/components/editor-layout/panel-icons.tsx#L388) — hence the panel shows the full icon while the margin doesn't.)

`MARKER_META.report.icon` ([marginalia.ts:340](src/lib/marginalia.ts#L340)) is the single source every report-marker surface reads (margin grid, orphan dock, re-pin drop pin), so fixing it here fixes all of them at once.

## Fix (deep = unified = trivial)

Remove `hideFrame: true` from [marginalia.ts:280](src/lib/marginalia.ts#L280) so the report margin marker renders the **full balloon+lines** like the panel and consistent with all six sibling markers:
```ts
const ReportIcon = React.createElement(IconReports, { size: MARGIN_ICON_SIZE });
```
This IS the unifying fix — it makes report obey the same "margin marker = full panel icon at MARGIN_ICON_SIZE" rule as every other type.

**Dead-code cleanup (optional, recommended):** after this, nothing passes `hideFrame: true` anymore (grep confirms marginalia.ts:280 is the only caller). The cleaning session can delete the `hideFrame` prop + the `!hideFrame &&` guard from `IconReports` (panel-icons.tsx:224,228) so the frame is unconditional — removing the very knob that caused the bug so it can't regress.

**Why `hideFrame` existed (verify live):** the comment at [panel-icons.tsx:222-223](src/components/editor-layout/panel-icons.tsx#L222) says margin mode drops the balloon "outline + tail." Presumably someone felt the balloon frame looked cramped inside the marker's own rounded-square background at 16px. The user explicitly wants the full icon, and sibling consistency backs that — but the cleaning session should eyeball the 16px balloon in the marker chip and, if it reads cramped, nudge stroke-width/size rather than re-hiding the frame.

## Live-verify (dev preview OK — server is up on :3000)
- A paragraph with a Report card → its margin marker shows the full report balloon+lines, matching the Reports panel-strip icon, at parity with note/todo/cut/etc. markers.
- Check both sides (report `defaultSide: "left"`), the orphan dock, and a re-pin drop pin — all read from `MARKER_META.report.icon`, so all should show the full icon.
- Confirm the 16px balloon isn't visually cramped inside the marker's rounded-square background; tune stroke/size if so.
