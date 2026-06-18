/**
 * IdentityCascade — the single writer for any identity-changing operation.
 *
 * Root diagnosis (T1 §2): Virgil had no durable internal id for a bibliography
 * entry and no cascade owner for any identity change. A citekey rename mutated
 * the `.bib` entry's `key` (and, half the time, the citation refs) but stranded
 * every *other* surface that keyed on the citekey string — annotations
 * (DATA-LOSS, BIB-A2-01), bib-review requests, the float, panel selection, the
 * occurrence cursor. The only mutation chokepoint (`updateBibKeyAndType`)
 * migrated two of those surfaces and silently forgot the rest, and every new
 * citekey-keyed sidecar re-opened the wound.
 *
 * The deep fix is to invert the relationship: instead of teaching one call
 * site to remember every surface, every surface *declares itself* to ONE
 * owner. `BibEntry.uid` (Stage 0, already landed) gives entries a durable
 * surrogate id decoupled from the renameable citekey; this module is the
 * **single `IdentityCascade` writer** that fans an identity change out to every
 * registered migrator atomically. A new citekey-keyed sidecar registers a
 * migrator and gets rename-safety for free — the "did we remember surface N?"
 * regression class is structurally gone.
 *
 * This is a PURE-LOGIC service (no React, no editor import): the cascade holds
 * a migrator registry and runs the fan-out. The editor `\cite{}` doc-rewrite is
 * itself a migrator the citation hook registers, passing the live editor — so
 * the cascade module never depends on TipTap. Keystroke sanctity is unaffected:
 * `runIdentityChange` fires only on an explicit rename/retype (a panel action),
 * never on a keystroke, and walks nothing proportional to the doc on type.
 *
 * Rollout: gated behind `virgil:identity-cascade` (identity-flag.ts) — flag-off
 * keeps the legacy `updateBibKeyAndType` path so the existing suite is green.
 */

// ---------------------------------------------------------------------------
// The identity-change vocabulary
// ---------------------------------------------------------------------------

export type IdentityKind = "bibEntry" | "inlineAtom";

/** A citekey rename: the entry `uid` is STABLE; the cascade rewrites the
 *  natural key (`.bib` `key`) + every `\cite{oldKey}` in the editor doc + every
 *  citekey-keyed sidecar (annotations/bib-review re-key by uid are no-ops once
 *  re-keyed, but the citation-refs `keys[]` rewrite and any legacy/orphan
 *  bucket run here). */
export interface RenameCitekeyChange {
  uid: string;
  oldKey: string;
  newKey: string;
  /** The entry's (possibly also-changed) bib type, threaded so the single
   *  writer applies the `.bib` `key`+`type` mutation in one place. Optional —
   *  a pure rename omits it. */
  newType?: string;
}

/** A bib type retype with NO identity move (same uid, same key) — routed
 *  through the same atomic writer for consistency. */
export interface RetypeChange {
  uid: string;
  newType: string;
}

/**
 * An id-regen reconciliation after a markerless re-parse (the Axis-A case,
 * T1 §3.2(c) / PLAN D1.2). The remap is `oldId -> newId` for inline atoms whose
 * `citationId`/`footnoteId` regenerated. Stage 3 (W1b) lands the bus consumer
 * that *produces* this remap; the vocabulary lives here so the cascade is the
 * single owner of every identity move from the start.
 */
export interface RegenIdsChange {
  remap: ReadonlyMap<string, string>;
}

export type IdentityChange =
  | { kind: "bibEntry"; renameCitekey: RenameCitekeyChange }
  | { kind: "bibEntry"; retype: RetypeChange }
  | { kind: "inlineAtom"; regenIds: RegenIdsChange };

/**
 * A migrator reacts to an identity change by re-pointing whatever state it
 * owns. It MUST be idempotent and side-effect-contained (it owns exactly one
 * surface). The cascade calls every registered migrator for the change's kind
 * inside one logical batch. Async is allowed (a sidecar persist) — the cascade
 * awaits all of them so `runIdentityChange` resolves only once the fan-out
 * settled.
 */
