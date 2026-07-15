/**
 * Float key grammar — the single popout-key SSOT for the AF subsystem.
 *
 * Target grammar (BOTH domains): `float:<domain>:<kind>:<id>`
 *   card        → `float:card:note:<id>`, `float:card:revision-suggestion:<id>`, …
 *   textobject  → `float:textobject:paragraph:<uuid>`, `float:textobject:exampleBlock:<uuid>`, …
 *
 * Replaces the two legacy grammars: flat card `<prefix>:<id>` and
 * `textobject:<kind>:<id>`. `panel-registry.cardPopKey`/`popKey` and
 * `text-object-registry.textObjectPopoutKey` delegate here.
 *
 * **Colon-safe:** `id` is everything after the 3rd structural colon — NEVER
 * split on every colon (text-object uuids and the legacy `revision:s:<id>`
 * suggestion key carry interior colons). Mirrors `parseTextObjectPopoutKey`.
 *
 * This module is a runtime LEAF (imports only the `FloatDomain` type). The only
 * "kind ≠ key-prefix" divergence in the whole card spine is the revision pair
 * (`revision` prefix → `revision-comment`; `revision:s:<id>` → `revision-suggestion`,
 * the `s:` STRIPPED), which is a key-grammar fact encoded directly here — so we
 * never import `CARD_REGISTRY` (no cycle, and the migration stays pure).
 */
import type { FloatDomain } from "./types";

const FLOAT_PREFIX = "float:";
const FLOAT_DOMAINS: ReadonlySet<string> = new Set<FloatDomain>([
  "card",
  "textobject",
]);

export interface ParsedFloatKey {
  domain: FloatDomain;
  kind: string;
  id: string;
}

/** Build the canonical `float:<domain>:<kind>:<id>` key. */
export function buildFloatKey(ref: ParsedFloatKey): string {
  return `${FLOAT_PREFIX}${ref.domain}:${ref.kind}:${ref.id}`;
}

/**
 * Parse a `float:<domain>:<kind>:<id>` key. Colon-safe: `id` is everything
 * after the 3rd colon. Returns null if the key isn't `float:`-prefixed, the
 * domain is unknown, or any segment is empty.
 */
export function parseFloatKey(key: string): ParsedFloatKey | null {
  if (!key.startsWith(FLOAT_PREFIX)) return null;
  const rest = key.slice(FLOAT_PREFIX.length);
  const sep1 = rest.indexOf(":");
  if (sep1 <= 0) return null;
  const domain = rest.slice(0, sep1);
  if (!FLOAT_DOMAINS.has(domain)) return null;
  const afterDomain = rest.slice(sep1 + 1);
  const sep2 = afterDomain.indexOf(":");
  if (sep2 <= 0) return null;
  const kind = afterDomain.slice(0, sep2);
  const id = afterDomain.slice(sep2 + 1);
  if (!kind || !id) return null;
  return { domain: domain as FloatDomain, kind, id };
}

/**
 * Dual-read parse — handles BOTH the new `float:` grammar and the two legacy
 * grammars. Used by dispatch consumers (FloatHost, lookupSpec, …) during the
 * phased flip so they work whether a key is already migrated or not.
 *
 * Legacy resolution is registry-free:
 *  - `textobject:<kind>:<id>`  → { textobject, kind, id }
 *  - `revision:s:<id>`         → { card, "revision-suggestion", id }  (s: stripped)
 *  - `revision:<id>`           → { card, "revision-comment", id }
 *  - `revision-suggestion:<id>`→ { card, "revision-suggestion", id }  (defensive; unused)
 *  - `<prefix>:<id>`           → { card, prefix, id }   (every other card kind: prefix === kind)
 *
 * The ambiguous doc-aware legacy keys `list:`/`example:` are NOT resolved here
 * (a bare `example:` may be the panel card OR a pre-D10 exampleBlock — only the
 * doc walk in `post-load-migrations` can tell). `list:` → null; `example:` is
 * treated as the panel card (the common case), which the doc-aware leg corrects
 * if it turns out to be a block.
 */
export function parseAnyKey(key: string): ParsedFloatKey | null {
  if (key.startsWith(FLOAT_PREFIX)) return parseFloatKey(key);

  if (key.startsWith("textobject:")) {
    const rest = key.slice("textobject:".length);
    const sep = rest.indexOf(":");
    if (sep <= 0) return null;
    const kind = rest.slice(0, sep);
    const id = rest.slice(sep + 1);
    if (!kind || !id) return null;
    return { domain: "textobject", kind, id };
  }

  const sep = key.indexOf(":");
  if (sep <= 0) return null;
  const prefix = key.slice(0, sep);
  const rawId = key.slice(sep + 1);
  if (!rawId) return null;
  if (prefix === "list") return null; // doc-aware only

  const { kind, id } = canonicalizeCardPrefix(prefix, rawId);
  return { domain: "card", kind, id };
}

