// @vitest-environment jsdom
//
// Selection-bug A — the linkedRange popout must BE the selection: correctly
// labeled and fully rendered. Two deterministic guards:
//
//  (1) `linkedRange.computeLabel` reflects the mark's TRUE nature — a plain
//      selection grab rides a `kind:"transient"` linkedAnchor and reads "Text
//      selection"; a real annotation's range (note/highlight/cut/revision,
//      carrying a `linkCard`) returns null so the chrome keeps "Linked range".
//      This is the ONE source both the released-float header
//      (`linked-range-body.tsx` via `setHeaderLabel`) and the lift-overlay's
//      popout-mode header (`TextObjectGrabHandle`) read.
//
//  (2) The float surface's schema COVERS main (task 842 census — nodes, marks,
//      attrs, derived from the live builders) and (`buildEditorExtensions({ surface:"float" })`,
//      now consumed by `linked-range-body.tsx`) INCLUDES the block node types
//      a selection can span — displayMath / figureBlock / lists / exampleBlock
//      / heading — so a rich range round-trips instead of being silently
//      dropped to a blank popout (the pre-FCU hand-rolled StarterKit subset
//      omitted exactly these).

import { describe, it, expect, vi } from "vitest";

// The extension barrel transitively imports `@/lib/storage` (via the figure /
// graphics / tex-block NodeView components). storage.ts picks its backend with
// a raw `require("@/lib/storage-fsa")`, which vitest's resolver can't follow.
// We never CALL any storage function here, so a stub module is enough — same
// pattern as editor-extensions.test.ts.
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node as PMNode } from "@tiptap/pm/model";
import { LinkedAnchor } from "@/lib/tiptap/linked-anchor";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { EditorState } from "@tiptap/pm/state";
import {
  checkLinkedRangeRepresentable,
  linkedRangeAsDoc,
  planLinkedRangeWriteBack,
} from "@/lib/linked-range-writeback";
import { TEXT_OBJECT_REGISTRY } from "../text-object-registry";

// --- (1) computeLabel: transient → "Text selection", annotation → null ------

const markSchema = getSchema([StarterKit, LinkedAnchor]);

/** A one-paragraph doc whose text carries a linkedAnchor mark with the given
 *  attrs. Returned as a minimal `{ state: { doc } }` shape — all
 *  `computeLabel` touches is `editor.state.doc`. */
function docWithAnchor(attrs: Record<string, unknown> | null): Editor {
  const marks = attrs ? [{ type: "linkedAnchor", attrs }] : [];
  const doc = PMNode.fromJSON(markSchema, {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "marked text", marks }] },
    ],
  });
  return { state: { doc } } as unknown as Editor;
}

describe("linkedRange.computeLabel", () => {
  const computeLabel = TEXT_OBJECT_REGISTRY.linkedRange.computeLabel;

  it("is defined on the linkedRange entry", () => {
    expect(typeof computeLabel).toBe("function");
  });

  it("returns 'Text selection' for a transient (plain-selection) grab", () => {
    const editor = docWithAnchor({ anchorId: "aa11", kind: "transient" });
    expect(computeLabel!(editor, { kind: "linkedRange", id: "aa11" })).toBe(
      "Text selection",
    );
  });

  it("returns null for a real annotation's range (note → falls back to 'Linked range')", () => {
    const editor = docWithAnchor({
      anchorId: "bb22",
      kind: "note",
      linkCard: "note:xyz",
    });
    expect(computeLabel!(editor, { kind: "linkedRange", id: "bb22" })).toBeNull();
  });

  it("returns null for highlight/cut/revision (every non-transient kind)", () => {
    for (const kind of ["highlight", "cut", "revision"]) {
      const editor = docWithAnchor({ anchorId: "cc33", kind });
      expect(
        computeLabel!(editor, { kind: "linkedRange", id: "cc33" }),
      ).toBeNull();
    }
  });

  it("returns null when no mark with the id is present (so chrome keeps meta.label)", () => {
    const editor = docWithAnchor({ anchorId: "dd44", kind: "transient" });
    // Ask for a different id than the one stamped.
    expect(computeLabel!(editor, { kind: "linkedRange", id: "zzzz" })).toBeNull();
    // …and with no mark at all.
    const bare = docWithAnchor(null);
    expect(computeLabel!(bare, { kind: "linkedRange", id: "aa11" })).toBeNull();
  });
});

// --- (2) float schema fidelity: the range's node types survive --------------

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

function floatCtx(): EditorExtensionsCtx {
  return {
    surface: "float",
    editable: true,
    cardContext: true,
    callbacks: {},
    docIdRef: null,
    host: { getMainEditor: () => null },
  };
}

