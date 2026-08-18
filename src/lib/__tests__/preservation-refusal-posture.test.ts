// Task 357 hole 4 — the INERT refusal.
//
// Both preservation gates were correct about the `.tex` and silent about the
// user. Each `console.error`d on a fire-and-forget promise; `readDocBundle`
// returned the lossy content anyway; the editor mounted it; and the first
// gesture that counted as a real user edit let the write gate step aside, so
// the very model that had just been refused reached disk on the next autosave.
// Net: the gates DELAYED the loss by one gesture and never told anyone.
//
// The contract these legs pin: a refusal is published, it SUSPENDS the
// step-aside for as long as it stands, and an acknowledgment — the user's
// informed choice — is the one thing that outranks it.
import { describe, expect, it, beforeEach } from "vitest";
import {
  recordPreservationRefusal,
  getPreservationNotice,
  isWriteProtected,
  isPreservationAcknowledged,
  acknowledgePreservationNotice,
  clearPreservationNotice,
  subscribePreservationNotices,
  type PreservationRefusalDetail,
} from "@/lib/preservation-notice";
import {
  retainLoadedCounts,
  checkWriteAgainstRetained,
  noteUserEdit,
  clearRetained,
  writeRefusalDetail,
} from "@/lib/write-preservation";
import {
  checkTexPreservation,
  preservationRefusalDetail,
} from "@/lib/tex-preservation";

const DOC = "doc-1";

const LOADED = `\\documentclass{article}

\\begin{document}

\\section{One}

Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.

\\section{Two}

Nu xi omicron pi rho sigma tau upsilon phi chi psi omega.

\\end{document}
`;
/** What a lossy parse re-serializes to — the second section gone. */
const LOSSY = `\\documentclass{article}

\\begin{document}

\\section{One}

Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.

\\end{document}
`;

const DETAIL: PreservationRefusalDetail = {
  source: "load",
  region: "body",
  before: 20,
  after: 8,
  lost: 12,
  allowed: 4,
};

beforeEach(() => {
  clearRetained();
  clearPreservationNotice();
});

describe("the refusal channel", () => {
  it("publishes the first refusal and reports it ARMED", () => {
    const { armed } = recordPreservationRefusal(DOC, DETAIL);
    expect(armed, "the first refusal must arm the forensic snapshot").toBe(true);
    const n = getPreservationNotice(DOC);
    expect(n?.lost).toBe(12);
    expect(n?.source).toBe("load");
    expect(n?.refusals).toBe(1);
    expect(isWriteProtected(DOC)).toBe(true);
  });

  it("counts a REPEAT refusal without re-arming", () => {
    // The autosave retries every 1500 ms while the notice stands. Re-arming
    // would re-snapshot identical bytes for as long as the user reads the
    // banner, which is exactly what the armed EDGE exists to avoid.
    recordPreservationRefusal(DOC, DETAIL);
    const second = recordPreservationRefusal(DOC, {
      ...DETAIL,
      source: "write",
    });
    expect(second.armed).toBe(false);
    const n = getPreservationNotice(DOC);
    expect(n?.refusals).toBe(2);
    // The FIRST refusal's source is the one kept — it describes what went wrong.
    expect(n?.source).toBe("load");
  });

  it("does not re-arm behind an ACKNOWLEDGMENT", () => {
    recordPreservationRefusal(DOC, DETAIL);
    acknowledgePreservationNotice(DOC);
    recordPreservationRefusal(DOC, DETAIL);
    expect(isPreservationAcknowledged(DOC)).toBe(true);
    expect(isWriteProtected(DOC)).toBe(false);
  });

  it("says nothing about a doc with no refusal", () => {
    expect(getPreservationNotice("never-refused")).toBeNull();
    expect(getPreservationNotice(null)).toBeNull();
    expect(isWriteProtected(null)).toBe(false);
  });

  it("hands out a STABLE snapshot until the notice changes", () => {
    // useSyncExternalStore's getSnapshot must not mint a new object per call.
    recordPreservationRefusal(DOC, DETAIL);
    expect(getPreservationNotice(DOC)).toBe(getPreservationNotice(DOC));
    const before = getPreservationNotice(DOC);
    acknowledgePreservationNotice(DOC);
    expect(getPreservationNotice(DOC)).not.toBe(before);
  });

  it("notifies subscribers on record, acknowledge and clear — and not otherwise", () => {
    let fires = 0;
    const off = subscribePreservationNotices(() => {
      fires += 1;
    });
    recordPreservationRefusal(DOC, DETAIL);
    acknowledgePreservationNotice(DOC);
    acknowledgePreservationNotice(DOC); // idempotent — no second fire
    clearPreservationNotice(DOC);
    clearPreservationNotice(DOC); // nothing to drop — no fire
    off();
    expect(fires).toBe(3);
  });
});

