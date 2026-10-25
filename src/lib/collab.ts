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

import { announceStorageKey } from "@/lib/cross-window-storage";

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
  /** Task 1281 — the RENAME LEDGER: names this browser has given up, most
   *  recent first, each with WHEN it was given up. A rename only migrates
   *  the papers mounted at that moment; every other paper's `collab.json`
   *  still carries the old name, and the ledger is what lets the next open
   *  fold it onto the current one (`adoptIdentity`, collab-store.ts).
   *  Maintained ONLY by {@link saveIdentity}: bounded, deduped, never holding
   *  the current name. Absent when no rename has happened. */
  previousNames?: CollabNameRelease[];
}

/** One rename-ledger entry (task 1281): `name` stopped being this browser's
 *  at `until`. A trace of `name` stamped later than that (past a grace) can't
 *  be this browser's — it is someone else who now goes by it. */
export interface CollabNameRelease {
  name: string;
  until: string;
}

/** The rename ledger keeps this many released names. */
export const COLLAB_PREVIOUS_NAMES_MAX = 8;

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
  /** Task 1213 — WHICH live session (one `useCollab` instance: one pane of
   *  one window) holds the pen. The holder NAME is per-browser, so every
   *  pane and window of that browser shares it; ownership is the session.
   *  Absent on a legacy record: then any session of `holder`'s name counts
   *  as the holder (see {@link holdsPen}) until its next heartbeat stamps
   *  its own session. */
  holderSession?: string | null;
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
  /** Task 1213 — the live sessions (panes/windows) of this name present on
   *  the paper, session id → ISO of that session's last heartbeat. One
   *  name, several sessions: a release drops only its own session, and the
   *  entry goes only when no fresh session of the name remains. Absent on a
   *  legacy entry (then a release drops the entry, as before). */
  sessions?: Record<string, string>;
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
      const name = parsed.name.trim();
      const previousNames = normalizeLedger(
        Array.isArray(parsed.previousNames) ? parsed.previousNames : [],
        name,
      );
      return previousNames.length
        ? { name, color: parsed.color.toLowerCase(), previousNames }
        : { name, color: parsed.color.toLowerCase() };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Sanitize a rename ledger: well-formed entries only, one per name (the
 *  latest release wins), most recent first, never `current`, bounded. */
function normalizeLedger(entries: unknown[], current: string): CollabNameRelease[] {
  const latest = new Map<string, CollabNameRelease>();
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const { name, until } = e as { name?: unknown; until?: unknown };
    if (typeof name !== "string" || typeof until !== "string") continue;
    const n = name.trim();
    const at = Date.parse(until);
    if (!n || n === current || !Number.isFinite(at)) continue;
    const seen = latest.get(n);
    if (!seen || Date.parse(seen.until) < at) latest.set(n, { name: n, until });
  }
  return [...latest.values()]
    .sort((a, b) => Date.parse(b.until) - Date.parse(a.until))
    .slice(0, COLLAB_PREVIOUS_NAMES_MAX);
}

/**
 * THE identity write door (task 1014). The identity is per-BROWSER but cached
 * per PANE (every mounted `useCollab`) and projected onto every paper's
 * `collab.json` (pen holder, presence, participants). Peer windows hear the
 * write through the native `storage` event; this window's other panes hear it
 * through the in-window announcement — and each `useCollab` that hears an
 * actual change migrates its paper's sidecar from the old name to the new one.
 * An unchanged identity announces nothing.
 *
 * A NAME change is also recorded in the identity's rename ledger (task 1281,
 * {@link CollabIdentity.previousNames}) — the door, not the caller, owns it:
 * the outgoing name is stamped with the moment it was given up, merged with
 * the ledger already stored (a caller's copy may be stale), so the papers
 * that were NOT mounted during the rename converge on their next open.
 */
export function saveIdentity(
  identity: CollabIdentity,
  clock: () => number = Date.now,
): void {
  if (typeof window === "undefined") return;
  const prior = loadIdentity();
  const released: CollabNameRelease[] =
    prior && prior.name !== identity.name
      ? [{ name: prior.name, until: new Date(clock()).toISOString() }]
      : [];
  const previousNames = normalizeLedger(
    [
      ...released,
      ...(prior?.previousNames ?? []),
      ...(identity.previousNames ?? []),
    ],
    identity.name,
  );
  const record: CollabIdentity = { name: identity.name, color: identity.color };
  if (previousNames.length) record.previousNames = previousNames;
  const value = JSON.stringify(record);
  try {
    if (localStorage.getItem(COLLAB_IDENTITY_KEY) === value) return;
    localStorage.setItem(COLLAB_IDENTITY_KEY, value);
  } catch {
    return;
  }
  announceStorageKey(COLLAB_IDENTITY_KEY);
}

/* ── Holding sessions (task 1213) ─────────────────────────────────── */

/** One live holder of collab state: the per-browser identity NAME plus the
 *  per-instance SESSION (one `useCollab` — one pane of one window). Every
 *  "is this mine?" question about the pen or presence asks the session. */
export interface CollabSelf {
  name: string;
  session: string;
}

/** Mint a session id for one `useCollab` instance. Unique per pane per
 *  window per page load — a reload is a new session. */
export function mintCollabSession(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Does `self` hold `pen`? The name must match AND the session — except on
 *  a legacy record that names no session, which any session of the name
 *  holds until its next heartbeat stamps one ({@link CollabPenState}). */
export function holdsPen(pen: CollabPenState, self: CollabSelf): boolean {
  if (pen.holder !== self.name) return false;
  return !pen.holderSession || pen.holderSession === self.session;
}

/* ── Pure update helpers ──────────────────────────────────────────── */

/** Touch a presence entry for `name`, creating one if missing. */
export function touchPresence(
  sidecar: CollabSidecar,
  name: string,
  patch: Partial<CollabPresenceEntry> = {},
  /** Task 1213 — the session touching it; recorded in `sessions` so a
   *  later release of a SIBLING session leaves this one's presence. */
  session?: string,
): CollabSidecar {
  const now = new Date().toISOString();
  const prev = sidecar.presence[name] ?? {
    lastHeartbeat: now,
    focusedCard: null,
    selectedCards: [],
    cursorParagraphId: null,
  };
  const entry: CollabPresenceEntry = { ...prev, lastHeartbeat: now, ...patch };
  if (session) entry.sessions = { ...(prev.sessions ?? {}), [session]: now };
  return {
    ...sidecar,
    presence: {
      ...sidecar.presence,
      [name]: entry,
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
      // Explicit fields: the identity also carries its rename ledger, which
      // is per-browser state and never belongs on a paper's roster.
      {
        name: identity.name,
        color: identity.color,
        firstSeen: new Date().toISOString(),
      },
    ],
  };
}
