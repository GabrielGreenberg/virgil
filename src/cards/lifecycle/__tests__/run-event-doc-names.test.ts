/**
 * `run-event.ts` names its obligations, never numbers them (task 1541).
 *
 * The executor's header states one event × obligation table and the rule that
 * every comment refers to an obligation by its NAME — "deliberately no numbers
 * and no count, which is what drifted". Task 1363 rewrote the header and the
 * step comments by hand and still left five JSDoc lines citing the old
 * numbering ("obligation 2" = SETTLE, now the table's 3rd row). This pin makes
 * the header's rule hold by construction: a numbered reference anywhere in the
 * file fails here, and every name a comment may use is a row of the table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const SOURCE = readFileSync(join(__dirname, "..", "run-event.ts"), "utf8");

describe("run-event.ts obligation vocabulary", () => {
  it("cites no obligation by number", () => {
    const hits = SOURCE.split("\n")
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter(({ text }) => /\bobligations?\s+#?\d/i.test(text));
    expect(hits, "use the obligation's NAME (GATE / CONFIRM / SETTLE / …), not a number").toEqual([]);
  });

  it("states the event × obligation table the names come from", () => {
    const rows = [...SOURCE.matchAll(/^ \*   ([A-Z]+)\s+\|/gm)].map((m) => m[1]);
    expect(rows).toEqual(["GATE", "CONFIRM", "SETTLE", "UNBRIDGE", "MUTATE", "SIGNAL", "FINALIZE"]);
  });
});
