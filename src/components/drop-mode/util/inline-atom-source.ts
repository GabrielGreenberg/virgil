/**
 * Single-slot capture for the in-text inline-atom grab gesture.
 *
 * The four canonical Atoms (footnote, citation, \ref/labelRef, inline
 * math) are dragged to a new inline-cursor position by the
 * `InlineAtomGrab` plugin. footnote/citation carry an id and *could* be
 * re-found by scan, but \ref and inline math carry NO id — so the grab
 * captures the exact source node at mousedown and the `inTextAtomGrab`
 * drop spec resolves from this capture instead of by id. One uniform
 * path for all four kinds, and the only path the id-less kinds have.
 *
 * Only ONE drop session is ever active (the controller enforces this),
 * so a single module-level slot suffices — no map. The slot is keyed by
 * a token embedded in the cardKey (`atom-grab:<token>`) so a stale slot
 * from an abandoned gesture can never satisfy a later one.
 *
 * No typing mutates the doc between grab and release — but a COLLAB peer's
 * edit, an agent writeback reloaded into the view, or a timed transaction is
 * not the gesture's, and that is the async gap a raw position cannot survive.
 * So the capture's position is FOLLOWED (`at`, a `trackPos` handle started at
 * mousedown, task 1635): it is mapped through every transaction that lands
 * mid-drag and reads `null` once the spot itself was deleted. The followed
 * position is then CONFIRMED by identity (task 648, the "addressing the live
 * document across an async gap" law): the durable `atomId` where the kind has
 * one — which also re-finds the atom anywhere if the position fails — and, for
 * the id-less kinds (`ref`, `inline-math`, `dynamic` — no Card,
 * `ATOM_REGISTRY.idAttr: null`), the grabbed NODE's content (task 1574). An
 * id-less atom has nothing to re-find it by, so a followed position that no
 * longer holds it is a refusal, never a nearest-content-match guess (which
 * moved a DIFFERENT identical `$x$` once the grabbed one had shifted).
 *
 * The rule, stated once: **follow the position; confirm by id where the
 * registry has one, content fingerprint otherwise.**
 *
 * The slot OWNS the `at` handle: overwriting or clearing the slot disposes it,
 * and the gesture clears the slot on every way its session ends.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { AtomKind } from "@/lib/tiptap/atom-registry";
import type { TrackedPos } from "@/lib/tiptap/tracked-pos";

export interface CapturedAtomSource {
  /** Opaque token echoed in the cardKey (`atom-grab:<token>`). */
  token: string;
  /** Atom-registry kind. TYPED from the registry (task 645) — it used to be a
   *  plain `string` whose real vocabulary lived only in this doc-comment, so a
   *  typo'd kind captured cleanly and failed at commit.
   *
   *  `nodeName` below stays `string` deliberately: `AtomMeta.nodeName` is
   *  declared `string`, so a literal union for it could only come from the
   *  registry OBJECT, and deriving it there while `AtomMeta` constrains that
   *  same object is circular. A union nothing could flow into would be
   *  vocabulary declared and unread — the drift this task is closing, one
   *  level up. */
  kind: AtomKind;
  /** Schema node name to verify at commit ("footnote" | "citation" | …). */
  nodeName: string;
  /** The editor the atom lives in (main or a card-body editor). */
  editor: Editor;
  /** The atom's position, FOLLOWED from mousedown through every transaction
   *  that landed since (task 1635) — `get()` is `null` once the spot was
   *  deleted. A hint the commit confirms by identity, never trusts alone. */
  at: TrackedPos;
  /**
   * The atom's entity id (`footnoteId` / `citationId`) at grab time, or `null`
   * for the id-less kinds. Where present it CONFIRMS the followed position and,
   * should that fail, re-finds the atom anywhere in the document: the id is the
   * same atom whatever the document did.
   */
  atomId: string | null;
  /**
   * The grabbed node as it stood at mousedown — the CONTENT fingerprint the
   * commit confirms an id-less kind against (task 1574). Captured for every
   * kind (it is the node already in hand), but only READ where `atomId` is
   * null: an id-bearing atom whose attrs a peer edited is still the same atom.
   */
  atomNode: PMNode;
}

let current: CapturedAtomSource | null = null;

/** Record the grabbed atom. Overwrites any prior slot (one session at a time),
 *  disposing the tracker it held. */
export function stashInlineAtomSource(source: CapturedAtomSource): void {
  if (current && current.at !== source.at) current.at.dispose();
  current = source;
}

/** Read the captured source iff its token matches; otherwise null. */
export function readInlineAtomSource(token: string): CapturedAtomSource | null {
  return current && current.token === token ? current : null;
}

/** Clear the slot — called on gesture commit, cancel, and cleanup. */
export function clearInlineAtomSource(): void {
  current?.at.dispose();
  current = null;
}
