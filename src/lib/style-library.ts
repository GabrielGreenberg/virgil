/**
 * Style library — user-managed list of named LaTeX preamble blobs,
 * persisted globally in localStorage. The Virgil-bar Style dropdown
 * reads from this library; per-doc state in `document-settings.json`
 * stores only the active styleId.
 *
 * Seeded on first load with the entries from `SEED_STYLES`. After that
 * the user owns the list — seed entries are editable, renameable, and
 * deletable like any other.
 *
 * The `EMERGENCY_PREAMBLE` constant in document-styles.ts is the
 * last-resort fallback used by `resolveStyle` if every other lookup
 * fails (e.g. user deleted every entry and somehow opened a doc that
 * points at a missing id). Not surfaced in UI.
 */
import {
  CLASSIC_PREAMBLE,
  EMERGENCY_PREAMBLE,
  SEED_STYLES,
  DEFAULT_STYLE_ID,
  type StyleEntry,
} from "@/lib/document-styles";

export const STYLE_LIBRARY_KEY = "virgil-style-library";

/**
 * Bumped whenever the SEED preambles change in a way stored libraries
 * should pick up. On read, any `origin: "seed"` style whose preamble is
 * byte-identical to a retired seed generation (KNOWN_LEGACY_SEED_PREAMBLES)
 * is upgraded to the current seed preamble; user-edited seeds (bytes
 * diverged) and user styles are never touched.
 *
 * v2 (2026-07-02): seeds rebuilt on the shared baseline package block
 * (graphicx/natbib/expex + all 7 `\v*id` shims) via buildPreamble.
 */
export const STYLE_LIBRARY_VERSION = 2;

// Frozen bytes of the v1 CLASSIC_PREAMBLE (Greenberg + Emergency were
// byte-identical to it). Do NOT reformat — the migration gate is exact
// byte equality.
const LEGACY_CLASSIC_PREAMBLE_V1 = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{xcolor}

% Virgil entity-id markers — no-op commands that carry stable UUIDs for
% inline entities (footnotes, citations, examples) across .tex parse
% cycles. Without these, every re-parse regenerates the ids and any UI
% state keyed by them (e.g. popped-out cards) becomes stale.
\\providecommand{\\vfid}[1]{}
\\providecommand{\\vcid}[1]{}
\\providecommand{\\vexid}[1]{}

\\begin{document}

`;

const KNOWN_LEGACY_SEED_PREAMBLES: readonly string[] = [
  LEGACY_CLASSIC_PREAMBLE_V1,
];

export interface StyleLibraryBlob {
  version: number;
  styles: StyleEntry[];
  defaultStyleId: string;
}

const EMERGENCY_ENTRY: StyleEntry = {
  id: "__emergency__",
  name: "Emergency",
  preamble: EMERGENCY_PREAMBLE,
  origin: "seed",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

function freshSeed(): StyleLibraryBlob {
  return {
    version: STYLE_LIBRARY_VERSION,
    styles: SEED_STYLES.map((s) => ({ ...s })),
    defaultStyleId: DEFAULT_STYLE_ID,
  };
}

/** Upgrade untouched seed styles to the current seed preamble. Only
 *  styles byte-identical to a KNOWN legacy seed generation qualify —
 *  anything the user edited fails the byte gate and is preserved. */
function migrateSeedStyles(styles: StyleEntry[]): StyleEntry[] {
  return styles.map((s) => {
    if (s.origin !== "seed") return s;
    if (!KNOWN_LEGACY_SEED_PREAMBLES.includes(s.preamble)) return s;
    const seed = SEED_STYLES.find((x) => x.id === s.id);
    const preamble = seed?.preamble ?? CLASSIC_PREAMBLE;
    if (preamble === s.preamble) return s;
    return { ...s, preamble, updatedAt: new Date().toISOString() };
  });
}

/**
 * Read the library from localStorage. Seeds on first read if missing.
 * Sync — localStorage is sync. Returns a defensive copy so callers
 * don't mutate the cached blob.
 */
export function getStyleLibrarySync(): StyleLibraryBlob {
  if (typeof window === "undefined") return freshSeed();
  try {
    const raw = localStorage.getItem(STYLE_LIBRARY_KEY);
    if (!raw) {
      const seed = freshSeed();
      localStorage.setItem(STYLE_LIBRARY_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as Partial<StyleLibraryBlob>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray(parsed.styles)
    ) {
      return freshSeed();
    }
    const storedVersion = parsed.version ?? 1;
    if (storedVersion < STYLE_LIBRARY_VERSION) {
      const migrated: StyleLibraryBlob = {
        version: STYLE_LIBRARY_VERSION,
        styles: migrateSeedStyles(parsed.styles),
        defaultStyleId: parsed.defaultStyleId ?? DEFAULT_STYLE_ID,
      };
      // Persist the bumped version directly (no STYLE_LIBRARY_EVENT — this
      // can run during render; every reader re-reads localStorage anyway).
      try {
        localStorage.setItem(STYLE_LIBRARY_KEY, JSON.stringify(migrated));
      } catch {
        /* quota / privacy mode — the in-memory upgrade still applies */
      }
      return migrated;
    }
    return {
      version: storedVersion,
      styles: parsed.styles,
      defaultStyleId: parsed.defaultStyleId ?? DEFAULT_STYLE_ID,
    };
  } catch {
    return freshSeed();
  }
}

/** Dispatched on every same-tab write so subscribed React components
 *  in other parts of the tree pick up the change. The browser's native
 *  `storage` event only fires in OTHER tabs. */
export const STYLE_LIBRARY_EVENT = "virgil-style-library-changed";

export function setStyleLibrarySync(next: StyleLibraryBlob): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STYLE_LIBRARY_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(STYLE_LIBRARY_EVENT));
  } catch {
    /* quota / privacy mode — silently drop */
  }
}

/**
 * Resolve a style by id with cascading fallbacks:
 *   1. Exact id match in the library.
 *   2. The library's defaultStyleId.
 *   3. The first style in the library.
 *   4. Hardcoded EMERGENCY_PREAMBLE entry (never null).
 */
export function resolveStyle(id: string | null | undefined): StyleEntry {
  const lib = getStyleLibrarySync();
  if (id) {
    const hit = lib.styles.find((s) => s.id === id);
    if (hit) return hit;
  }
  const def = lib.styles.find((s) => s.id === lib.defaultStyleId);
  if (def) return def;
  if (lib.styles.length > 0) return lib.styles[0];
  return EMERGENCY_ENTRY;
}

export function getDefaultStyleIdSync(): string {
  return getStyleLibrarySync().defaultStyleId;
}
