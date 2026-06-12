// @vitest-environment jsdom
//
// Chip-D residue pin (test-hardening): the registry→Floatable→FloatChrome
// header-tint chain. `cardFloatable` (src/cards/floats/index.tsx) sets
// `Floatable.headerTint` from the kind's theme `headerDefault` — the same
// solid hex the DOCKED card header paints — so a popped card keeps the
// kind-tinted strip (pop-out continuity #20). The FloatChrome half (paint
// the tint / neutral fallback) is pinned in FloatChrome.test.tsx; THIS file
// pins the producer half against the REAL registered builders:
//
//   1. A card floatable's headerTint === CARD_THEMES[themeKey].headerDefault
//      (checked for note + todo).
//   2. A text-object floatable carries NO headerTint (neutral strip).
//   3. Bonus chip-D/WS7 residue: the note float's kind-chevron title slot is
//      gated exactly like the docked card (Mode-B yes, Mode-A no).

import { describe, it, expect, vi } from "vitest";

// cards/floats imports every panel's card components → `@/lib/storage`
// (the known barrel/storage gotcha).
vi.mock("@/lib/storage", () => {
  const stub = () => undefined;
  const names = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib", "createDocFromPicker",
    "createDocInFolder", "pickProjectFolder", "registerDocInFolder",
    "openExistingDocFromPicker", "listDocs", "renameDoc", "deleteDocFromIndex",
    "flushDoc", "drainDoc", "detectBibPackage", "readPaperFolder", "getTexFilename",
    "writePdf", "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: () => false };
  for (const n of names) mod[n] = stub;
  return mod;
});

// Boot-register the real card float builders onto CARD_REGISTRY, and the
// real text-object float bodies onto TEXT_OBJECT_REGISTRY (so the paragraph
// floatable below actually builds instead of returning null).
import "@/cards/floats";
import "@/text-objects/floats";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_THEMES } from "@/components/panel-primitives";
import { textObjectFloatable } from "@/text-objects/text-object-floatable";
import type { CardFloatCtx } from "@/cards/card-float-ctx";
import type { UserNote, TodoItem } from "@/lib/types";
import type { Link } from "@/links/_shared/types";

function modeBLink(): Link {
  return {
    id: "l2",
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: ["p1"],
      margin: { side: "right" },
      textRange: { anchorId: "a1", textSnapshot: "ranged text" },
    },
    target: { type: "card", ref: { kind: "note", id: "n1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function modeALink(): Link {
  return {
    id: "l1",
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: ["p1"],
      margin: { side: "right" },
    },
    target: { type: "card", ref: { kind: "note", id: "n1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function note(links: Link[]): UserNote {
  return {
    kind: "note",
    id: "n1",
    title: "",
    content: { type: "doc", content: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    aiRequest: false,
    links,
  };
}

const todo: TodoItem = {
  id: "t1",
  text: "t",
  notes: "",
  done: false,
  aiRequest: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  links: [],
};

/** Minimal ctx — the builders only read the collection for their kind (plus
 *  editorRef in closures that never run here). */
function ctxWith(partial: Partial<CardFloatCtx>): CardFloatCtx {
  return {
    editorRef: { current: null },
    notes: [],
    highlights: [],
    todoItems: [],
    selectedNoteId: null,
    selectedTodoId: null,
    toggleTodo: () => {},
    convertNotesCard: () => {},
    ...partial,
  } as unknown as CardFloatCtx;
}

describe("cardFloatable headerTint (registry → Floatable, chip-D chain)", () => {
  it("note float: headerTint is the note theme's headerDefault", () => {
    const f = CARD_REGISTRY.note.toFloatable(
      "n1",
      ctxWith({ notes: [note([modeBLink()])] }),
    );
    expect(f).not.toBeNull();
    expect(CARD_REGISTRY.note.themeKey).toBe("note");
    expect(f!.headerTint).toBe(CARD_THEMES.note.headerDefault);
    // Sanity: a solid pre-mixed hex, not an rgba/var.
    expect(f!.headerTint).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("todo float: headerTint follows the kind's themeKey (todo)", () => {
    const f = CARD_REGISTRY.todo.toFloatable("t1", ctxWith({ todoItems: [todo] }));
    expect(f).not.toBeNull();
    expect(CARD_REGISTRY.todo.themeKey).toBe("todo");
    expect(f!.headerTint).toBe(CARD_THEMES.todo.headerDefault);
    // The two kinds genuinely differ — the tint is per-kind, not global.
    expect(CARD_THEMES.todo.headerDefault).not.toBe(CARD_THEMES.note.headerDefault);
  });

  it("text-object floatable: NO headerTint (FloatChrome's neutral fallback)", () => {
    const f = textObjectFloatable(
      { kind: "paragraph", id: "p1" },
      { current: null },
    );
    // Paragraph's float body is registered by the @/text-objects/floats
    // import above — the builder must return a real Floatable…
    expect(f).not.toBeNull();
    // …that never writes the field at all (neutral FloatChrome strip).
    expect("headerTint" in f!).toBe(false);
  });
});

describe("note float kind-chevron gate (WS7 — float half of the docked gate)", () => {
  it("Mode-B note: chromeSlots.title carries the CardKindHeader", () => {
    const f = CARD_REGISTRY.note.toFloatable(
      "n1",
      ctxWith({ notes: [note([modeBLink()])] }),
    );
    expect(f!.chromeSlots?.title).toBeTruthy();
  });

  it("Mode-A note: title slot gated off (plain label fallback in FloatChrome)", () => {
    const f = CARD_REGISTRY.note.toFloatable(
      "n1",
      ctxWith({ notes: [note([modeALink()])] }),
    );
    expect(f!.chromeSlots?.title).toBeUndefined();
  });
});
