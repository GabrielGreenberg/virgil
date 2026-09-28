/**
 * borrowed-render — static HTML for a borrowed card body (perf Wave 3, T1).
 *
 * The presence-tier system renders a COLLAPSED card body as static HTML
 * instead of mounting a read-only TipTap editor per card (the diagnosis's
 * 881-live-editors problem). This module is the render SSOT for that tier:
 * the SAME normalize → citation-refresh pipeline the live `BorrowedMainText`
 * runs, serialized over the SAME extension list `buildCardBodySchema`
 * composes — byte-identical schema by construction, never a hand copy (the
 * task-308 discipline: a static tier is a THIRD body surface bound by the
 * same scope rule as the other two).
 *
 * "Visually identical to the live body" is a DECLARED, TESTED property, not an
 * assumption (task 823). Static serialization runs each node's `renderHTML`
 * and NO NodeViews and NO plugins, so wherever the live look comes from one of
 * those, the static render diverges unless the node carries a static twin:
 *
 *  - {@link STATIC_TWIN_NODE_TYPES} — every NodeView-bearing node whose
 *    `renderHTML` reproduces the view: the paragraph (`p-cmd-only` stamp),
 *    the citation (`citationDisplay`: sanitized i/b + the empty `[cite]`
 *    pill), the footnote marker and label ref (same text), and the math
 *    atoms (raw source + a `latex` attribute; `StaticBorrowedText` runs the
 *    one-shot KaTeX pass over `STATIC_MATH_SELECTORS`).
 *  - the one PLUGIN look — the `.latex-cmd` grey mono span the latexCommand
 *    decoration paints over bare `\foo` runs — is reproduced by a static
 *    pass here ({@link withStaticCommandRuns}) through the SAME scanner.
 *  - every OTHER NodeView-bearing node in a scope (expex examples, figures,
 *    forest/tex blocks, `%` comments, the title block, …) is T1-UNSAFE:
 *    {@link bodyNeedsLiveRender} answers true for a body holding one, and the
 *    tier hook promotes that card to the live (T2) body instead of painting a
 *    render that drops, e.g., an example's visible `(N)`.
 *
 * `static-render-parity.test.tsx` derives the NodeView census from the
 * extension list and fails when a new NodeView-bearing node is neither a twin
 * nor unsafe-by-derivation, and renders each twin both ways to compare.
 *
 * Failure is a REFUSAL, not a blank: TipTap swallows schema mismatches into
 * empty documents elsewhere (the task-308 lesson), but `Node.fromJSON`
 * throws on an unknown node type — so `renderBorrowedHtml` catches and
 * returns null, and the caller falls back to the plain-text summary. A card
 * the static tier can't render keeps showing its text rather than nothing.
 */

