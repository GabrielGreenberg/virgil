"use client";

/**
 * Small stacked color dots used to show partner presence (selection /
 * cursor focus) on cards and paragraphs. Different visual from the
 * claim pill — informational only, no locking implication.
 */

interface PresenceDotsProps {
  /** Partners present at this site. Empty → renders nothing. */
  presences: { name: string; color: string }[];
  /** Show name on hover. Defaults to true. */
  withTooltip?: boolean;
}

export default function CollabPresenceDots({ presences, withTooltip = true }: PresenceDotsProps) {
  if (presences.length === 0) return null;
  const title = withTooltip
    ? presences.length === 1
      ? `${presences[0].name} is here`
      : `${presences.map((p) => p.name).join(", ")} are here`
    : undefined;
  return (
    <span
      className="inline-flex items-center gap-[1px] shrink-0"
      data-hint={title}
      aria-label={title}
    >
      {presences.slice(0, 4).map((p) => (
        <span
          key={p.name}
          className="block rounded-full"
          style={{
            width: 6,
            height: 6,
            backgroundColor: p.color,
            boxShadow: "0 0 0 1px rgba(255,255,255,0.7)",
          }}
        />
      ))}
    </span>
  );
}
