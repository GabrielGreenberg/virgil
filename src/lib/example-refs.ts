import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Body-`\label` capture for expex examples — the SSOT behind the three
 * example-number resolvers:
 *   - parse/reload `exampleMap`      (`src/lib/latex-parser.ts`)
 *   - live-doc ref-display refresh   (`src/lib/editor-extensions.ts`)
 *   - create/popover resolver        (`src/components/editor-layout/card-actions/ref.ts`)
 *
 * expex lets a `\label{…}` sit anywhere inside an `\ex`/`\pex` body, not just
 * immediately after the header. Only the header-adjacent form is promoted onto
 * `exampleBlock.attrs.label` (the parser's header scan); a body-line `\label`
 * survives as a raw `latexCommand`-marked text node, so an attr-only resolver
 * renders the ref as "??". This walks an example block's body and harvests
 * EVERY such `\label`, binding each to the nearest enclosing item (→ number
 * `N`+subLabel, matching expex's `\refstepcounter`, which advances on `\a`) or,
 * with no enclosing item, to the parent block (→ number `N`).
 *
 * Generic over the node representation so the JSONContent parser and the two
 * ProseMirror walkers share ONE implementation — callers pass accessors, or use
 * the {@link collectExampleBodyLabelsJSON} / {@link collectExampleBodyLabelsPM}
 * wrappers.
 */
export interface ExampleNodeAccessors<N> {
  typeName: (n: N) => string;
  /** The `subLabel` attr — only read on `exampleItem` nodes. */
  subLabel: (n: N) => string | null | undefined;
  text: (n: N) => string | null | undefined;
  children: (n: N) => Iterable<N>;
}

export interface ExampleBodyLabel {
  /** The `\label{…}` argument. */
  key: string;
  /**
   * null → binds to the parent block (resolves to number `N`); else the nearest
   * enclosing item's subLabel (resolves to number `N`+subLabel).
   */
  subLabel: string | null;
}

const BODY_LABEL_RE = /\\label\{([^}]+)\}/g;

/**
 * Walk one example block's body, collecting every body-line `\label{…}` with
 * its binding context. Skips the header-adjacent label (already promoted onto
 * `attrs.label`) and item `tag`/`label` attrs (owned by the callers) — this is
 * strictly the raw-text body-label gap.
 */
export function collectExampleBodyLabels<N>(
  block: N,
  acc: ExampleNodeAccessors<N>,
): ExampleBodyLabel[] {
  const out: ExampleBodyLabel[] = [];

  const walk = (n: N, sub: string | null): void => {
    if (acc.typeName(n) === "exampleItem") {
      // Descend with THIS item's subLabel as the binding context (a nested
      // xlist tier overrides its parent's; an empty subLabel keeps the outer).
      const nested = acc.subLabel(n);
      const nextSub = nested ? nested : sub;
      for (const c of acc.children(n)) walk(c, nextSub);
      return;
    }
    const text = acc.text(n);
    if (typeof text === "string" && text.includes("\\label{")) {
      BODY_LABEL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = BODY_LABEL_RE.exec(text)) !== null) {
        out.push({ key: m[1], subLabel: sub });
      }
    }
    for (const c of acc.children(n)) walk(c, sub);
  };

  for (const c of acc.children(block)) walk(c, null);
  return out;
}

const JSON_ACCESSORS: ExampleNodeAccessors<JSONContent> = {
  typeName: (n) => n.type ?? "",
  subLabel: (n) => (n.attrs?.subLabel as string | undefined) ?? null,
  text: (n) => n.text,
  children: (n) => n.content ?? [],
};

/** Harvest body-`\label`s from a parsed (JSONContent) example block. */
export function collectExampleBodyLabelsJSON(
  block: JSONContent,
): ExampleBodyLabel[] {
  return collectExampleBodyLabels(block, JSON_ACCESSORS);
}

function pmChildren(n: PMNode): PMNode[] {
  const kids: PMNode[] = [];
  n.forEach((c) => kids.push(c));
  return kids;
}

const PM_ACCESSORS: ExampleNodeAccessors<PMNode> = {
  typeName: (n) => n.type.name,
  subLabel: (n) => (n.attrs.subLabel as string | undefined) ?? null,
  text: (n) => n.text,
  children: pmChildren,
};

/** Harvest body-`\label`s from a live (ProseMirror) example block node. */
export function collectExampleBodyLabelsPM(block: PMNode): ExampleBodyLabel[] {
  return collectExampleBodyLabels(block, PM_ACCESSORS);
}
