import { describe, expect, it } from "vitest";
import { queueFilename, type QueueEntry } from "../queue";

// Pins the import-bib queue slot: it must get its OWN file so it can coexist
// with an in-flight index / bib-review on the shared `<citekey>.json` slot
// (mirrors bib-edit / paper-review / deepIndex).
describe("queueFilename — import-bib", () => {
  const base = { status: "requested", requestedAt: "2026-01-01T00:00:00Z", attempts: 0 } as const;

  it("routes an import-bib entry to <citekey>-importbib.json", () => {
    const entry: QueueEntry = { kind: "import-bib", citekey: "smith2020", ...base };
    expect(queueFilename(entry)).toBe("smith2020-importbib.json");
  });

  it("keeps a slot distinct from the shared index/authenticate <citekey>.json", () => {
    const imp: QueueEntry = { kind: "import-bib", citekey: "x", ...base };
    const idx: QueueEntry = { kind: "index", citekey: "x", ...base };
    expect(queueFilename(idx)).toBe("x.json");
    expect(queueFilename(imp)).not.toBe(queueFilename(idx));
  });
});
