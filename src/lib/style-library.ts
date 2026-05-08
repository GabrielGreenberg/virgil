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
  EMERGENCY_PREAMBLE,
  SEED_STYLES,
  DEFAULT_STYLE_ID,
  type StyleEntry,
} from "@/lib/document-styles";

export const STYLE_LIBRARY_KEY = "virgil-style-library";

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
    version: 1,
    styles: SEED_STYLES.map((s) => ({ ...s })),
    defaultStyleId: DEFAULT_STYLE_ID,
  };
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
    return {
      version: parsed.version ?? 1,
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
