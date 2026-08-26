// @vitest-environment jsdom
/**
 * TASK 393 — the card-body capture DOOR, and the census that keeps it the door.
 *
 * The door was never the part that could misbehave. A CAPTURE SITE that asks
 * the schema about one payload and stores another is — and that call site type
 * checks perfectly, which is exactly what shipped: `canMountInCardBody(rawSlice)`
 * beside `createArchiveSnippet(rawSlice)` with the write's own normalizer
 * silently changing the payload in between.
 *
 * So: the contract legs pin what `prepareCardBodyCapture` guarantees, and the
 * CENSUS pins that nothing in production re-derives it.
 */
import { describe, it, expect, vi } from "vitest";

// `borrowed-schema` composes the real extension barrel, which reaches
// `@/lib/storage` — whose backend `require` cannot resolve under vitest. The
// schema builders themselves touch none of it.
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});
import fs from "node:fs";
import path from "node:path";
import { Slice, Fragment } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import {
  prepareCardBodyCapture,
  describeCardBodyRefusal,
  type CardBodyCapture,
} from "@/lib/tiptap/card-body-capture";
import {
  canMountInCardBody,
  cardBodySchemaFor,
} from "@/lib/tiptap/borrowed-schema";
import { unsupportedConstructs } from "@/lib/tiptap/schema-mount";
import { normalizeRichContent } from "@/lib/footnote-content";
import { codeOnly } from "@/lib/__tests__/_source-scan";

const REPO = path.resolve(__dirname, "../../../..");
const SILOS = ["src", "library"];

function refusalOf(c: CardBodyCapture): Extract<CardBodyCapture, { ok: false }> {
  if (c.ok) throw new Error("expected a refusal");
  return c;
}

const ANCHORED_DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Anchored prose.",
          marks: [
            {
              type: "linkedAnchor",
              attrs: { anchorId: "b50e", kind: "note", linkId: "b50e", linkCard: "note:n1" },
            },
          ],
        },
      ],
    },
  ],
};

