// @vitest-environment jsdom
//
// Task 148 — a CONTAINER's kind cannot answer an INLINE-INSERT question.
//
// THE BUG THIS PINS. `cardActionAllowedForCtx` resolved a kind-bearing block
// ref straight to `TEXT_OBJECT_REGISTRY[kind].actions`, while the lightning /
// slash / typed surfaces resolved the caret's IMMEDIATE textblock parent and
// read THAT kind's set. For a container the two are different nodes: an expex
// example's caret sits in an inner `paragraph` (PROSE_ACTIONS — footnote /
// citation / suggest-edit ENABLED) while the grab bar read `exampleBlock`
// (filed under the old `NON_PROSE_BLOCK_ACTIONS` — the same three DISABLED).
// The bucket's stated premise ("no place to embed inline insertions in
// non-prose blocks / structural containers") was simply FALSE for the four
// kinds filed under it that hold prose: `bulletList`, `orderedList` and
// `exampleBlock`. (`figureBlock` is prose-bodied too and stays reduced — see
// the `NO_INLINE_LANDING_INSIDE` legs below.)
//
// Per Gabriel's resolved decision the surfaces reconcile onto the PERMISSIVE
// answer, and the reconciliation is positional: `blockRangeAllowsAction` asks
// EVERY surface's question about the TEXTBLOCKS the action can actually reach.
//
// WHAT IS PROVEN (all against the REAL editor schema / a REAL editor — only
// `@/lib/storage` is stubbed, per the documented extension-barrel gotcha):
//   1. SCHEMA-TRUTH CENSUS (the leg with teeth) — for every kind and every one
//      of the three actions, the curated set drops it ONLY where the real
//      schema says no descendant textblock could host it, or where the pair is
//      a stated POLICY exclusion. This is the leg that catches the ORIGINAL
//      shape: the registry cannot check its own premise (it is editor-coupled
//      and has no schema), so a hand bucketing is exactly what drifted.
//   2. CROSS-SURFACE PARITY — for every container in a real document, the grab
//      bar's verdict on the block ref equals the lightning bolt's verdict at a
//      caret in that container's body, for every card action.
//   3. THE LANDING — `inlineInsertPos` makes "the end of the passage" a TEXT
//      position, so a container footnote lands IN the body instead of in a
//      block ProseMirror's fitter fabricates to hold it. Pinned with real
//      transactions, and against the raw `range.to` that misbehaved.
//   4. FAIL-CLOSED — a container whose body the schema really can't host
//      (a quote holding only a `codeBlock`) refuses, and so does a selection
//      running from prose into a `titleField` (the `\title{\cite{}}` residual).
//   5. NON-REGRESSION — the true atom / verbatim / title kinds are unmoved.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor, getSchema } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  cardActionRows,
  type ActionContext,
  type ActionRef,
} from "@/lib/actions/action-registry";
import {
  TEXT_OBJECT_REGISTRY,
  INLINE_INSERT_ACTIONS,
  typeHostsInlineInsert,
  inlineInsertPos,
  blockRangeAllowsAction,
} from "@/text-objects/text-object-registry";
import type { TextObjectKind } from "@/text-objects/types";
import type { DragHandleAction } from "@/components/DragHandleMenu";

// ───────────────────────────────────────────────────────────────────────────
// Real editor stack
// ───────────────────────────────────────────────────────────────────────────

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

/**
 * The ONE allowlist: a kind × action pair the curated set drops for an
 * editorial reason the schema knows nothing about. An entry here is a decision
 * someone made on purpose; every OTHER drop must be schema-true.
 */
const POLICY_INLINE_INSERT_EXCLUSIONS = new Map<string, string>([
  // A `\title{}` has no bibliography of its own — citing inside the paper's
  // title is an authoring error, not a schema one (`titleField` is `inline*`
  // and would host the atom happily). Predates 148; `TITLE_FIELD_ACTIONS`.
  ["titleField×citation", "a title has no bibliography"],
]);

