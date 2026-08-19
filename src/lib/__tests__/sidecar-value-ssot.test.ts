// Task 363 — the sidecar VALUE SSOT, and the census that keeps it total.
//
// The finding was a storm of Dropbox "conflicted copy" files in a real paper
// folder: 197 forks, **134 of them on the three files that no list in the
// codebase named** — `editor-state.json` (102), `virgil.json` (27),
// `collab.json` (5). `ALL_SIDECAR_FILENAMES` was "the files a mount reads",
// not "the files Virgil writes", and the three loudest writers were in neither.
// The loudest of all is a file whose entire contents are a scroll offset, a
// caret paragraph uuid and a fold list, and it was rewritten in full on every
// 400 ms scroll pause.
//
// So the table is total over what Virgil writes, and the two behaviours that
// depend on the value — the write cadence and the conflict report — are DERIVED
// from it rather than picked per hook.
//
// The leg with teeth is the CENSUS: the table was never the part that could
// misbehave — a writer that spells its own debounce number, or a sidecar
// nobody declared, is. Both are invisible to any behavioural test of the table.
//
// Legs:
//   1. TOTALITY   — every `*.json` filename production spells as a `virgil/`
//                   sidecar write target is declared.
//   2. DERIVATION — `ALL_SIDECAR_FILENAMES` is the `mount: true` subset, and
//                   the two lists can no longer drift.
//   3. CADENCE    — the tier decides the debounce, content is byte-unchanged
//                   from the pre-363 default, and an undeclared file FAILS
//                   CLOSED to content.
//   4. CENSUS     — no production write site spells a debounce literal.
//   5. CANARY     — the needles demonstrably fire (synthetic, not standing on
//                   the drained defect) + a stripper swallow self-check.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./_source-scan";
import {
  ALL_VIRGIL_SIDECAR_FILENAMES,
  CONTENT_WRITE_DEBOUNCE_MS,
  MOUNT_SIDECAR_FILENAMES,
  SIDECAR_VALUE,
  sidecarTier,
  sidecarWriteDebounceMs,
  VIEW_WRITE_DEBOUNCE_MS,
} from "@/lib/sidecar-value";
import { ALL_SIDECAR_FILENAMES } from "@/lib/sidecar-files";

const REPO = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name) && !full.includes("__tests__")) out.push(full);
  }
  return out;
}

const SRC_FILES = walk(path.join(REPO, "src"));

/**
 * Filenames that look like a sidecar but are NOT written into `virgil/`, each
 * with WHY. Kept deliberately small: a name that IS a `virgil/` write target
 * belongs in `SIDECAR_VALUE`, never here.
 */
const NON_SIDECAR_JSON: Record<string, string> = {
  "index.json": "the doc index (OPFS/dev root) and the figures cache index — neither lives in virgil/",
  "unsaved-model.json": "a forensic name inside virgil/.history/, written by the snapshot path only",
  "manifest.json": "the PWA manifest",
  "library-overlay.json": "a Library-silo file, outside any paper's virgil/",
  "personal-snapshot.json": "the prefs promoter's input, in the repo not a paper",
};

describe("sidecar value SSOT — totality", () => {
  it("declares every *.json filename production treats as a virgil/ sidecar", () => {
    const seen = new Set<string>();
    for (const file of SRC_FILES) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));
      for (const m of src.matchAll(/"([a-z][a-z0-9-]*\.json)"/g)) seen.add(m[1]!);
    }
    const undeclared = [...seen]
      .filter((f) => !(f in SIDECAR_VALUE))
      .filter((f) => !(f in NON_SIDECAR_JSON));
    expect(undeclared).toEqual([]);
  });

  it("names all three files the storm was made of", () => {
    // The regression that mattered: these were in NO list before task 363.
    expect(sidecarTier("editor-state.json")).toBe("view");
    expect(sidecarTier("collab.json")).toBe("view");
    expect(sidecarTier("virgil.json")).toBe("content");
  });

  it("is frozen and has a stable declaration order", () => {
    expect(Object.isFrozen(SIDECAR_VALUE)).toBe(true);
    expect(ALL_VIRGIL_SIDECAR_FILENAMES).toEqual(Object.keys(SIDECAR_VALUE));
  });
});

