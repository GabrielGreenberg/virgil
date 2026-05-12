import { type SectionPathEntry } from "@/panels/Outline";

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)) + "…";
}

// Deepest entry (the user's current section) gets the fullest treatment.
// The immediate parent gets moderate space. Older ancestors are tight.
function getCharLimit(indexFromEnd: number): number {
  if (indexFromEnd === 0) return 40;
  if (indexFromEnd === 1) return 24;
  return 14;
}

/**
 * Plain-text section-path indicator. Rendered in the chrome strip above
 * the editor pod by the parent wrapper. Renders nothing when the path is
 * empty (no heading has scrolled past the reference line yet).
 */
export function SectionLozenge({ sectionPath }: { sectionPath: SectionPathEntry[] }) {
  if (sectionPath.length === 0) return null;
  return (
    <div
      className="pointer-events-none text-[11px] whitespace-nowrap max-w-full truncate"
      style={{ color: "var(--muted, #857c70)" }}
    >
      {sectionPath.map((entry, i) => {
        const indexFromEnd = sectionPath.length - 1 - i;
        return (
          <span key={i}>
            {i > 0 && <span className="mx-1 opacity-50">›</span>}
            {entry.sectionNumber && (
              <span className="opacity-60 mr-1">{entry.sectionNumber}</span>
            )}
            <span className={i === sectionPath.length - 1 ? "font-medium" : "opacity-80"}>
              {truncateText(entry.text, getCharLimit(indexFromEnd))}
            </span>
          </span>
        );
      })}
    </div>
  );
}
