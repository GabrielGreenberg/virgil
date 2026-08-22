// Task 419 — ONE transfer-payload file door, deduping by CONTENT, scoped to
// the event.
//
// The reported bug: one Cmd-V of one screenshot into the bug-report window
// added TWO thumbnails. `handlePaste` read the payload through both of a
// `DataTransfer`'s views — `items[i].getAsFile()` and `files[i]` — and deduped
// them with `!files.includes(file)`, an `Array#includes` REFERENCE test across
// two lists the browser materializes INDEPENDENTLY. Identity is not a property
// the platform promises across those two views; the only stable answer is the
// payload's own content.
//
// Nothing about this is a type error, and NO fixture could see it: the
// pre-419 harness returned a stable `getAsFile` identity (so the guard would
// have worked even where it ran) and hard-coded `files: []` (so the second
// loop never ran at all). Both halves of the real-world defect were
// UNREPRESENTABLE in every one of the four suites that pasted.
//
// The census found the MIRROR of it one carrier over, which the task's own
// scope note had reported as absent: `LibraryView`'s file DROP reads
// `e.dataTransfer?.files` — ONE view — so on a payload shaped the way the
// bug-report window's own comment believes possible it ingests nothing,
// silently. So the door is stated over the PAYLOAD, not over the clipboard.
//
// Legs:
//   1. DOOR      — the two views, each alone and together, plus the ordering,
//                  the `accept` filter, and the null/absent-view guards.
//   2. PER-EVENT — two calls with equivalent payloads each yield their file;
//                  the `seen` Set never escapes the call. Deduping across the
//                  session would swallow a deliberate second paste, which is a
//                  WORSE bug than the one being fixed.
//   3. CENSUS    — the leg with teeth. The door was never the part that could
//                  misbehave; a SECOND extraction site that reads a raw
//                  transfer view is, and it type-checks perfectly. Allowlist
//                  EMPTY — a hit is ROUTE-it-through-the-door. Plus the
//                  positive twin per call site, so silence in the census reads
//                  as "it routes" and not "it stopped handling the gesture".
//   4. CANARY    — the census needle demonstrably fires, on a synthetic source
//                  and on both pre-419 spellings; plus a stripper swallow
//                  check.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./_source-scan";
import { filesFromTransfer, imagesFromClipboard } from "@/lib/transfer-files";

const REPO = path.resolve(__dirname, "../../..");
const SILOS = ["src", "library"] as const;
const DOOR = "src/lib/transfer-files.ts";

/** The bytes each fixture File was built from, so `twin` can mint a SECOND
 *  File with identical name/size/type/lastModified and distinct identity —
 *  which is exactly what a real payload's two views hand you. */
const bytesOf = new WeakMap<File, string>();

function mk(name: string, type: string, bytes: string, lastModified = 1000): File {
  const f = new File([bytes], name, { type, lastModified });
  bytesOf.set(f, bytes);
  return f;
}

function png(name: string, lastModified = 1000): File {
  return mk(name, "image/png", `bytes-${name}`, lastModified);
}

function twin(f: File): File {
  return mk(f.name, f.type, bytesOf.get(f) ?? "", f.lastModified);
}

function transfer(opts: { items?: File[]; files?: File[] }) {
  const dt: Record<string, unknown> = {};
  if (opts.items) {
    dt.items = opts.items.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file }));
  }
  if (opts.files) dt.files = opts.files;
  return dt as Parameters<typeof imagesFromClipboard>[0];
}

const names = (files: File[]) => files.map((f) => f.name);

// ---------------------------------------------------------------------------
// Leg 1 — the door
// ---------------------------------------------------------------------------

