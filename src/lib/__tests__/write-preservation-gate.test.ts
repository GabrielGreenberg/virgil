// Task 357 — the WRITE-side preservation gate.
//
// 350-D gated the LOAD writeback and deliberately exempted the autosave: once
// the user has edited, the model IS their document, and refusing to save their
// typing would be a worse failure than the one being guarded. That rationale is
// sound and it does not cover `writeDocBundle`'s OTHER caller.
//
// `flushNow` writes the whole bundle on an anchor-UUID MINT. One card gesture —
// a grab-handle click, an omni open, a card drag — on a uuid-less paragraph
// mints an id and persists immediately, WITH NO TYPING AT ALL. So a lossy parse
// reached disk on a gesture the user reasonably believes is read-only, and it
// replaced `virgil.json` wholesale on the way, carrying sidecar damage no .tex
// gate could ever see.
//
// The contract these legs pin, in the task's own words: load a lossy model →
// card gesture → NO write; then a real keystroke → write allowed, because the
// model is now the user's.
import { describe, expect, it, beforeEach } from "vitest";
import {
  retainLoadedCounts,
  checkWriteAgainstRetained,
  noteUserEdit,
  clearRetained,
  isRealUserEdit,
} from "@/lib/write-preservation";
import type { Transaction } from "@tiptap/pm/state";

const DOC = "doc-1";
const LOADED = `\\documentclass{article}
\\usepackage{expex}

\\begin{document}

\\section{One}

Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.

\\section{Two}

Nu xi omicron pi rho sigma tau upsilon phi chi psi omega.

\\end{document}
`;
/** What a lossy parse would re-serialize to — the second section gone. */
const LOSSY = `\\documentclass{article}
\\usepackage{expex}

\\begin{document}

\\section{One}

Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.

\\end{document}
`;

/** A transaction as the update event delivers it. `addToHistory: false` is the
 *  shape every system write uses (see `anchor-mint-signal.ts`). */
function tx(opts: { docChanged: boolean; addToHistory?: false }): Transaction {
  return {
    docChanged: opts.docChanged,
    getMeta: (k: string) =>
      k === "addToHistory" ? opts.addToHistory : undefined,
  } as unknown as Transaction;
}

beforeEach(() => clearRetained());

describe("the gate refuses a pre-edit write that loses content", () => {
  it("refuses the write when nothing the user did produced it", () => {
    retainLoadedCounts(DOC, LOADED);
    const v = checkWriteAgainstRetained(DOC, LOSSY);
    expect(v, "a lossy pre-edit write was allowed").not.toBeNull();
    expect(v!.region).toBe("body");
    expect(v!.lost).toBeGreaterThan(v!.allowed);
  });

  it("allows an honest write that loses nothing", () => {
    retainLoadedCounts(DOC, LOADED);
    expect(checkWriteAgainstRetained(DOC, LOADED)).toBeNull();
  });

  it("allows a write that GROWS the document", () => {
    retainLoadedCounts(DOC, LOADED);
    const grown = LOADED.replace("\\end{document}", "Extra prose here.\n\n\\end{document}");
    expect(checkWriteAgainstRetained(DOC, grown)).toBeNull();
  });

  it("steps aside once the user has genuinely edited", () => {
    // The 350-D rationale, applied at its real boundary: after a real edit the
    // model is theirs and refusing to save it would be the worse failure.
    retainLoadedCounts(DOC, LOADED);
    expect(checkWriteAgainstRetained(DOC, LOSSY)).not.toBeNull();
    noteUserEdit(DOC);
    expect(checkWriteAgainstRetained(DOC, LOSSY)).toBeNull();
  });

  it("says NOTHING for a doc this process never loaded", () => {
    // No baseline ⇒ nothing to compare. The gate must not invent one.
    expect(checkWriteAgainstRetained("never-loaded", LOSSY)).toBeNull();
  });

  it("a fresh load RESETS both the baseline and the edited flag", () => {
    retainLoadedCounts(DOC, LOADED);
    noteUserEdit(DOC);
    expect(checkWriteAgainstRetained(DOC, LOSSY)).toBeNull();
    retainLoadedCounts(DOC, LOADED); // reopened
    expect(checkWriteAgainstRetained(DOC, LOSSY)).not.toBeNull();
  });

  it("guards the PREAMBLE region independently of the body", () => {
    retainLoadedCounts(DOC, LOADED);
    // Body untouched; only the preamble shrinks — a body-only gate would pass
    // this, which is why the two regions are weighed separately.
    const gutted = LOADED.replace("\\usepackage{expex}\n", "");
    // …and it does NOT trip: `\\usepackage{expex}` is 2 words and the floor is 4.
    // That is the slack floor doing what it was built to do, recorded as a
    // STATED limit rather than a hidden one — the task notes the same floor
    // passes one whole `\\author{Jane Q. Doe}`. Closing it needs the dropped-RUN
    // leg (a contiguous source run absent from the output), a separate piece.
    expect(gutted).not.toBe(LOADED);
    expect(checkWriteAgainstRetained(DOC, gutted), "the 4-word floor is documented, not a surprise").toBeNull();
  });

  it("…and DOES trip once the preamble loss clears the floor", () => {
    const extra = "\\usepackage{graphicx}\n\\usepackage{amsmath}\n\\usepackage{booktabs}\n";
    const rich = LOADED.replace("\\begin{document}", extra + "\\begin{document}");
    retainLoadedCounts(DOC, rich);
    const stripped = rich.replace(extra, "");
    const v = checkWriteAgainstRetained(DOC, stripped);
    expect(v?.region).toBe("preamble");
  });
});

