/**
 * The ONE clipboard codec for a node's attributes (task 1068).
 *
 * ProseMirror's in-editor clipboard is an HTML round trip: copy/cut serialize
 * the slice with `DOMSerializer` (each node's `renderHTML`), paste reads it back
 * with `DOMParser` (each node's `parseHTML` + per-attribute `parseHTML`). An
 * attribute that is not spelt on BOTH halves does not survive — and TipTap's
 * default half is lossy for everything but a plain non-numeric string:
 *
 *   - default render writes `String(value)`, so an OBJECT attr (a footnote's
 *     rich `content`) becomes `"[object Object]"`;
 *   - default parse runs `fromString`, so a numeric-looking STRING is coerced
 *     to a number (`$1.50$` → `$1.5$`, `\ref{1.10}` → `\ref{1.1}` — a
 *     different label), and `"true"` to a boolean;
 *   - an attr suppressed with `renderHTML: () => ({})` (to avoid camelCase HTML
 *     attributes) simply comes back as its default — ids, `\footnote[3]`.
 *
 * Hand-spelling a `parseHTML`/`renderHTML` pair per attribute is how the
 * footnote's `thanks` came to be written as `data-thanks` and read back from
 * `thanks`. So the pair is declared ONCE here, and every attribute of a node
 * that opts in round-trips by the same rule:
 *
 *   - it renders to `data-attr-<kebab-name>` holding `JSON.stringify(value)`,
 *     and ONLY when the value differs from the attr's default (an absent
 *     attribute parses back to the default — TipTap's own rule for a
 *     `parseHTML` answering `null`/`undefined`);
 *   - it parses back with `JSON.parse` — never `fromString` — so a string
 *     stays a string, a number a number, an object an object.
 *
 * The `data-attr-` prefix keeps this lane apart from a node's PRESENTATIONAL
 * attributes (`data-type`, `data-link-*`, `data-thanks`, `data-empty`), which
 * CSS, the link chrome and the static card tier read and which carry derived
 * values (`data-link-id` is `linkId || footnoteId`). The two lanes never share
 * a name, so a presentational spelling can change without touching the
 * clipboard, and vice versa.
 *
 * Pinned by `atom-clipboard-round-trip.test.ts`: every inline atom node in the
 * live main schema, every attr, non-default / numeric-looking / object values,
 * `DOMSerializer → DOMParser`, deep-equal.
 */

/** The HTML attribute an attr named `name` travels in. */
export function clipboardAttrName(name: string): string {
  return `data-attr-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Encode `value` for the clipboard, or `null` (attribute omitted) when it is
 *  the attr's default — the absent attribute decodes back to that default. */
export function encodeClipboardAttr(value: unknown, dflt: unknown): string | null {
  if (value === undefined || sameValue(value, dflt)) return null;
  return JSON.stringify(value);
}

/** Decode a `data-attr-*` value. `undefined` means "absent — take the
 *  default". A value that is not JSON (hand-written HTML) is kept as the raw
 *  string rather than dropped — still never number-coerced. */
export function decodeClipboardAttr(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Read attr `name` off a rendered element (the static card tier's KaTeX pass
 *  reads math's `latex` this way). */
export function readClipboardAttr(el: Element, name: string): unknown {
  return decodeClipboardAttr(el.getAttribute(clipboardAttrName(name)));
}

interface AttrSpecIn {
  default?: unknown;
}

/**
 * Wrap a TipTap `addAttributes()` map so every attr round-trips through the
 * codec. Other spec keys (`keepOnSplit`, …) pass through untouched; an attr
 * that already declares its own `parseHTML`/`renderHTML` is left alone (it has
 * stated its own clipboard policy — e.g. the block `uuid`, which a paste never
 * carries).
 */
export function withClipboardCodec<T extends Record<string, AttrSpecIn>>(specs: T): T {
  const out: Record<string, object> = {};
  for (const [name, spec] of Object.entries(specs)) {
    if ("parseHTML" in spec || "renderHTML" in spec) {
      out[name] = spec;
      continue;
    }
    const htmlName = clipboardAttrName(name);
    out[name] = {
      ...(spec as object),
      parseHTML: (el: HTMLElement) => decodeClipboardAttr(el.getAttribute(htmlName)),
      renderHTML: (attrs: Record<string, unknown>) => {
        const encoded = encodeClipboardAttr(attrs[name], spec.default);
        return encoded === null ? {} : { [htmlName]: encoded };
      },
    };
  }
  return out as unknown as T;
}
