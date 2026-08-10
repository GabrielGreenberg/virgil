/**
 * Generic doc-slice duplicator. Walks a ProseMirror slice and:
 *
 *   1. Remints every TextObject node's `uuid` attr with a fresh 4-hex
 *      short id (`generateShortId`) — the format EVERY TextObject kind
 *      persists in `.tex` source. Driven by [TEXT_OBJECT_REGISTRY](./text-object-registry.ts).
 *      Invariant: every TextObject node leaves the walker with a fresh
 *      uuid, even if the source node was missing one (emits diagnostic).
 *
 *   2. Remints every inline-atom card's id attr (`footnoteId`,
 *      `citationId`) and clones the matching sidecar entry via
 *      [card-lifecycle-registry](../panels/card-lifecycle-registry.tsx).
 *      `INLINE_ATOM_CARDS` is the only kind-aware data here — a 2-entry
 *      lookup table; adding a new inline-atom card kind is one line. This
 *      also descends into an atom's `attrs.content` JSONContent blob (the
 *      footnote body — a place PM's `node.content` traversal can't reach) and
 *      re-identifies the atoms nested there via the same rule, so a `\cite`
 *      inside a footnote gets a fresh citationId + cloned CitationRef instead
 *      of stranding the clone on the source's identity (task 080).
 *
 *   3. Remints every `linkedAnchor` mark's `anchorId` + clones the
 *      sidecar entry the mark points at (`linkCard` → `cardKind:cardId`).
 *      When the source card is missing (unparseable `linkCard` or
 *      `lifecycle.clone()` returns null), the cloned text is STRIPPED of
 *      the mark — an orphan mark is worse than no mark. Diagnostic
 *      emitted so the dispatcher can surface the failure.
 *
 * Zero per-kind switches. Adding a new TextObject kind = one
 * `TEXT_OBJECT_REGISTRY` entry. Adding a new sidecar-bearing card kind =
 * one `registerCardLifecycle` call (registry-side) + (for new inline-atom
 * kinds only) one entry in `INLINE_ATOM_CARDS` here.
 *
 * Diagnostics: pass an optional `DuplicateDiagnostics` collector. Each
 * silent-skip path now emits a tagged warning so the dispatcher can
 * decide whether to log, toast, or abort. See ACTION-MENU-DIAGNOSIS.md
 * followup B1.
 */

