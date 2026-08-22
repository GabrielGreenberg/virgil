// @vitest-environment jsdom
//
// **Write-side accountability** — task 357, the census this cluster was missing.
//
// 350-D gated the load-writeback; 357 gated `writeDocBundle` (hole 1), gave the
// refusal a channel and a posture (hole 4), gated the code-pane re-parse (hole
// 2) and the schema MOUNT (hole 3). Every one of those closed a specific door.
// None of them could answer the question this file asks:
//
// > **Every function that writes a document's file is ACCOUNTABLE — it MEASURES
// > the write against what was read (a GATE), or SNAPSHOTS the bytes it is
// > about to overwrite (a forensic net), or states at the site why it needs
// > neither.**
//
// The gate was never the part that could misbehave. A WRITER that never asks
// is, and such a writer type-checks perfectly, throws nothing, and is invisible
// to every behavioural test of every gate. `writeTex` was exactly that: the one
// `.tex` writer in either backend with no gate AND no `snapshotPriorBundle`,
// carrying the single most destructive write Virgil makes (a style switch
// replaces the whole preamble) with no net of any kind underneath it. It had
// been that way since the FSA backend landed.
//
// ── Why the needle is the WRITE, not the filename ──────────────────────────
//
// The obvious census asks "which declarations mention `texFilename`?" — a hand
// list wearing a regex's clothes, and one that this repo's own history says
// will be missing a name (AGENTS.md, "The default half"). `writeTemplateFiles`
// writes a `.tex` and never spells the word. So the needle is the WRITE call
// itself, which between the two backends is every text write either makes — and
// the accountability question is then asked of ALL of them. The ones that write
// something other than the `.tex` answer with a marker that says so, which is a
// sentence someone had to write and a reviewer can read back.
//
// ── The needle is a FAMILY, renegotiated in place (task 415) ────────────────
//
// It used to be exactly `writeTextToHandle(` / `putText(` — the two raw
// primitives. Task 415 put a GATED FUNNEL in front of both
// (`writeTrackedText` / `putTrackedText`: skip a file whose bytes are already
// on disk, then write, then stamp the ledger), and every real writer moved
// behind it. Measured on that tree with the old needle, this census fell from
// eleven sites to TWO — the funnel's own — and its `.tex`-writer leg to ZERO.
// It would have gone on passing four of its five legs while speaking for almost
// nothing, which is the population-evaporation shape a census is least able to
// report about itself.
//
// So the needle is the FAMILY: the raw primitives AND the gated doors. That
// keeps the population identical to the pre-415 one (the same eleven writers,
// now spelled through a door), and it is why this file exports `writeSites()` —
// the byte-equality census in `per-file-write-gate.test.ts` asks a DIFFERENT
// question of the SAME extraction, so the two can never come to disagree about
// who the writers are.
//
// ── Scope, stated rather than implied ──────────────────────────────────────
//
// This censuses TEXT writes in the two storage backends. Deliberately out:
// binary writes (`writePdf`, `writeFigureRaster`, the snapshot machinery's own
// `copyFileIfPresent`) — build artifacts and the net itself; and everything
// outside these two files, which is not a document writer at all. A guard that
// overstates its reach is the failure mode this whole cluster is about.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codeOnlyLines } from "@/lib/__tests__/_source-scan";

const SRC = path.join(__dirname, "../..");
const BACKENDS = ["lib/storage-fsa.ts", "lib/storage-dev.ts"] as const;