describe("imagesFromClipboard — the two views (leg 1)", () => {
  it("ONE image described by BOTH views yields ONE file — the defect", () => {
    const shot = png("image.png");
    const out = imagesFromClipboard(transfer({ items: [shot], files: [twin(shot)] }));
    expect(names(out)).toEqual(["image.png"]);
    // And it is the FIRST view's File that survives — order is `items` first.
    expect(out[0]).toBe(shot);
  });

  it("`items` only yields the image (control — today's passing path)", () => {
    expect(names(imagesFromClipboard(transfer({ items: [png("a.png")] })))).toEqual(["a.png"]);
  });

  it("`files` only yields the image — the Finder-Copy case the old second loop existed for", () => {
    expect(names(imagesFromClipboard(transfer({ files: [png("a.png")] })))).toEqual(["a.png"]);
  });

  it("two DIFFERENT images in both views yield two, in payload order", () => {
    const a = png("a.png");
    const b = png("b.png");
    const out = imagesFromClipboard(transfer({ items: [a, b], files: [twin(a), twin(b)] }));
    expect(names(out)).toEqual(["a.png", "b.png"]);
  });

  it("a `files` entry the first view did NOT describe is still taken", () => {
    const a = png("a.png");
    const b = png("b.png");
    const out = imagesFromClipboard(transfer({ items: [a], files: [twin(a), b] }));
    expect(names(out)).toEqual(["a.png", "b.png"]);
  });

  it("the same NAME at a different size or time is a different image", () => {
    // A clipboard image is typically "image.png" in both views, which is why
    // the key cannot be the name alone.
    const first = png("image.png", 1000);
    const later = png("image.png", 2000);
    expect(imagesFromClipboard(transfer({ items: [first], files: [later] }))).toHaveLength(2);
  });

  it("non-image payloads are ignored in BOTH views by the image reader", () => {
    const text = mk("notes.txt", "text/plain", "hi");
    expect(imagesFromClipboard(transfer({ items: [text], files: [text] }))).toEqual([]);
  });

  it("with NO `accept`, every file is taken — the library-ingest reading", () => {
    // A library drop takes PDF / DOCX / .tex / .bib alike, so the filter is
    // the CALLER's, not the door's.
    const pdf = mk("paper.pdf", "application/pdf", "%PDF");
    const tex = mk("main.tex", "", "\\documentclass{article}");
    const out = filesFromTransfer(transfer({ items: [pdf, tex], files: [twin(pdf), twin(tex)] }));
    expect(names(out)).toEqual(["paper.pdf", "main.tex"]);
  });

  it("`accept` is consulted BEFORE `getAsFile`, so a rejected item is never materialized", () => {
    let minted = 0;
    const dt = {
      items: [
        {
          kind: "file",
          type: "text/plain",
          getAsFile: () => {
            minted++;
            return new File(["hi"], "notes.txt", { type: "text/plain" });
          },
        },
      ],
    } as unknown as Parameters<typeof imagesFromClipboard>[0];
    expect(imagesFromClipboard(dt)).toEqual([]);
    expect(minted).toBe(0);
  });

  it("a `kind: string` item is not a file, whatever its type says", () => {
    // A drop carries `text/uri-list` / `text/plain` items beside the files.
    const dt = {
      items: [{ kind: "string", type: "image/png", getAsFile: () => png("nope.png") }],
    } as unknown as Parameters<typeof imagesFromClipboard>[0];
    expect(imagesFromClipboard(dt)).toEqual([]);
  });

  it("a text-only paste yields nothing (the fall-through contract)", () => {
    expect(imagesFromClipboard(transfer({ items: [], files: [] }))).toEqual([]);
  });

  it("an absent view, or no payload at all, is an ANSWER and not a throw", () => {
    // The reason the second loop exists at all is a belief that a paste path
    // can fill only one view; a door whose job is to read both must not throw
    // on the half that is missing.
    expect(names(imagesFromClipboard(transfer({ items: [png("a.png")] })))).toEqual(["a.png"]);
    expect(imagesFromClipboard(null)).toEqual([]);
    expect(imagesFromClipboard(undefined)).toEqual([]);
    expect(imagesFromClipboard({} as never)).toEqual([]);
  });

  it("an item that reports `kind: file` but hands back null is skipped", () => {
    const dt = {
      items: [{ kind: "file", type: "image/png", getAsFile: () => null }],
    } as unknown as Parameters<typeof imagesFromClipboard>[0];
    expect(imagesFromClipboard(dt)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Leg 2 — per-event scope
// ---------------------------------------------------------------------------

describe("imagesFromClipboard — per-event scope (leg 2)", () => {
  it("two SEPARATE calls with the same image each yield it", () => {
    const one = transfer({ items: [png("image.png")], files: [twin(png("image.png"))] });
    expect(imagesFromClipboard(one)).toHaveLength(1);
    expect(imagesFromClipboard(one)).toHaveLength(1);
  });

  it("the door holds no module state — the `seen` Set is created in the call", () => {
    const src = fs.readFileSync(path.join(REPO, DOOR), "utf8");
    const code = codeOnly(src);
    // Every `new Set` in this module must sit INSIDE the exported function,
    // never at module scope, or the session-wide dedupe returns.
    for (const line of code.split("\n")) {
      if (line.includes("new Set")) expect(line.startsWith("  ")).toBe(true);
    }
    expect(code).toContain("new Set");
  });
});

// ---------------------------------------------------------------------------
// Leg 3 — the census (the leg with teeth)
// ---------------------------------------------------------------------------

/**
 * Files permitted to read a raw clipboard/drag payload's FILE views outside
 * the door. EMPTY, and it stays empty: a second extraction site is exactly
 * how the identity-vs-content choice gets made a second time, and it is
 * invisible to every behavioural test of this door. A hit is ROUTE-it.
 */
const PERMITTED_RAW_CLIPBOARD_FILE_READERS: Record<string, string> = {};

/** `getAsFile(` — the `items` view. `clipboardData.files` / `dataTransfer.files`
 *  — the `files` view, on either carrier, since a drop hands you the identical
 *  two-view payload and would arrive with the same choice to get wrong. */
const RAW_VIEW =
  /\bgetAsFile\s*\(|\bclipboardData\s*(?:\?\.)?\s*\.?\s*files\b|\bdataTransfer\s*(?:\?\.)?\s*\.?\s*files\b/;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function censusFiles(): string[] {
  const files: string[] = [];
  for (const silo of SILOS) walk(path.join(REPO, silo), files);
  return files
    .map((f) => path.relative(REPO, f))
    .filter((rel) => rel !== DOOR)
    .sort();
}

describe("clipboard-image extraction — census (leg 3)", () => {
  const hits = censusFiles().filter((rel) =>
    RAW_VIEW.test(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))),
  );

  it("no production file outside the door reads a raw clipboard/drag FILE view", () => {
    const unlisted = hits.filter((rel) => !(rel in PERMITTED_RAW_CLIPBOARD_FILE_READERS));
    expect(unlisted, `ROUTE these through imagesFromClipboard: ${unlisted.join(", ")}`).toEqual([]);
  });

  it("the allowlist is empty and stays empty", () => {
    expect(Object.keys(PERMITTED_RAW_CLIPBOARD_FILE_READERS)).toEqual([]);
  });

  // The POSITIVE TWIN, per call site: silence in the census above must read
  // as "it routes", never as "it stopped handling the gesture". Neither
  // handler is mounted by any suite, so source is the only witness.
  it.each([
    ["src/components/BugReportWindow.tsx", "imagesFromClipboard(e.clipboardData)"],
    ["library/components/LibraryView.tsx", "filesFromTransfer(e.dataTransfer)"],
  ])("%s asks the door", (rel, call) => {
    expect(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))).toContain(call);
  });

  it("reading `getData` is NOT a file view — the needle stays precise", () => {
    // BibEntryCard reads `clipboardData.getData("text/html")` and touches no
    // files; a needle that indicted it would be a census nobody could keep.
    const src = codeOnly(
      fs.readFileSync(path.join(REPO, "src/components/BibEntryCard.tsx"), "utf8"),
    );
    expect(src).toContain("clipboardData.getData");
    expect(RAW_VIEW.test(src)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Leg 4 — canaries
// ---------------------------------------------------------------------------

describe("census canaries (leg 4)", () => {
  it("the needle fires on the PRE-419 spelling", () => {
    const preFix = `
      for (const item of Array.from(e.clipboardData.items)) {
        const file = item.getAsFile();
      }
      for (const file of Array.from(e.clipboardData.files)) {}
      for (const file of Array.from(ev.dataTransfer.files)) {}
    `;
    expect(RAW_VIEW.test(codeOnly(preFix))).toBe(true);
  });

  it("the stripper does not swallow the file it is handed", () => {
    const src = fs.readFileSync(path.join(REPO, DOOR), "utf8");
    const code = codeOnly(src);
    expect(code).toContain("export function filesFromTransfer");
    expect(code).toContain("export function imagesFromClipboard");
    // The module is comment-heavy by design; what must survive the stripper is
    // the CODE, so count declarations rather than bytes.
    expect(code.split("export ").length - 1).toBe(3);
  });

  it("a hit inside a COMMENT is not a hit", () => {
    expect(RAW_VIEW.test(codeOnly("// Finder Copy puts it on clipboardData.files instead."))).toBe(
      false,
    );
  });
});
