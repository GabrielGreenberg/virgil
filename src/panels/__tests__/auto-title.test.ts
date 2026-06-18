import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  nextCardTitle,
  isAutoTitle,
  resolveLoadedTitle,
  resolveTitleAuto,
  CARD_TITLE_LABELS,
} from "@/panels/panel-registry";
import type { CardKind } from "@/cards/types";

/**
 * BUG #31 / T6-C12: auto-generated titles ("Footnote 2", "Archive Text 1")
 * must never persist as user content, and a recorded-or-legacy generated one
 * must be stripped on load — while a real user title (even one shaped like
 * "Report 8") is preserved.
 *
 * The original BUG #31 remedy guessed provenance back from the title's SHAPE
 * (`isAutoTitle`), which is provably ambiguous: a generated "Report 8" and a
 * user-typed "Report 8" are byte-identical, so it silently stripped a real
 * title (REP-A2-02 [HIGH]). T6-C12 records the bit (`titleAuto`) instead:
 * `resolveLoadedTitle` reads recorded provenance and only falls back to the
 * shape heuristic ONCE for a pre-T6 legacy record, then self-stamps via
 * `resolveTitleAuto`. `isAutoTitle` is retained but DEMOTED to that single
 * fallback — its positive/negative cases below stay valid (the function is
 * unchanged), they just no longer drive the load path directly.
 */

// The kinds that auto-title (label !== null), with their generated prefix.
// Sourced from CARD_TITLE_LABELS (= CardMeta.titleLabel), the SAME map
// nextCardTitle reads — so this table can't drift from the matcher's source.
const AUTO_TITLING: Array<[CardKind, string]> = (
  Object.keys(CARD_TITLE_LABELS) as CardKind[]
)
  .filter((k) => CARD_TITLE_LABELS[k] !== null)
  .map((k) => [k, CARD_TITLE_LABELS[k] as string]);

