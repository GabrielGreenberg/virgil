import { PanelId } from "@/hooks/useViewPrefs";
import { PANEL_REGISTRY } from "@/panels/panel-registry";

export function IconNotes({ active, size = 18 }: { active?: boolean; size?: number }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

// Highlighter pen — chunky marker tip with a swept underline beneath so
// the icon reads as "drag this across text and it leaves yellow."
export function IconHighlight({ active, size = 18 }: { active?: boolean; size?: number }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 4 L20 9 L13 16 L8 16 L8 11 Z" />
      <path d="M8 16 L6 18 L8 20 L10 18 Z" />
      <line x1="3" y1="22" x2="21" y2="22" strokeWidth="2.5" />
    </svg>
  );
}

export function IconRevisions({ active, size = 18 }: { active?: boolean; size?: number }) {
  const c = active ? "var(--accent)" : "currentColor";
  const cx = 12, cy = 12, r = 8;
  const gap = (14 * Math.PI) / 180;
  const N = 28;
  const pt = (t: number) => `${cx + r * Math.cos(t)} ${cy + r * Math.sin(t)}`;
  const renderArc = (tStart: number, tEnd: number, key: string) => {
    const dt = (tEnd - tStart) / N;
    const segs = [];
    for (let i = 0; i < N; i++) {
      const a = tStart + i * dt;
      const b = tStart + (i + 1) * dt;
      const u = (i + 1) / N;
      const opacity = Math.pow(u, 0.6);
      const isHead = i === N - 1;
      segs.push(
        <path
          key={`${key}-${i}`}
          d={`M ${pt(a)} A ${r} ${r} 0 0 1 ${pt(b)}`}
          stroke={c}
          strokeOpacity={opacity}
          strokeWidth="3.25"
          strokeLinecap={isHead ? "round" : "butt"}
          fill="none"
        />
      );
    }
    return segs;
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <g transform="rotate(45 12 12)">
        {renderArc(Math.PI + gap, 2 * Math.PI - gap, "top")}
        {renderArc(gap, Math.PI - gap, "bot")}
      </g>
    </svg>
  );
}

export function IconFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// Outline icon: headline + two indented bullet+line sub-items
export function IconOutline({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16" />
      <rect x="5.5" y="10.5" width="3" height="3" rx="0.75" fill={c} stroke="none" />
      <path d="M11 12h9" />
      <rect x="5.5" y="17.5" width="3" height="3" rx="0.75" fill={c} stroke="none" />
      <path d="M11 19h7" />
    </svg>
  );
}

export function IconArchive({ active, size = 18 }: { active?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </svg>
  );
}

// Two overlapping rounded rectangles — standard "copy / duplicate" affordance.
export function IconDuplicate({ active, size = 18 }: { active?: boolean; size?: number }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// Trash can — lid + body with two vertical guides for the destructive Delete action.
export function IconTrash({ active, size = 18 }: { active?: boolean; size?: number }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

// Footnote icon: "fn" in regular weight, larger
export function IconFootnote({ active, size = 18 }: { active?: boolean; size?: number }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill={c}>
      <text x="2" y="15.5" fontSize="15" fontWeight="600" fontFamily="system-ui, sans-serif">fn</text>
    </svg>
  );
}

// Citation icon: open book with bookmark ribbon
export function IconCitation({ active, size = 18 }: { active?: boolean; size?: number }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Page body */}
      <path d="M9 6h9l3 3v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      {/* Page fold */}
      <path d="M18 6v3h3" />
      {/* Arrow shaft going up-left off the page, base at mid-page */}
      <path d="M13 15L3 3" />
      {/* Arrow head — well clear of page */}
      <path d="M7 3H3v4" />
    </svg>
  );
}

export function IconBibliography({ active, size = 18 }: { active?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8" />
      <path d="M8 12h6" />
    </svg>
  );
}

// Library icon — a shelf of upright books with the rightmost leaning
// left, resting against its neighbor. Each book is a solid block of
// color at a different opacity so they read as distinct spines.
export function IconLibrary() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      {/* Book 1 — upright */}
      <rect x="3" y="5" width="4" height="15" rx="0.6" fill="currentColor" fillOpacity="0.6" />
      {/* Book 2 — upright, taller */}
      <rect x="8" y="3" width="4" height="17" rx="0.6" fill="currentColor" fillOpacity="0.6" />
      {/* Book 3 — leaning LEFT, top resting against Book 2 */}
      <path d="M12 5 L16 5 L20 20 L16 20 Z" fill="currentColor" fillOpacity="0.6" />
    </svg>
  );
}

// Todo icon: checkmarks with lines
export function IconTodo({ active, size = 18 }: { active?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l2.5 2.5L11 5" />
      <path d="M14 7h7" />
      <path d="M4 17l2.5 2.5L11 15" />
      <path d="M14 17h7" />
    </svg>
  );
}

export function IconCutter({ active, size = 18 }: { active?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88" />
      <path d="M14.47 14.48L20 20" />
      <path d="M8.12 8.12L12 12" />
    </svg>
  );
}