import { Slice, Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import { isTextObjectKind } from "./text-object-registry";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import type { CardKind } from "@/panels/_shared/types";
import { generateEntityId, generateShortId } from "@/lib/uuid";
import { linkCardKey, parseLinkCardKey } from "@/links/link-dom-contract";
import { remintNestedAtomIds } from "@/lib/inline-content";

/** Inline-atom card lookup — node-type-name → { CardKind, id-attr-name }.
 *  Only the schema's sidecar-bearing inline atoms appear here. */
const INLINE_ATOM_CARDS: Record<string, { cardKind: CardKind; idAttr: string }> = {
  footnote: { cardKind: "footnote", idAttr: "footnoteId" },
  citation: { cardKind: "citation", idAttr: "citationId" },
};

function inlineAtomCardEntry(
  typeName: string,
): { cardKind: CardKind; idAttr: string } | null {
  return INLINE_ATOM_CARDS[typeName] ?? null;
}

/** Remint a TextObject node's identity.
 *
 *  INVARIANT: **every** TextObject kind persists its id as a 4-hex short id
 *  in the `.tex` source — so all of them mint a `generateShortId()`. The id
 *  round-trips one of three ways, all 4-hex:
 *    • the ` %!v:xxxx` anchor (paragraph, heading, bulletList, orderedList,
 *      blockquote, codeBlock, displayMath, figureBlock, graphicsBlock,
 *      listItem, latexComment) — matched 4-hex-only by `NODE_UUID_REGEX`;
 *    • a `\vXid{xxxx}` short-id command (exampleBlock `\vexid`, exampleItem
 *      `\vxid`, linkedRange `\vlid`);
 *    • the `%!vtex:begin/end xxxx` sentinel (texBlock).
 *  `titleField` persists NO source id (it round-trips via the preamble and
 *  is re-minted short by `block-uuid-backfill` on load), so a short id is
 *  the consistent, harmless choice there too.
 *
 *  There is therefore NO TextObject kind that should mint a 36-char entity
 *  id. The old `meta.sourceMarker?.idLength === 4` proxy was the bug (task
 *  064): only exampleBlock/exampleItem/linkedRange declare a `sourceMarker`,
 *  so the other 13 kinds fell to the `else` and got a `crypto.randomUUID()`
 *  that the 4-hex `%!v:` anchor truncates on the next save+reload — losing
 *  the clone's identity AND leaking the raw `%!v:<uuid>` marker into the
 *  block's own visible text. `sourceMarker` describes the persistence
 *  *mechanism*, not the id *format*; conflating them was the fork.
 *
 *  Pinned by `__tests__/duplicate-slice-idformat.test.ts`, which asserts the
 *  4-hex mint for every kind in `TEXT_OBJECT_REGISTRY` — so a future kind
 *  that genuinely needed a long id would fail loudly here (a conscious
 *  decision) rather than silently corrupting its round-trip.
 *
 *  The `!isTextObjectKind` fallback keeps `generateEntityId()` for any non-
 *  TextObject node routed here; the sole caller already guards on
 *  `isTextObjectKind`, and inline-atom (footnote/citation) clones remint
 *  their own short ids on the atom path above, so it is a defensive branch. */
export function mintUuidForKind(kind: string): string {
  return isTextObjectKind(kind) ? generateShortId() : generateEntityId();
}

/** Tagged diagnostic codes emitted by the duplicate walker. */
export type DuplicateWarnCode =
  | "missing-source-uuid"
  | "orphan-inline-atom"
  | "missing-card-on-mark"
  | "unparseable-link-card";

/** Diagnostic collector — pass to `duplicateSlice` to capture every
 *  non-fatal anomaly the walker encounters. The dispatcher decides
 *  whether to console.warn, toast, or abort. Pure data; no UI deps. */
export interface DuplicateDiagnostics {
  warn(code: DuplicateWarnCode, detail?: object): void;
}

/** Build a fresh diagnostic collector. The `codes` set lets the caller
 *  decide whether to surface anything to the user after the walk. */
export interface DuplicateDiagnosticsHandle extends DuplicateDiagnostics {
  readonly codes: ReadonlySet<DuplicateWarnCode>;
  readonly details: ReadonlyArray<{ code: DuplicateWarnCode; detail?: object }>;
}

export function createDuplicateDiagnostics(): DuplicateDiagnosticsHandle {
  const codes = new Set<DuplicateWarnCode>();
  const details: { code: DuplicateWarnCode; detail?: object }[] = [];
  return {
    codes,
    details,
    warn(code, detail) {
      codes.add(code);
      details.push({ code, detail });
    },
  };
}

/** Public entry point: produce a deep-cloned slice with every identity
 *  reminted and every sidecar card cloned via the lifecycle registry.
 *  Pass `diag` to capture non-fatal anomalies (missing uuids, orphan
 *  atoms, unresolvable card links) for the dispatcher to surface. */
export function duplicateSlice(
  slice: Slice,
  lifecycle: CardLifecycleApi,
  diag?: DuplicateDiagnostics,
): Slice {
  const content = transformFragment(slice.content, lifecycle, diag);
  return new Slice(content, slice.openStart, slice.openEnd);
}

function transformFragment(
  fragment: Fragment,
  lifecycle: CardLifecycleApi,
  diag?: DuplicateDiagnostics,
): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((child) => out.push(transformNode(child, lifecycle, diag)));
  return Fragment.fromArray(out);
}

