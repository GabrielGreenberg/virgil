// @vitest-environment jsdom
/**
 * Task 330 — the hook SEED DOORS, driven for real.
 *
 * `pull-seed.test.ts` proves the seed leaving the Stack is complete. This proves
 * the record ARRIVING in the destination doc is, which is the half the user
 * sees: pre-330 the seed was already complete at every link and the ONE host
 * implementation then hand-copied a few names out of it, so a note lost its
 * `title`, a todo its `notes`, a suggestion its `user_text` + `instructions`.
 *
 * The doors are driven against the REAL hooks — a fake would be asserting the
 * shape of the fix rather than its effect, and three of the four losses were
 * caused by real hook behaviour the host could not see from outside:
 * `useNotes.addNote` hard-sets `title: ""` + `titleAuto: true`,
 * `useRevisions.addSuggestion` hard-codes `user_text`/`instructions`/`author`,
 * and `useArchive.updateSnippetTitle` — the pre-330 host's own carrier for the
 * title — stamps `titleAuto: false`, so the title arrived claiming a human had
 * typed a machine-default.
 *
 * The demanded field set is DERIVED from `CARD_REGISTRY[kind].content`, so a new
 * content field on any of these kinds is covered by declaration alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

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
  for (const name of STORAGE_FNS) mod[name] = vi.fn().mockResolvedValue(null);
  return mod;
});
// The comment doors bridge their default AI-request flag; that is a sidecar
// write, not the subject here.
vi.mock("@/lib/ai-request-bridge", () => ({
  bridgeCardAiRequestFlag: vi.fn().mockResolvedValue(undefined),
}));

import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KIND_BY_STACK_CARD_KIND, type StackCardKind } from "@/lib/stack/card-kinds";
import { pullSeed } from "@/lib/stack/pull-seed";
import {
  POPULATED_SNAPSHOT_DATA,
  UNCARRIABLE_CONTENT_FIELDS,
  asRecord,
  declaredContentFields,
} from "@/lib/stack/__tests__/_pull-fixtures";
import { useNotes } from "../useNotes";
import { useTodos } from "../useTodos";
import { useArchive } from "../useArchive";
import { useRevisions } from "../useRevisions";
import { useCutter } from "../useCutter";

/** The seed the real spec would hand this kind's factory. */
function seedFor<K extends StackCardKind>(kind: K) {
  return pullSeed(kind, POPULATED_SNAPSHOT_DATA[kind] as never);
}

function demandedFields(kind: StackCardKind): string[] {
  const exempt = new Set(UNCARRIABLE_CONTENT_FIELDS[kind] ?? []);
  return declaredContentFields(
    CARD_REGISTRY[CARD_KIND_BY_STACK_CARD_KIND[kind]].content,
  ).filter((f) => !exempt.has(f));
}

/** Assert the created record carries every declared content field, unchanged. */
function expectContentArrived(kind: StackCardKind, created: unknown) {
  const rec = asRecord(created);
  const source = asRecord(POPULATED_SNAPSHOT_DATA[kind]);
  const fields = demandedFields(kind);
  expect(fields.length, `${kind} declares no content — nothing to prove`).toBeGreaterThan(0);
  for (const f of fields) {
    expect(rec[f], `${kind}: the pulled card lost "${f}"`).toEqual(source[f]);
  }
}

/** Assert nothing the source doc owned came across. */
function expectSourceStateStayedBehind(created: unknown, sourceId: string) {
  const rec = asRecord(created);
  expect(rec.id).not.toBe(sourceId);
  expect(rec.id).toBeTruthy();
  expect(rec.archived).toBeFalsy();
  expect(rec.links).toEqual([]);
  expect(rec.selectedText).toBeUndefined();
  expect(rec.originalAnchor).toBeUndefined();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the note door", () => {
  it("carries the title AND its provenance", () => {
    const { result } = renderHook(() => useNotes("doc-b"));
    let created: unknown;
    act(() => {
      created = result.current.addNoteFromSeed(null, seedFor("note"));
    });
    expectContentArrived("note", created);
    // The provenance half of the report: pre-330 the note arrived titleless AND
    // stamped `titleAuto: true`, so "never titled" and "title lost" became the
    // same record — the user could not even tell something had gone missing.
    expect((created as { titleAuto?: boolean }).titleAuto).toBe(false);
    expectSourceStateStayedBehind(created, "src-note-id");
  });

  it("a pulled note whose only content is its TITLE is not pristine", () => {
    // The body-only pristine gate would have discarded it on the next
    // click-away — losing the words a second time, one layer down.
    const { result } = renderHook(() => useNotes("doc-b"));
    const seed = { ...seedFor("note"), content: undefined };
    let created: { id: string } | undefined;
    act(() => {
      created = result.current.addNoteFromSeed(null, seed) as { id: string };
    });
    act(() => {
      result.current.discardPristineNotes();
    });
    expect(result.current.notes.map((n) => n.id)).toContain(created!.id);
  });
});