// Reports icon — a squircle speech balloon with short ruled text lines,
// reading as "a written response/commentary." Modeled on IconOmni's
// rounded-rect-plus-lines, but with a higher corner radius + a downward
// tail + varied line lengths so it stays visually distinct from the omni
// square. In margin mode (hideFrame) the balloon outline + tail are dropped
// so the centered text lines still read at 16px in the margin.
export function IconReports({ active, size = 18, hideFrame }: { active?: boolean; size?: number; hideFrame?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {!hideFrame && (
        // Squircle speech balloon with an integral tail at the lower-left:
        // ONE continuous outline path (the bottom-left corner pulls down into
        // the tail point) so it reads as an outline, not a filled wedge.
        <path d="M7 4H17A4 4 0 0 1 21 8V13A4 4 0 0 1 17 17H7L3 21V8A4 4 0 0 1 7 4Z" />
      )}
      {/* Two text lines, vertically centered in the bubble body */}
      <line x1="7" y1="9" x2="17" y2="9" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  );
}

export function IconSearch({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

export function IconSplit({ active, focusedHalf }: { active?: boolean; focusedHalf?: "top" | "bottom" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Shaded half indicating which pane is focused */}
      {active && focusedHalf === "top" && (
        <rect x="4" y="4" width="16" height="8" fill="currentColor" fillOpacity="0.35" stroke="none" rx="1" />
      )}
      {active && focusedHalf === "bottom" && (
        <rect x="4" y="12" width="16" height="8" fill="currentColor" fillOpacity="0.35" stroke="none" rx="1" />
      )}
      {/* Outline + single divider line */}
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}

export function IconWordCount({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill={c}>
      <text x="3" y="15.5" fontSize="16" fontWeight="700" fontFamily="system-ui, sans-serif">#</text>
    </svg>
  );
}

// OmniView icon: rounded square with three equal-length horizontal
// lines inside, signaling "all panel content threaded together".
export function IconOmni({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c}
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <line x1="7" y1="8" x2="17" y2="8" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="7" y1="16" x2="17" y2="16" />
    </svg>
  );
}

// Blank icon: rounded square with a dashed interior, signaling
// "suppress omni — leave a truly empty canvas on this side".
export function IconBlank({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c}
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="1.5" strokeDasharray="2.5 2.5" />
    </svg>
  );
}

// Exclamation in a triangle — for the "Errors" panel (live LaTeX lint
// + parsed compile log).
export function IconErrors({ active, size = 18 }: { active?: boolean; size?: number }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c}
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 L22 20 L2 20 Z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </svg>
  );
}

// Literal "(1)" glyph used for every mention of the expex Examples feature —
// strip button, Action toolbar, Format-popover control. SVG text mirrors
// the sizing of IconFootnote (`fn`): 18×18 render in a 20-unit viewBox,
// baseline at y=15.5, fontSize=15, fontWeight=600. The "1" itself is set
// in the document's serif to echo how expex numbers render in the text
// (section numbers + example numbers both read as serif digits).
export function IconExample({
  active,
  size = 18,
}: {
  active?: boolean;
  size?: number;
}) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={c}
      aria-hidden
    >
      <text
        x="10"
        y="15.5"
        textAnchor="middle"
        fontSize="15"
        fontWeight="600"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        (1)
      </text>
    </svg>
  );
}

// Lightning-bolt glyph used on the action triggers that expand into the
// SelectionActionsMenu. The contextual margin trigger uses the filled
// yellow variant (default); the stable MenuBar-strip trigger passes
// `muted` to get a stroked currentColor outline that inherits the
// strip's ink-muted/hover-ink-body palette like its sibling buttons.
export function IconZap({ size = 16, muted = false }: { size?: number; muted?: boolean }) {
  if (muted) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 L4 14 H11 L10 22 L20 9 H13 Z" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#eab308" stroke="#a16207" strokeWidth="1.25" strokeLinejoin="round">
      <path d="M13 2 L4 14 H11 L10 22 L20 9 H13 Z" />
    </svg>
  );
}

// Per-panel-id icon renderer for the strip + omni button. Labels for
// these ids come from PANEL_REGISTRY (or the "Blank" fallback below);
// only the icon factory lives here, since icons reference local
// components and aren't part of the registry.
export const PANEL_ICONS: Record<PanelId, (active: boolean) => React.ReactNode> = {
  outline: (a) => <IconOutline active={a} />,
  todo: (a) => <IconTodo active={a} />,
  notes: (a) => <IconNotes active={a} />,
  revisions: (a) => <IconRevisions active={a} />,
  archive: (a) => <IconArchive active={a} />,
  footnotes: (a) => <IconFootnote active={a} />,
  citations: (a) => <IconCitation active={a} />,
  bibliography: (a) => <IconBibliography active={a} />,
  cutter: (a) => <IconCutter active={a} />,
  reports: (a) => <IconReports active={a} />,
  examples: (a) => <IconExample active={a} />,
  search: (a) => <IconSearch active={a} />,
  wordcount: (a) => <IconWordCount active={a} />,
  errors: (a) => <IconErrors active={a} />,
  blank: () => null,
  omni: (a) => <IconOmni active={a} />,
};

/** Display label for a panel id. Reads from PANEL_REGISTRY for real
 *  panels and falls back for the layout-only "blank" slot. */
export function panelLabel(id: PanelId): string {
  if (id === "blank") return "Blank";
  return PANEL_REGISTRY[id].label;
}
