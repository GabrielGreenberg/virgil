// @vitest-environment jsdom
//
// TASK 426 — a uuid-bearing CONTAINER keeps its `%!v:` identity across a
// save/reload, per container kind, derived from the schema.
//
// The filing (inbox 2026-08-22, from the task-416 worker) reported that a
// `bulletList`'s own anchor is emitted after `\end{itemize}` and NEVER read
// back, so a whole-list uuid dies on the next open and every card anchored to
// the list orphans with no edit. Measured here against the REAL parser and
// serializer at HEAD `9add153d`: **the premise is false for a real anchor.**
// The `\begin{env}` dispatcher harvests the post-closer anchor UNCONDITIONALLY
// for every environment name (task 342) and the list arm applies it to the
// list node. What the filing's own fixture carried was `%!v:ul1` / `%!v:a` /
// `%!v:b` — NOT anchors at all: the anchor grammar is exactly four hex chars
// (`NODE_UUID_ANCHOR`, `TRAILING_UUID_ANCHOR` — both readers agree), so those
// tokens were never harvested on EITHER side. The item "anchors" survived only
// as comment-tail TEXT (task 347's carrier), and the list one vanished because
// a `%!v:`-prefixed line that is not a valid anchor is skipped as Virgil's own
// internal noise (`latex-parser.ts`, "Skip UUID anchor comments silently") —
// a reserved namespace no user writes into.
//
// So there is no read-side fix to land. What the task asked for beyond the
// fix is still owed, and it is the durable half: a sweep per uuid-bearing
// CONTAINER kind, DERIVED from `UUID_BEARING_NODE_TYPES` ∩ the real schema's
// container types, so `blockquote` / `figureBlock` / `exampleBlock` — which
// the filing never checked — and any future container arrive with no fixture
// and the coverage leg fails first. Every leg asserts the parsed node's `uuid`
// ATTR, never a `%!v:` grep of the bytes (task 387's trap), over TWO full
// cycles (cycle 1 is where a loss would land, cycle 2 is where a fresh mint
// would show as a moved id).
//
// The filing's own fixture is pinned as a CONTROL at the end, so the next
// reader who reproduces it sees the same answer rather than re-filing it.
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

import type { JSONContent } from "@tiptap/react";
import { getSchema } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly, assignUuids } from "@/lib/latex-serializer";
import { UUID_BEARING_NODE_TYPES } from "@/lib/node-attr-sets";

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
  } as unknown as EditorExtensionsCtx;
}

/** The uuid-bearing node types that are CONTAINERS in the real schema —
 *  block-level, holding block children (so their anchor is appended after a
 *  closer rather than after their own text). Derived, never hand-listed. */
function containerKinds(): string[] {
  const schema = getSchema(buildEditorExtensions(mainCtx()));
  return Object.entries(schema.nodes)
    .filter(
      ([name, type]) =>
        UUID_BEARING_NODE_TYPES.has(name) &&
        type.isBlock &&
        !type.isTextblock &&
        !type.isLeaf &&
        !type.isAtom,
    )
    .map(([name]) => name)
    .sort();
}

const P = (text: string, uuid?: string): JSONContent => ({
  type: "paragraph",
  ...(uuid ? { attrs: { uuid } } : {}),
  content: [{ type: "text", text }],
});

/** One fixture per container kind, every CONTAINER-level node seeded with an
 *  explicit 4-hex id so identity is a falsifiable claim in both directions
 *  (`assignUuids` mints RANDOM ids, so an unseeded fixture cannot tell a
 *  preserved uuid from a re-minted one). Paragraphs INSIDE a container are
 *  deliberately unseeded: a paragraph under a `DEFERRING_PARENT` yields its
 *  identity to the container (`assignUuids`), so it carries no anchor by
 *  design and seeding one would assert a contract the app does not make. */
const FIXTURES: Record<string, () => JSONContent> = {
  bulletList: () => ({
    type: "bulletList",
    attrs: { uuid: "c0c0" },
    content: [
      { type: "listItem", attrs: { uuid: "a0a0" }, content: [P("one")] },
      { type: "listItem", attrs: { uuid: "b0b0" }, content: [P("two")] },
    ],
  }),
  orderedList: () => ({
    type: "orderedList",
    attrs: { uuid: "c1c1" },
    content: [
      { type: "listItem", attrs: { uuid: "a1a1" }, content: [P("one")] },
      { type: "listItem", attrs: { uuid: "b1b1" }, content: [P("two")] },
    ],
  }),
  // A list item is only ever INSIDE a list; its anchor rides the item's own
  // slice end (task 348). Seeded through a list so the harness shape is real.
  listItem: () => FIXTURES.bulletList(),
  blockquote: () => ({
    type: "blockquote",
    attrs: { uuid: "c2c2" },
    content: [P("quoted one"), P("quoted two")],
  }),
  figureBlock: () => ({
    type: "figureBlock",
    attrs: {
      uuid: "c3c3",
      extras: "",
      trailingExtras: "",
      placement: "",
      starred: false,
      source: "fig.png",
      widthPercent: null,
      sources: [],
      label: "fig:one",
      hasCaption: true,
      shortCaption: null,
      numbered: true,
      figureNumber: null,
    },
    content: [
      { type: "figureCaption", content: [{ type: "text", text: "A caption." }] },
    ],
  }),
  exampleBlock: () => ({
    type: "exampleBlock",
    attrs: { uuid: "c4c4", kind: "multi", tag: "", label: "" },
    content: [
      {
        type: "exampleItemList",
        content: [
          {
            type: "exampleItem",
            attrs: { uuid: "d4d4", tag: "", label: "", subLabel: "" },
            content: [P("first item")],
          },
          {
            type: "exampleItem",
            attrs: { uuid: "e4e4", tag: "", label: "", subLabel: "" },
            content: [P("second item")],
          },
        ],
      },
    ],
  }),
  exampleItem: () => FIXTURES.exampleBlock(),
};

