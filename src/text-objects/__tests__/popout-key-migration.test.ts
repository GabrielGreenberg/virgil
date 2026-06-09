import { describe, it, expect, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { migrateDocAwarePopoutKey } from "../post-load-migrations";

/** Minimal editor whose doc yields the given (kind, uuid) nodes to a
 *  `descendants` walk — enough for `resolveUuidToKind`. */
function mockEditor(nodes: Array<{ kind: string; uuid: string }>): Editor {
  return {
    state: {
      doc: {
        descendants(fn: (node: unknown) => boolean | void) {
          for (const n of nodes) {
            const cont = fn({ type: { name: n.kind }, attrs: { uuid: n.uuid } });
            if (cont === false) break;
          }
        },
      },
    },
  } as unknown as Editor;
}

describe("migrateDocAwarePopoutKey — the doc-aware leg (example/list split)", () => {
  it("splits `example:` by walking the doc: in-editor block vs panel card", () => {
    const ed = mockEditor([{ kind: "exampleBlock", uuid: "blk1" }]);
    // A uuid that IS an exampleBlock node → the in-editor text-object.
    expect(migrateDocAwarePopoutKey(ed, "example:blk1")).toBe(
      "float:textobject:exampleBlock:blk1",
    );
    // A uuid with no matching block → the Examples *panel card*.
    expect(migrateDocAwarePopoutKey(ed, "example:card9")).toBe(
      "float:card:example:card9",
    );
  });

  it("resolves `list:` to the concrete list kind, dropping orphans", () => {
    const ed = mockEditor([
      { kind: "bulletList", uuid: "b1" },
      { kind: "orderedList", uuid: "o1" },
    ]);
    expect(migrateDocAwarePopoutKey(ed, "list:b1")).toBe(
      "float:textobject:bulletList:b1",
    );
    expect(migrateDocAwarePopoutKey(ed, "list:o1")).toBe(
      "float:textobject:orderedList:o1",
    );
    // Orphan list key (no matching node) → dropped (null) with a warn.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(migrateDocAwarePopoutKey(ed, "list:gone")).toBeNull();
    warn.mockRestore();
  });

  it("passes through already-migrated `float:` keys (idempotent)", () => {
    const ed = mockEditor([]);
    expect(migrateDocAwarePopoutKey(ed, "float:card:note:abc")).toBe(
      "float:card:note:abc",
    );
    expect(migrateDocAwarePopoutKey(ed, "float:textobject:paragraph:p1")).toBe(
      "float:textobject:paragraph:p1",
    );
  });

  it("normalizes any straggler legacy key (defensive)", () => {
    const ed = mockEditor([]);
    expect(migrateDocAwarePopoutKey(ed, "footnote:f1")).toBe(
      "float:card:footnote:f1",
    );
    expect(migrateDocAwarePopoutKey(ed, "textobject:heading:h1")).toBe(
      "float:textobject:heading:h1",
    );
  });
});