/**
 * The one card prefix→kind divergence: the revision pair. Every other card
 * prefix equals its kind. Strips the `s:` infix on suggestion keys.
 */
function canonicalizeCardPrefix(
  prefix: string,
  rawId: string,
): { kind: string; id: string } {
  if (prefix === "revision") {
    if (rawId.startsWith("s:")) {
      return { kind: "revision-suggestion", id: rawId.slice(2) };
    }
    return { kind: "revision-comment", id: rawId };
  }
  if (prefix === "revision-suggestion") {
    return { kind: "revision-suggestion", id: rawId };
  }
  return { kind: prefix, id: rawId };
}

/**
 * Map ONE legacy/`float:` key to the canonical `float:` grammar, registry-free.
 * Idempotent (a `float:` key passes through unchanged). Returns the unchanged
 * key for the doc-aware-only prefixes `list:`/`example:` (the doc-aware leg in
 * `post-load-migrations` converts those once the editor exists).
 *
 * The read-time prefs migration runs its existing block-prefix step FIRST
 * (`paragraph:`/`heading:`/`texBlock:` → `textobject:…`, dropping `selection:`),
 * then feeds the result here.
 */
export function migrateLegacyKeyToFloat(key: string): string {
  if (key.startsWith(FLOAT_PREFIX)) return key; // idempotent
  // Defer the doc-aware-ambiguous prefixes untouched.
  if (key.startsWith("list:") || key.startsWith("example:")) return key;

  if (key.startsWith("textobject:")) {
    const rest = key.slice("textobject:".length);
    const sep = rest.indexOf(":");
    if (sep <= 0) return key;
    return buildFloatKey({
      domain: "textobject",
      kind: rest.slice(0, sep),
      id: rest.slice(sep + 1),
    });
  }

  const sep = key.indexOf(":");
  if (sep <= 0) return key;
  const prefix = key.slice(0, sep);
  const rawId = key.slice(sep + 1);
  const { kind, id } = canonicalizeCardPrefix(prefix, rawId);
  return buildFloatKey({ domain: "card", kind, id });
}

/**
 * Lockstep map migration: rewrite BOTH `poppedOutCards` (the ordered key list)
 * AND `cardFloatPositions` (the rect map keyed by the SAME string) with one
 * `mapKey` transform, atomically. The existing D10 migration rewrote only the
 * former → every saved float rect orphaned on upgrade; this is the
 * no-silent-data-loss fix (AF §4.3).
 *
 * `mapKey` returns the new key, or `null` to DROP the key (and its rect).
 * Returns `changed: false` (and the original references) when nothing moved, so
 * callers can skip the prefs write.
 */
export function migrateFloatKeys<T>(
  keys: readonly string[],
  positions: Readonly<Record<string, T>>,
  mapKey: (key: string) => string | null,
): { keys: string[]; positions: Record<string, T>; changed: boolean } {
  let changed = false;
  const nextKeys: string[] = [];
  const emitted = new Set<string>(); // target keys already pushed to nextKeys
  const remap = new Map<string, string>(); // old → new (for surviving keys)
  for (const key of keys) {
    const next = mapKey(key);
    if (next === null) {
      changed = true;
      continue;
    }
    if (next !== key) changed = true;
    remap.set(key, next);
    // Collision-safe by construction: two source keys can canonicalize to the
    // SAME target (a stale-SW grammar downgrade or an interrupted migration can
    // leave both grammar-variants of one entity in the stored blob). Dedup here
    // — the migration is the one path that bypasses toggleCardPopout's runtime
    // includes-guard — so poppedOutCards never emits a duplicate React key.
    if (emitted.has(next)) {
      changed = true; // a collapse happened → persist the deduped blob
      continue;
    }
    emitted.add(next);
    nextKeys.push(next);
  }

  const nextPositions: Record<string, T> = {};
  for (const [key, rect] of Object.entries(positions)) {
    // A rect may exist for a key not in `keys` (a closed-but-remembered float)
    // — still migrate it so re-opening lands at the saved rect.
    const mapped = remap.get(key) ?? mapKey(key);
    if (mapped === null) {
      changed = true;
      continue;
    }
    if (mapped !== key) changed = true;
    // First-writer-wins on a target collision: never clobber an already-written
    // rect (both colliding keys are the same entity, so the surviving rect is
    // equivalent — but keep it deterministic rather than last-iterated).
    if (Object.prototype.hasOwnProperty.call(nextPositions, mapped)) {
      changed = true;
      continue;
    }
    nextPositions[mapped] = rect;
  }

  if (!changed) {
    return { keys: keys as string[], positions: positions as Record<string, T>, changed: false };
  }
  return { keys: nextKeys, positions: nextPositions, changed: true };
}
