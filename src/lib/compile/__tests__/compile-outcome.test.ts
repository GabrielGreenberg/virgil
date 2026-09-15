// @vitest-environment node
/**
 * TASK 575 — ONE OUTCOME VOCABULARY.
 *
 * A compile result reaches the user twice: the PDF pane (the service's
 * `finishCompile` message) and the hook's system dialog. Each used to word the
 * result itself, and the two had already disagreed: a mirror DOWNLOAD failure
 * was told "unavailable offline" in the dialog, and a hang that followed
 * productive attempts was told "still downloading — press Compile again" on
 * both. The words now live in `compile-outcome.ts` and read recorded facts.
 *
 * The behavioural legs pin the words; the CENSUS pins that nobody else writes
 * them — the vocabulary was never the part that could misbehave, a second
 * speller is, and it type-checks perfectly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeCompileOutcome } from "@/lib/compile/compile-outcome";
import type { CompileResult } from "@/lib/compile/compile-types";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

const base: CompileResult = {
  status: "ok",
  log: "",
  ranPasses: 1,
  bibtexStatus: "absent",
};

describe("task 575 — degraded names download failures and offline misses separately", () => {
  it("a download failure alone never says offline", () => {
    const v = describeCompileOutcome({
      ...base,
      status: "degraded",
      downloadFailures: [
        { name: "tikz.sty", reason: "HTTP 503" },
        { name: "pgf.sty", reason: "HTTP 429" },
      ],
    })!;
    expect(v.message).toMatch(/2 packages could not be downloaded/);
    expect(v.message).not.toMatch(/offline/i);
    expect(v.tone).toBe("default");
  });

  it("an offline miss alone says offline and nothing about downloading", () => {
    const v = describeCompileOutcome({
      ...base,
      status: "degraded",
      offlineMisses: ["tikz.sty"],
    })!;
    expect(v.message).toMatch(/A package was unavailable offline/);
    expect(v.message).not.toMatch(/could not be downloaded/);
  });

  it("both are named, each in its own words", () => {
    const v = describeCompileOutcome({
      ...base,
      status: "degraded",
      downloadFailures: [{ name: "a.sty", reason: "x" }],
      offlineMisses: ["b.sty", "c.sty"],
    })!;
    expect(v.message).toMatch(/A package could not be downloaded and 2 were unavailable offline/);
  });

  it("counts DISTINCT packages, as the Errors panel lists them", () => {
    const v = describeCompileOutcome({
      ...base,
      status: "degraded",
      offlineMisses: ["tikz.sty", "tikz.sty", "tikz"],
    })!;
    expect(v.message).toMatch(/A package was unavailable offline/);
  });

  it("falls back to bibtex, then to a later pass", () => {
    expect(
      describeCompileOutcome({ ...base, status: "degraded", bibtexStatus: "failed" })!.message,
    ).toMatch(/bibliography/);
    expect(describeCompileOutcome({ ...base, status: "degraded" })!.message).toMatch(
      /later compile pass/,
    );
  });
});

describe("task 575 — a hang is never worded as progress", () => {
  it("a timeout whose LAST attempt fetched nothing never promises continuation, even with earlier fetches", () => {
    const v = describeCompileOutcome({
      ...base,
      status: "timeout",
      assetsFetched: 40,
      stop: "hang",
    })!;
    expect(v.title).toBe("Compile timed out");
    expect(v.message).not.toMatch(/still downloading|press compile again|carry on/i);
    expect(v.message).toMatch(/40 packages it downloaded are cached/);
  });

  it("a timeout with no recorded stop reason fails toward NOT promising progress", () => {
    const v = describeCompileOutcome({ ...base, status: "timeout", assetsFetched: 9 })!;
    expect(v.message).not.toMatch(/carry on|still downloading/i);
  });

  it("a productive stop does promise continuation", () => {
    const v = describeCompileOutcome({
      ...base,
      status: "timeout",
      assetsFetched: 12,
      stop: "productive-timeout",
    })!;
    expect(v.title).toBe("Still downloading LaTeX packages");
    expect(v.message).toMatch(/12 downloaded so far/);
    expect(v.message).toMatch(/Press Compile again to carry on/);
  });

  it("a hang with nothing fetched says it took too long", () => {
    const v = describeCompileOutcome({ ...base, status: "timeout", stop: "hang" })!;
    expect(v.message).toMatch(/took too long/);
  });
});

describe("task 575 — the remaining statuses", () => {
  it("ok says nothing", () => {
    expect(describeCompileOutcome(base)).toBeNull();
  });
  it("a failed compile with download failures names them", () => {
    const v = describeCompileOutcome({
      ...base,
      status: "failed",
      downloadFailures: [{ name: "a.sty", reason: "x" }],
    })!;
    expect(v.message).toMatch(/^A package could not be downloaded, and the compile failed/);
    expect(v.tone).toBe("danger");
  });
  it("boot-failed", () => {
    expect(describeCompileOutcome({ ...base, status: "boot-failed" })!.title).toMatch(
      /failed to start/,
    );
  });
});

describe("task 575 — CENSUS: one speller for the outcome words", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..");
  const read = (p: string) => commentsStripped(readFileSync(join(ROOT, p), "utf8"));
  const HOOK = read("src/hooks/useLatexCompile.ts");
  const SERVICE = read("src/lib/compile/compile-service.ts");

  // Sentences only the vocabulary may spell (string literals KEPT — the needles
  // ARE quoted text, the trap `_source-scan`'s header records).
  const SENTENCES = [
    /(was|were) unavailable offline/,
    /could not be downloaded/,
    /Still downloading/,
    /took too long/,
    /Compiled with warnings/,
    /failed to start/,
    /citations may show/,
  ];

  it("the hook spells no outcome sentence and no private wording function", () => {
    expect(HOOK).not.toMatch(/function failureMessage/);
    for (const re of SENTENCES) expect(HOOK, String(re)).not.toMatch(re);
    expect(HOOK).toMatch(/from "@\/lib\/compile\/compile-outcome"/);
    // Both dialog branches read the vocabulary.
    expect(HOOK.match(/describeCompileOutcome\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("the service's pane message comes from the same function", () => {
    expect(SERVICE).not.toMatch(/function outcomeMessage/);
    for (const re of SENTENCES) expect(SERVICE, String(re)).not.toMatch(re);
    expect(SERVICE).toMatch(/finishCompile\([\s\S]{0,200}describeCompileOutcome\(finished\)/);
  });

  it("no reader re-infers the stop reason from the assetsFetched total", () => {
    // The only `assetsFetched > 0` test outside the loop must be gated on the
    // recorded stop in the vocabulary itself.
    expect(HOOK).not.toMatch(/assetsFetched\s*>\s*0|assetsFetched\s*\?\?\s*0\)\s*>\s*0/);
    expect(SERVICE).not.toMatch(/result\.assetsFetched\s*\?\?\s*0\)\s*>\s*0/);
  });

  it("can see: the needles match the vocabulary module itself", () => {
    const VOCAB = read("src/lib/compile/compile-outcome.ts");
    for (const re of SENTENCES) expect(VOCAB, String(re)).toMatch(re);
  });
});