/** Every `(structural path, uuid)` pair in the tree, so a loss reads as a
 *  changed path and a steal reads as two. */
function uuidsByPath(node: JSONContent, path = "doc"): Record<string, string> {
  const out: Record<string, string> = {};
  if (node.attrs?.uuid) out[path] = node.attrs.uuid as string;
  (node.content ?? []).forEach((child, i) => {
    Object.assign(out, uuidsByPath(child, `${path}/${child.type}[${i}]`));
  });
  return out;
}

function cycle(doc: JSONContent): { doc: JSONContent; tex: string } {
  assignUuids(doc);
  const tex = serializeBodyOnly(doc);
  return { doc: parseLatex(tex), tex };
}

describe("container-anchor-roundtrip · every uuid-bearing container has a fixture", () => {
  it("the container set is DERIVED from the schema and every member is covered", () => {
    const kinds = containerKinds();
    // A list that is missing the two reported kinds is a harness that can
    // answer nothing.
    expect(kinds).toContain("bulletList");
    expect(kinds).toContain("orderedList");
    for (const kind of kinds) {
      expect(FIXTURES[kind], `no fixture for container kind ${kind}`).toBeTruthy();
    }
  });
});

describe("container-anchor-roundtrip · a container's own uuid survives two save/reload cycles", () => {
  it.each(containerKinds())("%s", (kind) => {
    // Wrapped in prose so the container is neither first nor last block —
    // the everyday position, and the one where a stranded anchor line has
    // neighbours to be mis-assigned to.
    const seedDoc: JSONContent = {
      type: "doc",
      content: [P("Intro.", "0a0a"), FIXTURES[kind](), P("Outro.", "0b0b")],
    };
    const seed = uuidsByPath(seedDoc);
    const seedKindPath = Object.keys(seed).find((p) => p.endsWith(`/${kind}[1]`) || p.includes(`${kind}[`));
    expect(seedKindPath, `fixture holds no ${kind}`).toBeTruthy();

    // Cycle 1 — the reload. A read-side gap shows here as the container
    // coming back uuid-less (then minted fresh), i.e. a CHANGED id.
    const c1 = cycle(seedDoc);
    expect(uuidsByPath(c1.doc), `cycle 1 moved an identity:\n${c1.tex}`).toEqual(seed);

    // Cycle 2 — the fixed point. A fresh mint in cycle 1 would have moved
    // again here; the bytes must not move either (the fix is READ-side only,
    // so an emit that changed would be a regression of the 348 position law).
    const c2 = cycle(c1.doc);
    expect(uuidsByPath(c2.doc)).toEqual(seed);
    expect(c2.tex).toBe(c1.tex);

    // The id the reader answered is one the emitter actually WROTE (the
    // `%!v:` suffix for most containers, the `\vexid{}` / `\vxid{}` PREFIX
    // for the expex family) — a sanity pin on the bytes; the identity claim
    // above is the attr equality, never a grep (task 387's trap).
    expect(c1.tex).toContain(seed[seedKindPath!]);
  });
});

describe("container-anchor-roundtrip · the stacked closer line (task 348's shape)", () => {
  it("`\\end{itemize} %!v:child %!v:me` assigns each anchor to its own owner", () => {
    // An item whose last tail child is itself a list: the inner list's
    // anchor and the item's anchor stack on one line after the inner
    // closer, and the outer list's anchor follows the outer closer.
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { uuid: "0000" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "1111" },
              content: [
                P("outer item"),
                {
                  type: "bulletList",
                  attrs: { uuid: "2222" },
                  content: [
                    { type: "listItem", attrs: { uuid: "3333" }, content: [P("inner")] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const seed = uuidsByPath(doc);
    const c1 = cycle(doc);
    expect(c1.tex).toContain("\\end{itemize} %!v:2222 %!v:1111");
    expect(c1.tex).toContain("\\end{itemize} %!v:0000");
    expect(uuidsByPath(c1.doc)).toEqual(seed);
    const c2 = cycle(c1.doc);
    expect(uuidsByPath(c2.doc)).toEqual(seed);
    expect(c2.tex).toBe(c1.tex);
  });
});

describe("container-anchor-roundtrip · the filing's fixture, pinned as a CONTROL", () => {
  it("`%!v:ul1` is not an anchor — it is a malformed Virgil marker, skipped by design", () => {
    // The token grammar is exactly four hex chars. A `%!v:`-prefixed line that
    // does not match it is Virgil's reserved namespace, dropped as internal
    // noise; a plain `% note` in the same position survives as a comment
    // block. Neither is a whole-list identity loss, which is why no fix lands.
    const src = [
      "\\begin{itemize}",
      "  \\item one %!v:a",
      "  \\item two %!v:b",
      "\\end{itemize} %!v:ul1",
      "",
    ].join("\n");
    const parsed = parseLatex(src);
    const list = parsed.content?.find((n) => n.type === "bulletList");
    expect(list).toBeTruthy();
    // No anchor was read — because none was written.
    expect(list!.attrs?.uuid).toBeUndefined();
    // And the same shape with a REAL anchor reads it, byte for byte.
    const real = parseLatex(src.replace("%!v:ul1", "%!v:c0c0"));
    expect(real.content?.find((n) => n.type === "bulletList")?.attrs?.uuid).toBe("c0c0");
  });
});
