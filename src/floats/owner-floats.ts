/**
 * Popped-out floats are OWNED BY A DOCUMENT (task 1400).
 *
 * A popped float — a card (`float:card:<kind>:<id>`) or a text object
 * (`float:textobject:<kind>:<uuid>`) — names an entity that lives in exactly
 * one document. Until task 1400 the popout list (`poppedOutCards`) and its
 * rects (`cardFloatPositions`) were ONE window-wide slot handed unfiltered to
 * every keep-alive pane's `FloatHost`, so a paragraph popped in doc B rendered
 * (and closed) over doc A, Cmd-W closed an off-screen float of another doc, and
 * a bib float — keyed by a citekey every paper may share — was the SAME float
 * in every doc citing that entry. That is the "per-doc services under
 * multi-pane keep-alive" law's single-slot defect: a per-DOCUMENT value stored
 * at window scope.
 *
 * The store is now a REGISTRY keyed by its owner — `cardFloats[docId]` holds
 * that doc's ordered keys and rects — and the pane sees only its own slice:
 * `scopeCardFloats(cardFloats, docId)` is the ONE projection, applied by
 * `EditorPane` from its own `docId` (see `scopePaneViewPrefs`), so no pane can
 * read, render, close or position another doc's float. The window-level
 * consumers that legitimately span docs (the Cmd-W MRU stack) carry the owner
 * in every entry and act only on the ACTIVE doc's.
 *
 * Pure and dependency-light: the engine (`useViewPrefs`) and the tests share
 * these transforms; nothing here touches React or storage.
 */
import { migrateFloatKeys } from "./float-key";

export type FloatRect = { x: number; y: number; width: number; height: number };

/** One document's popped floats: the ordered open keys (insertion order is
 *  the fallback paint order) and the saved rect per key. A rect may exist for
 *  a key not (yet) in `keys` — `popOutAtRect` seeds the rect, then opens, in
 *  the same tick. Such a rect never outlives a reload: the load door keeps
 *  only rects whose key is open (task 1491). */
export interface CardFloatSlice {
  keys: string[];
  positions: Record<string, FloatRect>;
}

/** The window's popped floats, keyed by owning document id. */
export type CardFloats = Record<string, CardFloatSlice>;

/** The reserved owner of a pre-1400 flat popout list read from storage. The
 *  flat list named no document, so it is held here — rendered by NO pane —
 *  until the layout adopts it into the doc that is active at boot
 *  (`adoptLegacyCardFloats`). Not a doc id any producer mints (doc ids are
 *  FsaDocIndex ids / `library-paper:<citekey>`). */
export const LEGACY_FLOAT_OWNER = "\u0000legacy-unowned";

const EMPTY_KEYS: readonly string[] = Object.freeze([]);
const EMPTY_POSITIONS: Readonly<Record<string, FloatRect>> = Object.freeze({});

/** A frozen empty slice — the stable answer for a doc with no floats, so an
 *  unrelated doc's float write never changes this pane's slice identity. */
export const EMPTY_CARD_FLOAT_SLICE: Readonly<CardFloatSlice> = Object.freeze({
  keys: EMPTY_KEYS as string[],
  positions: EMPTY_POSITIONS as Record<string, FloatRect>,
});

/** The owner's slice, or the stable empty slice. */
export function sliceOf(floats: CardFloats | undefined, owner: string): CardFloatSlice {
  return floats?.[owner] ?? EMPTY_CARD_FLOAT_SLICE;
}

/** Write `owner`'s slice; an empty slice is DELETED, so a doc with no open
 *  floats and no remembered rects leaves no residue in the window blob. */
function withSlice(floats: CardFloats, owner: string, slice: CardFloatSlice): CardFloats {
  const empty = slice.keys.length === 0 && Object.keys(slice.positions).length === 0;
  if (empty) {
    if (!(owner in floats)) return floats;
    const { [owner]: _dropped, ...rest } = floats;
    return rest;
  }
  return { ...floats, [owner]: slice };
}

function dropKey(slice: CardFloatSlice, key: string): CardFloatSlice {
  const { [key]: _droppedPos, ...positions } = slice.positions;
  return { keys: slice.keys.filter((k) => k !== key), positions };
}

/** Toggle: open → close (forgetting the rect, so the next pop spawns fresh
 *  from its trigger); closed → open. */
export function toggleCardFloat(floats: CardFloats, owner: string, key: string): CardFloats {
  const slice = sliceOf(floats, owner);
  if (slice.keys.includes(key)) return withSlice(floats, owner, dropKey(slice, key));
  return withSlice(floats, owner, { keys: [...slice.keys, key], positions: slice.positions });
}

/** Close (never opens). No-op — same reference — when the key isn't there. */
export function closeCardFloat(floats: CardFloats, owner: string, key: string): CardFloats {
  const slice = floats[owner];
  if (!slice || (!slice.keys.includes(key) && !(key in slice.positions))) return floats;
  return withSlice(floats, owner, dropKey(slice, key));
}

