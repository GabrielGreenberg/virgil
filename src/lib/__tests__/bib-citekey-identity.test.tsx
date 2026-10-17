// @vitest-environment jsdom
//
// Task 1159 — citekey IDENTITY is case-insensitive in the bib mutators.
//
// BibTeX and biber compare citekeys case-insensitively, and the parser's own
// block pairing already folds case (`bib-parser.ts` `takeBlock`). The
// mutators did not, so three doors disagreed with the compiler:
//
//   1. ADD — `addEntriesToProjectBib` deduped with `new Set(keys)`, so a
//      library drop of `Smith2020` beside `smith2020` appended a block BibTeX
//      reports as a "Repeated entry".
//   2. RENAME — the head door's collision check was `e.key === key`, so a
//      rename onto a case-twin was accepted.
//   3. REMOVE — `removeEntryFromProjectBib` filtered `e.key !== citekey`,
//      deleting EVERY block under a duplicated key, bypassing the address
//      ladder task 690 built to tell duplicates apart.
//
// Each leg below fails on the pre-fix code; the census pins the shape.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnlyLines } from "./_source-scan";
import { flushPrefix } from "@/lib/write-queue";

let DISK = "";
const tick = () => new Promise((r) => setTimeout(r, 0));

vi.mock("@/lib/storage", async () => {
  const { enqueueWrite } = await import("@/lib/write-queue");
  return {
    readSidecar: vi.fn(async () => ({})),
    readSidecarIfExists: vi.fn(async () => null),
    writeSidecar: vi.fn(async () => undefined),
    readBib: vi.fn(async () => ({
      bibText: DISK,
      bibFilename: "references.bib",
      detectedPackage: "natbib",
    })),
    mutateBib: vi.fn(
      async (h: { docId: string }, mutate: (current: string) => string | null) =>
        enqueueWrite(`${h.docId}/bib/references.bib`, async () => {
          await tick();
          const next = mutate(DISK);
          if (next === null) return null;
          DISK = next;
          return next;
        }),
    ),
  };
});

import { addEntriesToProjectBib, removeEntryFromProjectBib } from "@/lib/project-bib";
import { bibAddressOf, citekeyEq } from "@/lib/bib-address";
import { validateBibEntryHead, validateBibEntryHeadChange } from "@/lib/bib-entry-head";
import { parseBibFile } from "@/lib/bib-parser";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";

const DOC = "doc-1159";
const block = (key: string, title = key.toUpperCase()) =>
  `@book{${key},\n  title = {${title}},\n}\n`;
const keysOnDisk = () => parseBibFile(DISK).map((e) => e.key);
const titlesOnDisk = () => parseBibFile(DISK).map((e) => e.fields.title);

beforeEach(() => {
  DISK = "";
  resetPipelines();
});
afterEach(async () => {
  await flushPrefix(DOC);
  await tick();
});

describe("citekeyEq — the one key-equality rule", () => {
  it("folds case, and only case", () => {
    expect(citekeyEq("Smith2020", "smith2020")).toBe(true);
    expect(citekeyEq("SMITH2020", "smith2020")).toBe(true);
    expect(citekeyEq("smith2020", "smith2020a")).toBe(false);
  });
});

describe("add · a case-twin is the SAME key", () => {
  it("dropping `Smith2020` onto a bib holding `smith2020` appends nothing", async () => {
    DISK = block("smith2020");
    beginDocPipeline(DOC);
    const out = await addEntriesToProjectBib(DOC, [
      { key: "Smith2020", type: "book", fields: { title: "X" }, raw: "" },
    ]);
    expect(out).toEqual({ appended: 0, result: { kind: "declined" } });
    expect(keysOnDisk()).toEqual(["smith2020"]);
  });

  it("dedupes case-twins WITHIN one drop too", async () => {
    DISK = block("a");
    beginDocPipeline(DOC);
    const out = await addEntriesToProjectBib(DOC, [
      { key: "Jones1999", type: "book", fields: { title: "J" }, raw: "" },
      { key: "jones1999", type: "book", fields: { title: "j" }, raw: "" },
    ]);
    expect(out.appended).toBe(1);
    expect(keysOnDisk()).toEqual(["a", "Jones1999"]);
  });
});

describe("rename · onto a case-twin is a collision", () => {
  const entries = parseBibFile(block("smith2020") + block("jones1999"));
  const self = bibAddressOf(entries, entries[1]);

  it("renaming `jones1999` to `Smith2020` is refused", () => {
    expect(validateBibEntryHead({ key: "Smith2020", type: "book" }, { entries, self }).ok).toBe(false);
  });

  it("a case-only rename of the entry ITSELF is not a collision", () => {
    expect(
      validateBibEntryHeadChange(
        { key: "jones1999", type: "book" },
        { key: "Jones1999", type: "book" },
        { entries, self },
      ).ok,
    ).toBe(true);
  });
});

describe("remove · takes exactly the addressed block", () => {
  it("removing one of two same-key blocks leaves the other", async () => {
    DISK = block("dup", "First") + block("dup", "Second") + block("b");
    beginDocPipeline(DOC);
    const parsed = parseBibFile(DISK);
    const second = bibAddressOf(parsed, parsed[1]);
    expect((await removeEntryFromProjectBib(DOC, second)).kind).toBe("written");
    expect(keysOnDisk()).toEqual(["dup", "b"]);
    expect(titlesOnDisk()).toEqual(["First", "B"]);
  });

  it("an address that names nothing is a decline, not a mass delete", async () => {
    DISK = block("a");
    beginDocPipeline(DOC);
    expect((await removeEntryFromProjectBib(DOC, { key: "zzz", keyOrdinal: 0 })).kind).toBe(
      "declined",
    );
    expect(keysOnDisk()).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// CENSUS — no raw citekey equality in the bib mutators.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../../..");
/** The mutator files whose key questions must go through `citekeyEq`. */
const MUTATOR_FILES = ["src/lib/project-bib.ts", "src/lib/bib-entry-head.ts"];
/** Raw key equality: `.key === x`, `x !== e.key`, or a Set built of raw keys. */
const RAW_KEY_EQ = /\.key\s*[!=]==|[!=]==\s*\w+\.key\b|new Set\(\w+\.map\(\(?\w+\)?\s*=>\s*\w+\.key\)\)/;
/** A line that compares a key EXACTLY on purpose says so with this marker in a
 *  comment on the same line — e.g. "did this entry's own key move?", where a
 *  case-only change IS a move. */
const EXEMPT = "citekey-exact";

function rawKeyHits(src: string): string[] {
  const raw = src.split("\n");
  return codeOnlyLines(src)
    .split("\n")
    .filter((l, i) => RAW_KEY_EQ.test(l) && !raw[i].includes(EXEMPT));
}

describe("CENSUS · bib mutators ask citekeyEq, never a raw `.key ===`", () => {
  for (const f of MUTATOR_FILES) {
    it(`${f} holds no raw citekey equality`, () => {
      expect(rawKeyHits(fs.readFileSync(path.join(REPO, f), "utf8"))).toEqual([]);
    });
  }

  it("the census can SEE a rogue comparison (canary)", () => {
    expect(rawKeyHits("const x = entries.filter((e) => e.key !== citekey);")).toHaveLength(1);
    expect(rawKeyHits("const s = new Set(existing.map((e) => e.key));")).toHaveLength(1);
    expect(rawKeyHits("if (citekeyEq(e.key, key)) return;")).toEqual([]);
    expect(rawKeyHits("if (key === current.key) return; // citekey-exact: self")).toEqual([]);
  });
});