describe("task 393 — prepareCardBodyCapture (the one door)", () => {
  it("normalizes BEFORE it validates: an anchored capture is accepted", () => {
    // The pre-393 order — validate the raw payload — refuses this, because the
    // excerpt schema deliberately has no `linkedAnchor` (the normalizer strips
    // it). The control below is what makes that a claim rather than a hope.
    expect(canMountInCardBody(ANCHORED_DOC, "excerpt").ok).toBe(false);
    const prepared = prepareCardBodyCapture(ANCHORED_DOC, "excerpt");
    expect(prepared.ok).toBe(true);
  });

  it("hands back the object it validated, and the write's normalize is a no-op on it", () => {
    const prepared = prepareCardBodyCapture(ANCHORED_DOC, "excerpt");
    if (!prepared.ok) throw new Error("expected ok");
    // What the caller stores IS what was judged — the guarantee the door exists
    // for. A second derivation from the source is what task 393 was.
    expect(canMountInCardBody(prepared.content, "excerpt").ok).toBe(true);
    expect(normalizeRichContent(prepared.content)).toEqual(prepared.content);
    expect(JSON.stringify(prepared.content)).not.toContain("linkedAnchor");
    // …and it did not mutate the source.
    expect(JSON.stringify(ANCHORED_DOC)).toContain("linkedAnchor");
  });

  it("takes a live Slice — the capture shape — as well as JSON", () => {
    const schema = cardBodySchemaFor("excerpt");
    const para = schema.nodes.paragraph.create(null, schema.text("Sliced."));
    // openStart/openEnd 1 ⇒ the fragment's children are INLINE, the shape that
    // used to throw `contentMatchAt on a node with invalid content`.
    const inline = new Slice(Fragment.from(schema.text("Sliced.")), 0, 0);
    const blocks = new Slice(Fragment.from(para), 0, 0);
    for (const slice of [inline, blocks]) {
      const prepared = prepareCardBodyCapture(slice, "excerpt");
      if (!prepared.ok) throw new Error("expected ok");
      expect(prepared.content.type).toBe("doc");
      // Bare inline is wrapped so the result is `block+`-valid in every case.
      expect(prepared.content.content?.[0]?.type).toBe("paragraph");
      expect(JSON.stringify(prepared.content)).toContain("Sliced.");
    }
  });

  it("still REFUSES a genuine vocabulary gap — the 308 invariant is untouched", () => {
    const gap: JSONContent = {
      type: "doc",
      content: [{ type: "futureBlock", content: [{ type: "text", text: "x" }] }],
    };
    const refusal = refusalOf(prepareCardBodyCapture(gap, "excerpt"));
    expect(refusal.reason).toBeTruthy();
    expect(refusal.constructs).toContain("futureBlock");
  });

  it("a refusal NAMES the construct — derived from the schema, not parsed", () => {
    const one = refusalOf(
      prepareCardBodyCapture(
        { type: "doc", content: [{ type: "futureBlock" }] },
        "excerpt",
      ),
    );
    expect(describeCardBodyRefusal(one)).toContain("futureBlock");

    const many = refusalOf(
      prepareCardBodyCapture(
        {
          type: "doc",
          content: [
            { type: "futureBlock" },
            { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "futureMark" }] }] },
          ],
        },
        "excerpt",
      ),
    );
    const phrase = describeCardBodyRefusal(many);
    expect(phrase).toContain("futureBlock");
    expect(phrase).toContain("futureMark");
    expect(phrase).toContain(" and ");
  });

  it("falls back to the probe's own reason when there is no name to give", () => {
    // A mount can fail on a MALFORMED model whose every type name is known — a
    // text node with no `text`, a non-array `content`. Naming nothing there and
    // claiming the constructs list is complete would be worse than the raw
    // message, so the phrase degrades to it.
    const malformed = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text" }] }],
    } as unknown as JSONContent;
    const refusal = refusalOf(prepareCardBodyCapture(malformed, "excerpt"));
    expect(refusal.constructs).toEqual([]);
    expect(describeCardBodyRefusal(refusal)).toContain(refusal.reason);
  });

  it("`unsupportedConstructs` names each gap ONCE, in first-seen order", () => {
    const schema = cardBodySchemaFor("excerpt");
    const doc = {
      type: "doc",
      content: [
        { type: "zzz" },
        { type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "aaa" }] }] },
        { type: "zzz" },
      ],
    };
    expect(unsupportedConstructs(schema, doc)).toEqual(["zzz", "aaa"]);
    // Known vocabulary names nothing — so an empty list is evidence, not silence.
    expect(unsupportedConstructs(schema, normalizeRichContent(ANCHORED_DOC))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE CENSUS — the leg with teeth
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
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

function productionFiles(): string[] {
  const files: string[] = [];
  for (const silo of SILOS) {
    const root = path.join(REPO, silo);
    if (fs.existsSync(root)) walk(root, files);
  }
  return files.map((f) => path.relative(REPO, f)).sort();
}

/** The two modules entitled to spell the probe: the one that DEFINES it, and
 *  the one door every capture enters. Anything else is a second table. */
const PROBE_OWNERS = new Set([
  "src/lib/tiptap/borrowed-schema.ts",
  "src/lib/tiptap/card-body-capture.ts",
]);

describe("task 393 — census: one door, and nothing re-derives it", () => {
  const files = productionFiles();

  it("the census can see the tree it is scanning", () => {
    expect(files).toContain("src/lib/tiptap/card-body-capture.ts");
    expect(files).toContain("src/components/editor-layout/card-actions/drag-handle-actions.ts");
    expect(files.length).toBeGreaterThan(300);
  });

  it("no production file CALLS `canMountInCardBody` outside the door", () => {
    // The allowlist is EMPTY by construction — a hit is MIGRATE-it, never an
    // entry. `canMountInCardBody` answers the SCHEMA question ("can this scope
    // hold this model?"); a CAPTURE has to ask about the payload it will store,
    // which is what the door derives. Comments are stripped and string literals
    // kept: a doc comment naming the function is not a caller, a call is.
    const hits = files
      .filter((rel) => !PROBE_OWNERS.has(rel))
      .filter((rel) =>
        /\bcanMountInCardBody\s*\(/.test(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))),
      );
    expect(hits).toEqual([]);
  });

  it("…and the needle is real: the door itself is a hit under the same regex", () => {
    // A canary that does NOT stand on the drained defect — the door legitimately
    // calls the probe, so if the regex ever stops matching, this fails first.
    const src = codeOnly(
      fs.readFileSync(path.join(REPO, "src/lib/tiptap/card-body-capture.ts"), "utf8"),
    );
    expect(/\bcanMountInCardBody\s*\(/.test(src)).toBe(true);
  });

  it("the door normalizes — the one line the whole task is", () => {
    const src = codeOnly(
      fs.readFileSync(path.join(REPO, "src/lib/tiptap/card-body-capture.ts"), "utf8"),
    );
    expect(/\bnormalizeRichContent\s*\(/.test(src)).toBe(true);
  });

  it("every capture site enters the door, and stores what the door returned", () => {
    // Discovered, not hand-listed: any production file that mints an archive
    // snippet is a capture site. Today that is the drag-handle dispatcher; the
    // next one inherits the rule by being found here.
    const captureSites = files.filter((rel) =>
      /createArchiveSnippet\s*\(\s*\{/.test(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))),
    );
    expect(captureSites.length).toBeGreaterThan(0);
    for (const rel of captureSites) {
      const src = codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"));
      expect(src, `${rel} must derive its payload through prepareCardBodyCapture`).toMatch(
        /\bprepareCardBodyCapture\s*\(/,
      );
    }
  });

  it("…and every capture site RE-HOMES the anchors it displaces (task 491)", () => {
    // Same DISCOVERED population, one more obligation. A capture SETS TEXT
    // ASIDE, so every Mode-A paragraph anchor it consumes moves to the
    // surviving neighbour rather than orphaning — Gabriel: "they should just
    // stack up on the preceeding paragraph."
    //
    // The door was never the part that could misbehave; a capture site that
    // deletes an anchored block and never asks is, and it type-checks
    // perfectly. Allowlist EMPTY — a hit is WIRE-it.
    const captureSites = files.filter((rel) =>
      /createArchiveSnippet\s*\(\s*\{/.test(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))),
    );
    expect(captureSites.length).toBeGreaterThan(0);
    for (const rel of captureSites) {
      const src = codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"));
      expect(src, `${rel} must resolve the surviving neighbour`).toMatch(
        /\bresolveDisplacedAnchorTarget\s*\(/,
      );
      expect(src, `${rel} must retarget the displaced anchors`).toMatch(
        /\banchorRetarget\.retarget\s*\(/,
      );
      // ONE neighbour per gesture: the fresh snippet and the cards it displaced
      // must not be resolved twice, or they land on different paragraphs and
      // "stack up" is false.
      const resolves = src.match(/\bresolveDisplacedAnchorTarget\s*\(/g) ?? [];
      expect(resolves.length, `${rel} resolves the neighbour more than once`).toBe(1);
    }
  });

  it("nothing outside the retarget module re-derives the sweep (task 491)", () => {
    // `retargetDisplacedAnchors` is reached through the pane's stable
    // `AnchorRetargetApi`; a second caller would hold a live handler bundle and
    // decide for itself which cards move.
    const hits = files
      .filter((rel) => rel !== "src/cards/retarget-anchors.ts")
      .filter((rel) =>
        /\bretargetDisplacedAnchors\s*\(/.test(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))),
      );
    expect(hits).toEqual([]);
  });
});