import { getSchema, type AnyExtension, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/react";
import {
  DOMSerializer,
  Fragment,
  Node as PMNode,
  type Schema,
} from "@tiptap/pm/model";
import {
  buildCardBodySchema,
  starterKitConfigForScope,
  type CardBodySchemaScope,
} from "@/lib/tiptap/borrowed-schema";
import { normalizeRichContent } from "@/lib/footnote-content";
import { forEachBareCommand } from "@/lib/tiptap/cmd-only-paragraph";
import { inlineIsProse } from "@/lib/prose-index";
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";

/**
 * Rewrite citation nodes so their `displayText` reflects the current
 * bibliography lookup (persisted nodes often saved `displayText=""`). Pure.
 * Factored out of BorrowedMainText (its sole owner pre-Wave-3) so the live
 * editor and the static tier resolve citations through ONE walk — the
 * `resolve(command) || command` fallback included.
 */
export function refreshCitationDisplay(
  doc: JSONContent,
  resolve: ((command: string) => string) | undefined,
): JSONContent {
  if (!resolve) return doc;
  function walk(node: JSONContent): JSONContent {
    if (node.type === "citation" && node.attrs) {
      const command = (node.attrs.command as string) || "";
      const desired = resolve!(command) || command;
      if (node.attrs.displayText !== desired) {
        return { ...node, attrs: { ...node.attrs, displayText: desired } };
      }
      return node;
    }
    if (node.content) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  }
  return walk(doc);
}

// One extension list per scope, cached — composed once. Composition mirrors
// BorrowedMainText's editor construction exactly (StarterKit at the scope's
// config + the borrowed sub-schema with includeLabelRefFootnote), which is
// also what borrowed-schema's own `cardBodySchemaFor` composes for the
// capture guard.
const EXTENSIONS_CACHE = new Map<CardBodySchemaScope, Extensions>();

export function extensionsForScope(scope: CardBodySchemaScope): Extensions {
  const cached = EXTENSIONS_CACHE.get(scope);
  if (cached) return cached;
  const exts: Extensions = [
    StarterKit.configure({ ...starterKitConfigForScope(scope) }),
    ...buildCardBodySchema(scope, { includeLabelRefFootnote: true }),
  ];
  EXTENSIONS_CACHE.set(scope, exts);
  return exts;
}

// ---------------------------------------------------------------------------
// The static-render census (task 823)
// ---------------------------------------------------------------------------

/** The display-math atom has no ATOM_REGISTRY row (it is a block, not an
 *  inline atom); its DOM type is spelled once, here and in math.ts. */
const DISPLAY_MATH_DOM_TYPE = "display-math";

/** The math spans the one-shot KaTeX pass repaints — read from the atom
 *  registry, not hand-spelled at the pass. */
export const STATIC_MATH_SELECTORS = {
  inline: `span[data-type="${ATOM_REGISTRY["inline-math"].domType}"]`,
  display: `div[data-type="${DISPLAY_MATH_DOM_TYPE}"]`,
} as const;

/**
 * NodeView-bearing node types whose `renderHTML` IS the static twin of the
 * view — each pinned by a render-both-ways case in the parity test.
 */
export const STATIC_TWIN_NODE_TYPES: ReadonlySet<string> = new Set([
  "paragraph", // CardParagraph renderHTML stamps p-cmd-only
  ATOM_REGISTRY.citation.nodeName, // citationDisplay, shared with the view
  ATOM_REGISTRY.footnote.nodeName, // same marker text
  ATOM_REGISTRY.ref.nodeName, // same display text
  ATOM_REGISTRY["inline-math"].nodeName, // KaTeX pass (StaticBorrowedText)
  "displayMath", // KaTeX pass (StaticBorrowedText)
]);

function flattenExtensions(exts: readonly AnyExtension[]): AnyExtension[] {
  const out: AnyExtension[] = [];
  const visit = (ext: AnyExtension) => {
    out.push(ext);
    const add = (ext.config as { addExtensions?: (this: unknown) => AnyExtension[] })
      .addExtensions;
    if (add) {
      const children = add.call({
        name: ext.name,
        options: ext.options,
        storage: {},
        parent: undefined,
        editor: undefined,
      });
      children.forEach(visit);
    }
  };
  exts.forEach(visit);
  return out;
}

const UNSAFE_CACHE = new Map<CardBodySchemaScope, ReadonlySet<string>>();

/**
 * The node types at `scope` whose live look comes from a NodeView with no
 * static twin — DERIVED from the extension list (every node extension with an
 * `addNodeView`, minus {@link STATIC_TWIN_NODE_TYPES}), so a NodeView added
 * tomorrow is unsafe by default rather than silently diverging.
 */
export function t1UnsafeNodeTypes(scope: CardBodySchemaScope): ReadonlySet<string> {
  const cached = UNSAFE_CACHE.get(scope);
  if (cached) return cached;
  const out = new Set<string>();
  for (const ext of flattenExtensions(extensionsForScope(scope))) {
    if (ext.type !== "node") continue;
    if (!(ext.config as { addNodeView?: unknown }).addNodeView) continue;
    if (!STATIC_TWIN_NODE_TYPES.has(ext.name)) out.add(ext.name);
  }
  UNSAFE_CACHE.set(scope, out);
  return out;
}

/**
 * Does this card body hold a node the static tier cannot paint faithfully?
 * O(body) JSON walk, run on render of a COLLAPSED card only (never on the
 * editor's keystroke path — a card body is not the main document).
 */
export function bodyNeedsLiveRender(
  value: unknown,
  scope: CardBodySchemaScope,
): boolean {
  const unsafe = t1UnsafeNodeTypes(scope);
  if (unsafe.size === 0 || value == null || typeof value !== "object") return false;
  const walk = (node: JSONContent): boolean =>
    (node.type != null && unsafe.has(node.type)) ||
    (node.content?.some(walk) ?? false);
  return walk(value as JSONContent);
}

// ---------------------------------------------------------------------------
// The static pipeline
// ---------------------------------------------------------------------------

/** Transformed textblock → the node it was derived from, so the paragraph's
 *  `p-cmd-only` stamp is computed from what the LIVE view sees (the stamp
 *  counts a marked run and a bare command run differently). */
const ORIGINAL_OF = new WeakMap<PMNode, PMNode>();

/**
 * The static twin of the latexCommand decoration plugin: every bare-text
 * command run in a PROSE text node (`inlineIsProse` — the plugin's own gate)
 * wears the `latexCommand` mark, whose `renderHTML` is the same
 * `span.latex-cmd` the decoration paints. Same scanner
 * (`forEachBareCommand`). Returns `node` itself when nothing changed.
 */
export function withStaticCommandRuns(node: PMNode, schema: Schema): PMNode {
  const markType = schema.marks.latexCommand;
  if (!markType) return node;
  const cmdMark = markType.create();
  const visit = (n: PMNode): PMNode => {
    if (n.isTextblock) {
      const kids: PMNode[] = [];
      let changed = false;
      n.forEach((child) => {
        const text = child.text;
        if (!text || !inlineIsProse(child)) {
          kids.push(child);
          return;
        }
        let last = 0;
        const found = forEachBareCommand(text, (off, len) => {
          if (off > last) kids.push(schema.text(text.slice(last, off), child.marks));
          kids.push(
            schema.text(text.slice(off, off + len), cmdMark.addToSet(child.marks)),
          );
          last = off + len;
        });
        if (found === 0) {
          kids.push(child);
          return;
        }
        changed = true;
        if (last < text.length) kids.push(schema.text(text.slice(last), child.marks));
      });
      if (!changed) return n;
      const copy = n.copy(Fragment.fromArray(kids));
      ORIGINAL_OF.set(copy, n);
      return copy;
    }
    if (n.isLeaf || n.childCount === 0) return n;
    const kids: PMNode[] = [];
    let changed = false;
    n.forEach((child) => {
      const next = visit(child);
      if (next !== child) changed = true;
      kids.push(next);
    });
    return changed ? n.copy(Fragment.fromArray(kids)) : n;
  };
  return visit(node);
}

interface ScopeRenderer {
  schema: Schema;
  serializer: DOMSerializer;
}
const RENDERER_CACHE = new Map<CardBodySchemaScope, ScopeRenderer>();

function rendererForScope(scope: CardBodySchemaScope): ScopeRenderer {
  const cached = RENDERER_CACHE.get(scope);
  if (cached) return cached;
  const schema = getSchema(extensionsForScope(scope));
  const base = DOMSerializer.fromSchema(schema);
  const nodes = { ...base.nodes };
  const paragraph = nodes.paragraph;
  // The paragraph spec is computed from the ORIGINAL node (its content still
  // comes from the transformed one — the serializer fills the content hole
  // from the node it walks, not the one the spec was built from).
  if (paragraph) nodes.paragraph = (n: PMNode) => paragraph(ORIGINAL_OF.get(n) ?? n);
  const renderer = { schema, serializer: new DOMSerializer(nodes, base.marks) };
  RENDERER_CACHE.set(scope, renderer);
  return renderer;
}

/**
 * Render a borrowed card body to static HTML. Returns null when the body
 * cannot be represented in this scope's schema (unknown node/mark) — the
 * caller must fall back to a text summary, never render a blank.
 */
export function renderBorrowedHtml(
  value: unknown,
  scope: CardBodySchemaScope,
  resolveCitation?: (command: string) => string,
): string | null {
  try {
    const resolved = refreshCitationDisplay(
      normalizeRichContent(value),
      resolveCitation,
    );
    const { schema, serializer } = rendererForScope(scope);
    const doc = withStaticCommandRuns(PMNode.fromJSON(schema, resolved), schema);
    const container = document.implementation
      .createHTMLDocument()
      .createElement("div");
    container.appendChild(serializer.serializeFragment(doc.content));
    return container.innerHTML;
  } catch {
    return null;
  }
}