export type IdentityMigrator = (change: IdentityChange) => void | Promise<void>;

// ---------------------------------------------------------------------------
// The cascade — a per-document service instance
// ---------------------------------------------------------------------------

/**
 * One cascade instance owns the migrator registry for a single document. It is
 * intentionally NOT a module-level singleton: a multi-window/multi-doc session
 * has independent sidecar state per doc, so each `EditorPane` constructs its
 * own cascade and the sidecar hooks register against *that* instance (threaded
 * via context/props in a later wave; this slice wires it through `useCitations`
 * for the rename path).
 */
export class IdentityCascade {
  private migrators: Map<IdentityKind, Set<IdentityMigrator>> = new Map();

  /**
   * Register a migrator for an identity-change kind. Returns an unregister
   * function (effect-cleanup friendly). Registering the same function twice is
   * a no-op (Set semantics) so a re-render that re-registers can't double-fire.
   */
  registerMigrator(kind: IdentityKind, migrator: IdentityMigrator): () => void {
    let set = this.migrators.get(kind);
    if (!set) {
      set = new Set();
      this.migrators.set(kind, set);
    }
    set.add(migrator);
    return () => {
      this.migrators.get(kind)?.delete(migrator);
    };
  }

  /** Number of migrators registered for a kind (diagnostics / tests). */
  migratorCount(kind: IdentityKind): number {
    return this.migrators.get(kind)?.size ?? 0;
  }

  /**
   * THE single public mutator. Fan a single identity change out to every
   * migrator registered for its kind, in one batch, awaiting all of them. A
   * pure rename with no registered migrators is a well-formed no-op (resolves
   * immediately) — so a caller can always route through the cascade even before
   * any surface has registered (the legacy path stays a fallback behind the
   * flag).
   *
   * Errors in one migrator are isolated: a migrator that throws is logged and
   * the rest still run (a single broken surface must not strand the others —
   * this is the DATA-LOSS class, the bar is "never lose the rename half-way").
   */
  async runIdentityChange(change: IdentityChange): Promise<void> {
    const set = this.migrators.get(change.kind);
    if (!set || set.size === 0) return;
    const results: Array<void | Promise<void>> = [];
    for (const migrator of set) {
      try {
        results.push(migrator(change));
      } catch (err) {
        console.error("IdentityCascade migrator threw (sync):", err);
      }
    }
    await Promise.all(
      results.map((r) =>
        Promise.resolve(r).catch((err) => {
          console.error("IdentityCascade migrator rejected (async):", err);
        }),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Change constructors (keep call sites from building the union by hand)
// ---------------------------------------------------------------------------

export function renameCitekeyChange(
  c: RenameCitekeyChange,
): IdentityChange {
  return { kind: "bibEntry", renameCitekey: c };
}

export function retypeChange(c: RetypeChange): IdentityChange {
  return { kind: "bibEntry", retype: c };
}

export function regenIdsChange(remap: ReadonlyMap<string, string>): IdentityChange {
  return { kind: "inlineAtom", regenIds: { remap } };
}

// ---------------------------------------------------------------------------
// Narrowing helpers (a migrator only handles a subset of the union)
// ---------------------------------------------------------------------------

export function isRenameCitekey(
  change: IdentityChange,
): change is { kind: "bibEntry"; renameCitekey: RenameCitekeyChange } {
  return change.kind === "bibEntry" && "renameCitekey" in change;
}

export function isRetype(
  change: IdentityChange,
): change is { kind: "bibEntry"; retype: RetypeChange } {
  return change.kind === "bibEntry" && "retype" in change;
}

export function isRegenIds(
  change: IdentityChange,
): change is { kind: "inlineAtom"; regenIds: RegenIdsChange } {
  return change.kind === "inlineAtom" && "regenIds" in change;
}
