"use client";

/**
 * Small "Sam · 12s" pill rendered in a card's chrome when the partner has
 * focus-claimed it. The colored dot matches the partner's collaborator
 * color so multiple participants are visually distinct.
 */

import { useEffect, useState } from "react";

interface CollabClaimPillProps {
  holder: string;
  color: string;
  /** When the partner first focused. Drives the seconds counter. */
  focusedAt?: string;
}

export default function CollabClaimPill({ holder, color, focusedAt }: CollabClaimPillProps) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  let label = holder;
  if (focusedAt) {
    const sec = Math.max(0, Math.floor((Date.now() - Date.parse(focusedAt)) / 1000));
    label = sec < 5 ? `${holder} · just now` : sec < 60 ? `${holder} · ${sec}s` : `${holder} · ${Math.floor(sec / 60)}m`;
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0"
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
      }}
      title="Co-author is editing this card"
    >
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
