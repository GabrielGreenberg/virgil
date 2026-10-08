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
 *      There is no kind-aware data here at all: the `{nodeName, idAttr}`
 *      pair comes from `cardAtomMetaForNodeName`, the ATOM_REGISTRY's own
 *      Card-bearing narrowing (task 645), so adding a new inline-atom card
 *      kind is one registry row and no edit here. This
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
 * kinds only) an `idAttr`/`domIdAttr` on its `ATOM_REGISTRY` row.
 *
 * Diagnostics: pass an optional `DuplicateDiagnostics` collector. Each
 * silent-skip path now emits a tagged warning so the dispatcher can
 * decide whether to log, toast, or abort. See ACTION-MENU-DIAGNOSIS.md
 * followup B1.
 */

import { Slice, Fragment, type Mark, type Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import { isTextObjectKind } from "./text-object-registry";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import type { CardKind } from "@/panels/_shared/types";
import { generateEntityId, generateShortId } from "@/lib/uuid";
import { linkCardKey, parseLinkCardKey } from "@/links/link-dom-contract";
import { mapJsonDeep, remintNestedAtomIds } from "@/lib/inline-content";
import { collectLabelKeysIn } from "@/lib/labels";
import { LABEL_DECLARING_NODE_TYPES } from "@/lib/node-attr-sets";
import { cardAtomMetaForNodeName } from "@/lib/tiptap/atom-registry";

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
 *  064): only exampleBlock/exampleItem/linkedRange declared a `sourceMarker`,
 *  so the other 13 kinds fell to the `else` and got a `crypto.randomUUID()`
 *  that the 4-hex `%!v:` anchor truncates on the next save+reload — losing
 *  the clone's identity AND leaking the raw `%!v:<uuid>` marker into the
 *  block's own visible text. The facet described the persistence *mechanism*,
 *  not the id *format*; conflating them was the fork. (That facet is gone
 *  entirely as of task 255 — the marker vocabulary lives in
 *  `src/lib/latex-markers.ts` — so the proxy is not merely unread now but
 *  unspellable.)
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

/** Options for one duplicate walk. */
export interface DuplicateSliceOptions {
  /** Every `\label` key the TARGET document already declares
   *  (`collectLabelKeysIn(doc)`). A duplicated declaration takes the first
   *  `<key>-N` free against this set AND every key minted earlier in the same
   *  walk. Omitted → only the slice's own keys count as taken, which still
   *  guarantees the copy never re-declares the source's key. Deterministic in
   *  its input, so the dry walk and the real walk (task 735) mint the SAME
   *  labels. */
  takenLabels?: ReadonlySet<string>;
}

/** Public entry point: produce a deep-cloned slice with every identity
 *  reminted and every sidecar card cloned via the lifecycle registry.
 *  Pass `diag` to capture non-fatal anomalies (missing uuids, orphan
 *  atoms, unresolvable card links) for the dispatcher to surface. */
export function duplicateSlice(
  slice: Slice,
  lifecycle: CardLifecycleApi,
  diag?: DuplicateDiagnostics,
  opts?: DuplicateSliceOptions,
): Slice {
  const table = createRemintTable(lifecycle, diag, opts?.takenLabels ?? collectSliceLabels(slice));
  const content = transformFragment(slice.content, table);
  return new Slice(content, slice.openStart, slice.openEnd);
}

// ---------------------------------------------------------------------------
// The REMINT TABLE (task 1002) — identity is reminted once per ENTITY, not once
// per node the walk happens to visit.
//
// An identity can span several nodes: one `linkedAnchor` anchorId covers every
// text node of "plain **bold** plain", or a span across two paragraphs, or the
// text either side of a footnote atom. A walker that decides each node's new
// identity locally clones the card once PER FRAGMENT — the copy lands with N
// cards each on one fragment, where the source had one card on the span. So
// every identity the walk remints goes through ONE per-walk table keyed by the
// SOURCE identity: the first visit mints (clones the card, mints the id, derives
// the label), every later visit reads the answer back. Including a failure: a
// mark whose card could not be cloned is stripped on every fragment, with one
// diagnostic.
//
// Labels are identities too. A `\label` key copied verbatim declares the same
// key twice — LaTeX's "multiply defined", the ref index resolving to the first,
// and `renameLabelWithRefs` on the COPY carrying every `\ref` in the paper to
// it. The table therefore remints every declaration `collectLabelKeysIn` can
// see — the declaring nodes' `label` attr (`LABEL_DECLARING_NODE_TYPES`), a
// `displayMath` source, raw `\label{}` text, and footnote-body text — to a
// fresh `<key>-N`. A `\ref` INSIDE the copy keeps pointing at the source's key:
// whether a copied cross-reference should follow the copy is the author's
// call, and the source's refs are never touched.
// ---------------------------------------------------------------------------

