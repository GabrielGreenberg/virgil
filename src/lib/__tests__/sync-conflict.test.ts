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
import {
  classifySidecarSibling,
  hasSyncConflicts,
  scanSidecarSiblings,
} from "@/lib/sync-conflict";

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