export function setCardFloatRect(
  floats: CardFloats,
  owner: string,
  key: string,
  rect: FloatRect,
): CardFloats {
  const slice = sliceOf(floats, owner);
  return withSlice(floats, owner, {
    keys: slice.keys,
    positions: { ...slice.positions, [key]: rect },
  });
}

/** Lockstep key migration (`migrateFloatKeys`) over ONE owner's slice, or —
 *  `owner` omitted — over every slice (the load-time grammar migration, which
 *  needs no doc). Same reference when nothing changed. */
export function migrateCardFloats(
  floats: CardFloats,
  mapKey: (key: string) => string | null,
  owner?: string,
): CardFloats {
  const owners = owner === undefined ? Object.keys(floats) : owner in floats ? [owner] : [];
  let next = floats;
  for (const o of owners) {
    const slice = floats[o];
    const result = migrateFloatKeys(slice.keys, slice.positions, mapKey);
    if (result.changed) next = withSlice(next, o, { keys: result.keys, positions: result.positions });
  }
  return next;
}

/** Close every float of `owner` (or, `owner` omitted, of every doc). */
export function closeAllCardFloats(floats: CardFloats, owner?: string): CardFloats {
  if (owner === undefined) return Object.keys(floats).length === 0 ? floats : {};
  const slice = floats[owner];
  if (!slice || slice.keys.length === 0) return floats;
  const positions = { ...slice.positions };
  for (const k of slice.keys) delete positions[k];
  return withSlice(floats, owner, { keys: [], positions });
}

/** Drop `owner`'s WHOLE slice — open keys and every remembered rect, seeded
 *  or not — because the document itself is gone (removed, or reset under the
 *  same id: task 1491). Unlike `closeAllCardFloats`, which closes floats of a
 *  doc that still exists, nothing of the slice is kept. Same reference when
 *  the owner holds nothing. */
export function forgetCardFloatOwner(floats: CardFloats, owner: string): CardFloats {
  if (!(owner in floats)) return floats;
  const { [owner]: _forgotten, ...rest } = floats;
  return rest;
}

/** Move the pre-1400 unowned slice into `owner` (appending; the owner's own
 *  keys and rects win a collision). Same reference when there is none. */
export function adoptLegacyCardFloats(floats: CardFloats, owner: string): CardFloats {
  const legacy = floats[LEGACY_FLOAT_OWNER];
  if (!legacy || owner === LEGACY_FLOAT_OWNER) return floats;
  const own = sliceOf(floats, owner);
  const keys = [...own.keys];
  for (const k of legacy.keys) if (!keys.includes(k)) keys.push(k);
  const { [LEGACY_FLOAT_OWNER]: _legacy, ...rest } = floats;
  return withSlice(rest, owner, { keys, positions: { ...legacy.positions, ...own.positions } });
}

// The stored `cardFloats` value's load door is the structural window table's
// `float-slices` shape (`structural-window.ts`); only the pre-1400 legacy fold
// below reads raw storage here.
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function rectOf(v: unknown): FloatRect | undefined {
  if (!isPlainObject(v)) return undefined;
  const { x, y, width, height } = v;
  const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  return fin(x) && fin(y) && fin(width) && fin(height) ? { x, y, width, height } : undefined;
}

function sliceFrom(keys: unknown, positions: unknown): CardFloatSlice {
  const k = Array.isArray(keys) ? keys.filter((x): x is string => typeof x === "string") : [];
  const p: Record<string, FloatRect> = {};
  if (isPlainObject(positions)) {
    for (const [key, r] of Object.entries(positions)) {
      const rect = rectOf(r);
      if (rect) p[key] = rect;
    }
  }
  return { keys: [...new Set(k)], positions: p };
}

/** Read a pre-1400 flat pair (`poppedOutCards` + `cardFloatPositions`) as the
 *  unowned legacy slice. `undefined` when neither field is present. */
export function legacyFlatToCardFloats(
  poppedOutCards: unknown,
  cardFloatPositions: unknown,
): CardFloats | undefined {
  if (poppedOutCards === undefined && cardFloatPositions === undefined) return undefined;
  return withSlice({}, LEGACY_FLOAT_OWNER, sliceFrom(poppedOutCards, cardFloatPositions));
}

/** The Cmd-W target: the most recent entry of the window's MRU float stack
 *  that is ON SCREEN — a card float owned by `ownerOnScreen` (the doc in
 *  front; `null` when no doc pane is showing), or a panel float while ANY doc
 *  pane is showing. Panel floats are window-wide across docs, but each doc's
 *  EditorPane paints them, so with no doc pane in front (Library, Reader)
 *  they are hidden too. A float the user cannot see is never the target
 *  (tasks 1400, 1567). */
export function frontmostOnScreen<
  R extends { kind: "panel" } | { kind: "card"; owner: string },
>(stack: readonly R[], ownerOnScreen: string | null): R | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    const r = stack[i];
    if (r.kind === "panel" ? ownerOnScreen !== null : r.owner === ownerOnScreen) return r;
  }
  return undefined;
}