describe("linkedRange float schema (buildEditorExtensions surface:'float')", () => {
  const schema = getSchema(buildEditorExtensions(floatCtx()));

  // Task 842 — DERIVED, not a hand list. The float mounts a live cut of the
  // MAIN doc and writes it back over the whole range, so any node, mark or
  // attr main has and the float lacks is content the float cannot hold (it
  // mounts BLANK — TipTap swallows the mismatch) and then overwrites. The hand
  // list this replaces named 14 types and missed the one real gap
  // (`maketitleMarker`). Mirrors excerpt-schema.test.ts's "main ⊆ excerpt".
  const mainSchema = getSchema(buildEditorExtensions(mainCtx()));

  it("every MAIN node type is registered in the float schema (float ⊇ main)", () => {
    const missing = Object.keys(mainSchema.nodes).filter((n) => !schema.nodes[n]);
    expect(
      missing,
      "A main-editor node the linked-range float cannot hold. A range spanning " +
        "it would pop out blank and its write-back is refused. Register it on " +
        "every surface in `buildEditorExtensions` (gate its main-only " +
        "behaviour on `surface`), as titleField / maketitleMarker are.",
    ).toEqual([]);
  });

  it("every MAIN mark type is registered in the float schema", () => {
    const missing = Object.keys(mainSchema.marks).filter((m) => !schema.marks[m]);
    expect(missing).toEqual([]);
  });

  it("every MAIN node type declares the same attrs in the float schema", () => {
    const dropped: string[] = [];
    for (const [name, mainType] of Object.entries(mainSchema.nodes)) {
      const floatType = schema.nodes[name];
      if (!floatType) continue; // the node leg owns that failure
      const floatAttrs = new Set(Object.keys(floatType.spec.attrs ?? {}));
      for (const attr of Object.keys(mainType.spec.attrs ?? {})) {
        if (!floatAttrs.has(attr)) dropped.push(`${name}.${attr}`);
      }
    }
    expect(dropped).toEqual([]);
  });

  it("round-trips a multi-block range (heading + list + paragraph) without dropping blocks", () => {
    const richDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    };
    const node = PMNode.fromJSON(schema, richDoc);
    // Pre-fix, the narrow schema collapsed a rich range to a single empty
    // paragraph; here all three blocks survive in order.
    expect(node.childCount).toBe(3);
    const childTypes: string[] = [];
    node.forEach((c) => childTypes.push(c.type.name));
    expect(childTypes).toEqual(["heading", "bulletList", "paragraph"]);
  });
});

// --- (3) the write door refuses rather than deleting (task 842) -------------

describe("planLinkedRangeWriteBack — never delete what the float did not hold", () => {
  const mainSchema = getSchema(buildEditorExtensions(mainCtx()));
  const floatSchema = getSchema(buildEditorExtensions(floatCtx()));

  const para = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const mainState = () =>
    EditorState.create({
      doc: PMNode.fromJSON(mainSchema, {
        type: "doc",
        content: [
          { type: "titleField", attrs: { field: "title" }, content: [{ type: "text", text: "T" }] },
          { type: "maketitleMarker" },
          para("first"),
          para("second"),
        ],
      }),
    });
  /** The whole-block range from the titleField through "second". */
  const wholeRange = (s: EditorState) => ({ from: 0, to: s.doc.content.size });

  it("a range spanning \\maketitle seeds into the float with the marker intact", () => {
    const s = mainState();
    const seed = linkedRangeAsDoc(s.doc, wholeRange(s));
    expect(seed).not.toBeNull();
    expect(checkLinkedRangeRepresentable(floatSchema, seed).ok).toBe(true);
    const mounted = PMNode.fromJSON(floatSchema, seed);
    const types: string[] = [];
    mounted.forEach((c) => types.push(c.type.name));
    expect(types).toContain("maketitleMarker");
  });

  it("an unedited round trip writes nothing (byte-identical)", () => {
    const s = mainState();
    const seed = linkedRangeAsDoc(s.doc, wholeRange(s))!;
    const plan = planLinkedRangeWriteBack(s, wholeRange(s), seed, floatSchema);
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.tr).toBeNull();
  });

  it("an edited round trip keeps the marker", () => {
    const s = mainState();
    const seed = linkedRangeAsDoc(s.doc, wholeRange(s))!;
    const edited = {
      ...seed,
      content: [...seed.content!.slice(0, -1), para("second, edited")],
    };
    const plan = planLinkedRangeWriteBack(s, wholeRange(s), edited, floatSchema);
    expect(plan.ok && plan.tr).toBeTruthy();
    const next = plan.ok && plan.tr ? plan.tr.doc : null;
    const types: string[] = [];
    next!.forEach((c) => types.push(c.type.name));
    expect(types).toEqual(["titleField", "maketitleMarker", "paragraph", "paragraph"]);
    expect(next!.lastChild!.textContent).toBe("second, edited");
  });

  it("a float child main cannot rebuild → REFUSED, not skipped (main untouched)", () => {
    const s = mainState();
    const seed = linkedRangeAsDoc(s.doc, wholeRange(s))!;
    const planted = {
      ...seed,
      content: [...seed.content!, { type: "noSuchNode" }],
    };
    const plan = planLinkedRangeWriteBack(s, wholeRange(s), planted, floatSchema);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.constructs).toEqual(["noSuchNode"]);
  });

  it("a range the FLOAT schema cannot hold → REFUSED (the blank-seed overwrite)", () => {
    // A float schema WITHOUT maketitleMarker — the pre-842 shape, and any
    // future main-only node. The float would mount blank; a keystroke there
    // wrote one paragraph over the whole range. Now the door refuses.
    const narrow = getSchema([StarterKit, LinkedAnchor]);
    const s = mainState();
    const plan = planLinkedRangeWriteBack(
      s,
      wholeRange(s),
      { type: "doc", content: [para("typed into a blank float")] },
      narrow,
    );
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.constructs).toContain("maketitleMarker");
    expect(
      checkLinkedRangeRepresentable(narrow, linkedRangeAsDoc(s.doc, wholeRange(s))).ok,
    ).toBe(false);
  });
});
