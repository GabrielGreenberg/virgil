// Task 363 — the fork half: noticing what a sync daemon did to `virgil/`.
//
// The fixtures below are REAL names, copied out of the folder this task was
// filed from (`Dropbox/Apps/Overleaf/Coherence Intro/virgil/`, 2026-08-18: 197
// conflicted copies and 19 leftover `.crswap` files across eight sidecars).
// That matters more than it looks — every grammar here is a guess about what
// some other program writes, and a hand-invented fixture would only prove the
// regex matches the regex's author's idea of Dropbox.
//
// Legs:
//   1. GRAMMARS   — each service's decoration, on real names.
//   2. FAIL CLOSED — a declared sidecar is never a sibling; a decoration whose
//                    base is not a Virgil file is not reported as the user's
//                    lost writing.
//   3. REPORT     — grouping, the content/view split, and the ordering that
//                   puts the half that can be unmerged writing first.
//   4. TIER JOIN  — the report reads the value SSOT, so `editor-state.json`'s
//                   102 forks are debris and `notes.json`'s 36 are not.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  classifySidecarSibling,
  hasSyncConflicts,
  scanSidecarSiblings,
  SYNC_ORIGIN_LABEL,
} from "@/lib/sync-conflict";
import { ALL_VIRGIL_SIDECAR_FILENAMES, SIDECAR_VALUE } from "@/lib/sidecar-value";

/** Verbatim from the reporting folder. */
const REAL_NAMES = [
  "notes.json",
  "notes (Gabriel Greenberg's conflicted copy 2026-06-09).json",
  "notes (Gabriel Greenberg's conflicted copy 2026-06-09 5).json",
  "archive.json",
  "archive (Gabriel Greenberg's conflicted copy 2026-07-04).json",
  "archive (Gabriel Greenberg's conflicted copy 2026-07-04 1).json",
  "editor-state.json",
  "editor-state (Gabriel Greenberg's conflicted copy 2026-08-18).json",
  "editor-state (Gabriel Greenberg's conflicted copy 2026-08-18 3).json",
  "archive.json.1.crswap",
  "citations.json.crswap",
  "ai-requests.json",
];

describe("sync-conflict — grammars", () => {
  it("recognizes a Dropbox conflicted copy, attributed and dated", () => {
    const s = classifySidecarSibling(
      "notes (Gabriel Greenberg's conflicted copy 2026-06-09 5).json",
    );
    expect(s).toEqual({
      name: "notes (Gabriel Greenberg's conflicted copy 2026-06-09 5).json",
      base: "notes.json",
      kind: "conflict",
      origin: "dropbox",
    });
  });

  it("recognizes the older un-attributed Dropbox spelling", () => {
    expect(classifySidecarSibling("notes (conflicted copy 2026-06-09).json"))
      .toMatchObject({ base: "notes.json", origin: "dropbox" });
  });

  it("recognizes Syncthing, Drive and iCloud decorations", () => {
    expect(
      classifySidecarSibling("revisions.sync-conflict-20260818-120000-K3XQ7ZA.json"),
    ).toMatchObject({ base: "revisions.json", origin: "syncthing" });
    expect(classifySidecarSibling("todos (1).json")).toMatchObject({
      base: "todos.json",
      origin: "drive",
    });
    expect(classifySidecarSibling("cutter 2.json")).toMatchObject({
      base: "cutter.json",
      origin: "icloud",
    });
  });

  it("recognizes Chrome FSA write debris, numbered or not", () => {
    expect(classifySidecarSibling("archive.json.1.crswap")).toMatchObject({
      base: "archive.json",
      kind: "swap",
      origin: "chrome-swap",
    });
    expect(classifySidecarSibling("citations.json.crswap")).toMatchObject({
      base: "citations.json",
      kind: "swap",
    });
  });
});

