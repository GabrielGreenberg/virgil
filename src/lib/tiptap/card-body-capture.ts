/**
 * **card-body-capture — the ONE door from a document slice to a card-body
 * payload.** A destructive capture (today: Archive) derives its payload here,
 * and stores exactly what this returned.
 *
 * ## Why this is a door and not two calls
 *
 * The never-destroy invariant (task 308) says a destructive lifecycle action
 * must never delete content its capture destination cannot hold, and it is
 * enforced by asking the destination's real schema. That is right, and it is
 * only right about **the payload that will actually be stored**.
 *
 * Task 393 is what happens when it isn't. The archive dispatcher validated the
 * RAW slice JSON while the write path stored the NORMALIZED one — and the
 * normalizer deliberately strips `DOC_ONLY_MARKS` (`linkedAnchor`, the doc-level
 * anchor mark), which the excerpt schema deliberately does not register FOR THAT
 * REASON. So the guard asked about a payload the write never stores, and any
 * passage carrying a Mode-B text anchor — i.e. exactly the worked-over prose a
 * user most wants to archive — was refused for a loss that could not happen.
 * Two tables, one question: the shape every law in AGENTS.md is written against.
 *
 * So: NORMALIZE, then VALIDATE THAT, and hand back the validated object. The
 * caller stores the `content` it was given, so the guard and the write cannot
 * disagree about what is being judged — a property of the door rather than
 * something a call site has to remember.
 *
 * ## And a refusal NAMES what it refused
 *
 * When the check does fire for a genuine vocabulary gap it is telling the user
 * their action was declined; "part of it" gives them nothing to act on. The
 * refusal carries the offending construct names, DERIVED from the schema's own
 * vocabulary ({@link unsupportedConstructs}) rather than parsed out of
 * ProseMirror's message.
 *
 * Cheap: one JSON walk plus one `Schema.nodeFromJSON` over the captured slice
 * (edit-sized, not doc-sized), on a discrete user action — never a keystroke.
 */
import { Slice } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import { normalizeRichContent } from "@/lib/footnote-content";
import { unsupportedConstructs } from "@/lib/tiptap/schema-mount";
import {
  canMountInCardBody,
  cardBodySchemaFor,
  type CardBodySchemaScope,
} from "@/lib/tiptap/borrowed-schema";

/**
 * The prepared capture. On `ok` the `content` is BOTH what was validated and
 * what the caller must store — never re-derive a second payload from the
 * source.
 */
export type CardBodyCapture =
  | { ok: true; content: JSONContent }
  | {
      ok: false;
      /** ProseMirror's own message, for the console. */
      reason: string;
      /** Node/mark names the destination schema has not got. May be empty when
       *  the mount failed for a content expression rather than a vocabulary
       *  gap — see {@link unsupportedConstructs}. */
      constructs: string[];
    };

/**
 * A ProseMirror `Slice` as a schema-valid `doc` JSON, suitable for booting a
 * fresh TipTap editor (the archive snippet's mini-editor).
 *
 * Why this is non-trivial: a slice from `doc.slice(from, to)` carries
 * `openStart` / `openEnd` — the boundaries cut THROUGH ancestor nodes. For a
 * selection inside a paragraph the content Fragment holds INLINE children (text
 * + inline marks), not a paragraph; for a multi-paragraph selection with
 * partial ends it is MIXED. A card body's `doc.content` is `block+`, so bare
 * inline children at doc level throw `contentMatchAt on a node with invalid
 * content` when the body mounts.
 *
 * Algorithm: walk the top-level children; inline runs accumulate into a buffer,
 * each block child flushes that buffer into a paragraph and emits itself, with
 * a final flush at the end. Handles every shape —
 *   - all-inline (single-paragraph sub-range): one paragraph wrapping all;
 *   - all-block (full-paragraph selection): blocks pass through unwrapped;
 *   - mixed: inline runs at the boundaries become paragraphs flanking the
 *     middle blocks.
 */
function sliceToDocJson(slice: Slice): JSONContent {
  const docContent: JSONContent[] = [];
  let openInline: JSONContent[] = [];
  const flushInline = () => {
    if (openInline.length === 0) return;
    docContent.push({ type: "paragraph", content: openInline });
    openInline = [];
  };
  slice.content.forEach((child) => {
    if (child.isBlock) {
      flushInline();
      docContent.push(child.toJSON() as JSONContent);
    } else {
      openInline.push(child.toJSON() as JSONContent);
    }
  });
  flushInline();
  return { type: "doc", content: docContent };
}

/**
 * Derive the payload a card body at `scope` would store from `source`, and
 * prove the destination can hold it.
 *
 * `source` is a live `Slice` (the capture shape) or any JSON the card
 * normalizer accepts. On `ok: false` the caller MUST abort the destructive half
 * — nothing has been deleted yet, and the alternative is a section removed from
 * the document and a card that renders blank.
 */
export function prepareCardBodyCapture(
  source: Slice | unknown,
  scope: CardBodySchemaScope,
): CardBodyCapture {
  const raw = source instanceof Slice ? sliceToDocJson(source) : source;
  // The SAME normalize the write performs (`useArchive.updateSnippet` →
  // `normalizeRichContent`), run BEFORE the check rather than after it. This
  // line is the whole of task 393: what is judged is what is stored.
  const content = normalizeRichContent(raw);
  // ONE probe, still: `canMountInCardBody` stays the authority on whether the
  // destination can hold this (it asks the schema itself). The schema is
  // re-read below only to NAME the gap, and only on the failure path.
  const check = canMountInCardBody(content, scope);
  if (check.ok) return { ok: true, content };
  return {
    ok: false,
    reason: check.reason,
    constructs: unsupportedConstructs(cardBodySchemaFor(scope), content),
  };
}

/**
 * The noun phrase a refusal message slots in: the construct names when the
 * schema could name them, else the probe's own reason. Shared so every capture
 * surface refuses in one voice.
 */
export function describeCardBodyRefusal(
  refusal: Extract<CardBodyCapture, { ok: false }>,
): string {
  const names = refusal.constructs.map((n) => `“${n}”`);
  if (names.length === 0) return `part of it (${refusal.reason})`;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