describe("the highlight door", () => {
  it("carries the tint and stays a placeholder", () => {
    const { result } = renderHook(() => useNotes("doc-b"));
    let created: unknown;
    act(() => {
      created = result.current.addHighlightFromSeed(null, seedFor("highlight"));
    });
    expect((created as { highlightColor?: string }).highlightColor).toBe("#abcdef");
    expect((created as { id: string }).id).not.toBe("src-highlight-id");
  });
});

describe("the todo door", () => {
  it("carries `notes` — the field the old seed TYPE could not express", () => {
    const { result } = renderHook(() => useTodos("doc-b"));
    let created: unknown;
    act(() => {
      created = result.current.addItemFromSeed(seedFor("todo"));
    });
    expectContentArrived("todo", created);
    expect((created as { notes?: string }).notes).toBe("notes the user typed");
    expectSourceStateStayedBehind(created, "src-todo-id");
  });

  it("a pulled todo whose only content is its `notes` is not pristine", () => {
    const { result } = renderHook(() => useTodos("doc-b"));
    let created: { id: string } | undefined;
    act(() => {
      created = result.current.addItemFromSeed({
        ...seedFor("todo"),
        text: "",
      });
    });
    act(() => {
      result.current.discardPristineTodos();
    });
    expect(result.current.items.map((t) => t.id)).toContain(created!.id);
  });
});

describe("the archive door", () => {
  it("carries the title WITHOUT re-deciding its provenance", () => {
    const { result } = renderHook(() => useArchive("doc-b"));
    let created: unknown;
    act(() => {
      created = result.current.archiveFromSeed(null, seedFor("archive"));
    });
    expectContentArrived("archive", created);
    expect((created as { titleAuto?: boolean }).titleAuto).toBe(false);
  });

  it("born-free intent is decided by THIS pull, not carried", () => {
    const { result } = renderHook(() => useArchive("doc-b"));
    let free: unknown;
    let anchored: unknown;
    act(() => {
      free = result.current.archiveFromSeed(null, seedFor("archive"));
      anchored = result.current.archiveFromSeed("dest-para", seedFor("archive"));
    });
    expect((free as { unanchored?: boolean }).unanchored).toBe(true);
    // The source record was `unanchored: true`; landing on a paragraph here must
    // not inherit that, or the clip reads free while it is anchored.
    expect((anchored as { unanchored?: boolean }).unanchored).toBeFalsy();
  });
});

describe("the suggestion doors — both panels", () => {
  const cases = [
    ["revision-suggestion", useRevisions, "addSuggestionFromSeed"],
    ["cutter-suggestion", useCutter, "addSuggestionFromSeed"],
  ] as const;

  it.each(cases)("%s carries user_text, instructions and author", (kind, useHook, door) => {
    const { result } = renderHook(() => useHook("doc-b"));
    let created: unknown;
    act(() => {
      const api = result.current as unknown as Record<string, (...a: unknown[]) => unknown>;
      created = api[door](null, seedFor(kind));
    });
    expectContentArrived(kind, created);
    const rec = asRecord(created);
    // `user_text` is the human's OWN rewrite and the field the apply path
    // prefers (`replacement = user_text or suggested_text`); `instructions` is
    // free-form guidance. Neither is reachable from the pre-330 host at all.
    expect(rec.user_text).toBe("the human's own rewrite");
    expect(rec.instructions).toBeTruthy();
    // `author` was hard-coded "human" on a record the AI wrote.
    expect(rec.author).toBe("ai");
    expectSourceStateStayedBehind(created, POPULATED_SNAPSHOT_DATA[kind].id);
  });

  it.each(cases)("%s lands PENDING, never applied", (kind, useHook, door) => {
    const { result } = renderHook(() => useHook("doc-b"));
    let created: unknown;
    act(() => {
      const api = result.current as unknown as Record<string, (...a: unknown[]) => unknown>;
      created = api[door](null, seedFor(kind));
    });
    const rec = asRecord(created);
    // The source card was `status: "applied"` with an `appliedChange` binding a
    // live range in the SOURCE paper's `.tex`. A copy claiming applied here
    // would offer Keep/Revert over a splice this document has never had.
    expect(rec.status).toBe("pending");
    expect(rec.appliedChange).toBeUndefined();
  });
});

describe("the comment doors — both panels", () => {
  const cases = [
    ["revision-comment", useRevisions],
    ["cutter-comment", useCutter],
  ] as const;

  it.each(cases)("%s carries its body and its plain-text mirror", (kind, useHook) => {
    const { result } = renderHook(() => useHook("doc-b"));
    let created: unknown;
    act(() => {
      const api = result.current as unknown as Record<string, (...a: unknown[]) => unknown>;
      created = api.addCommentFromSeed(null, seedFor(kind));
    });
    expectContentArrived(kind, created);
    expectSourceStateStayedBehind(created, POPULATED_SNAPSHOT_DATA[kind].id);
  });
});
