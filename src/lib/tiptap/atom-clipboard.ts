/**
 * AtomClipboard — the clipboard's two remaining questions about inline Atoms
 * (task 1068). The first question — "do an atom's attrs survive the HTML
 * round trip?" — is answered per attribute by the codec
 * (`attr-clipboard-codec.ts`); this extension owns the other two.
 *
 * 1. IDENTITY ON PASTE. The codec carries a footnote's / citation's id through
 *    the clipboard, so a paste can now present an id the document already
 *    holds. The policy is node-identity's law — "a move conserves identity; a
 *    split mints it" — read at paste time:
 *
 *      - CUT → paste: the cut already deleted the source, so the id is free
 *        and is KEPT — the card follows its text.
 *      - COPY → paste (or a second paste of the same cut): the source is still
 *        live, so the colliding id is RE-MINTED; the copy is a new footnote
 *        whose body comes from the carried `content`.
 *
 *    The rule is `remintCollidingIdentity`'s (the text-range move's), applied
 *    through `remintNestedAtomIds`, so a `\cite` nested inside a pasted
 *    footnote's body is covered too. An internal
 *    PM drag-move (`view.dragging.move`) is a move whose source deletion has not
 *    been staged yet — it is passed through untouched rather than re-minted.
 *
 *    `scope: "fresh"` (the borrowed card editors) re-mints EVERY card-bearing id
 *    unconditionally: a card body's editor cannot see the main document's live
 *    ids, so "is it free?" is unanswerable there and paste-as-new is the only
 *    safe reading (the Stack pull's rule). A float CAN see them — it names
 *    MAIN through `hostDoc` and collides against both live sets (task 1074).
 *
 * 2. PLAIN TEXT. The plain-text flavour (what another app receives) projects
 *    every atom through ONE table, `ATOM_PLAIN_TEXT`, keyed by `AtomKind` — so a
 *    new atom kind is a compile error until it states its text. Replaces
 *    citation's private `clipboardTextSerializer`, which pre-empted every other
 *    serializer and emitted "" for math, refs and footnotes.
 *
 *    Deliberately NOT `renderText`: that would also change `editor.getText()`,
 *    whose legacy caller (`links.ts` snapshot search) maps offsets by counting
 *    text nodes only.
 *
 * Cost: paste-time only (a human gesture) — O(slice) for the plain text,
 * O(doc) to collect the live ids; nothing runs per keystroke.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Slice, Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { atomMetaForNodeName, type AtomKind } from "./atom-registry";
import { renderDynamicCommand } from "@/lib/latex-dynamic-commands";
import type { JSONContent } from "@tiptap/core";
import { collectAtomIds } from "./node-identity";
import { remintNestedAtomIds } from "@/lib/inline-content";
import { generateShortId } from "@/lib/uuid";
import { emitInlineMath } from "@/lib/latex-lexer";

/**
 * The plain-text projection of each Atom — what a reader sees, in reading
 * order:
 *   - citation → its visible display text ("Smith 2020"), else the command;
 *   - ref → its visible number, else the `\ref{label}` source;
 *   - inline math → its source, in its own delimiters (`$…$`, `$$…$$`, … —
 *     task 1070's `emitInlineMath`; the source — no plain-text rendering of math
 *     exists, and the source is what a reader of the `.tex` sees);
 *   - dynamic (`\today`) → the value it shows (task 1335);
 *   - footnote → "" — the marker is apparatus, not prose; the HTML flavour
 *     carries the whole footnote for an in-app paste.
 */
export const ATOM_PLAIN_TEXT: Record<AtomKind, (node: PMNode) => string> = {
  citation: (n) => (n.attrs.displayText as string) || (n.attrs.command as string) || "",
  ref: (n) =>
    (n.attrs.displayText as string) ||
    (n.attrs.label ? `\\${(n.attrs.refCommand as string) || "ref"}{${n.attrs.label as string}}` : ""),
  "inline-math": (n) => emitInlineMath(n.attrs.latex, n.attrs.delim),
  footnote: () => "",
  // Task 1335: the value the chip shows — a reader copying "Dated \today"
  // wants the date, as with a ref's number.
  dynamic: (n) => renderDynamicCommand(n.attrs.command as string),
};

/** Plain text of a clipboard slice: text, atoms via `ATOM_PLAIN_TEXT`, display
 *  math as its source on its own line, "\n" between blocks. */