describe("sync-conflict — fails closed", () => {
  it("never reports a declared sidecar as a sibling of another", () => {
    // `bib-settings.json` must not read as `bib` + a suffix, and the exact
    // match short-circuits FIRST so no decoration grammar can reinterpret it.
    for (const name of [
      "notes.json",
      "bib-settings.json",
      "bib-review-requests.json",
      "orphaned-footnotes.json",
      "editor-state.json",
    ]) {
      expect(classifySidecarSibling(name)).toBeNull();
    }
  });

  it("does not claim a file whose base Virgil does not write", () => {
    // A user's own parked file, and a fork of something that isn't ours.
    expect(classifySidecarSibling("notes-old.json")).toBeNull();
    expect(classifySidecarSibling("scratch (1).json")).toBeNull();
    expect(
      classifySidecarSibling("references (Gabriel's conflicted copy 2026-01-01).bib"),
    ).toBeNull();
    expect(classifySidecarSibling("scratch.json.crswap")).toBeNull();
  });

  it("leaves .history/ and unrelated entries alone", () => {
    expect(classifySidecarSibling("unsaved-model.json")).toBeNull();
    expect(classifySidecarSibling("README.md")).toBeNull();
  });
});

describe("sync-conflict — report", () => {
  it("groups the real folder's names and splits content from view", () => {
    const r = scanSidecarSiblings(REAL_NAMES);
    expect(hasSyncConflicts(r)).toBe(true);
    expect(r.total).toBe(6);
    // notes + archive are the user's writing; editor-state is not.
    expect(r.contentTotal).toBe(4);
    expect(r.swapFiles).toEqual(["archive.json.1.crswap", "citations.json.crswap"]);
    // Content first, then descending count, then alphabetical — notes and
    // archive tie at 2, so the tie-break decides and the order is stable.
    expect(r.groups.map((g) => g.base)).toEqual([
      "archive.json",
      "notes.json",
      "editor-state.json",
    ]);
    expect(r.groups.map((g) => g.tier)).toEqual(["content", "content", "view"]);
  });

  it("puts CONTENT first even when a view file has far more forks", () => {
    // The reporting folder's actual shape: editor-state had 102 forks and
    // notes 36, and the 36 are the ones that can be unmerged writing.
    const names = [
      ...Array.from(
        { length: 5 },
        (_, i) => `editor-state (X's conflicted copy 2026-08-18 ${i}).json`,
      ),
      "notes (X's conflicted copy 2026-06-09).json",
    ];
    const r = scanSidecarSiblings(names);
    expect(r.groups[0]!.base).toBe("notes.json");
    expect(r.total).toBe(6);
    expect(r.contentTotal).toBe(1);
  });

  it("reports nothing for a clean folder", () => {
    const r = scanSidecarSiblings(["notes.json", "archive.json", "virgil.json"]);
    expect(hasSyncConflicts(r)).toBe(false);
    expect(r.total).toBe(0);
    expect(r.groups).toEqual([]);
  });

  it("counts swap debris without raising a conflict on its own", () => {
    // `.crswap` is never user data — it rides a report as context, and a folder
    // with only debris has nothing worth a pill (the badge's own render gate).
    const r = scanSidecarSiblings(["notes.json", "notes.json.2.crswap"]);
    expect(r.total).toBe(0);
    expect(r.swapFiles).toHaveLength(1);
    expect(hasSyncConflicts(r)).toBe(false);
  });
});