/** The RAW text-write primitives — the two calls that actually touch a file. */
export const RAW_WRITE_CALL = /\b(?:writeTextToHandle|putText)\(/;
/** The GATED doors every real writer goes through since task 415. */
export const GATED_WRITE_CALL = /\b(?:writeTrackedText|putTrackedText)\(/;
/** Either. A CALL, never the helper's own signature. */
const WRITE_CALL = new RegExp(
  `${RAW_WRITE_CALL.source}|${GATED_WRITE_CALL.source}`,
);
const WRITE_DECLARATION =
  /\bfunction\s+(?:writeTextToHandle|putText|writeTrackedText|putTrackedText)\b/;

/** Either preservation gate: the load-writeback's, or the write side's. */
const GATE = /\b(?:checkTexPreservation|checkWriteAgainstRetained)\(/;
/** Either forensic net. */
const SNAPSHOT = /\b(?:snapshotPriorBundle|snapshotPriorBib)\(/;
/** The in-place excuse, which must be followed by a stated reason. */
const EXEMPT = /tex-write-exempt:\s*(\S.*)$/;
/** The task-415 byte-equality excuse — a DIFFERENT question, its own marker
 *  (task 204's rule: an exemption is scoped to the shape it justifies). */
const GATE_EXEMPT = /write-gate-exempt:\s*(\S.*)$/;

/**
 * The enclosing top-level declaration, the same shape `container-fit-guardrail`
 * uses: walk back to the line after the previous column-0 `}`. That deliberately
 * INCLUDES the doc comment above the declaration, which is where a marker
 * belongs — a reason that explains a function reads better above it than buried
 * in its body.
 */
function enclosingRegion(lines: string[], siteIdx: number): string[] {
  let start = siteIdx;
  while (start > 0 && !/^\}/.test(lines[start - 1])) start--;
  return lines.slice(start, siteIdx + 1);
}

/** Does this declaration resolve the document's OWN `.tex` file handle? Asked of
 *  the whole region rather than the write line, because `writeTex` resolves its
 *  handle three lines above the write and calls the local `fh` — which is
 *  precisely the writer this census exists for. */
const TEX_TARGET = /\b(?:getTexFileHandle\(|texFh\b|meta\.texFilename\b)/;

interface WriteSite {
  file: string;
  line: number;
  text: string;
  gated: boolean;
  snapshotted: boolean;
  writesTex: boolean;
  exemptReason: string | null;
  /** A raw primitive call (touches the file), vs. one through the 415 door. */
  raw: boolean;
  /** The 415 byte-equality excuse, read by `per-file-write-gate.test.ts`. */
  gateExemptReason: string | null;
}

/**
 * Every text write in the two backends, tagged with how it is accounted for.
 *
 * The source is read COMMENT-STRIPPED but LINE-ALIGNED for the needle, so prose
 * describing a write is not a write — and the RAW lines are what the marker is
 * read from, since a marker is by definition a comment.
 */
export function writeSites(): WriteSite[] {
  const sites: WriteSite[] = [];
  for (const rel of BACKENDS) {
    const raw = readFileSync(path.join(SRC, rel), "utf8");
    const rawLines = raw.split("\n");
    const codeLines = codeOnlyLines(raw).split("\n");
    codeLines.forEach((code, i) => {
      if (!WRITE_CALL.test(code)) return;
      if (WRITE_DECLARATION.test(code)) return;
      const region = enclosingRegion(rawLines, i);
      const codeRegion = enclosingRegion(codeLines, i);
      const marker = region.map((l) => l.match(EXEMPT)).find(Boolean);
      const gateMarker = region.map((l) => l.match(GATE_EXEMPT)).find(Boolean);
      sites.push({
        file: rel,
        line: i + 1,
        text: rawLines[i].trim(),
        gated: codeRegion.some((l) => GATE.test(l)),
        snapshotted: codeRegion.some((l) => SNAPSHOT.test(l)),
        writesTex: codeRegion.some((l) => TEX_TARGET.test(l)),
        exemptReason: marker ? marker[1].trim() : null,
        raw: RAW_WRITE_CALL.test(code),
        gateExemptReason: gateMarker ? gateMarker[1].trim() : null,
      });
    });
  }
  return sites;
}

describe("census · every backend write is gated, snapshotted, or excused", () => {
  it("finds the writes it is supposed to find", () => {
    // A census that matched nothing would pass every leg below. Both backends
    // must contribute, and the count must be in the range a hand read gives.
    const sites = writeSites();
    expect(sites.length).toBeGreaterThanOrEqual(10);
    for (const rel of BACKENDS) {
      expect(
        sites.filter((s) => s.file === rel).length,
        `no write sites found in ${rel} — the needle has gone stale`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("no write is unaccounted for", () => {
    const orphans = writeSites().filter(
      (s) => !s.gated && !s.snapshotted && s.exemptReason === null,
    );
    expect(
      orphans.map((s) => `${s.file}:${s.line}  ${s.text}`),
      "a write with no gate, no snapshot and no stated reason — add one, " +
        "or state why this write cannot lose a byte of anyone's document",
    ).toEqual([]);
  });

  it("every exemption states a REASON, not just a marker", () => {
    // The marker is not the point; the sentence is. A bare `tex-write-exempt:`
    // is an exemption nobody has to defend.
    const thin = writeSites()
      .filter((s) => s.exemptReason !== null)
      .filter((s) => (s.exemptReason ?? "").length < 24);
    expect(thin.map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });

  it("the FSA .tex writers are covered by a gate or a snapshot, never a marker", () => {
    // The stated reasons are all "this writes something that is not the .tex",
    // so a marker appearing on a genuine `.tex` writer would be a category
    // error — and is exactly how `writeTex` would be excused rather than fixed.
    const texWriters = writeSites().filter(
      (s) => s.file === "lib/storage-fsa.ts" && s.writesTex,
    );
    expect(texWriters.length).toBeGreaterThanOrEqual(3);
    for (const s of texWriters) {
      expect(
        s.gated || s.snapshotted,
        `${s.file}:${s.line} writes the .tex with no gate and no snapshot`,
      ).toBe(true);
      expect(s.exemptReason, `${s.file}:${s.line} excuses a .tex write`).toBeNull();
    }
  });

  it("the census can SEE an unaccounted write (canary)", () => {
    // Synthetic, not a live line: a canary standing on the defect evaporates
    // the moment the defect is drained (task 220's rule).
    const fixture = [
      "async function roguePersist(fh: FileSystemFileHandle, text: string) {",
      "  await writeTextToHandle(fh, text);",
      "}",
    ];
    const region = enclosingRegion(fixture, 1);
    expect(WRITE_CALL.test(fixture[1])).toBe(true);
    expect(region.some((l) => GATE.test(l) || SNAPSHOT.test(l))).toBe(false);
    expect(region.some((l) => EXEMPT.test(l))).toBe(false);
  });

  it("a comment describing a write is not a write", () => {
    const raw = "// this eventually calls writeTextToHandle(fh, latex)\nconst x = 1;\n";
    expect(WRITE_CALL.test(codeOnlyLines(raw).split("\n")[0])).toBe(false);
  });
});