export function sliceToPlainText(slice: Slice): string {
  let out = "";
  let firstBlock = true;
  slice.content.descendants((node) => {
    const meta = atomMetaForNodeName(node.type.name);
    if (meta) {
      out += ATOM_PLAIN_TEXT[meta.kind](node);
      return false;
    }
    if (node.isText) {
      out += node.text ?? "";
      return false;
    }
    if (node.isBlock) {
      if (!firstBlock && !out.endsWith("\n")) out += "\n";
      firstBlock = false;
      if (node.type.name === "displayMath") {
        out += (node.attrs.latex as string) || "";
        return false;
      }
    }
    return true;
  });
  return out;
}

export interface AtomClipboardOptions {
  /** `"collide"` (main editor): keep a pasted id that is free, re-mint one
   *  that is live. `"fresh"` (card editors): re-mint every card-bearing id. */
  scope: "collide" | "fresh";
  /**
   * A surface whose doc is a PART of another document (a float holds one node
   * of MAIN's) names that document here (task 1074). When it resolves, the
   * paste reads `"collide"` against the UNION of both live sets — so a cut →
   * paste inside a float keeps its id (and its card) once the cut has reached
   * MAIN, and re-mints while it has not. Unresolvable (no host, host torn
   * down) → `scope` stands.
   */
  hostDoc?: (() => PMNode | null) | null;
}

/**
 * Re-identify the slice's card-bearing atoms (nested ones inside a footnote's
 * `content` blob included — `remintNestedAtomIds` reads them the way the live
 * editor does). `fresh` re-mints every id; otherwise an id is kept iff it is
 * not in `live` — `remintCollidingIdentity`'s rule for a move. `live` is
 * MUTATED as ids are claimed, so two copies inside one slice can't collide
 * either. Returns the SAME slice when nothing changed.
 */
function remintSlice(slice: Slice, live: Set<string>, fresh: boolean): Slice {
  const nodes: PMNode[] = [];
  slice.content.forEach((n) => nodes.push(n));
  if (nodes.length === 0) return slice;
  const schema = nodes[0].type.schema;
  let changed = false;
  const out = nodes.map((node) => {
    const { content, remapped } = remintNestedAtomIds(
      node.toJSON() as JSONContent,
      (typeName, oldId) => {
        if (!atomMetaForNodeName(typeName)?.idAttr) return null;
        if (!fresh && !live.has(oldId)) {
          live.add(oldId);
          return null; // free — the atom travels with its text (cut → paste)
        }
        const minted = generateShortId(live);
        live.add(minted);
        return minted;
      },
    );
    if (remapped.length === 0) return node;
    try {
      const rebuilt = schema.nodeFromJSON(content as Parameters<typeof schema.nodeFromJSON>[0]);
      changed = true;
      return rebuilt;
    } catch (err) {
      // Keep the user's content over its identity; the save-time
      // `assignUuids` dedup still separates a duplicate id.
      console.error("[atom-clipboard] re-hydrate after remint failed:", err);
      return node;
    }
  });
  return changed ? new Slice(Fragment.fromArray(out), slice.openStart, slice.openEnd) : slice;
}

/** Does `slice` carry any card-bearing atom id at all (O(slice) pre-check so a
 *  plain-text paste never walks the document)? */
function sliceHasAtomIds(slice: Slice): boolean {
  let hit = false;
  slice.content.descendants((node) => {
    if (hit) return false;
    const meta = atomMetaForNodeName(node.type.name);
    if (meta?.idAttr && (node.attrs[meta.idAttr] || node.attrs.linkId)) hit = true;
    return !hit;
  });
  return hit;
}

export const AtomClipboard = Extension.create<AtomClipboardOptions>({
  name: "atomClipboard",

  addOptions() {
    return { scope: "collide", hostDoc: null };
  },

  addProseMirrorPlugins() {
    const { scope, hostDoc } = this.options;
    return [
      new Plugin({
        key: new PluginKey("atomClipboard"),
        props: {
          clipboardTextSerializer: (slice) => sliceToPlainText(slice),
          transformPasted(slice, view) {
            if (view.dragging?.move) return slice;
            if (!sliceHasAtomIds(slice)) return slice;
            // The live set is what the paste ENTERS — a cut has already
            // removed its source, so its ids read as free. A part-of-a-host
            // surface also asks the host (a float's doc is one node of MAIN's).
            const live = collectAtomIds(view.state.doc);
            const host = hostDoc?.() ?? null;
            if (host) for (const id of collectAtomIds(host)) live.add(id);
            return remintSlice(slice, live, scope === "fresh" && !host);
          },
        },
      }),
    ];
  },
});