describe("a STANDING refusal suspends the write gate's step-aside", () => {
  it("keeps measuring after a REAL user edit — the defect this closes", () => {
    // Pre-fix: the load gate refused, the editor mounted the lossy model, the
    // user typed one character, and the gate stepped aside — so the autosave
    // wrote the refused model over their intact file.
    retainLoadedCounts(DOC, LOADED);
    const verdict = checkTexPreservation(LOADED, LOSSY);
    expect(verdict.ok).toBe(false);
    recordPreservationRefusal(DOC, preservationRefusalDetail(verdict));

    noteUserEdit(DOC); // the user types into the lossy model

    const v = checkWriteAgainstRetained(DOC, LOSSY);
    expect(v, "a standing refusal must not be overridden by a user edit").not.toBeNull();
    expect(v!.region).toBe("body");
  });

  it("steps aside once the user ACKNOWLEDGES, edit or no edit", () => {
    retainLoadedCounts(DOC, LOADED);
    recordPreservationRefusal(DOC, DETAIL);
    expect(checkWriteAgainstRetained(DOC, LOSSY)).not.toBeNull();
    acknowledgePreservationNotice(DOC);
    // No user edit anywhere — the acknowledgment alone is the permission,
    // because refusing a user who was told and decided is the worse failure.
    expect(checkWriteAgainstRetained(DOC, LOSSY)).toBeNull();
  });

  it("still steps aside on a plain user edit when NOTHING was refused", () => {
    // The 350-D rationale, unchanged: with no evidence against the model, the
    // user's typing makes it theirs. A fix that broke this would refuse every
    // real deletion the user ever makes.
    retainLoadedCounts(DOC, LOADED);
    noteUserEdit(DOC);
    expect(checkWriteAgainstRetained(DOC, LOSSY)).toBeNull();
  });

  it("a fresh LOAD drops the notice through the one door", () => {
    // `retainLoadedCounts` is the single door both halves of the gate enter, so
    // the baseline and the posture cannot disagree about what a reload means.
    recordPreservationRefusal(DOC, DETAIL);
    expect(isWriteProtected(DOC)).toBe(true);
    retainLoadedCounts(DOC, LOADED);
    expect(isWriteProtected(DOC)).toBe(false);
    expect(getPreservationNotice(DOC)).toBeNull();
  });

  it("carries the write gate's own verdict into the channel unchanged", () => {
    retainLoadedCounts(DOC, LOADED);
    const v = checkWriteAgainstRetained(DOC, LOSSY);
    const detail = writeRefusalDetail(v!);
    expect(detail).toEqual({
      source: "write",
      region: v!.region,
      before: v!.before,
      after: v!.after,
      lost: v!.lost,
      allowed: v!.allowed,
    });
  });

  it("carries the LOAD gate's verdict, picking the region that failed", () => {
    // Body-first, else preamble — the same rule `describePreservationRefusal`
    // states, spelled once so the banner and the log line cannot disagree.
    const preambleLoss = LOADED.replace(
      "\\documentclass{article}",
      "\\documentclass{article}\n\\usepackage{a}\n\\usepackage{b}\n\\usepackage{c}\n\\usepackage{d}\n\\usepackage{e}",
    );
    const stripped = LOADED;
    const v = checkTexPreservation(preambleLoss, stripped);
    expect(v.ok).toBe(false);
    expect(preservationRefusalDetail(v).region).toBe("preamble");
    expect(preservationRefusalDetail(checkTexPreservation(LOADED, LOSSY)).region).toBe(
      "body",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE CENSUS — the leg with teeth
// ───────────────────────────────────────────────────────────────────────────
//
// The channel was never the part that could misbehave; a refusal site that
// keeps its finding to itself is. Neither backend's gate is reachable from a
// unit test (each needs a live FSA handle or the dev API), so both are pinned
// by SOURCE — and so is the save path, which lives in a hook no test mounts
// against a real backend.
import { readFileSync } from "node:fs";
import { codeOnly } from "@/lib/__tests__/_source-scan";
import { join } from "node:path";

const REPO = join(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

describe("census · every refusal reaches the channel", () => {
  const BACKENDS = ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"] as const;

  it("both backends publish at BOTH gates", () => {
    for (const rel of BACKENDS) {
      const src = read(rel);
      const hits = src.match(/recordPreservationRefusal\(/g) ?? [];
      expect(
        hits.length,
        `${rel}: each of the load gate and the write gate must publish its refusal`,
      ).toBe(2);
      // …and each publishes the verdict it actually measured, rather than a
      // hand-built detail that could drift from the log line beside it.
      expect(src).toContain("preservationRefusalDetail(verdict)");
      expect(src).toContain("writeRefusalDetail(writeVerdict)");
    }
  });

  it("the FSA backend snapshots on the ARMED edge, at both gates", () => {
    // The bytes on disk are still the intact ones at the moment of the first
    // refusal, and that is the last moment we are certain of it. The dev
    // backend keeps no `virgil/.history/`, so it has no snapshot to force —
    // an asymmetry stated at both of its sites rather than silently absent.
    const fsa = read("src/lib/storage-fsa.ts");
    const armedBlocks = fsa.match(/if \(armed\) \{\s*await snapshotPriorBundle\(/g) ?? [];
    expect(armedBlocks.length, "both gates must snapshot on the armed edge").toBe(2);
    // Asked of CODE, not raw source: the dev backend's own sites now NAME the
    // missing snapshot in prose to state the asymmetry (task 357's `writeTex`
    // marker does exactly that), and a guard that cannot tell a comment from a
    // call would read that honesty as the mechanism it is denying.
    const dev = codeOnly(read("src/lib/storage-dev.ts"));
    expect(dev).not.toContain("snapshotPriorBundle");
  });

  it("the save path reads the CHANNEL rather than the absence of a throw", () => {
    // `writeDocBundle` returns normally on a refusal, so a save path that
    // inferred success from "nothing threw" would report Saved over a write
    // that never happened — and advance `lastSavedRef` to a doc that never
    // reached disk, which suppresses a later legitimate flush of it.
    const src = read("src/hooks/useDocument.ts");
    expect(src).toContain("isWriteProtected(handle.docId)");
    const at = src.indexOf("isWriteProtected(handle.docId)");
    const savedAt = src.indexOf('setSaveStatus("saved")', at);
    const assignAt = src.indexOf("lastSavedRef.current = doc", at);
    expect(savedAt, "the refusal check must precede the saved claim").toBeGreaterThan(at);
    expect(assignAt, "…and precede the lastSaved assignment").toBeGreaterThan(at);
  });

  it("the gate consults the posture, and the posture has ONE door out", () => {
    const gate = read("src/lib/write-preservation.ts");
    expect(gate).toContain("isPreservationAcknowledged(docId)");
    expect(gate).toContain("isWriteProtected(docId)");
    // A bare `entry.userEdited` early-return is the pre-fix shape and is
    // exactly what re-opens the hole; it must be qualified by the posture.
    expect(gate).not.toMatch(/if\s*\(\s*!entry\s*\|\|\s*entry\.userEdited\s*\)/);
    // And the notice is dropped at the one place the baseline is captured.
    expect(gate).toContain("clearPreservationNotice(docId)");
  });

  it("the banner offers no plain DISMISS", () => {
    // Dismissing would hide the notice while every write stayed refused —
    // the silence this surface exists to end, wearing a tidier UI.
    const badge = read("src/components/PreservationNoticeBadge.tsx");
    expect(badge).toContain("acknowledgePreservationNotice(");
    expect(badge).not.toMatch(/clearPreservationNotice\(/);
  });
});