/**
 * The document every parity/landing leg runs against. Each container is
 * populated the way a user would meet it, plus the two adversarial shapes the
 * fail-closed legs need (a quote whose only child is a `codeBlock`; an example
 * whose last child is a gloss).
 */
const FIXTURE = {
  type: "doc",
  content: [
    {
      type: "titleField",
      attrs: { field: "title", uuid: "title-A" },
      content: [{ type: "text", text: "My Paper" }],
    },
    {
      type: "paragraph",
      attrs: { uuid: "para-A" },
      content: [{ type: "text", text: "Ordinary prose here." }],
    },
    {
      type: "heading",
      attrs: { uuid: "head-A", level: 2 },
      content: [{ type: "text", text: "A section" }],
    },
    {
      type: "blockquote",
      attrs: { uuid: "quote-A" },
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "quote-A-p" },
          content: [{ type: "text", text: "Quoted words." }],
        },
      ],
    },
    {
      type: "bulletList",
      attrs: { uuid: "bl-A" },
      content: [
        {
          type: "listItem",
          attrs: { uuid: "li-A" },
          content: [
            {
              type: "paragraph",
              attrs: { uuid: "li-A-p" },
              content: [{ type: "text", text: "First bullet." }],
            },
          ],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { uuid: "ol-A" },
      content: [
        {
          type: "listItem",
          attrs: { uuid: "oli-A" },
          content: [
            {
              type: "paragraph",
              attrs: { uuid: "oli-A-p" },
              content: [{ type: "text", text: "First numbered." }],
            },
          ],
        },
      ],
    },
    {
      type: "exampleBlock",
      attrs: { uuid: "ex-A", kind: "single" },
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "ex-A-p" },
          content: [{ type: "text", text: "The example sentence." }],
        },
      ],
    },
    {
      type: "exampleBlock",
      attrs: { uuid: "ex-G", kind: "single" },
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "ex-G-p" },
          content: [{ type: "text", text: "Glossed example." }],
        },
        {
          type: "exampleGloss",
          attrs: { glossId: "g-1", colCount: 2 },
          content: [
            {
              type: "alignedGlossRow",
              attrs: { tier: "gla" },
              content: [
                { type: "glossCell", content: [{ type: "text", text: "ich" }] },
                { type: "glossCell", content: [{ type: "text", text: "bin" }] },
              ],
            },
            {
              type: "proseGlossRow",
              attrs: { tier: "glft" },
              content: [{ type: "text", text: "I am" }],
            },
          ],
        },
      ],
    },
    {
      type: "figureBlock",
      attrs: { uuid: "fig-A" },
      content: [
        { type: "figureCaption", content: [{ type: "text", text: "A caption." }] },
      ],
    },
    {
      type: "codeBlock",
      attrs: { uuid: "code-A" },
      content: [{ type: "text", text: "x = 1" }],
    },
    {
      type: "latexComment",
      attrs: { uuid: "cmt-A" },
      content: [{ type: "text", text: "a comment" }],
    },
    // Adversarial: a quote whose ONLY body is verbatim. The container is
    // PROSE_ACTIONS, but nothing inside it can host an inline atom.
    {
      type: "blockquote",
      attrs: { uuid: "quote-C" },
      content: [
        {
          type: "codeBlock",
          attrs: { uuid: "quote-C-code" },
          content: [{ type: "text", text: "y = 2" }],
        },
      ],
    },
  ],
};

function mountFixture(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: FIXTURE,
  });
}

/** The grab menu's decoration decision for `id` on `ref`. */
function decorate(
  id: DragHandleAction,
  ref: ActionRef,
  editor: Editor,
): "ok" | "disabled" | "absent" {
  const row = cardActionRows("grab").find((r) => r.id === id);
  if (!row) throw new Error(`no grab row for ${id}`);
  return row.applies({ ref, view: editor.view } as ActionContext);
}

function grabCardIds(): DragHandleAction[] {
  return cardActionRows("grab").map((r) => r.id as DragHandleAction);
}

interface Found {
  node: PMNode;
  pos: number;
}