interface RemintTable {
  readonly lifecycle: CardLifecycleApi;
  readonly diag?: DuplicateDiagnostics;
  /** `linkedAnchor` mark → its reminted mark attrs, or null = strip. Keyed by
   *  the source anchorId (falling back to the linkCard for an id-less mark). */
  anchor(mark: Mark): Record<string, unknown> | null;
  /** Inline-atom card → its cloned id, or null when no card could be cloned. */
  atom(kind: CardKind, sourceId: string): string | null;
  /** A source `\label` key → the copy's fresh key. */
  label(sourceKey: string): string;
}

const LABEL_CMD_RE = /\\label\{([^}]+)\}/g;

function createRemintTable(
  lifecycle: CardLifecycleApi,
  diag: DuplicateDiagnostics | undefined,
  takenLabels: ReadonlySet<string>,
): RemintTable {
  const anchors = new Map<string, Record<string, unknown> | null>();
  const atoms = new Map<string, string | null>();
  const labels = new Map<string, string>();
  const taken = new Set(takenLabels);

  return {
    lifecycle,
    diag,
    anchor(mark) {
      const linkCard =
        typeof mark.attrs.linkCard === "string" ? mark.attrs.linkCard : "";
      const anchorId =
        typeof mark.attrs.anchorId === "string" ? mark.attrs.anchorId : "";
      const key = anchorId || `card:${linkCard}`;
      if (anchors.has(key)) return anchors.get(key)!;
      let out: Record<string, unknown> | null = null;
      const parsed = parseLinkCardKey(linkCard);
      if (!parsed) {
        // Mark with no resolvable card kind — strip rather than carry
        // forward an orphan. The original mark on the source is left alone.
        diag?.warn("unparseable-link-card", { linkCard });
      } else {
        const clonedId = lifecycle.get(parsed.kind)?.clone(parsed.id) ?? null;
        if (!clonedId) {
          // Card lookup failed; same rationale — strip the cloned mark
          // instead of leaving it pointing at the source's card (which
          // would make two anchors compete for the same card).
          diag?.warn("missing-card-on-mark", {
            cardKind: parsed.kind,
            cardId: parsed.id,
          });
        } else {
          const newAnchorId = generateEntityId();
          out = {
            ...mark.attrs,
            anchorId: newAnchorId,
            linkId: newAnchorId,
            linkCard: linkCardKey(parsed.kind, clonedId),
          };
        }
      }
      anchors.set(key, out);
      return out;
    },
    atom(kind, sourceId) {
      const key = `${kind}:${sourceId}`;
      if (atoms.has(key)) return atoms.get(key)!;
      const cloned = lifecycle.get(kind)?.clone(sourceId) ?? null;
      if (cloned == null) {
        diag?.warn("orphan-inline-atom", { cardKind: kind, sourceId });
      }
      atoms.set(key, cloned);
      return cloned;
    },
    label(sourceKey) {
      const known = labels.get(sourceKey);
      if (known) return known;
      const m = /^(.*?)-(\d+)$/.exec(sourceKey);
      const base = m ? m[1] : sourceKey;
      let n = m ? Number(m[2]) + 1 : 2;
      while (taken.has(`${base}-${n}`)) n++;
      const fresh = `${base}-${n}`;
      taken.add(fresh);
      labels.set(sourceKey, fresh);
      return fresh;
    },
  };
}

/** Every `\label` key the slice itself declares — the floor of the taken set
 *  when the caller supplies none (the source is always in the slice). */
function collectSliceLabels(slice: Slice): Set<string> {
  return collectLabelKeysIn(slice.content);
}

/** Rewrite every `\label{key}` in raw source to the table's fresh key. */
function remintRawLabels(text: string, table: RemintTable): string {
  if (!text.includes("\\label{")) return text;
  return text.replace(LABEL_CMD_RE, (_all, key: string) => `\\label{${table.label(key)}}`);
}

function transformFragment(fragment: Fragment, table: RemintTable): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((child) => out.push(transformNode(child, table)));
  return Fragment.fromArray(out);
}

