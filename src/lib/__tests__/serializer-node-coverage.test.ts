// @vitest-environment jsdom
//
// TASK 357 — the last write-side hole: the SERIALIZER's two silent drops.
//
// `serializeNode`'s `default:` arm emitted a node's CHILDREN and dropped its
// WRAPPER; for a childless node it emitted nothing at all. `serializeInline`'s
// trailing `return ""` did the same for any inline node its if-chain had not
// heard of — even the five it duplicated from `serializeNode` were a fork
// waiting to drift. Both produce well-formed LaTeX that is simply SHORTER than
// the user's document, which is invisible to every gate downstream: the write
// gate's step-aside rests on "after a real user edit the model IS the
// document", so the moment the user types, a wrapper-dropping serialize is
// measured against nothing at all.
//
// > **A serializer that cannot represent its input REFUSES. It never emits
// > LESS.**
//
// Three layers, mirroring the fix:
//   1. THE PREMISE (the leg with teeth) — every node type the REAL main-editor
//      schema declares has an ARM. The serializer is TipTap-free by
//      construction and cannot ask the schema, so without this check nothing in
//      the system is entitled to notice that a node extension shipped without a
//      serializer arm. That is the one genuinely reachable way to hit the
//      default arm, and this turns it from a silent drop into a build failure.
//   2. THE BEHAVIOUR — the refusal itself, and the two drops it retires,
//      driven through the real `serializeBodyOnly` / `serializeToLatex`.
//   3. THE CENSUS — the refusal must reach the user. Every bundle writer
//      catches it and publishes to the preservation channel; every read-only
//      projection of the `.tex` fails OPEN. The serializer was never the part
//      that could misbehave once it throws — a DOOR that lets the throw escape
//      into a fire-and-forget promise is, and that door type-checks perfectly.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The extension barrel transitively imports `@/lib/storage` (figure / graphics /
// tex-block NodeViews). Same stub the sibling schema suites use.
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

import type { JSONContent } from "@tiptap/react";
import { getSchema } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  serializeBodyOnly,
  serializeToLatex,
  UnserializableNodeError,
} from "@/lib/latex-serializer";
import { codeOnly, commentsStripped } from "@/lib/__tests__/_source-scan";