describe("isAutoTitle (demoted legacy fallback): matches generated, spares real", () => {
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
 * T6-C12: `resolveLoadedTitle` truth table. This is the new load-path oracle —
 * recorded provenance first, shape heuristic ONLY as the legacy fallback.
 */
describe("resolveLoadedTitle: recorded provenance, not shape", () => {
  it("titleAuto:false → keep the title ALWAYS, even a numbered one (REP-A2-02)", () => {
    // The HIGH bug: a user who NAMED their report "Report 8" keeps it.
    expect(resolveLoadedTitle("report", "Report 8", false)).toBe("Report 8");
    expect(resolveLoadedTitle("note", "Note 3", false)).toBe("Note 3");
    expect(resolveLoadedTitle("todo", "Task 5", false)).toBe("Task 5");
    expect(resolveLoadedTitle("archive", "Archive Text 1", false)).toBe(
      "Archive Text 1",
    );
    expect(resolveLoadedTitle("example", "Example 4", false)).toBe("Example 4");
    // a plain prose title with the flag is obviously kept too
    expect(resolveLoadedTitle("report", "On Frege", false)).toBe("On Frege");
  });

  it("titleAuto:true → drop the title (recorded machine-generated)", () => {
    expect(resolveLoadedTitle("report", "Report 8", true)).toBe("");
    expect(resolveLoadedTitle("note", "anything at all", true)).toBe("");
    expect(resolveLoadedTitle("todo", "Task 5", true)).toBe("");
  });

  it("titleAuto:undefined (legacy) → falls back to the shape heuristic ONCE", () => {
    // A pre-T6 record with no recorded bit behaves exactly like current main.
    expect(resolveLoadedTitle("report", "Report 8", undefined)).toBe(""); // generated shape → strip
    expect(resolveLoadedTitle("report", "On Frege", undefined)).toBe("On Frege"); // real → keep
    expect(resolveLoadedTitle("archive", "Archive Text 1", undefined)).toBe("");
    expect(resolveLoadedTitle("archive", "Archive Text from 2019", undefined)).toBe(
      "Archive Text from 2019",
    );
    expect(resolveLoadedTitle("todo", "Task 9", undefined)).toBe("");
    expect(resolveLoadedTitle("todo", "Email the editor", undefined)).toBe(
      "Email the editor",
    );
  });

  it("non-string title → '' regardless of the bit (never strands a non-string)", () => {
    expect(resolveLoadedTitle("note", undefined, false)).toBe("");
    expect(resolveLoadedTitle("note", null, true)).toBe("");
    expect(resolveLoadedTitle("note", 42, undefined)).toBe("");
  });
});

/**
 * T6-C12: `resolveTitleAuto` — the bit a migrator STAMPS on load. Explicit bits
 * are preserved verbatim; a legacy record derives the bit ONCE from shape so
 * the record is permanently classified (self-stamping, forward-only).
 */
describe("resolveTitleAuto: self-stamping migration", () => {
  it("preserves an explicit recorded bit verbatim", () => {
    expect(resolveTitleAuto("report", "Report 8", false)).toBe(false);
    expect(resolveTitleAuto("report", "On Frege", true)).toBe(true);
  });

  it("legacy record (undefined) derives the bit from shape ONCE", () => {
    expect(resolveTitleAuto("report", "Report 8", undefined)).toBe(true); // generated shape
    expect(resolveTitleAuto("report", "On Frege", undefined)).toBe(false); // real title
    expect(resolveTitleAuto("todo", "Task 9", undefined)).toBe(true);
    expect(resolveTitleAuto("todo", "Email the editor", undefined)).toBe(false);
  });

  it("migration is idempotent + self-stamps: a stamped record reads provenance forever", () => {
    // Simulate the load-then-write-back lifecycle for every persisting kind.
    const cases: Array<[CardKind, string, string]> = [
      // [kind, storedTitle, expectedTitleAfterFirstLoad]
      ["report", "Report 8", ""], // legacy generated → stripped, stamped auto
      ["report", "On Frege", "On Frege"], // legacy real → kept, stamped user
      ["note", "Note 4", ""],
      ["archive", "Archive Text 1", ""],
      ["todo", "Task 9", ""], // todo's body
      ["example", "Example 7", ""],
    ];
    for (const [kind, stored, expectedTitle] of cases) {
      // First load (legacy record, no bit):
      const title1 = resolveLoadedTitle(kind, stored, undefined);
      const bit1 = resolveTitleAuto(kind, stored, undefined);
      expect(title1, `${kind}:${stored}`).toBe(expectedTitle);

      // The migrator writes back { title: title1, titleAuto: bit1 }. On the
      // SECOND load it reads the stamped record — provenance, not shape:
      const title2 = resolveLoadedTitle(kind, title1, bit1);
      const bit2 = resolveTitleAuto(kind, title1, bit1);
      expect(title2, `${kind}:reload`).toBe(title1); // idempotent
      expect(bit2, `${kind}:reload-bit`).toBe(bit1); // idempotent
    }
  });

  it("a legacy real numbered title survives forever once stamped user-owned", () => {
    // The "Report 8" the user TYPED would be misclassified by shape on the
    // legacy edge — but once an edit stamps titleAuto:false (see the create→
    // rename→reload round-trip below) it can never be stripped again.
    const stored = "Report 8";
    // user-stamped record (titleAuto already false, e.g. after a rename):
    expect(resolveLoadedTitle("report", stored, false)).toBe("Report 8");
    expect(resolveTitleAuto("report", stored, false)).toBe(false);
    // reload again — still kept
    expect(
      resolveLoadedTitle(
        "report",
        resolveLoadedTitle("report", stored, false),
        resolveTitleAuto("report", stored, false),
      ),
    ).toBe("Report 8");
  });
});

/**
 * T6-C12: the create → rename-to-numbered-title → reload round-trip. This is
 * the regression-proof REP-A2-02 [HIGH] demands: a card born blank+auto, renamed
 * by the user to a numbered title, must KEEP that title across a reload — the
 * exact case the old shape heuristic silently stripped.
 *
 * Modeled on the hooks' contract (create stamps titleAuto:true; the title setter
 * stamps titleAuto:false; the migrator runs resolveLoadedTitle/resolveTitleAuto)
 * without dragging in the React hooks + the tiptap-barrel/storage import gotcha.
 */
interface TitledRecord {
  title: string;
  titleAuto?: boolean;
}
function createCard(): TitledRecord {
  // FORK-1: a freshly-created card title stays BLANK + titleAuto:true.
  return { title: "", titleAuto: true };
}
function renameCard(card: TitledRecord, title: string): TitledRecord {
  // user edit → user-owned forever.
  return { ...card, title, titleAuto: false };
}
function reload(kind: CardKind, card: TitledRecord): TitledRecord {
  return {
    title: resolveLoadedTitle(kind, card.title, card.titleAuto),
    titleAuto: resolveTitleAuto(kind, card.title, card.titleAuto),
  };
}

describe("REP-A2-02 [HIGH]: create → rename to 'Report 8' → reload KEEPS it", () => {
  it("a freshly-created card is blank + titleAuto:true (FORK-1)", () => {
    const card = createCard();
    expect(card.title).toBe("");
    expect(card.titleAuto).toBe(true);
    // an untouched blank auto card stays blank across a reload
    expect(reload("report", card)).toEqual({ title: "", titleAuto: true });
  });

  it("renaming to a numbered title survives reload (the HIGH regression-proof)", () => {
    let card = createCard();
    card = renameCard(card, "Report 8"); // the literal collision case
    expect(card).toEqual({ title: "Report 8", titleAuto: false });
    const loaded = reload("report", card);
    expect(loaded.title).toBe("Report 8"); // NOT stripped
    expect(loaded.titleAuto).toBe(false);
    // double reload — still kept (idempotent)
    expect(reload("report", loaded).title).toBe("Report 8");
  });

  it("holds for every persisting kind (incl. todo body + example)", () => {
    const numbered: Array<[CardKind, string]> = [
      ["report", "Report 8"],
      ["note", "Note 3"],
      ["todo", "Task 5"], // todo's "title" is its body text
      ["archive", "Archive Text 1"],
      ["example", "Example 4"],
    ];
    for (const [kind, title] of numbered) {
      const card = renameCard(createCard(), title);
      expect(reload(kind, card).title, `${kind}:${title}`).toBe(title);
    }
  });
});

/**
 * Source-level guards (T6-C12): the load/migrate path now reads recorded
 * provenance via `resolveLoadedTitle` + stamps via `resolveTitleAuto`; the
 * shape heuristic `isAutoTitle` is no longer called directly from a hook.
 * Creation sites must still not persist a generated title (no `nextCardTitle`).
 */
function read(rel: string): string {
  return readFileSync(resolve(__dirname, "../..", rel), "utf8");
}

describe("T6-C12: creation sites don't persist a generated title", () => {
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

  it("the five persisting-sidecar migrators read provenance via resolveLoadedTitle", () => {
    for (const rel of [
      "hooks/useNotes.ts",
      "hooks/useArchive.ts",
      "hooks/useReports.ts",
      "hooks/useExamples.ts",
      "hooks/useTodos.ts",
    ]) {
      const src = read(rel);
      expect(src, `${rel} reads resolveLoadedTitle`).toContain(
        "resolveLoadedTitle",
      );
      expect(src, `${rel} stamps resolveTitleAuto`).toContain("resolveTitleAuto");
      // The shape heuristic must no longer be imported/called directly here.
      expect(src, `${rel} no direct isAutoTitle`).not.toContain("isAutoTitle");
    }
  });
});