function findByUuid(doc: PMNode, uuid: string): Found {
  let hit: Found | null = null;
  doc.descendants((node, pos) => {
    if (hit) return false;
    if ((node.attrs?.uuid as string | null) === uuid) hit = { node, pos };
    return !hit;
  });
  if (!hit) throw new Error(`no node with uuid ${uuid}`);
  return hit;
}

/** A caret just inside the FIRST textblock of `uuid`'s subtree. */
function bodyCaret(doc: PMNode, uuid: string): number {
  const { node, pos } = findByUuid(doc, uuid);
  if (node.isTextblock) return pos + 1;
  let caret = -1;
  node.descendants((child, offset) => {
    if (caret >= 0) return false;
    if (child.isTextblock) caret = pos + 1 + offset + 1;
    return caret < 0;
  });
  if (caret < 0) throw new Error(`no body textblock inside ${uuid}`);
  return caret;
}

/** The dispatcher's resolved range for a non-node-selecting block ref. */
function contentRange(doc: PMNode, uuid: string): { from: number; to: number } {
  const { node, pos } = findByUuid(doc, uuid);
  return { from: pos + 1, to: pos + node.nodeSize - 1 };
}

// ───────────────────────────────────────────────────────────────────────────
// (1) The schema-truth census — the leg with teeth
// ───────────────────────────────────────────────────────────────────────────

