/**
 * CI teeth for the bib-coherence pre-flight contract (task 322).
 *
 * `library/scripts/tests/` is pytest-shaped and nothing in CI runs Python —
 * `npm test` is vitest-only — so every Python guard is advisory unless
 * something shells out to it. This does, exactly as its three siblings do
 * (`bib-auth-cli-python`, `references-bib-upsert-python`,
 * `warning-recompute-merge-python`).
 *
 * What it protects: `validate_bib_coherence.py` became a DISPATCHED pipeline
 * step (`/library/authenticate-bib` step 2, advisory) after months as a
 * documented-but-uncalled helper, which promoted three latent bugs from
 * manual-tool quirks to pipeline behaviour — a quoted `journal = "…"` on a
 * `@phdthesis` reported COHERENT (the script's own headline case, missed by a
 * hand-rolled regex), a hardcoded `<citekey>.pdf` that turned "no PDF" into a
 * *finding* on every bib-only / DOCX / TEX entry, and a `--json` exit code
 * that could not tell a typo'd citekey from an incoherent entry. Eight of the
 * suite's thirteen legs fail on the pre-fix script.
 *
 * If `python3` is genuinely unavailable the test FAILS rather than skips — a
 * guard that quietly opts out of the environment it protects is worthless.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SUITE = path.join(
  REPO_ROOT,
  "library/scripts/tests/test_validate_bib_coherence.py",
);

describe("bib-coherence pre-flight (Python)", () => {
  it("passes library/scripts/tests/test_validate_bib_coherence.py", { timeout: 60_000 }, () => {
    let output: string;
    try {
      // `--standalone` forces the suite's built-in runner: this assertion reads
      // the "<n>/<n> passed" tally it prints, which pytest (if installed on the
      // machine) would replace with its own format — failing this guard for a
      // reason that has nothing to do with what it guards.
      output = execFileSync("python3", [SUITE, "--standalone"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(
        `Python bib-coherence suite failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
      );
    }
    const m = output.match(/(\d+)\/(\d+) passed/);
    expect(m, `no pass tally in output:\n${output}`).not.toBeNull();
    const [, passed, total] = m!;
    expect(Number(total)).toBeGreaterThan(0);
    expect(passed).toBe(total);
  });
});