describe("sidecar value SSOT — derivation", () => {
  it("ALL_SIDECAR_FILENAMES is exactly the mount subset", () => {
    expect([...ALL_SIDECAR_FILENAMES]).toEqual([...MOUNT_SIDECAR_FILENAMES]);
    expect([...ALL_SIDECAR_FILENAMES]).toEqual(
      ALL_VIRGIL_SIDECAR_FILENAMES.filter((f) => SIDECAR_VALUE[f]!.mount),
    );
  });

  it("keeps the three self-reading files OUT of the mount bundle", () => {
    // Each has its own reader — virgil.json rides the doc bundle,
    // editor-state.json has useEditorUIState, collab.json has useCollab — so
    // pre-reading them in the mount batch would be a second read, not a saving.
    for (const f of ["virgil.json", "editor-state.json", "collab.json"]) {
      expect(ALL_SIDECAR_FILENAMES).not.toContain(f);
    }
  });

  it("sidecar-files.ts holds no hand-written list of its own", () => {
    const raw = fs.readFileSync(path.join(REPO, "src/lib/sidecar-files.ts"), "utf8");
    // A re-export, not an array literal — the drift this task closed. The
    // needle runs on the RAW source deliberately: the thing being outlawed IS
    // a list of string literals, so stripping them would make the leg
    // unfalsifiable (the 205 lesson).
    expect(raw).not.toMatch(/\[[\s\S]{0,4000}"notes\.json"/);
    expect(raw).toContain("@/lib/sidecar-value");
  });
});

describe("sidecar value SSOT — cadence", () => {
  it("derives the debounce from the tier", () => {
    expect(sidecarWriteDebounceMs("notes.json")).toBe(CONTENT_WRITE_DEBOUNCE_MS);
    expect(sidecarWriteDebounceMs("editor-state.json")).toBe(VIEW_WRITE_DEBOUNCE_MS);
    expect(VIEW_WRITE_DEBOUNCE_MS).toBeGreaterThan(CONTENT_WRITE_DEBOUNCE_MS);
  });

  it("leaves every CONTENT sidecar at the pre-363 default, byte for byte", () => {
    // The fix must not have quietly slowed the user's writing to disk. 300 ms
    // was `usePersistentState`'s hard-coded default before this task.
    expect(CONTENT_WRITE_DEBOUNCE_MS).toBe(300);
    for (const f of ALL_VIRGIL_SIDECAR_FILENAMES) {
      if (SIDECAR_VALUE[f]!.tier !== "content") continue;
      expect(sidecarWriteDebounceMs(f)).toBe(300);
    }
  });

  it("FAILS CLOSED for an undeclared file", () => {
    // A wrongly-content file costs some extra writes; a wrongly-view file costs
    // the user's writing. The default is the whole of that asymmetry.
    expect(sidecarTier("some-future-panel.json")).toBe("content");
    expect(sidecarWriteDebounceMs("some-future-panel.json")).toBe(
      CONTENT_WRITE_DEBOUNCE_MS,
    );
  });
});

// ── The leg with teeth ────────────────────────────────────────────────────
// The two writers that own a sidecar debounce must take it from the door. A
// hand-picked number is exactly how `useEditorUIState` came to write ~100×
// per reading session while `usePersistentState` wrote at 300 ms, with nothing
// in the codebase relating the two.
const DEBOUNCE_OWNERS = [
  "src/hooks/usePersistentState.ts",
  "src/hooks/useEditorUIState.ts",
];

describe("sidecar value SSOT — census", () => {
  it("no sidecar write site spells its own debounce number", () => {
    for (const rel of DEBOUNCE_OWNERS) {
      const src = codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"));
      // The shape a hand-picked cadence takes: a bare millisecond literal
      // handed to setTimeout, or a `debounceMs = <n>` default.
      expect(src, `${rel} sets a timer from a literal`).not.toMatch(
        /setTimeout\([\s\S]{0,200}?,\s*\d{2,}\s*\)/,
      );
      expect(src, `${rel} defaults debounceMs to a literal`).not.toMatch(
        /debounceMs\s*=\s*\d+/,
      );
      expect(src, `${rel} does not read the cadence door`).toContain(
        "sidecarWriteDebounceMs",
      );
    }
  });

  it("CANARY — the needles fire on the pre-363 shapes", () => {
    const preFix = `const { debounceMs = 300 } = opts;\n` +
      `timer = setTimeout(() => { write(); }, 400);\n`;
    expect(codeOnly(preFix)).toMatch(/debounceMs\s*=\s*\d+/);
    expect(codeOnly(preFix)).toMatch(/setTimeout\([\s\S]{0,200}?,\s*\d{2,}\s*\)/);
  });

  it("CANARY — the stripper does not swallow the SSOT it reads", () => {
    // 202b's runaway (a backtick inside a double-quoted string ate 7 kB and
    // nine declarations, suite green) is the failure this checks for: the
    // census legs above are all NEGATIVE, so a stripper that returned "" would
    // pass every one of them.
    const raw = fs.readFileSync(path.join(REPO, "src/lib/sidecar-value.ts"), "utf8");
    const stripped = codeOnly(raw);
    // One surviving `{ tier` per declared entry. A ratio threshold would be
    // the wrong instrument here — this file is mostly prose, so a correct
    // strip legitimately removes ~80% of it.
    expect(stripped.match(/\{ tier/g)?.length ?? 0).toBe(
      ALL_VIRGIL_SIDECAR_FILENAMES.length,
    );
    for (const name of [
      "SIDECAR_VALUE",
      "sidecarWriteDebounceMs",
      "VIEW_WRITE_DEBOUNCE_MS",
      "CONTENT_WRITE_DEBOUNCE_MS",
    ]) {
      expect(stripped).toContain(name);
    }
    // And the ENTRIES survive on the raw side, one `tier:` per declared file
    // plus the interface's own field.
    expect(raw.split("\n").filter((l) => /tier: "(view|content)"/.test(l)).length)
      .toBe(ALL_VIRGIL_SIDECAR_FILENAMES.length);
  });
});