function transformNode(
  node: PMNode,
  lifecycle: CardLifecycleApi,
  diag?: DuplicateDiagnostics,
): PMNode {
  // Marks: remint linkedAnchor (or strip on unresolvable card); pass
  // other marks through unchanged.
  const newMarks = node.marks.length
    ? node.marks
        .map((mark) => {
          if (mark.type.name !== "linkedAnchor") return mark;
          const linkCard =
            typeof mark.attrs.linkCard === "string" ? mark.attrs.linkCard : "";
          const parsed = parseLinkCardKey(linkCard);
          if (!parsed) {
            // Mark with no resolvable card kind — strip rather than
            // carry forward an orphan. The original mark on the source
            // is left alone.
            diag?.warn("unparseable-link-card", { linkCard });
            return null;
          }
          const clonedId = lifecycle.get(parsed.kind)?.clone(parsed.id) ?? null;
          if (!clonedId) {
            // Card lookup failed; same rationale — strip the cloned
            // mark instead of leaving it pointing at the source's card
            // (which would make two anchors compete for the same card).
            diag?.warn("missing-card-on-mark", {
              cardKind: parsed.kind,
              cardId: parsed.id,
            });
            return null;
          }
          const newAnchorId = generateEntityId();
          return mark.type.create({
            ...mark.attrs,
            anchorId: newAnchorId,
            linkId: newAnchorId,
            linkCard: linkCardKey(parsed.kind, clonedId),
          });
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
    : node.marks;

  // Text nodes have no attrs or content; their identity is (text,
  // marks). `node.type.create()` REJECTS text-node construction with
  // "NodeType.create can't construct text nodes" — so route through
  // `node.mark()` which produces a new text node with the same text
  // and the given marks. This branch is what kept the pre-fix
  // duplicate broken for any text-bearing paragraph — every text child
  // hit the create-throw below.
  if (node.isText) {
    return newMarks === node.marks ? node : node.mark(newMarks);
  }

  // Recurse for non-text nodes so the rebuilt node carries rewritten
  // children. (Text nodes have empty content, no need to recurse.)
  const newContent = node.content.size
    ? transformFragment(node.content, lifecycle, diag)
    : node.content;

  // Attrs: remint inline-atom id (if applicable) + TextObject uuid.
  const newAttrs: Record<string, unknown> = { ...node.attrs };

  const atom = inlineAtomCardEntry(node.type.name);
  if (atom) {
    const oldId =
      typeof newAttrs[atom.idAttr] === "string"
        ? (newAttrs[atom.idAttr] as string)
        : "";
    if (oldId) {
      const cloned = lifecycle.get(atom.cardKind)?.clone(oldId);
      if (cloned == null) {
        // Card kind opted out or source id missing. Mint a placeholder
        // so the schema stays valid; surface via diagnostic. The
        // resulting atom is orphan (no sidecar) — visible as a
        // footnote/citation with no card behind it.
        diag?.warn("orphan-inline-atom", {
          cardKind: atom.cardKind,
          sourceId: oldId,
        });
      }
      newAttrs[atom.idAttr] = cloned ?? generateShortId();
    }
  }

  // An inline atom whose body is a JSONContent blob (the footnote's
  // `attrs.content`) hides FURTHER inline atoms that the `node.content`
  // traversal above never reaches — a `\cite` nested in the footnote body
  // (`content: { default: null }`, so `node.content.size` is 0). Re-identify
  // them the SAME way the top-level atom branch does: clone each nested atom's
  // sidecar and rewrite its id in the cloned blob. Without this the clone's
  // nested cite keeps the SOURCE's citationId with no cloned CitationRef,
  // stranding two footnotes on one citation identity (duplicate-id sidecar +
  // a delete that strikes both — task 080). Gated on the blob's presence, not
  // on the footnote kind, so any future content-blob-bearing atom inherits it.
  const contentBlob = newAttrs.content;
  if (contentBlob && typeof contentBlob === "object") {
    const { content: reminted } = remintNestedAtomIds(
      contentBlob as JSONContent,
      (typeName, oldNestedId) => {
        const nestedAtom = inlineAtomCardEntry(typeName);
        // inlineMath / labelRef and the like carry no cloneable sidecar
        // identity — leave them untouched (their attrs are safe to share).
        if (!nestedAtom) return null;
        const clonedNested =
          lifecycle.get(nestedAtom.cardKind)?.clone(oldNestedId) ?? null;
        if (clonedNested == null) {
          diag?.warn("orphan-inline-atom", {
            cardKind: nestedAtom.cardKind,
            sourceId: oldNestedId,
          });
        }
        return clonedNested;
      },
    );
    newAttrs.content = reminted;
  }

  // INVARIANT: every TextObject node leaves the walker with a fresh
  // uuid, full stop. The previous `&& uuid.length > 0` guard let
  // uuid-less paragraphs propagate the empty string into the clone,
  // producing duplicate-identity issues that surfaced as silent-broken
  // paragraph Duplicate. If a source was missing a uuid, emit a
  // diagnostic but still mint — the clone must have its own identity.
  if (isTextObjectKind(node.type.name)) {
    const sourceUuid = typeof newAttrs.uuid === "string" ? newAttrs.uuid : "";
    if (!sourceUuid) {
      diag?.warn("missing-source-uuid", { kind: node.type.name });
    }
    newAttrs.uuid = mintUuidForKind(node.type.name);
  }

  return node.type.create(newAttrs, newContent, newMarks);
}
