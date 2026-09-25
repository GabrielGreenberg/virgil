/**
 * feature-flags — the SSOT for every `virgil:` boolean switch.
 *
 * Virgil is steered by a set of `localStorage` switches: kill-switches for a
 * new engine, soak gates for an opt-in experiment, rollout flags for a staged
 * feature, and dev-only opt-ins. Before this module each one was its own
 * hand-rolled reader, and they did not agree on what "on" looked like — `"1"`
 * here, `"on"` there, `!== "0"` somewhere else, `"off"` reverts in the geometry
 * kill-switches. Setting `virgil:card-tiers = "1"` (the spelling every
 * neighbouring flag used) did nothing, silently. Four of the readers were
 * near-byte-identical clone modules differing only in the key string.
 *
 * So: **one registry, one dialect, one reader.**
 *
 * ## The dialect (decided once, for every flag)
 *
 * A stored value is parsed by {@link parseFlagValue}, which accepts the whole
 * universal vocabulary in BOTH directions, case- and whitespace-insensitively:
 *
 *   ON   — `"1" | "true" | "on" | "yes"`
 *   OFF  — `"0" | "false" | "off" | "no"`
 *
 * Anything else (including an unset key) means "no opinion" and the row's
 * `default` decides. Every legacy sentinel each flag used to honour is a member
 * of one of those two sets, so **no switch Gabriel has already set changes
 * meaning** — the dialect only ever ADDS spellings, and it adds them in the
 * direction the writer obviously intended (`virgil:card-tiers = "1"` now turns
 * the soak flag on instead of silently doing nothing).
 *
 * ## The failure branches (also decided once)
 *
 *  - key unset, value unrecognised, or `localStorage` throws (sandboxed iframe,
 *    blocked site data) ⇒ the row's `default`. Every reader already did this;
 *    it is now stated once instead of re-derived sixteen times.
 *  - no `window` (SSR) ⇒ the row's `ssr` when it declares one, else `default`.
 *    Three flags deliberately report OFF under SSR even though they default ON,
 *    to avoid a hydration mismatch on first client render. That difference is
 *    real, so the row DECLARES it rather than a reader re-inventing it.
 *
 * ## `requires` — a nested flag reads as OFF unless its parent is on
 *
 * Some flags are not independent: `virgil:inline-atom-lifecycle` gates a
 * reconciler that can only register as a policy on the consumer that
 * `virgil:identity-cascade` creates. Set the child ON with the parent OFF and
 * BOTH footnote-orphan writers went dark — the legacy event bridges bailed
 * because the child flag was on, and the new reconciler never registered
 * because there was no consumer, so a deleted footnote was dropped instead of
 * recorded as an orphan. {@link readFlag} resolves `requires` transitively, so
 * that combination is now unrepresentable rather than merely undocumented, and
 * in dev it says so once on the console.
 *
 * ## Reading
 *
 * Flags are read at CALL TIME and nothing here is memoized, so a flip takes
 * effect on the next read (in practice: on reload, which is the contract every
 * `virgil:*` switch has always had). Because nothing caches a snapshot, no
 * `storage`-event subscription is required — the cross-window-storage law
 * governs stores that cache, and this is not one.
 *
 * Census: `src/lib/__tests__/feature-flag-registry.test.ts` asserts that every
 * `virgil:` key read anywhere in `src/**` + `library/**` is either a row here
 * or a declared non-flag, and that no production file reads `localStorage` for
 * a flag outside this module.
 */

/** What a flag is FOR — the lifecycle stage that explains why it exists. */
export type FlagStatus =
  /** Reverts a shipped engine to its legacy path if it misbehaves. Default ON. */
  | "kill-switch"
  /** An opt-in experiment awaiting a soak before its default flips. Default OFF. */
  | "soak"
  /** A staged feature being A/B'd, or a shipped one keeping an opt-out. */
  | "rollout"
  /** A developer/debug opt-in that never ships on. Default OFF. */
  | "dev";

export interface FlagSpec {
  /** Value when the key is unset, holds an unrecognised value, or
   *  `localStorage` is unreachable. */
  readonly default: boolean;
  /** Value under SSR (no `window`). Declared ONLY where it deliberately
   *  differs from `default` — always to report OFF for a default-ON flag so
   *  the server render matches the client's first paint. */
  readonly ssr?: boolean;
  readonly status: FlagStatus;
  /** Flags that must ALSO be on for this one to read as on. Resolved
   *  transitively by {@link readFlag}. */
  readonly requires: readonly string[];
  /** The spelling this flag's own docs/comments have always advertised for
   *  FLIPPING it away from `default` — kept so the row records the sentinel a
   *  reader may already have set. The census asserts it actually parses to
   *  `!default`, so it cannot rot into a lie. */
  readonly legacy: string;
  /** One line: what the flag turns on, and what OFF means. */
  readonly note: string;
}

/**
 * Every `virgil:` boolean switch in the app. A new flag is added HERE and read
 * through {@link readFlag}; the census fails a flag read anywhere else.
 */
