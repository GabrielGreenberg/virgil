/**
 * Collaborator-mode types, constants, and pure helpers.
 *
 * The whole collab system shares one sidecar file (`virgil/collab.json`)
 * keyed under the doc's `virgil/` folder. A second author opens the same
 * Dropbox-synced folder; their tab polls the file every few seconds. The
 * pen state coordinates `.tex` editing; per-user presence entries
 * coordinate per-card focus claims and soft awareness.
 *
 * No live-cursor co-editing — turn-taking only.
 */

/* ── Constants ────────────────────────────────────────────────────── */

export const COLLAB_SIDECAR_FILE = "collab.json";

/** localStorage key for the user's per-browser identity. */
export const COLLAB_IDENTITY_KEY = "virgil-collab-identity";

export const COLLAB_TIMINGS = {
  /** How often the pen-holder writes a heartbeat to the file. */
  penHeartbeatMs: 30_000,
  /** Active vs. idle threshold — partner shows "idle" past this. */
  penActiveMs: 60_000,
  /** Idle window before "stepped away" badge color kicks in. */
  penIdleMs: 3 * 60_000,
  /** Stale window — partner can take over after this. */
  penStaleMs: 5 * 60_000,
  /** How often the focused-card claim is heartbeat-refreshed. */
  cardHeartbeatMs: 10_000,
  /** Auto-release a focus claim if heartbeat older than this. */
  cardStaleMs: 60_000,
  /** Poll the sidecar at this rate. */
  pollMs: 5_000,
  /** Throttle activity-stamp writes to at most this often. */
  activityThrottleMs: 5_000,
};

/** Curated subset of PRESET_COLORS chosen for collaborator distinguishability. */
export const COLLAB_COLORS: { name: string; hex: string }[] = [
  { name: "Teal",   hex: "#14b8a6" },
  { name: "Sky",    hex: "#0ea5e9" },
  { name: "Indigo", hex: "#6366f1" },
  { name: "Pink",   hex: "#ec4899" },
  { name: "Amber",  hex: "#d4a843" },
  { name: "Green",  hex: "#15803d" },
];

/* ── Types ────────────────────────────────────────────────────────── */

export interface CollabIdentity {
  name: string;
  color: string;
}

export interface CollabParticipant {
  name: string;
  color: string;
  firstSeen: string;
}

export interface CollabRequest {
  name: string;
  requestedAt: string;
}

export interface CollabPenState {
  /** Display name of the holder, or null if free. */
  holder: string | null;
  /** ISO when this holder took the pen. */
  since: string | null;
  /** ISO of the holder's most recent heartbeat. */
  lastHeartbeat: string | null;
  /** ISO of the holder's most recent real input. */
  lastActivity: string | null;
  /** Pending requests from non-holders. */
  requestedBy: CollabRequest[];
}

export interface CollabFocusClaim {
  panelKind: string;
  cardId: string;
  focusedAt: string;
  lastHeartbeat: string;
}

export interface CollabPresenceEntry {
  lastHeartbeat: string;
  focusedCard: CollabFocusClaim | null;
  selectedCards: { panelKind: string; cardId: string }[];
  cursorParagraphId: string | null;
}

export interface CollabSidecar {
  enabled: boolean;
  participants: CollabParticipant[];
  pen: CollabPenState;
  presence: Record<string, CollabPresenceEntry>;
}

export const EMPTY_COLLAB_SIDECAR: CollabSidecar = {
  enabled: false,
  participants: [],
  pen: {
    holder: null,
    since: null,
    lastHeartbeat: null,
    lastActivity: null,
    requestedBy: [],
  },
  presence: {},
};

/* ── Derived state ────────────────────────────────────────────────── */

export type PenStatus = "free" | "active" | "idle" | "stale";

export interface DerivedPen {
  status: PenStatus;
  holder: string | null;
  /** Seconds since the holder's last activity (or null when free). */
  idleSec: number | null;
  /** Seconds since the holder's last heartbeat (or null when free). */
  staleSec: number | null;
  /** Pending requests for the pen. */
  requestedBy: CollabRequest[];
}

