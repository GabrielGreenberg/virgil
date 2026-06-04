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
 * grab and release). The spec re-reads `doc.nodeAt(pos)` at commit and
 * verifies the node kind, so a concurrent (collab) edit that shifted the
 * atom degrades to a silent no-op rather than moving the wrong node.
 */

import type { Editor } from "@tiptap/react";

export interface CapturedAtomSource {
  /** Opaque token echoed in the cardKey (`atom-grab:<token>`). */
  token: string;
  /** Atom-registry kind ("footnote" | "citation" | "ref" | "inline-math"). */
  kind: string;
  /** Schema node name to verify at commit ("footnote" | "citation" | …). */
  nodeName: string;
  /** The editor the atom lives in (main or a card-body editor). */
  editor: Editor;
  /** Document position of the atom at grab time. */
  pos: number;
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
