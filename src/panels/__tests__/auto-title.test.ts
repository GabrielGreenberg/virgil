import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  nextCardTitle,
  isAutoTitle,
  CARD_TITLE_LABELS,
} from "@/panels/panel-registry";
import type { CardKind } from "@/cards/types";

/**
 * BUG #31: auto-generated titles ("Footnote 2", "Archive Text 1") must never
 * persist, and any legacy persisted one must be stripped on load. `isAutoTitle`
 * is the precise per-kind matcher the sidecar migrators use — it must catch the
 * EXACT `^<Label> <digits>$` shape `nextCardTitle` emits, and NOTHING else.
 */

// The kinds that auto-title (label !== null), with their generated prefix.
// Sourced from CARD_TITLE_LABELS (= CardMeta.titleLabel), the SAME map
// nextCardTitle reads — so this table can't drift from the matcher's source.
const AUTO_TITLING: Array<[CardKind, string]> = (
  Object.keys(CARD_TITLE_LABELS) as CardKind[]
)
  .filter((k) => CARD_TITLE_LABELS[k] !== null)
  .map((k) => [k, CARD_TITLE_LABELS[k] as string]);

describe("BUG #31: isAutoTitle matches generated titles, spares real ones", () => {
  it("the auto-titling set is exactly the kinds with a non-null titleLabel", () => {
    // Pins the six known auto-titlers so a registry change is caught.
    const labels = Object.fromEntries(AUTO_TITLING);
    expect(labels).toEqual({
      note: "Note",
      footnote: "Footnote",
      archive: "Archive Text",
      todo: "Task",
      report: "Report",
      example: "Example",
    });
  });

  it("every nextCardTitle output round-trips back through isAutoTitle (true)", () => {
    for (const [kind] of AUTO_TITLING) {
      for (const count of [0, 1, 9, 41]) {
        const generated = nextCardTitle(kind, count); // e.g. "Note 1"
        expect(generated).not.toBe("");
        expect(isAutoTitle(kind, generated), `${kind}:${generated}`).toBe(true);
      }
    }
  });

  it("positive cases: the exact `<Label> <digits>` shape per kind", () => {
    const positives: Array<[CardKind, string]> = [
      ["note", "Note 1"],
      ["note", "Note 37"],
      ["footnote", "Footnote 2"],
      ["archive", "Archive Text 1"], // two-word label matches literally
      ["archive", "Archive Text 12"],
      ["todo", "Task 3"],
      ["report", "Report 8"],
      ["example", "Example 4"],
    ];
    for (const [kind, title] of positives) {
      expect(isAutoTitle(kind, title), `${kind}:${title}`).toBe(true);
    }
  });

  it("negative cases: real titles the user might type are SPARED", () => {
    const negatives: Array<[CardKind, string]> = [
      // real prose titles that merely START with the label
      ["footnote", "Footnote on Frege"],
      ["note", "Note to self"],
      ["report", "Report on the corpus"],
      ["archive", "Archive Text from 2019"],
      // a "<word> <digits>" shape with the WRONG word for the kind
      ["footnote", "Chapter 2"],
      ["note", "Section 3"],
      // right label but no trailing number
      ["note", "Note"],
      ["report", "Report"],
      // right shape but extra leading/trailing content
      ["note", "My Note 1"],
      ["note", "Note 1 (draft)"],
      ["footnote", " Footnote 2"], // leading space
      ["footnote", "Footnote 2 "], // trailing space
      // non-integer / non-digit suffix
      ["note", "Note one"],
      ["note", "Note 1.5"],
      ["note", "Note #1"],
      // empty / whitespace
      ["note", ""],
      ["note", "   "],
    ];
    for (const [kind, title] of negatives) {
      expect(isAutoTitle(kind, title), `${kind}:${JSON.stringify(title)}`).toBe(
        false,
      );
    }
  });

  it("cross-kind: a label only matches its OWN kind", () => {
    // "Note 1" is auto for note, but NOT for report/footnote/etc.
    expect(isAutoTitle("note", "Note 1")).toBe(true);
    expect(isAutoTitle("report", "Note 1")).toBe(false);
    expect(isAutoTitle("footnote", "Note 1")).toBe(false);
    // "Task 1" is auto for todo only.
    expect(isAutoTitle("todo", "Task 1")).toBe(true);
    expect(isAutoTitle("note", "Task 1")).toBe(false);
  });

  it("kinds that never auto-title (null label) always return false", () => {
    const nullLabelKinds = (Object.keys(CARD_TITLE_LABELS) as CardKind[]).filter(
      (k) => CARD_TITLE_LABELS[k] === null,
    );
    expect(nullLabelKinds.length).toBeGreaterThan(0);
    for (const kind of nullLabelKinds) {
      // even a "Citation 1"-looking string is spared for a null-label kind
      expect(isAutoTitle(kind, "Citation 1")).toBe(false);
      expect(isAutoTitle(kind, "Anything 2")).toBe(false);
    }
  });

  it("non-string input is always false (never nulls a real title by accident)", () => {
    expect(isAutoTitle("note", undefined)).toBe(false);
    expect(isAutoTitle("note", null)).toBe(false);
    expect(isAutoTitle("note", 42)).toBe(false);
    expect(isAutoTitle("note", { title: "Note 1" })).toBe(false);
  });
});