describe("curated inline-insert drops are schema-TRUE (task 148)", () => {
  const FAMILY = [...INLINE_INSERT_ACTIONS];

  it("a kind drops footnote/citation/suggest-edit only where the schema hosts none of it — or by stated policy", () => {
    const violations: string[] = [];
    for (const kind of Object.keys(TEXT_OBJECT_REGISTRY) as TextObjectKind[]) {
      const meta = TEXT_OBJECT_REGISTRY[kind];
      // `linkedRange` is MARK-backed — it has no node type at all, so there is
      // no subtree to ask the schema about. Its range always lives inside some
      // real textblock, which the positional gate then answers.
      if (meta.isRange) continue;
      const type = schema.nodes[kind];
      expect(type, `${kind} has no schema node`).toBeTruthy();
      const set = meta.actions as ReadonlyArray<DragHandleAction>;
      for (const action of FAMILY) {
        const drops = !set.includes(action);
        const schemaHosts = typeHostsInlineInsert(type, action);
        const policy = POLICY_INLINE_INSERT_EXCLUSIONS.has(`${kind}×${action}`);
        const shouldDrop = !schemaHosts || policy;
        if (drops !== shouldDrop) {
          violations.push(
            `${kind} × ${action}: curated set ${drops ? "DROPS" : "allows"} it, ` +
              `schema ${schemaHosts ? "HOSTS" : "cannot host"} it` +
              `${policy ? " (policy exclusion declared)" : ""}`,
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("the census can SEE a violation (canary) — re-filing a prose container as an atom block trips it", () => {
    // Anchored on the real defect shape rather than on a synthetic one: this is
    // exactly what `exampleBlock` declared before this task.
    const meta = TEXT_OBJECT_REGISTRY.exampleBlock;
    const original = meta.actions;
    try {
      (meta as { actions: ReadonlyArray<DragHandleAction> }).actions =
        (original as ReadonlyArray<DragHandleAction>).filter(
          (a) => !INLINE_INSERT_ACTIONS.has(a),
        );
      const violations: string[] = [];
      for (const action of FAMILY) {
        const drops = !(
          meta.actions as ReadonlyArray<DragHandleAction>
        ).includes(action);
        if (drops !== !typeHostsInlineInsert(schema.nodes.exampleBlock, action)) {
          violations.push(`${action}`);
        }
      }
      expect(violations.sort()).toEqual([...FAMILY].sort());
    } finally {
      (meta as { actions: ReadonlyArray<DragHandleAction> }).actions = original;
    }
  });

  it("the schema predicate reads the real vocabulary — containers host, atoms and verbatim do not", () => {
    for (const kind of [
      "paragraph",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "listItem",
      "exampleBlock",
      "exampleItem",
      "titleField",
    ] as const) {
      for (const action of FAMILY) {
        expect(
          typeHostsInlineInsert(schema.nodes[kind], action),
          `${kind} × ${action} should be schema-hostable`,
        ).toBe(true);
      }
    }
    for (const kind of [
      "codeBlock",
      "latexComment",
      "displayMath",
      "texBlock",
      "graphicsBlock",
      // `figureBlock` is prose-bodied by CONTENT EXPRESSION — its only child is
      // a `figureCaption` (`inline*`) — and reads as unhostable because the
      // landing rule refuses to descend into a caption. That is the whole
      // reason the predicate reads `NO_INLINE_LANDING_INSIDE` rather than the
      // schema alone: if it did not, the census would demand `figureBlock` be
      // un-gated and every insert would then be refused by the gate.
      "figureBlock",
    ] as const) {
      for (const action of FAMILY) {
        expect(
          typeHostsInlineInsert(schema.nodes[kind], action),
          `${kind} × ${action} should NOT be schema-hostable`,
        ).toBe(false);
      }
    }
    // Its caption IS inline-hostable on its own — proving the refusal is the
    // landing rule's, not a schema accident.
    for (const action of FAMILY) {
      expect(typeHostsInlineInsert(schema.nodes.figureCaption, action)).toBe(true);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (2) Cross-surface parity — the defect the task reports
// ───────────────────────────────────────────────────────────────────────────

describe("grab bar and body caret agree inside a container (task 148)", () => {
  const CONTAINERS: Array<{ uuid: string; kind: TextObjectKind }> = [
    { uuid: "quote-A", kind: "blockquote" },
    { uuid: "bl-A", kind: "bulletList" },
    { uuid: "ol-A", kind: "orderedList" },
    { uuid: "li-A", kind: "listItem" },
    { uuid: "ex-A", kind: "exampleBlock" },
    { uuid: "ex-G", kind: "exampleBlock" },
  ];

  it("every card action reads the same on the container's grab ref as at a caret in its body", () => {
    const editor = mountFixture();
    const doc = editor.state.doc;
    const disagreements: string[] = [];
    for (const { uuid, kind } of CONTAINERS) {
      const blockRef: ActionRef = { kind, id: uuid };
      const caret: ActionRef = {
        kind: "cursor",
        pos: bodyCaret(doc, uuid),
        paragraphId: "",
      };
      for (const id of grabCardIds()) {
        // `highlight` is deliberately excluded from the CARET sweep: it is
        // `selection: "required"`, so a zero-width ref greys it for a reason
        // that is a property of the REF SHAPE and not of the block — the very
        // distinction `gateApplies` exists to layer on. The body-SELECTION
        // sweep below covers it, ref shape and all.
        if (id === "highlight") continue;
        const grab = decorate(id, blockRef, editor);
        const body = decorate(id, caret, editor);
        if (grab !== body) {
          disagreements.push(`${kind}(${uuid}) × ${id}: grab=${grab} body=${body}`);
        }
      }
    }
    expect(disagreements, disagreements.join("\n")).toEqual([]);
    editor.destroy();
  });

  it("…and the same on a body SELECTION, which covers highlight too", () => {
    const editor = mountFixture();
    const doc = editor.state.doc;
    const disagreements: string[] = [];
    for (const { uuid, kind } of CONTAINERS) {
      const blockRef: ActionRef = { kind, id: uuid };
      const from = bodyCaret(doc, uuid);
      const span: ActionRef = {
        kind: "selection",
        from,
        to: from + Math.max(1, doc.resolve(from).parent.content.size),
        paragraphId: "",
      };
      for (const id of grabCardIds()) {
        const grab = decorate(id, blockRef, editor);
        const body = decorate(id, span, editor);
        if (grab !== body) {
          disagreements.push(`${kind}(${uuid}) × ${id}: grab=${grab} body=${body}`);
        }
      }
    }
    expect(disagreements, disagreements.join("\n")).toEqual([]);
    editor.destroy();
  });

  it("and the agreed answer is the PERMISSIVE one — all three are enabled on an example and a list", () => {
    const editor = mountFixture();
    for (const [kind, uuid] of [
      ["exampleBlock", "ex-A"],
      ["exampleBlock", "ex-G"],
      ["bulletList", "bl-A"],
      ["orderedList", "ol-A"],
      ["blockquote", "quote-A"],
    ] as Array<[TextObjectKind, string]>) {
      const ref: ActionRef = { kind, id: uuid };
      for (const action of INLINE_INSERT_ACTIONS) {
        expect(decorate(action, ref, editor), `${kind} × ${action}`).toBe("ok");
      }
    }
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (3) The landing — where the atom actually goes
// ───────────────────────────────────────────────────────────────────────────

describe("an inline insert on a container ref lands in its BODY (task 148)", () => {
  const CONTAINERS = ["quote-A", "bl-A", "ol-A", "ex-A", "ex-G", "li-A"];

  it("inlineInsertPos resolves a container's content-range end to a textblock inside it", () => {
    const editor = mountFixture();
    const doc = editor.state.doc;
    for (const uuid of CONTAINERS) {
      const { to } = contentRange(doc, uuid);
      // The RAW position the dispatcher used before this task is NOT in a
      // textblock — this is the defect, asserted rather than assumed.
      expect(doc.resolve(to).parent.isTextblock, `${uuid} raw range.to`).toBe(false);
      const landed = inlineInsertPos(doc, to);
      expect(doc.resolve(landed).parent.isTextblock, `${uuid} landed`).toBe(true);
      // …and still INSIDE the container (bias is backward, never into the next
      // sibling block).
      const { pos, node } = findByUuid(doc, uuid);
      expect(landed, `${uuid} stays inside`).toBeGreaterThan(pos);
      expect(landed).toBeLessThan(pos + node.nodeSize);
    }
    editor.destroy();
  });

  it("a footnote atom inserted at the landing position joins the container's own TEXT; at the raw end it does not", () => {
    const editor = mountFixture();
    const doc = editor.state.doc;
    // The LIVE editor's schema instance — ProseMirror compares NodeTypes by
    // identity, so a node built from the module-level `getSchema` twin would be
    // silently dropped by `tr.insert` and every leg below would pass vacuously.
    const footnote = editor.schema.nodes.footnote;
    expect(footnote, "the schema registers a footnote atom").toBeTruthy();

    /** Where did the atom carrying `id` end up — its parent type, whether it
     *  is still INSIDE the container, and how many blocks the container gained
     *  making room for it? */
    const landing = (after: PMNode, id: string, uuid: string) => {
      let parentType = "(absent)";
      let atomPos = -1;
      after.descendants((node, pos) => {
        if (node.type.name !== "footnote") return true;
        if ((node.attrs?.footnoteId as string) !== id) return true;
        parentType = after.resolve(pos).parent.type.name;
        atomPos = pos;
        return false;
      });
      const host = findByUuid(after, uuid);
      return {
        parentType,
        blocks: host.node.childCount,
        inside:
          atomPos > host.pos && atomPos < host.pos + host.node.nodeSize,
      };
    };

    for (const uuid of CONTAINERS) {
      const { to } = contentRange(doc, uuid);
      const before = findByUuid(doc, uuid).node.childCount;

      const good = landing(
        editor.state.tr.insert(
          inlineInsertPos(doc, to),
          footnote.create({ footnoteId: `fn-${uuid}` }),
        ).doc,
        `fn-${uuid}`,
        uuid,
      );
      // It joined real text — not a shell the fitter had to build.
      expect(
        editor.schema.nodes[good.parentType]?.isTextblock,
        `${uuid}: landed in ${good.parentType}`,
      ).toBe(true);
      expect(good.blocks, `${uuid}: no block fabricated`).toBe(before);
      expect(good.inside, `${uuid}: stayed inside the container`).toBe(true);

      // The RAW content-range end — what the dispatcher used before task 148.
      // Whatever ProseMirror does to make room (fabricate a shell, drop the
      // atom, or let it escape the container), it is never "in the body text".
      const raw = landing(
        editor.state.tr.insert(
          to,
          footnote.create({ footnoteId: `fn-raw-${uuid}` }),
        ).doc,
        `fn-raw-${uuid}`,
        uuid,
      );
      const rawJoinedText =
        raw.parentType !== "(absent)" &&
        !!editor.schema.nodes[raw.parentType]?.isTextblock &&
        raw.blocks === before &&
        raw.inside;
      expect(rawJoinedText, `${uuid}: raw range.to must NOT join body text`).toBe(
        false,
      );
    }
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (4) Fail-closed — the two doors the positional gate also shuts
// ───────────────────────────────────────────────────────────────────────────

describe("the positional gate refuses where no reachable textblock can host it", () => {
  it("a block quote whose only body is a codeBlock greys all three", () => {
    const editor = mountFixture();
    const ref: ActionRef = { kind: "blockquote", id: "quote-C" };
    for (const action of INLINE_INSERT_ACTIONS) {
      expect(decorate(action, ref, editor), `quote-C × ${action}`).toBe("disabled");
    }
    // …while the quote whose body is prose keeps them (so the refusal is about
    // the BODY, not about blockquote-ness).
    for (const action of INLINE_INSERT_ACTIONS) {
      expect(decorate(action, { kind: "blockquote", id: "quote-A" }, editor)).toBe(
        "ok",
      );
    }
    editor.destroy();
  });

  it("a selection running from prose INTO a titleField refuses citation (the \\title{\\cite{}} residual)", () => {
    const editor = mountFixture();
    const doc = editor.state.doc;
    const title = findByUuid(doc, "title-A");
    const para = findByUuid(doc, "para-A");
    // A span that starts in the title and ends in the following paragraph. The
    // pre-148 gate asked only the START… but the atom lands at the END, and the
    // reverse span (start in prose, end in the title) is the corrupting one.
    const from = para.pos + 1;
    const to = title.pos + 1;
    expect(blockRangeAllowsAction(doc, from, to, "citation")).toBe(false);
    // Footnote is legal in a title, so the same span keeps it.
    expect(blockRangeAllowsAction(doc, from, to, "footnote")).toBe(true);
    editor.destroy();
  });

  it("a range holding no textblock at all (a true atom's node range) refuses", () => {
    const editor = mountFixture();
    const doc = editor.state.doc;
    const code = findByUuid(doc, "code-A");
    // The whole codeBlock node range: `text*`, so nothing can host the atom.
    expect(
      blockRangeAllowsAction(doc, code.pos + 1, code.pos + code.node.nodeSize - 1, "footnote"),
    ).toBe(false);
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (5) Non-regression — the kinds this task must NOT move
// ───────────────────────────────────────────────────────────────────────────

describe("the verbatim / title kinds are unmoved (tasks 061 / 066 / 146)", () => {
  it("codeBlock + latexComment still grey the three, and highlight too", () => {
    const editor = mountFixture();
    for (const kind of ["codeBlock", "latexComment"] as TextObjectKind[]) {
      const ref: ActionRef = { kind, id: kind === "codeBlock" ? "code-A" : "cmt-A" };
      for (const action of INLINE_INSERT_ACTIONS) {
        expect(decorate(action, ref, editor), `${kind} × ${action}`).toBe("disabled");
      }
      expect(decorate("highlight", ref, editor), `${kind} × highlight`).toBe(
        "disabled",
      );
      expect(decorate("note", ref, editor), `${kind} × note`).toBe("ok");
    }
    editor.destroy();
  });

  it("titleField still greys citation and keeps footnote / suggest-edit", () => {
    const editor = mountFixture();
    const ref: ActionRef = { kind: "titleField", id: "title-A" };
    expect(decorate("citation", ref, editor)).toBe("disabled");
    expect(decorate("footnote", ref, editor)).toBe("ok");
    expect(decorate("suggest-edit", ref, editor)).toBe("ok");
    expect(decorate("delete", ref, editor)).toBe("disabled");
    editor.destroy();
  });

  it("figureBlock stays reduced — and the ONE divergence 148 leaves standing is pinned, not forgotten", () => {
    const editor = mountFixture();
    const doc = editor.state.doc;
    const ref: ActionRef = { kind: "figureBlock", id: "fig-A" };
    for (const action of INLINE_INSERT_ACTIONS) {
      expect(decorate(action, ref, editor), `figureBlock × ${action}`).toBe(
        "disabled",
      );
    }
    // RESIDUAL, deliberate: a caret the user placed INSIDE the caption is still
    // permitted by the lightning / slash surfaces — the pre-148 defensive
    // allow, since `figureCaption` is not a TextObjectKind. Closing it means
    // TIGHTENING a surface the resolved decision said to leave permissive, so
    // it is recorded here rather than silently changed.
    const caret: ActionRef = {
      kind: "cursor",
      pos: bodyCaret(doc, "fig-A"),
      paragraphId: "",
    };
    expect(doc.resolve(caret.kind === "cursor" ? caret.pos : 0).parent.type.name).toBe(
      "figureCaption",
    );
    expect(decorate("footnote", caret, editor)).toBe("ok");
    editor.destroy();
  });

  it("an example ending in a GLOSS lands in its sentence, never in a gloss column", () => {
    const editor = mountFixture();
    const doc = editor.state.doc;
    const { to } = contentRange(doc, "ex-G");
    const landed = inlineInsertPos(doc, to);
    const $landed = doc.resolve(landed);
    expect($landed.parent.type.name).toBe("paragraph");
    // Nothing on the path is gloss machinery — an atom in a `glossCell` is a
    // silent interlinear-alignment change, and `proseGlossRow` is the gloss's
    // own `\glft` line rather than the example's sentence.
    const path: string[] = [];
    for (let d = $landed.depth; d > 0; d--) path.push($landed.node(d).type.name);
    expect(path).not.toContain("glossCell");
    expect(path).not.toContain("alignedGlossRow");
    expect(path).not.toContain("proseGlossRow");
    expect(path).not.toContain("exampleGloss");
    expect(path).toContain("exampleBlock");
    editor.destroy();
  });

  it("both menu surfaces publish the same card ids and read them the same way", () => {
    // The census must not be single-surface: `cardActionRows(surface)` filters
    // on `row.surfaces[surface]`, so a row present on one and absent on the
    // other would drop out of a grab-only sweep with no failure.
    const grab = cardActionRows("grab").map((r) => r.id);
    const lightning = cardActionRows("lightning").map((r) => r.id);
    expect([...lightning].sort()).toEqual([...grab].sort());
    const editor = mountFixture();
    const ref: ActionRef = { kind: "exampleBlock", id: "ex-A" };
    for (const id of grab) {
      const g = cardActionRows("grab").find((r) => r.id === id)!;
      const l = cardActionRows("lightning").find((r) => r.id === id)!;
      const ctx = { ref, view: editor.view } as ActionContext;
      expect(l.applies(ctx), `${id} across surfaces`).toBe(g.applies(ctx));
    }
    editor.destroy();
  });

  it("a block ref whose node is NOT in the doc falls back to its curated set", () => {
    // The doc-free answer: the positional layer can only tighten, never invent
    // an answer for a position it doesn't have. (This is the path the registry
    // coverage suite's phantom refs take.)
    const editor = mountFixture();
    expect(decorate("footnote", { kind: "displayMath", id: "ghost" }, editor)).toBe(
      "disabled",
    );
    expect(decorate("footnote", { kind: "exampleBlock", id: "ghost" }, editor)).toBe(
      "ok",
    );
    expect(decorate("footnote", { kind: "figureBlock", id: "ghost" }, editor)).toBe(
      "disabled",
    );
    editor.destroy();
  });
});
