"use client";

/**
 * Per-CardKind lifecycle SSOT. Sister of [panel-registry.ts](./panel-registry.ts) and
 * [src/links/link-registry.ts](../links/link-registry.ts). Mirrors the
 * `registerFloatBody` / `floatBodyComponent` slot pattern in
 * [src/text-objects/text-object-registry.ts](../text-objects/text-object-registry.ts).
 *
 * Unlike the float-body registry (module-global, single-shot at boot),
 * card lifecycle ops are PER-DOC — each sidecar hook is per-document, so
 * the registry flows through React context. The provider holds the live
 * map in a ref so consumers don't re-render when the underlying hook
 * returns change identity; the dispatcher reads `getCardLifecycle(kind)`
 * at click time, so it always sees the current document's ops.
 *
 * Adding a new card kind:
 *   1. Make sure the kind is in `CardKind` (it already is — this is just
 *      a behavior slot, not a type extension).
 *   2. Ensure the per-doc hook (e.g. `useFootnotes`) exposes a `clone(id)`
 *      and a `delete(id)`.
 *   3. Add one entry in EditorPane's `CardLifecycleProvider value={…}`.
 *
 * The drag-handle dispatcher's duplicate/delete walkers ([src/text-objects/duplicate-slice.ts](../text-objects/duplicate-slice.ts),
 * [src/text-objects/delete-range.ts](../text-objects/delete-range.ts)) iterate
 * the doc and call `get(kind)?.clone(id)` / `.delete(id)`. They contain
 * zero per-kind branches; an unregistered kind is a silent no-op.
 */

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { CardKind } from "./_shared/types";

/** Per-kind lifecycle operations. `clone` returns the new id, or null if
 *  the source id was not found (or the kind opts out of clone). `delete`
 *  is fire-and-forget — sidecar hooks already handle missing ids
 *  gracefully (filter is a no-op if nothing matches). */
export interface CardLifecycle {
  clone(sourceId: string): string | null;
  delete(id: string): void;
}

export type CardLifecycleRegistry = Partial<Record<CardKind, CardLifecycle>>;

/** Stable API surface read by consumers. The underlying registry can
 *  change identity each render without forcing a consumer re-render —
 *  `get` always reads the latest via a ref. */
export interface CardLifecycleApi {
  get(kind: CardKind): CardLifecycle | null;
}

const EMPTY_API: CardLifecycleApi = { get: () => null };

const Ctx = createContext<CardLifecycleApi>(EMPTY_API);

export interface CardLifecycleProviderProps {
  value: CardLifecycleRegistry;
  children: ReactNode;
}

export function CardLifecycleProvider({
  value,
  children,
}: CardLifecycleProviderProps) {
  const ref = useRef<CardLifecycleRegistry>(value);
  ref.current = value;
  // `api` is identity-stable for the provider's lifetime; only the ref's
  // payload moves. Consumers never re-render due to lifecycle churn.
  const api = useMemo<CardLifecycleApi>(
    () => ({ get: (kind) => ref.current[kind] ?? null }),
    [],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Hook for React-tree consumers. Returns the stable API. */
export function useCardLifecycle(): CardLifecycleApi {
  return useContext(Ctx);
}

/** Direct constructor for callers that own a registry but don't want the
 *  provider/consumer dance (e.g. `EditorPane` handing the API into a
 *  dispatcher hook). Identity is stable across renders; only the ref's
 *  payload changes, so the api object can be a useCallback/useMemo dep
 *  without cascading re-renders. */
export function useCardLifecycleApi(
  registry: CardLifecycleRegistry,
): CardLifecycleApi {
  const ref = useRef<CardLifecycleRegistry>(registry);
  ref.current = registry;
  return useMemo<CardLifecycleApi>(
    () => ({ get: (kind) => ref.current[kind] ?? null }),
    [],
  );
}