export const FLAG_REGISTRY = {
  // ── kill-switches (default ON; flip to revert a shipped engine) ──────────
  "virgil:geom-hover": {
    default: true,
    status: "kill-switch",
    requires: [],
    legacy: "off",
    note: "Service-backed hover resolvers (grab handle + par-title band); OFF reverts to the legacy full-document scans.",
  },
  "virgil:geom-active-block": {
    default: true,
    status: "kill-switch",
    requires: [],
    legacy: "off",
    note: "Snapshot binary-search active-paragraph resolver; OFF reverts to the legacy triple doc walk.",
  },
  "virgil:geom-breadcrumb": {
    default: true,
    status: "kill-switch",
    requires: [],
    legacy: "off",
    note: "Snapshot-derived section-path breadcrumb; OFF reverts to the legacy per-block coordsAtPos scan.",
  },
  "virgil:print-gate": {
    default: true,
    status: "kill-switch",
    requires: [],
    legacy: "off",
    note: "Print-intent gate (defer print until the doc is paint-ready); OFF prints immediately. Read once at module load.",
  },
  "virgil:doc-products": {
    default: true,
    // Client-only pipeline; report OFF server-side so first paint matches.
    ssr: false,
    status: "kill-switch",
    requires: [],
    legacy: "off",
    note: "The shared doc-products pipeline (docJson/sourceText/wordCounts); OFF makes every consumer compute its own.",
  },
  "virgil:layout-gesture": {
    default: true,
    status: "kill-switch",
    requires: [],
    legacy: "off",
    note: "The WINDOW-resize publisher on the layout-gesture bus (pane parking is untouched); OFF stops publishing window gestures.",
  },

  // ── soak flags (default OFF; awaiting a soak before the default flips) ───
  "virgil:card-tiers": {
    default: false,
    status: "soak",
    requires: [],
    legacy: "on",
    note: "Card presence tiers — a collapsed card body mounts machinery proportional to its usefulness instead of a live editor each.",
  },
  "virgil:perf-contain": {
    default: false,
    status: "soak",
    requires: [],
    legacy: "on",
    note: "Wave-4 Stage A `contain: layout style` on card/omni/panel/float containers, via `body.perf-contain`.",
  },

  // ── rollout flags ───────────────────────────────────────────────────────
  "virgil:identity-cascade": {
    default: false,
    status: "rollout",
    requires: [],
    legacy: "1",
    note: "IdentityCascade: sidecars re-key on BibEntry.uid and a citekey rename routes through the single writer.",
  },
  "virgil:inline-atom-lifecycle": {
    default: false,
    status: "rollout",
    // The reconciler registers as a POLICY on the identity-bus consumer, which
    // only exists when the cascade flag is on. Without this edge, ON+parent-OFF
    // silenced BOTH footnote-orphan writers and dropped the record entirely.
    requires: ["virgil:identity-cascade"],
    legacy: "1",
    note: "Bus-driven inline-atom lifecycle reconciler (orphan record + card-ref pruning); OFF leaves the legacy event bridges as the writer.",
  },
  "virgil:multi-doc-keepalive": {
    default: true,
    // Capacity is read client-side on mount and the first render has one open
    // doc either way, so reporting OFF (capacity 1) server-side is safe.
    ssr: false,
    status: "rollout",
    requires: [],
    legacy: "0",
    note: "Keep-alive LRU capacity 3 (1 visible + 2 warm) for instant paper↔paper switching; OFF pins capacity 1 (legacy cold remount).",
  },
  "virgil:pending-changes": {
    default: true,
    // Editor content never SSR-renders; report OFF to avoid any hydration
    // surprise on the first client paint.
    ssr: false,
    status: "rollout",
    requires: [],
    legacy: "0",
    note: "Applied AI suggestions land as a blue revertable range awaiting an explicit Keep; OFF is the legacy accept-immediately path.",
  },

  // ── dev opt-ins (default OFF; never ship on) ────────────────────────────
  "virgil:force-dev-storage": {
    default: false,
    status: "dev",
    requires: [],
    legacy: "1",
    note: "Force the dev storage backend (and disable the FSA file picker) when the host can't be detected as an iframe — how the Claude preview loads a doc.",
  },
  "virgil:bug-report": {
    default: false,
    status: "dev",
    requires: [],
    legacy: "1",
    note: "Per-machine opt-in for the bug-report drop window in the top bar (also needs real FSA and not dev storage).",
  },
  "virgil:wco-debug": {
    default: false,
    status: "dev",
    requires: [],
    legacy: "1",
    note: "Window-controls-overlay debug instrumentation; also enabled by a `wco-debug` query param.",
  },
  "virgil:lib-perf": {
    default: false,
    status: "dev",
    requires: [],
    legacy: "1",
    note: "Library data-layer timing logs (`[lib-perf] <label> <ms>`); also forced by `globalThis.__VIRGIL_LIB_PERF`.",
  },
} as const satisfies Record<string, FlagSpec>;