// ── The offline tool is a SECOND SPELLER of two things it must not drift on ──
// `tools/triage-sync-conflicts.mjs` is a `.mjs` script with no build step, so it
// cannot import the TypeScript SSOTs. It therefore re-states the decoration
// grammars and re-reads the sidecar vocabulary out of `sidecar-value.ts` by
// regex — and it is the half that DELETES files, so a drift there is the
// dangerous direction. These legs are what hold the two copies together.
describe("triage tool — held to the app's SSOTs", () => {
  const REPO = path.resolve(__dirname, "../../..");
  const TOOL = fs.readFileSync(
    path.join(REPO, "tools/triage-sync-conflicts.mjs"),
    "utf8",
  );
  const MODULE = fs.readFileSync(
    path.join(REPO, "src/lib/sync-conflict.ts"),
    "utf8",
  );

  /** Every regex literal in a source, normalized to its own text. */
  function regexes(src: string): string[] {
    return [...src.matchAll(/\/\^[^\n]*?\/[gimsuy]*/g)].map((m) => m[0]);
  }

  it("spells the same decoration grammars as the module", () => {
    const inModule = new Set(regexes(MODULE));
    const inTool = regexes(TOOL);
    // Every grammar the TOOL uses must be one the module also has — the tool is
    // never allowed to be more permissive than the surface that only reports.
    const extra = inTool.filter((r) => !inModule.has(r));
    expect(extra).toEqual([]);
    // …and it must actually carry them, or this leg passes vacuously.
    expect(inTool.length).toBeGreaterThanOrEqual(5);
  });

  it("reads the vocabulary from sidecar-value.ts, and the extraction is exact", () => {
    // The tool must NOT derive `declared` from the folder listing — that is the
    // open base set the module's whole loose-grammar safety argument forbids,
    // applied on the side that deletes.
    expect(TOOL).toContain("sidecar-value.ts");
    expect(TOOL).not.toMatch(/names\.filter\([^)]*\.json\$/);
    // Run the tool's OWN extraction regex against the real SSOT source.
    const ssot = fs.readFileSync(
      path.join(REPO, "src/lib/sidecar-value.ts"),
      "utf8",
    );
    const extracted = new Map<string, string>();
    for (const m of ssot.matchAll(
      /"([a-z][a-z0-9-]*\.json)":\s*\{\s*tier:\s*"(view|content)"/g,
    )) {
      extracted.set(m[1]!, m[2]!);
    }
    expect([...extracted.keys()].sort()).toEqual(
      [...ALL_VIRGIL_SIDECAR_FILENAMES].sort(),
    );
    for (const [f, tier] of extracted) {
      expect(SIDECAR_VALUE[f]!.tier).toBe(tier);
    }
  });

  it("decides prunability by POSITIVE evidence, never by a hand list of shapes", () => {
    // The first version asked "does this fork hold a record id the live file
    // lacks?", reading records out of a seven-name key list — so eight of the
    // twenty sidecars were deleted unexamined, and a same-id body edit (the
    // commonest conflict shape there is) read as carrying nothing. Both halves
    // fail OPEN in the destructive direction.
    expect(TOOL).not.toMatch(/\["cards",\s*"snippets"/);
    expect(TOOL).toContain("deepEqual");
    // The id-diff survives only as a labelled HINT, and must not gate the prune.
    expect(TOOL).toMatch(/newRecordHint/);
    const pruneRegion = TOOL.slice(TOOL.indexOf("const prunable"));
    expect(pruneRegion).not.toMatch(/prunable\.push\([^)]*newRecordHint/);
  });
});

describe("sync-conflict — the origin column has a reader", () => {
  it("reports ONE origin when every fork agrees, and null when they do not", () => {
    const one = scanSidecarSiblings([
      "notes.json",
      "notes (X's conflicted copy 2026-01-01).json",
      "archive (X's conflicted copy 2026-01-02).json",
    ]);
    expect(one.origin).toBe("dropbox");
    expect(SYNC_ORIGIN_LABEL[one.origin!]).toBe("Dropbox");

    const mixed = scanSidecarSiblings([
      "notes (X's conflicted copy 2026-01-01).json",
      "archive.sync-conflict-20260102-101010-AAAA.json",
    ]);
    expect(mixed.origin).toBeNull();
  });

  it("every origin has a human label", () => {
    for (const k of ["dropbox", "syncthing", "drive", "icloud", "chrome-swap"] as const) {
      expect(SYNC_ORIGIN_LABEL[k]).toBeTruthy();
    }
  });
});