/**
 * The per-kind sidecar migrators all apply the SAME strip rule on load:
 * `isAutoTitle(kind, stored) ? "" : stored` (todo strips its BODY `text`, the
 * rest strip the `title` field). This pins that transform's behavior on
 * representative legacy records without dragging in the React hooks (and the
 * tiptap-barrel/storage import gotcha). The migrator wiring is asserted to
 * reference `isAutoTitle` by the source-guard test below.
 */
function migrateTitle(kind: CardKind, stored: string): string {
  return isAutoTitle(kind, stored) ? "" : stored;
}

describe("BUG #31: migrators strip a legacy auto-title, keep a real one", () => {
  it("nulls a legacy generated title for every persisting kind", () => {
    expect(migrateTitle("note", "Note 4")).toBe("");
    expect(migrateTitle("archive", "Archive Text 1")).toBe("");
    expect(migrateTitle("report", "Report 2")).toBe("");
    expect(migrateTitle("example", "Example 7")).toBe("");
    // todo's generated value lived in the BODY (`text`), same matcher.
    expect(migrateTitle("todo", "Task 9")).toBe("");
  });

  it("keeps a real user title untouched", () => {
    expect(migrateTitle("note", "Frege's puzzle")).toBe("Frege's puzzle");
    expect(migrateTitle("archive", "Archive Text from 2019")).toBe(
      "Archive Text from 2019",
    );
    expect(migrateTitle("report", "Report on the corpus")).toBe(
      "Report on the corpus",
    );
    expect(migrateTitle("todo", "Email the editor")).toBe("Email the editor");
    // already-empty stays empty
    expect(migrateTitle("note", "")).toBe("");
  });
});

/**
 * Source-level guards (BUG #31): the creation sites must no longer call
 * `nextCardTitle` (so nothing persists a generated title), and the migrators
 * must call `isAutoTitle` (so legacy titles are stripped on load). Catches a
 * regression that re-introduces the persisting `nextCardTitle(...)` call.
 */
function read(rel: string): string {
  return readFileSync(resolve(__dirname, "../..", rel), "utf8");
}

describe("BUG #31: creation sites don't persist a generated title", () => {
  const creationSites = [
    "components/editor-layout/card-actions/card-creation.ts", // footnote
    "hooks/useNotes.ts",
    "hooks/useArchive.ts",
    "hooks/useReports.ts",
    "hooks/useExamples.ts",
    "hooks/useTodos.ts",
  ];

  it("no creation site references nextCardTitle anymore", () => {
    for (const rel of creationSites) {
      expect(read(rel), rel).not.toContain("nextCardTitle");
    }
  });

  it("the four persisting-sidecar migrators strip via isAutoTitle on load", () => {
    for (const rel of [
      "hooks/useNotes.ts",
      "hooks/useArchive.ts",
      "hooks/useReports.ts",
      "hooks/useExamples.ts",
      "hooks/useTodos.ts",
    ]) {
      expect(read(rel), rel).toContain("isAutoTitle");
    }
  });
});