/** Every declared flag key. */
export type FlagKey = keyof typeof FLAG_REGISTRY;

/** Compile-time proof that every `requires` edge names a real row. */
const _requiresAreKeys: Record<FlagKey, { readonly requires: readonly FlagKey[] }> =
  FLAG_REGISTRY;
void _requiresAreKeys;

export const FLAG_KEYS = Object.keys(FLAG_REGISTRY) as readonly FlagKey[];

export function isFlagKey(key: string): key is FlagKey {
  return Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, key);
}

/**
 * `virgil:` keys that are NOT boolean flags — stored user data, a dismissal
 * stamp, or a DOM event name. Declared here so the census can be TOTAL: every
 * `virgil:` string in the tree is either a flag row above or a row here, and a
 * new one that is neither fails the test rather than passing unnoticed.
 */
export const NON_FLAG_VIRGIL_KEYS: Readonly<Record<string, string>> = {
  "virgil:bug-report-draft": "stored draft text of an unsent bug report",
  "virgil:bug-report-machine": "the machine label a bug report is filed under",
  "virgil:library-root-stamp": "nonce a window posts when it changes the library folder handle (IndexedDB), so peer windows re-resolve it",
  "virgil:suppressed-confirms": "set of confirm dialogs the user chose not to see again",
  "virgil:install-prompt-dismissed": "timestamp of the dismissed PWA install prompt",
  "virgil:selection-menu-color-palette": "the selection menu's last-used colour palette",
  "virgil:spell-dictionary": "the user's global custom spelling dictionary",
  "virgil:tex-delimiters-changed": "DOM event name (not a storage key)",
  "virgil:tex-delimiters-will-change": "DOM event name (not a storage key)",
};

/** Stored spellings that mean ON, in every flag. */
export const FLAG_ON_VALUES: readonly string[] = ["1", "true", "on", "yes"];
/** Stored spellings that mean OFF, in every flag. */
export const FLAG_OFF_VALUES: readonly string[] = ["0", "false", "off", "no"];

/**
 * Parse a stored flag value. `null` means "no opinion" — the key is unset, or
 * holds something outside the dialect — and the caller falls back to the row's
 * `default`.
 */
export function parseFlagValue(raw: string | null | undefined): boolean | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (FLAG_ON_VALUES.includes(v)) return true;
  if (FLAG_OFF_VALUES.includes(v)) return false;
  return null;
}

/**
 * Test/runtime overrides. `undefined` (absent) → fall back to `localStorage`.
 * A test sets one so it doesn't depend on a jsdom `localStorage`; production
 * never touches them.
 */
const overrides = new Map<FlagKey, boolean>();

/** The flag's OWN value, before `requires` is applied. */
function readFlagSelf(key: FlagKey): boolean {
  const spec: FlagSpec = FLAG_REGISTRY[key];
  const forced = overrides.get(key);
  if (forced !== undefined) return forced;
  if (typeof window === "undefined") return spec.ssr ?? spec.default;
  try {
    return parseFlagValue(window.localStorage.getItem(key)) ?? spec.default;
  } catch {
    // localStorage can throw under a sandboxed iframe or blocked site data.
    return spec.default;
  }
}

/** Dev console warnings are one-per-edge, not one-per-read (flags are read on
 *  hot paths — a per-read warn would be its own performance bug). */
const warnedEdges = new Set<string>();

function warnUnmetRequirement(key: FlagKey, dep: FlagKey): void {
  if (process.env.NODE_ENV === "production") return;
  const edge = `${key}<-${dep}`;
  if (warnedEdges.has(edge)) return;
  warnedEdges.add(edge);
  console.warn(
    `[virgil:flags] "${key}" is set ON but requires "${dep}", which is OFF. ` +
      `Reading "${key}" as OFF — that combination is not a supported state. ` +
      `Set "${dep}" too, or unset "${key}".`,
  );
}

/**
 * The one reader. Honours the row's default, the universal dialect, the SSR
 * value, a test override, and the `requires` edges (transitively).
 */
export function readFlag(key: FlagKey): boolean {
  if (!readFlagSelf(key)) return false;
  for (const dep of FLAG_REGISTRY[key].requires as readonly FlagKey[]) {
    if (!readFlag(dep)) {
      warnUnmetRequirement(key, dep);
      return false;
    }
  }
  return true;
}

/**
 * Force a flag (tests, or an explicit toggle). Pass `undefined` to clear the
 * override and fall back to `localStorage`. Tests call this in `beforeEach` /
 * `afterEach` to exercise both the flag-ON and the flag-OFF parity paths.
 *
 * An override forces the flag's OWN value only — `requires` still applies, so a
 * child forced ON with its parent OFF still reads OFF. That is the point: the
 * incoherent combination has no spelling, not even in a test.
 */
export function setFlagOverride(key: FlagKey, value: boolean | undefined): void {
  if (value === undefined) overrides.delete(key);
  else overrides.set(key, value);
}

/** Clear every override (test teardown). */
export function clearFlagOverrides(): void {
  overrides.clear();
}
