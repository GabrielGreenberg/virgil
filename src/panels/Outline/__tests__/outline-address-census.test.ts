/**
 * Task 285 — the census with teeth.
 *
 * The resolver was never the part that can misbehave: it is a pure function of
 * an address and a doc, and its own suite pins it. What can misbehave is a
 * PRODUCER that stops carrying the uuid — `podAddress` returning `uuid: null`,
 * a row handler building `{ uuid: null, index }` because the uuid wasn't handy,
 * a future affordance addressing a block by index because that is what it had.
 * Every one of those typechecks perfectly and silently reinstates the defect:
 * an address with a null uuid is exactly the pre-285 integer, wearing the new
 * type.
 *
 * So: inside the Outline panel, `uuid: null` may be written only where the
 * thing being addressed genuinely has no identity — the Document-start row,
 * which means "whatever block is first" and is positional by design.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

const OUTLINE_DIR = join(process.cwd(), "src/panels/Outline");

/** Producers of block addresses. */
const PRODUCER_FILES = ["OutlinePanel.tsx", "focus-band-drag.ts"];

/**
 * The ONE sanctioned uuid-less address, keyed by a fragment of the LINE rather
 * than by file: a file-scoped exemption would also excuse the next producer
 * added to the same file, which is the drift this census exists to catch.
 */
const PERMITTED_UUIDLESS_ADDRESSES = [
  // The Document-start row and its measurement twin. "The first block" is a
  // positional fact that survives an insert above by definition, so there is
  // no identity to carry — see the comments at both sites.
  'const docStart = { uuid: null, index: 0 }',
  'attrs.push({ attr: "docstart", blockIndex: 0, uuid: null })',
];

/** The needle, read by BOTH the census and its canary — a canary defending a
 *  COPY of the rule proves only that the stripper works. */
const UUIDLESS = /uuid:\s*null/;

function sourceLines(file: string): string[] {
  return commentsStripped(readFileSync(join(OUTLINE_DIR, file), "utf8")).split("\n");
}

/**
 * Report a hit by its REAL line in the file.
 *
 * The shared `strip()` DELETES a block comment including its newlines rather
 * than blanking them, so an index into the stripped text is short by every
 * newline inside every `/* … *\/` above it — dozens, in a file whose first doc
 * comment starts at line 27. Detection is unaffected; the diagnostic would send
 * the reader to the wrong function, which is the drift the CSS half of the
 * stripper already had fixed. So locate the offending text in the ORIGINAL.
 */
function realLineOf(file: string, strippedLine: string): number | null {
  const needle = strippedLine.trim();
  if (!needle) return null;
  const original = readFileSync(join(OUTLINE_DIR, file), "utf8").split("\n");
  const i = original.findIndex((l) => l.includes(needle));
  return i === -1 ? null : i + 1;
}

describe("Outline address census — every producer carries the durable uuid", () => {
  it("writes `uuid: null` only where the address is positional by design", () => {
    const offenders: string[] = [];
    for (const file of PRODUCER_FILES) {
      for (const line of sourceLines(file)) {
        if (!UUIDLESS.test(line)) continue;
        if (PERMITTED_UUIDLESS_ADDRESSES.some((ok) => line.includes(ok))) continue;
        offenders.push(`${file}:${realLineOf(file, line) ?? "?"}  ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every permitted exemption still matches a real line (no stale entries)", () => {
    const all = PRODUCER_FILES.flatMap(sourceLines);
    for (const ok of PERMITTED_UUIDLESS_ADDRESSES) {
      expect(all.some((line) => line.includes(ok))).toBe(true);
    }
  });

  it("CANARY: the census can see a uuid-less address (the stripper isn't swallowing code)", () => {
    // A synthetic fixture rather than a live line — a canary standing on the
    // very lines the allowlist drains would evaporate the moment they change.
    const fixture = commentsStripped(
      ['// uuid: null in a comment must NOT count', 'return { uuid: null, index: pod.blockIndex };'].join("\n"),
    ).split("\n");
    const hits = fixture.filter((l) => UUIDLESS.test(l));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("pod.blockIndex");
  });

  it("the pod address reads the pod's own uuid", () => {
    const src = commentsStripped(readFileSync(join(OUTLINE_DIR, "OutlinePanel.tsx"), "utf8"));
    // Bounded to the function's own body: an unbounded `[\s\S]*?` would happily
    // match a `uuid: pod.uuid` anywhere later in a 2000-line file.
    const body = src.match(/function podAddress\(pod: OutlinePod\): BlockSpanAddress \{([^}]*)\}/);
    expect(body).not.toBeNull();
    expect(body![1]).toContain("uuid: pod.uuid");
  });

  it("the drop hands over addresses, never the pod's snapshot integers", () => {
    const src = commentsStripped(readFileSync(join(OUTLINE_DIR, "OutlinePanel.tsx"), "utf8"));
    expect(src).toContain("onReorderBlocks(podAddress(sourcePod), podAddress(targetPod), dropTarget.position)");
    // The pre-285 call form must not come back.
    expect(src).not.toMatch(/onReorderBlocks\(\s*sourcePod\.blockIndex/);
  });
});
