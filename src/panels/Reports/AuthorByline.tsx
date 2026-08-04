"use client";

import { AuthorChip } from "@/panels/_shared/suggestion-fields";

/** Author + timestamp byline for Report cards.
 *
 *  Composes the shared `AuthorChip` pill ("AI" / "Human") — the same primitive
 *  the Cutter and Revision suggestion cards render — and adds the card's
 *  createdAt as a compact timestamp. Only Reports carry a byline; Report
 *  Requests (the user's "ask") never do. We never display "Claude" —
 *  AI-authored reports read as "AI", matching the Revisions convention. */
export function AuthorByline({
  author,
  createdAt,
}: {
  author: "human" | "ai";
  createdAt: string;
}) {
  const when = formatByline(createdAt);
  return (
    <div className="px-3 pb-2 flex items-center gap-1.5">
      <AuthorChip author={author} />
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
