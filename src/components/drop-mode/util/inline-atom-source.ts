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
 * The captured `pos` is valid for the gesture's lifetime because a
 * drop-mode gesture is synchronous (no typing mutates the doc between
 * grab and release) — but a COLLAB peer's edit is not the gesture's, and
 * that is the async gap the position cannot survive. So the capture also
 * carries the atom's durable `atomId` where its kind has one, and the spec
 * re-resolves by IDENTITY at commit (task 648, the "addressing the live
 * document across an async gap" law). The id-less kinds (`ref`,
 * `inline-math` — no Card, `ATOM_REGISTRY.idAttr: null`) keep the position
 * form with a node-kind check, which for them is the whole question.
 */

import type { Editor } from "@tiptap/react";
import type { AtomKind } from "@/lib/tiptap/atom-registry";

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
  /** Document position of the atom at grab time. */
  pos: number;
  /**
   * The atom's entity id (`footnoteId` / `citationId`) at grab time, or `null`
   * for the id-less kinds. This — not `pos` — is what the commit resolves by
   * when it is present: a position is an address in a document that may have
   * moved under the gesture.
   */
  atomId: string | null;
}

let current: CapturedAtomSource | null = null;

/** Record the grabbed atom. Overwrites any prior slot (one session at a time). */
export function stashInlineAtomSource(source: CapturedAtomSource): void {
  current = source;
}

/** Read the captured source iff its token matches; otherwise null. */
export function readInlineAtomSource(token: string): CapturedAtomSource | null {
  return current && current.token === token ? current : null;
}

/** Clear the slot — called on gesture commit, cancel, and cleanup. */
export function clearInlineAtomSource(): void {
  current = null;
}