export function derivePen(
  pen: CollabPenState,
  now = Date.now(),
): DerivedPen {
  if (!pen.holder) {
    return {
      status: "free",
      holder: null,
      idleSec: null,
      staleSec: null,
      requestedBy: pen.requestedBy ?? [],
    };
  }
  const lastHb = pen.lastHeartbeat ? Date.parse(pen.lastHeartbeat) : 0;
  const lastAct = pen.lastActivity ? Date.parse(pen.lastActivity) : lastHb;
  const sinceHb = lastHb ? now - lastHb : Number.POSITIVE_INFINITY;
  const sinceAct = lastAct ? now - lastAct : Number.POSITIVE_INFINITY;
  let status: PenStatus;
  if (sinceHb >= COLLAB_TIMINGS.penStaleMs) status = "stale";
  else if (sinceAct >= COLLAB_TIMINGS.penIdleMs) status = "idle";
  else if (sinceAct >= COLLAB_TIMINGS.penActiveMs) status = "idle";
  else status = "active";
  return {
    status,
    holder: pen.holder,
    idleSec: Math.floor(sinceAct / 1000),
    staleSec: Math.floor(sinceHb / 1000),
    requestedBy: pen.requestedBy ?? [],
  };
}

/** Decide whether a focus claim is fresh enough to lock partner cards.
 *  Stale claims are treated as released. */
export function isClaimFresh(
  claim: CollabFocusClaim | null | undefined,
  now = Date.now(),
): boolean {
  if (!claim) return false;
  const last = Date.parse(claim.lastHeartbeat);
  if (!Number.isFinite(last)) return false;
  return now - last < COLLAB_TIMINGS.cardStaleMs;
}

/** Format seconds as a compact "just now / 12s / 4m / 1h" label. */
export function formatRelativeShort(sec: number | null): string {
  if (sec == null) return "";
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

/* ── Identity persistence (localStorage) ───────────────────────────── */

export function loadIdentity(): CollabIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(COLLAB_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.name === "string" &&
      typeof parsed.color === "string" &&
      parsed.name.trim() &&
      /^#[0-9a-f]{6}$/i.test(parsed.color)
    ) {
      return { name: parsed.name.trim(), color: parsed.color.toLowerCase() };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveIdentity(identity: CollabIdentity): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COLLAB_IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* ignore */
  }
}

/* ── Pure update helpers ──────────────────────────────────────────── */

/** Touch a presence entry for `name`, creating one if missing. */
export function touchPresence(
  sidecar: CollabSidecar,
  name: string,
  patch: Partial<CollabPresenceEntry> = {},
): CollabSidecar {
  const now = new Date().toISOString();
  const prev = sidecar.presence[name] ?? {
    lastHeartbeat: now,
    focusedCard: null,
    selectedCards: [],
    cursorParagraphId: null,
  };
  return {
    ...sidecar,
    presence: {
      ...sidecar.presence,
      [name]: { ...prev, lastHeartbeat: now, ...patch },
    },
  };
}

/** Drop presence entries whose heartbeat is older than penStaleMs. */
export function sweepStalePresence(
  sidecar: CollabSidecar,
  now = Date.now(),
): CollabSidecar {
  const next: Record<string, CollabPresenceEntry> = {};
  for (const [name, entry] of Object.entries(sidecar.presence)) {
    const last = Date.parse(entry.lastHeartbeat);
    if (!Number.isFinite(last) || now - last < COLLAB_TIMINGS.penStaleMs) {
      next[name] = entry;
    }
  }
  return { ...sidecar, presence: next };
}

/** Find a partner's claim on (panelKind, cardId), if any, freshness-checked. */
export function findClaim(
  sidecar: CollabSidecar,
  selfName: string | null,
  panelKind: string,
  cardId: string,
  now = Date.now(),
): { holder: string; color: string; claim: CollabFocusClaim } | null {
  for (const [name, entry] of Object.entries(sidecar.presence)) {
    if (name === selfName) continue;
    const c = entry.focusedCard;
    if (!c) continue;
    if (c.panelKind !== panelKind || c.cardId !== cardId) continue;
    if (!isClaimFresh(c, now)) continue;
    const participant = sidecar.participants.find((p) => p.name === name);
    return {
      holder: name,
      color: participant?.color ?? "#888888",
      claim: c,
    };
  }
  return null;
}

/** Add or refresh a participant entry. */
export function ensureParticipant(
  sidecar: CollabSidecar,
  identity: CollabIdentity,
): CollabSidecar {
  const existing = sidecar.participants.find((p) => p.name === identity.name);
  if (existing) {
    if (existing.color === identity.color) return sidecar;
    return {
      ...sidecar,
      participants: sidecar.participants.map((p) =>
        p.name === identity.name ? { ...p, color: identity.color } : p,
      ),
    };
  }
  return {
    ...sidecar,
    participants: [
      ...sidecar.participants,
      { ...identity, firstSeen: new Date().toISOString() },
    ],
  };
}