const REPO = join(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

/** Every node type the REAL main-editor schema declares. */
function schemaNodeTypes(): string[] {
  return Object.keys(getSchema(buildEditorExtensions(mainCtx()))).length
    ? Object.keys(getSchema(buildEditorExtensions(mainCtx())).nodes).sort()
    : [];
}

/** Run one node through the real block walk. Inline types are handed over as
 *  doc children on purpose: the serializer walks plain JSON and has no schema
 *  to object with, which is exactly the surface being probed. */
function serializeProbe(node: JSONContent): string {
  return serializeBodyOnly({ type: "doc", content: [node] });
}

// ── Layer 1 · the premise: every schema node type has an ARM ───────────────

describe("serializer coverage · the premise is checked against the schema", () => {
  it("every node type the main editor can hold has a serializer arm", () => {
    const refused: string[] = [];
    for (const type of schemaNodeTypes()) {
      if (type === "doc") continue; // the walk's own root
      try {
        serializeProbe({ type, attrs: {}, content: [] });
      } catch (err) {
        if (err instanceof UnserializableNodeError) refused.push(type);
        // Any OTHER throw is a node whose arm exists and disliked this minimal
        // fixture (a missing attr, say). That is not what this leg asks about:
        // the question is whether the type has an ANSWER, not whether a
        // hand-built stub satisfies it.
      }
    }
    expect(
      refused,
      "a node type the editor can hold but the serializer would refuse — " +
        "add its arm to `serializeNode`, or declare it consumed by its parent",
    ).toEqual([]);
  });

  it("…and the probe is not vacuous — an unknown type IS refused", () => {
    // A canary on a SYNTHETIC type, never on a production one: a canary that
    // stands on the defect evaporates the moment the defect is drained.
    expect(() => serializeProbe({ type: "quizWidget", content: [] })).toThrow(
      UnserializableNodeError,
    );
  });

  it("the schema really was built (the leg above can fail, not just pass)", () => {
    const types = schemaNodeTypes();
    expect(types.length).toBeGreaterThan(20);
    expect(types).toContain("exampleBlock");
    expect(types).toContain("figureCaption");
  });
});

// ── Layer 2 · the two drops, retired ──────────────────────────────────────

describe("the WRAPPER drop · a node the serializer cannot express is refused", () => {
  it("refuses rather than emitting the children and dropping the wrapper", () => {
    // The pre-357 arm returned "Alpha beta." — well-formed LaTeX, one whole
    // structural node lighter, and word-complete enough to sail past the words
    // measure once the user has typed.
    const model: JSONContent = {
      type: "sideNoteBlock",
      attrs: { uuid: "aaaa" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Alpha beta." }] },
      ],
    };
    expect(() => serializeProbe(model)).toThrow(UnserializableNodeError);
    try {
      serializeProbe(model);
    } catch (err) {
      expect((err as UnserializableNodeError).nodeType).toBe("sideNoteBlock");
    }
  });

  it("refuses a CHILDLESS unknown block, which used to vanish entirely", () => {
    expect(() =>
      serializeProbe({ type: "pageBreak", attrs: { uuid: "bbbb" } }),
    ).toThrow(UnserializableNodeError);
  });
});

describe("the INLINE drop · one dispatcher, so an inline arm cannot go missing", () => {
  const para = (content: JSONContent[]): JSONContent => ({
    type: "paragraph",
    attrs: { uuid: "p1" },
    content,
  });

  it("refuses an unknown INLINE node inside a paragraph", () => {
    // Pre-357 this returned "Before after." from `serializeInline`'s trailing
    // `return ""` — the atom gone, the sentence intact, nothing to notice.
    expect(() =>
      serializeProbe(
        para([
          { type: "text", text: "Before " },
          { type: "emojiAtom", attrs: { name: "smile" } },
          { type: "text", text: " after." },
        ]),
      ),
    ).toThrow(UnserializableNodeError);
  });

  it("still emits every inline type the sequence has always emitted", () => {
    // The five arms `serializeInline` duplicated now come from `serializeNode`.
    // Byte-for-byte the same output is the whole point of the delegation, so
    // this leg is a non-regression pin rather than a new claim.
    const out = serializeProbe(
      para([
        { type: "text", text: "See " },
        { type: "citation", attrs: { citationId: "c1", command: "\\citep{a}" } },
        { type: "text", text: " and " },
        { type: "inlineMath", attrs: { latex: "x^2" } },
        { type: "text", text: ", " },
        { type: "labelRef", attrs: { label: "sec:a", refCommand: "ref" } },
        { type: "hardBreak" },
        { type: "text", text: "next." },
      ]),
    );
    expect(out).toContain("\\citep{a}");
    expect(out).toContain("$x^2$");
    expect(out).toContain("\\ref{sec:a}");
    expect(out).toContain("\\\\");
    expect(out).toContain("next.");
  });

  it("a TEXT node reaching the block walk emits its bytes, it does not vanish", () => {
    // Malformed, but the answer to a structural anomaly is never "lose the
    // user's prose". Pre-357 this fell to the default arm and returned "".
    const out = serializeProbe({ type: "text", text: "stranded prose" });
    expect(out).toContain("stranded prose");
  });
});

describe("the FIGURE caption is declared, not defaulted", () => {
  it("a figure round-trips its caption through the figureBlock arm", () => {
    const out = serializeProbe({
      type: "figureBlock",
      attrs: { uuid: "f1", hasCaption: true, extras: "\\centering" },
      content: [
        {
          type: "figureCaption",
          content: [{ type: "text", text: "A caption." }],
        },
      ],
    });
    expect(out).toContain("\\begin{figure}");
    expect(out).toContain("A caption.");
  });

  it("…and a stray figureCaption at block level is silent, not refused", () => {
    // Declared as contextually consumed — the expex family's shape. If this
    // ever needs to emit, it must do so from a declared arm, not the default.
    expect(() =>
      serializeProbe({
        type: "figureCaption",
        content: [{ type: "text", text: "orphan" }],
      }),
    ).not.toThrow();
  });
});

describe("a real document is unaffected", () => {
  it("serializes a mixed document without refusing anything", () => {
    const out = serializeToLatex({
      type: "doc",
      content: [
        { type: "heading", attrs: { uuid: "h1", level: 2 }, content: [{ type: "text", text: "One" }] },
        {
          type: "paragraph",
          attrs: { uuid: "p1" },
          content: [
            { type: "text", text: "Alpha " },
            { type: "footnote", attrs: { footnoteId: "f1", content: null } },
            { type: "text", text: " omega." },
          ],
        },
        {
          type: "bulletList",
          attrs: { uuid: "l1" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "li1" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }],
            },
          ],
        },
      ],
    });
    expect(out).toContain("\\section{One}");
    expect(out).toContain("Alpha");
    expect(out).toContain("\\begin{itemize}");
  });
});

// ── Layer 3 · the census: the refusal reaches the user ────────────────────

/**
 * Does a `try { … } catch` BLOCK enclose `at`?
 *
 * The first cut asked `lastIndexOf("try {", at) > -1` and `indexOf("catch", at)
 * > at` over the WHOLE FILE, and the adversarial pass on this commit measured
 * what that buys: in `pipeline.ts` / `CodeEditor.tsx` / `useLatexSource.ts` the
 * needle has exactly one `try` above it, so the leg had teeth by accident; in
 * `EditorLayout.tsx` it had them only because no other `catch` follows; and in
 * `Editor.tsx` — five tries above, ten catches below — it had NONE. Deleting
 * the real try/catch around `serializeBodyOnly` there left the leg GREEN while
 * a refusal escaped a read-only projection. "Every one of these sites is a
 * small function" was a true sentence that the implementation never asked.
 *
 * So the containment is BRACE-BALANCED: from a candidate `try`'s own `{`, walk
 * to the depth-0 close, require a `catch` to follow it, and require `at` to sit
 * inside THAT span. The input is already comment- and literal-stripped
 * (`codeOnly`), so a brace in prose or in a string cannot skew the depth.
 */
