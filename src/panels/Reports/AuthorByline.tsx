"use client";

/** Author + timestamp byline for Report cards.
 *
 *  Mirrors the Revisions `AuthorChip` pill ("AI" / "Human") and adds the
 *  card's createdAt as a compact timestamp. Only Reports carry a byline;
 *  Report Requests (the user's "ask") never do. We never display "Claude" —
 *  AI-authored reports read as "AI", matching the Revisions convention. */
export function AuthorByline({
  author,
  createdAt,
}: {
  author: "human" | "ai";
  createdAt: string;
}) {
  const isAi = author === "ai";
  const when = formatByline(createdAt);
  return (
    <div className="px-3 pb-2 flex items-center gap-1.5">
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide ${
          isAi
            ? "bg-[var(--accent)]/10 text-[var(--accent)]"
            : "bg-surface-muted-strong text-ink-body"
        }`}
        title={isAi ? "AI-authored" : "Human-authored"}
      >
        {isAi ? "AI" : "Human"}
      </span>
      {when && <span className="text-[10px] text-ink-muted tabular-nums">{when}</span>}
    </div>
  );
}

function formatByline(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
