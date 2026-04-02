"use client";

export type ViewMode = "in-text" | "list";

// Page-with-text icon for "in-text" view
function IconInText({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={active ? "var(--accent)" : "#a8a39d"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="1" width="12" height="14" rx="1.5" />
      <path d="M5 4.5h6" />
      <path d="M5 7h6" />
      <path d="M5 9.5h4" />
    </svg>
  );
}

// Bullet list icon for "list" view
function IconListView({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={active ? "var(--accent)" : "#a8a39d"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="3" cy="4" r="1" fill={active ? "var(--accent)" : "#a8a39d"} stroke="none" />
      <path d="M6 4h8" />
      <circle cx="3" cy="8" r="1" fill={active ? "var(--accent)" : "#a8a39d"} stroke="none" />
      <path d="M6 8h8" />
      <circle cx="3" cy="12" r="1" fill={active ? "var(--accent)" : "#a8a39d"} stroke="none" />
      <path d="M6 12h6" />
    </svg>
  );
}

interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export default function ViewToggle({ mode, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center bg-stone-100 rounded p-0.5 gap-0.5">
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onChange("in-text"); }}
        className={`p-1 rounded transition-colors ${
          mode === "in-text" ? "bg-white shadow-sm" : "hover:bg-stone-50"
        }`}
        title="In-text view"
      >
        <IconInText active={mode === "in-text"} />
      </button>
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onChange("list"); }}
        className={`p-1 rounded transition-colors ${
          mode === "list" ? "bg-white shadow-sm" : "hover:bg-stone-50"
        }`}
        title="List view"
      >
        <IconListView active={mode === "list"} />
      </button>
    </div>
  );
}