function transformNode(node: PMNode, table: RemintTable): PMNode {
  const { diag } = table;
  // Marks: remint linkedAnchor through the table (or strip on an
  // unresolvable card); pass other marks through unchanged.
  const newMarks = node.marks.length
    ? node.marks
        .map((mark) => {
          if (mark.type.name !== "linkedAnchor") return mark;
          const attrs = table.anchor(mark);
          return attrs ? mark.type.create(attrs) : null;
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
    : node.marks;

  // Text nodes have no attrs or content; their identity is (text,
  // marks). `node.type.create()` REJECTS text-node construction with
  // "NodeType.create can't construct text nodes" — so route through
  // `schema.text` / `node.mark()`. A raw `\label{}` in the text is a
  // declaration and is reminted like any other.
  if (node.isText) {
    const text = node.text ?? "";
    const newText = remintRawLabels(text, table);
    if (newText !== text) return node.type.schema.text(newText, newMarks);
    return newMarks === node.marks ? node : node.mark(newMarks);
  }

  // Recurse for non-text nodes so the rebuilt node carries rewritten
  // children. (Text nodes have empty content, no need to recurse.)
  const newContent = node.content.size
    ? transformFragment(node.content, table)
    : node.content;

  // Attrs: remint inline-atom id (if applicable) + TextObject uuid.
  const newAttrs: Record<string, unknown> = { ...node.attrs };

  const atom = cardAtomMetaForNodeName(node.type.name);
  if (atom) {
    const oldId =
      typeof newAttrs[atom.idAttr] === "string"
        ? (newAttrs[atom.idAttr] as string)
        : "";
    if (oldId) {
      // Card kind opted out or source id missing → a placeholder keeps the
      // schema valid; the table already surfaced the diagnostic. The
      // resulting atom is orphan (no sidecar) — visible as a
      // footnote/citation with no card behind it.
      newAttrs[atom.idAttr] = table.atom(atom.kind, oldId) ?? generateShortId();
    }
  }

  // An inline atom whose body is a JSONContent blob (the footnote's
  // `attrs.content`) hides FURTHER inline atoms that the `node.content`
  // traversal above never reaches — a `\cite` nested in the footnote body
  // (`content: { default: null }`, so `node.content.size` is 0). Re-identify
  // them through the SAME table the top-level atom branch uses: clone each
  // nested atom's sidecar and rewrite its id in the cloned blob. Without this
  // the clone's nested cite keeps the SOURCE's citationId with no cloned
  // CitationRef, stranding two footnotes on one citation identity
  // (duplicate-id sidecar + a delete that strikes both — task 080). Gated on
  // the blob's presence, not on the footnote kind, so any future
  // content-blob-bearing atom inherits it. A raw `\label{}` in the body is a
  // declaration `collectLabelKeysIn` sees there, so it is reminted too.
  const contentBlob = newAttrs.content;
  if (contentBlob && typeof contentBlob === "object") {
    const { content: reminted } = remintNestedAtomIds(
      contentBlob as JSONContent,
      (typeName, oldNestedId) => {
        const nestedAtom = cardAtomMetaForNodeName(typeName);
        // inlineMath / labelRef and the like carry no cloneable sidecar
        // identity — leave them untouched (their attrs are safe to share).
        if (!nestedAtom) return null;
        return table.atom(nestedAtom.kind, oldNestedId);
      },
    );
    newAttrs.content = mapJsonDeep(reminted, (j) => {
      if (j.type !== "text" || !j.text) return j;
      const text = remintRawLabels(j.text, table);
      return text === j.text ? j : { ...j, text };
    });
  }

  // Label declarations — the same set `collectLabelKeysIn` reads.
  if (LABEL_DECLARING_NODE_TYPES.has(node.type.name)) {
    const label = newAttrs.label;
    if (typeof label === "string" && label) newAttrs.label = table.label(label);
  }
  if (node.type.name === "displayMath" && typeof newAttrs.latex === "string") {
    newAttrs.latex = remintRawLabels(newAttrs.latex, table);
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

// ---------------------------------------------------------------------------
// Staging the walk's card half (task 735).
//
// `lifecycle.clone` MINTS the id the duplicated slice must carry, so the walk
// cannot produce a slice without first creating sidecar cards. A caller that
// has to ask "will this transaction even land?" before creating anything walks
// TWICE: once DRY — every clone answers a placeholder and writes nothing, so the
// slice has the real one's exact shape (a dry clone never answers null, and the
// real walk's null only ever strips a mark or keeps the atom under a fresh id)
// — and, only once the dry build is admitted, for real, through a RECORDING
// lifecycle that can take back what it minted if the commit is refused anyway.
// ---------------------------------------------------------------------------

/** The placeholder a dry clone answers. Never persisted: the dry slice is only
 *  ever validated and probed, never dispatched. */
const DRY_CLONE_ID = "dry-clone";

/**
 * A lifecycle with the SAME kind coverage as `real` whose clones mint nothing.
 * Coverage matters: a kind the real registry lacks strips its mark in the real
 * walk, so the dry walk must strip it too.
 */
export function dryCloneLifecycle(real: CardLifecycleApi): CardLifecycleApi {
  return {
    get: (kind) => {
      const entry = real.get(kind);
      if (!entry) return null;
      return { clone: () => DRY_CLONE_ID, delete: () => {} };
    },
  };
}

/** A pass-through lifecycle that remembers every clone it minted. */
export interface RecordingCloneLifecycle {
  api: CardLifecycleApi;
  /** Delete every clone minted through `api` — the compensation for a commit
   *  that refused after the real walk ran. */
  rollback(): void;
}

export function recordingCloneLifecycle(
  real: CardLifecycleApi,
): RecordingCloneLifecycle {
  const minted: Array<{ kind: CardKind; id: string }> = [];
  return {
    api: {
      get: (kind) => {
        const entry = real.get(kind);
        if (!entry) return null;
        return {
          ...entry,
          clone: (sourceId) => {
            const id = entry.clone(sourceId);
            if (id != null) minted.push({ kind, id });
            return id;
          },
        };
      },
    },
    rollback: () => {
      for (const { kind, id } of minted.splice(0)) {
        void real.get(kind)?.delete(id);
      }
    },
  };
}