describe("what counts as a REAL user edit", () => {
  it("an anchor MINT does not — it is doc-changing and not undoable", () => {
    // The trap this exists for: keying on `docChanged` alone re-opens the hole,
    // because a mint IS a docChanged transaction.
    expect(isRealUserEdit(tx({ docChanged: true, addToHistory: false }))).toBe(false);
  });

  it("typing does — doc-changing and undoable", () => {
    expect(isRealUserEdit(tx({ docChanged: true }))).toBe(true);
  });

  it("a selection-only transaction does not", () => {
    expect(isRealUserEdit(tx({ docChanged: false }))).toBe(false);
    expect(isRealUserEdit(undefined)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE CENSUS — the leg with teeth
// ───────────────────────────────────────────────────────────────────────────
//
// The gate was never the part that could misbehave; a write path that never
// asks it is. Both backends are pinned by SOURCE, since neither `writeDocBundle`
// is reachable from a unit test (each needs a live FSA handle or the dev API).
//
// SCOPE, stated rather than implied: this covers `writeDocBundle` and the
// retain-at-read call. The task's remaining write paths — the code-pane
// re-parse, the schema-mount probe, `writeTex`'s missing snapshot and
// `apply_response.py` — are NOT yet gated and are NOT claimed here; see the
// task's progress log for what remains.
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("census · both backends ask the gate before writing a bundle", () => {
  const BACKENDS = ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"] as const;
  const REPO = join(__dirname, "../../..");

  it("each backend retains at READ and checks at WRITE", () => {
    for (const rel of BACKENDS) {
      const src = readFileSync(join(REPO, rel), "utf8");
      expect(src, `${rel} must retain the loaded counts`).toContain(
        "retainLoadedCounts(",
      );
      expect(src, `${rel} must ask the write gate`).toContain(
        "checkWriteAgainstRetained(",
      );
      // …and ACT on the answer. A call whose verdict is dropped on the floor
      // type-checks perfectly and IS the defect.
      expect(src, `${rel} must refuse on a verdict`).toMatch(
        /if\s*\(\s*writeVerdict\s*\)/,
      );
    }
  });

  it("the refusal precedes every write, the snapshot AND the ledger stamp", () => {
    // A refusal that had already stamped the ledger would make the DiskWatcher
    // report Virgil's own untaken write as an external change; one that had
    // already PUT the sidecar would leave `virgil.json` replaced wholesale by a
    // model the .tex gate just refused.
    for (const rel of BACKENDS) {
      const src = readFileSync(join(REPO, rel), "utf8");
      const gateAt = src.indexOf("checkWriteAgainstRetained(");
      const refuseAt = src.indexOf("describeWriteRefusal(", gateAt);
      expect(refuseAt, `${rel}: no refusal after the gate`).toBeGreaterThan(-1);
      // Scan from the gate's enclosing write function, not from the gate —
      // searching forward from the gate cannot see a write that PRECEDES it
      // (the toothless shape task 350-D's own census had to repair).
      const fnAt = src.lastIndexOf("writeDocBundle", gateAt);
      // The needles are the DESTRUCTIVE ones — the two file PUTs and the ledger
      // stamp. `snapshotPriorBundle(` left this list in task 357's serializer
      // pass and the reason is worth stating: it is a copy INTO
      // `virgil/.history/` that overwrites nothing, and every refusal path now
      // deliberately takes one on its armed edge (the serializer gate refuses
      // BEFORE this one, so its armed snapshot legitimately precedes this
      // refusal). Requiring it after the refusal would indict the forensic net
      // the refusal exists to arm. That it happens on exactly the armed edge is
      // pinned in `preservation-refusal-posture.test.ts`.
      for (const needle of ["putText(", "writeTextToHandle(", "stampLedger("]) {
        const at = src.indexOf(needle, fnAt);
        if (at === -1 || at > src.indexOf("\n}\n", refuseAt) + 100000) continue;
        expect(
          at,
          `${rel}: ${needle} must come AFTER the gate's refusal`,
        ).toBeGreaterThan(refuseAt);
      }
    }
  });

  it("the SERIALIZER gate precedes the words gate, in both backends", () => {
    // Task 357. The words measure counts the bytes a serialize produced; a
    // serialize that REFUSED produced none, so asking the word gate first would
    // be asking about a string that does not exist. Ordering is the whole of
    // it: both refusals must sit above every write, and the serializer's must
    // sit above the words gate's.
    for (const rel of BACKENDS) {
      const src = readFileSync(join(REPO, rel), "utf8");
      const serializeGuardAt = src.indexOf("reportSerializeRefusal(");
      expect(
        serializeGuardAt,
        `${rel} must catch the serializer's refusal, not let it escape`,
      ).toBeGreaterThan(-1);
      expect(
        src.indexOf("checkWriteAgainstRetained("),
        `${rel}: the words gate must come after the serializer gate`,
      ).toBeGreaterThan(serializeGuardAt);
    }
  });

  it("the user-edit signal is wired, and is NOT a bare docChanged test", () => {
    const src = readFileSync(join(REPO, "src/hooks/useDocument.ts"), "utf8");
    expect(src).toContain("isRealUserEdit(");
    expect(src).toContain("noteUserEdit(");
    // The trap: keying the step-aside on `docChanged` re-opens the hole, since
    // an anchor mint is doc-changing too.
    expect(src).not.toMatch(/if\s*\(\s*tx\?\.docChanged\s*\)\s*noteUserEdit/);
  });
});