function enclosingTryCovers(src: string, at: number): boolean {
  for (let i = src.lastIndexOf("try", at); i > -1; i = src.lastIndexOf("try", i - 1)) {
    const open = src.indexOf("{", i);
    if (open === -1 || open > at) continue;
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") {
        depth--;
        if (depth === 0) {
          // A `try` block contains nothing unless a `catch` actually follows.
          if (/^\s*catch\b/.test(src.slice(j + 1)) && at > open && at < j) {
            return true;
          }
          break;
        }
      }
    }
  }
  return false;
}


describe("census · every door accounts for the serializer's refusal", () => {
  const BACKENDS = ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"] as const;

  it("both backends catch the refusal at BOTH bundle-write sites", () => {
    // A throw escaping a bundle writer would be a THIRD inert refusal: nothing
    // awaits the load writeback, and `save()` catches, logs and leaves the doc
    // dirty — so the user watches an autosave that never lands, told nothing.
    for (const rel of BACKENDS) {
      const src = codeOnly(read(rel));
      const hits = src.match(/reportSerializeRefusal\(/g) ?? [];
      expect(
        hits.length,
        `${rel}: the load writeback AND writeDocBundle must each catch it`,
      ).toBe(2);
      // …and RETHROW anything else. Swallowing an unrelated failure here turns
      // a real bug into a silently skipped save — the defect's own shape.
      expect(src, `${rel} must rethrow a non-preservation error`).toMatch(
        /reportSerializeRefusal\([\s\S]{0,120}?throw err;/,
      );
    }
  });

  it("no bundle writer serializes OUTSIDE the guard", () => {
    // The needle is the bundle serialize call itself — a second one added
    // beside the guarded pair would be ungated and would type-check perfectly.
    for (const rel of BACKENDS) {
      const src = codeOnly(read(rel));
      const calls = src.match(/serializeToLatex\(content, serializeOpts\)/g) ?? [];
      const guards = src.match(/reportSerializeRefusal\(/g) ?? [];
      expect(
        calls.length,
        `${rel}: every bundle serialize must have a guard beside it`,
      ).toBe(guards.length);
    }
  });

  it("the refusal is published as its own SOURCE, with no 'save anyway'", () => {
    // The other three refusals have a version to save. This one does not — the
    // serializer produced no bytes — so offering acknowledgment would promise
    // what the commit cannot do, and refuse again one gesture later.
    const mod = read("src/lib/serialize-refusal.ts");
    expect(mod).toContain('source: "serialize"');
    expect(mod).toContain("recordPreservationRefusal(");
    // Comments stripped, string literals KEPT — the needle IS a literal.
    const badge = commentsStripped(read("src/components/PreservationNoticeBadge.tsx"));
    expect(badge).toContain('=== "serialize"');
    expect(badge).toMatch(/isSerialize \? null : \(/);
  });

  it("every read-only projection of the .tex fails OPEN", () => {
    // A refusal must never take a read-only surface down with it — least of all
    // the code view, which is what the banner tells the user to open.
    // The needle is the CALL, never the bare name — the import line matches a
    // bare name and sits inside no try, so a name needle indicts every site
    // for the wrong reason and would be repaired by loosening the guard.
    const projections: [string, string][] = [
      ["src/lib/doc-products/pipeline.ts", "getBlockLatex(doc.child(i))"],
      ["src/components/CodeEditor.tsx", "serializeToLatex(editor.getJSON()"],
      ["src/hooks/useLatexSource.ts", "serializeToLatex(editor.getJSON()"],
      ["src/components/EditorLayout.tsx", "serializeToLatex(latestDocEffective)"],
      ["src/components/Editor.tsx", "serializeBodyOnly({"],
    ];
    for (const [rel, needle] of projections) {
      const src = codeOnly(read(rel));
      const at = src.indexOf(needle);
      expect(at, `${rel}: ${needle} not found`).toBeGreaterThan(-1);
      expect(
        enclosingTryCovers(src, at),
        `${rel}: ${needle} is not inside a try/catch — a refusal here would ` +
          `take a read-only projection of the .tex down with it`,
      ).toBe(true);
    }
  });

  it("the code pane REFUSES a parse it could never write back", () => {
    // Narrowed by 357: an `UnserializableNodeError` IS evidence about the
    // parse — committing that model would put the live paper into a state no
    // write could ever leave. Any other throw keeps failing open.
    const src = codeOnly(read("src/lib/code-pane-bridge.ts"));
    expect(src).toContain("err instanceof UnserializableNodeError");
  });
});
