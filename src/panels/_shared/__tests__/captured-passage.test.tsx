// @vitest-environment jsdom
//
// TASK 488 — a captured passage is rendered by ONE door.
//
// Gabriel, from a real paper: *"when you make an AI request for revision, the
// original is rendered as plain text without formatting — should be more like
// an archive card."* The mechanism had two layers and this suite pins both:
//
//  1. CAPTURE. A Mode-B anchor stored ONLY `doc.textBetween(from, to, " ")`,
//     which drops every mark AND every inline ATOM — a `$x$` or a `\cite{k}`
//     inside the selection contributes NOTHING to that string. So no
//     render-time parse could recover them: the formatting was gone before any
//     surface saw it. `createLinkedAnchor` now also takes the real slice.
//  2. RENDER. The four surfaces that show a captured passage answered the
//     question three different ways (a `whitespace-pre-wrap` raw string, two
//     hand-spelled `richLatexToJson` → `BorrowedMainText` copies, and a raw
//     one-liner). They read one door now.
//
// NO PRE-488 SUITE COULD SEE ANY OF THIS: `RevisionRequestCard-excerpt` asserts
// the excerpt string is PRESENT (which the flat block satisfied perfectly), and
// every pending-change suite `vi.mock`s the rendering surface away. What was
// never asked is whether the passage arrives with its marks and atoms at all.
import { describe, it, expect, afterEach, vi } from "vitest";

// The borrowed schema transitively pulls `@/lib/storage` (the known barrel/
// storage gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "mutateSidecar", "readTex", "writeTex", "readDocBundle", "writeDocBundle",
    "readBib", "writeBib", "createDocFromPicker", "createDocInFolder",
    "pickProjectFolder", "registerDocInFolder", "openExistingDocFromPicker",
    "listDocs", "renameDoc", "deleteDocFromIndex", "flushDoc", "drainDoc",
    "detectBibPackage", "readPaperFolder", "getTexFilename", "writePdf",
    "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster",
    "readFigureIndex", "writeFigureIndex", "getDocWriteHandle",
    "importFigureFile", "deleteSidecarSiblings",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

import { render, cleanup } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Italic from "@tiptap/extension-italic";
import { LinkedAnchor } from "@/lib/tiptap/linked-anchor";

import {
  CapturedPassage,
  capturedPassageJson,
  capturedPassageOneLine,
} from "@/panels/_shared/captured-passage";
import { createLinkedAnchor } from "@/links/links";
import { codeOnly, trackedFiles } from "@/lib/__tests__/_source-scan";
import fs from "node:fs";
import path from "node:path";

afterEach(cleanup);

// ───────────────────────────────────────────────────────────────────────────
// 1. THE CAPTURE — the half no render-time parse can substitute for
// ───────────────────────────────────────────────────────────────────────────

/** A minimal editor carrying an inline ATOM beside marked text. The atom is
 *  what makes the leg falsifiable: `textBetween` drops it entirely, so a
 *  string-only capture cannot represent this selection at all. */
function makeEditor() {
  const Atom = Paragraph.extend({
    name: "citation",
    group: "inline",
    inline: true,
    atom: true,
    content: "",
    addAttributes: () => ({ command: { default: "\\cite{k}" } }),
    parseHTML: () => [{ tag: "span[data-type=citation]" }],
    renderHTML: () => ["span", { "data-type": "citation" }],
  });
  return new Editor({
    extensions: [Document, Paragraph, Text, Italic, Atom, LinkedAnchor],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain " },
            { type: "text", marks: [{ type: "italic" }], text: "stressed" },
            { type: "text", text: " " },
            { type: "citation", attrs: { command: "\\cite{k}" } },
            { type: "text", text: " tail" },
          ],
        },
      ],
    },
  });
}

describe("the capture keeps what `textBetween` throws away", () => {
  it("records the rich slice beside the plain string", () => {
    const ed = makeEditor();
    const end = ed.state.doc.content.size - 1;
    const record = createLinkedAnchor(ed, "revision", { from: 1, to: end });
    expect(record).toBeTruthy();

    // The DEFECT, stated as the reason the rich twin has to exist: the plain
    // capture keeps neither the emphasis nor the atom.
    expect(record!.text).toBe("plain stressed  tail");
    expect(record!.text).not.toContain("cite");

    // The rich twin keeps both.
    const inline = (record!.content as { content: { content: unknown[] }[] })
      .content[0].content as { type: string; marks?: { type: string }[] }[];
    expect(inline.some((n) => n.marks?.some((m) => m.type === "italic"))).toBe(true);
    expect(inline.some((n) => n.type === "citation")).toBe(true);
    ed.destroy();
  });

  it("captures cleanly when the span already carries another card's anchor", () => {
    // `normalizeRichContent` inside the leaf strips `linkedAnchor` (a
    // DOC_ONLY_MARK the card schemas deliberately do not register), so a second
    // anchor over the same words still yields a mountable body.
    const ed = makeEditor();
    const end = ed.state.doc.content.size - 1;
    createLinkedAnchor(ed, "note", { from: 1, to: end });
    const second = createLinkedAnchor(ed, "revision", { from: 1, to: end });
    const json = JSON.stringify(second!.content);
    expect(json).not.toContain("linkedAnchor");
    ed.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. THE LADDER — rich capture first, bytes second
// ───────────────────────────────────────────────────────────────────────────

describe("the door's resolution ladder", () => {
  const rich = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "from the capture" }] },
    ],
  };

  it("prefers the rich capture over the bytes", () => {
    const json = capturedPassageJson({ latex: "from the bytes", content: rich });
    expect(JSON.stringify(json)).toContain("from the capture");
    expect(JSON.stringify(json)).not.toContain("from the bytes");
  });

  it("parses the bytes when there is no capture (every pre-488 card, and every skill-authored original)", () => {
    const json = capturedPassageJson({ latex: "an \\emph{emphasised} word" });
    const s = JSON.stringify(json);
    expect(s).toContain("italic");
    expect(s).toContain("emphasised");
    // The command itself is consumed, not shown as source — the reported defect.
    expect(s).not.toContain("\\\\emph");
  });

  it("the one-line cue reads the SAME resolution", () => {
    expect(capturedPassageOneLine({ latex: "x", content: rich })).toBe(
      "from the capture",
    );
    expect(capturedPassageOneLine({ latex: "an  \\emph{emphasised}\n word" })).toBe(
      "an emphasised word",
    );
    expect(capturedPassageOneLine({ latex: "" })).toBe("");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. THE RENDER — against the REAL borrowed surface
// ───────────────────────────────────────────────────────────────────────────

describe("the rendered passage", () => {
  it("renders \\emph as real emphasis, not as source", () => {
    const { container } = render(
      <CapturedPassage latex="an \emph{emphasised} word" />,
    );
    expect(container.querySelector("em")).toBeTruthy();
    expect(container.textContent).toContain("emphasised");
    expect(container.textContent).not.toContain("\\emph");
  });

  it("carries the class the host chrome needs and the class the metrics rule keys on", () => {
    const { container } = render(
      <CapturedPassage latex="hi" className="bg-danger-soft text-red-700" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("captured-passage");
    expect(root.className).toContain("bg-danger-soft");
    // `.rtf-content` is what the borrowed typography rules key on; the
    // `.captured-passage .rtf-content` rule in globals.css is what drops the
    // editor-body metrics and hands the ink back to the host block.
    expect(root.querySelector(".rtf-content")).toBeTruthy();
  });

  it("drops the panel style's COLOUR so the host's ink shows through", () => {
    // The red "Original" cue lives on the host block's class; a colour written
    // inline by the passage would win over it.
    const { container } = render(
      <CapturedPassage
        latex="hi"
        bodyStyle={{ color: "rgb(1, 2, 3)", fontSize: "13px" }}
      />,
    );
    const body = container.querySelector(".rtf-content") as HTMLElement;
    expect(body.style.color).toBe("");
    expect(body.style.fontSize).toBe("13px");
  });

  it("mounts NO editor (the static tier — read-only needs none)", () => {
    const { container } = render(<CapturedPassage latex="hi" />);
    expect(container.querySelector(".ProseMirror")).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. THE CENSUS — the leg with teeth
//
// The door was never the part that could misbehave; a surface that renders a
// captured passage its own way is, and that type-checks perfectly. Allowlist
// EMPTY: a hit is ROUTE-it-through-the-door.
// ───────────────────────────────────────────────────────────────────────────

const DOOR = "src/panels/_shared/captured-passage.tsx";

describe("census — one door for a captured passage", () => {
  const panelFiles = trackedFiles("src/panels", /\.tsx?$/).filter(
    (p) => !p.includes("__tests__"),
  );

  it("no panel file parses a captured passage itself", () => {
    const hits = panelFiles.filter((p) => {
      if (p.endsWith(DOOR.replace("src/panels/", "src/panels/"))) return false;
      return /\brichLatexToJson\b/.test(codeOnly(fs.readFileSync(p, "utf8")));
    });
    expect(hits.map((p) => path.relative(process.cwd(), p))).toEqual([]);
  });

  it("no panel file renders a captured passage through a live editor surface", () => {
    // `BorrowedMainText` mounts a read-only TipTap editor. That is the right
    // surface for a card's OWN body (an example's projection is the card's
    // content, and it is what the presence tiers already govern) and the wrong
    // one for a passage QUOTED from the paper, which needs no editor at all.
    // Exemption is per FILE and states the shape it justifies.
    const OWN_BODY = ["src/panels/Examples/ExampleCard.tsx"];
    const hits = panelFiles.filter(
      (p) =>
        !OWN_BODY.some((o) => p.endsWith(o)) &&
        /\bBorrowedMainText\b/.test(codeOnly(fs.readFileSync(p, "utf8"))),
    );
    expect(hits.map((p) => path.relative(process.cwd(), p))).toEqual([]);
    // …and the exemption must still be excusing something.
    for (const o of OWN_BODY) {
      const abs = panelFiles.find((p) => p.endsWith(o));
      expect(abs, `${o} is gone — retire the exemption`).toBeTruthy();
      expect(codeOnly(fs.readFileSync(abs!, "utf8"))).toContain("BorrowedMainText");
    }
  });

  it("the door is the only speller of the borrowed static surface in panels", () => {
    const hits = panelFiles.filter(
      (p) =>
        !p.endsWith("captured-passage.tsx") &&
        /\bStaticBorrowedText\b/.test(codeOnly(fs.readFileSync(p, "utf8"))),
    );
    expect(hits.map((p) => path.relative(process.cwd(), p))).toEqual([]);
  });

  it("the capture is taken at the ONE anchor minter", () => {
    // `createLinkedAnchor` is where a Mode-B range is born; a second minter
    // that forgot the rich twin would silently reinstate the flattened
    // "Original" for whatever it creates.
    const links = fs.readFileSync(
      path.join(process.cwd(), "src/links/links.ts"),
      "utf8",
    );
    expect(codeOnly(links)).toContain("captureSliceContent(");
  });

  it("the slice→JSON conversion has ONE implementation", () => {
    // `prepareCardBodyCapture` reads the same leaf, so the payload the
    // DESTRUCTIVE door validates is byte-identical to the display capture's.
    const files = [
      ...trackedFiles("src/lib", /\.tsx?$/),
      ...trackedFiles("src/links", /\.tsx?$/),
      ...panelFiles,
    ].filter((p) => !p.includes("__tests__") && !p.endsWith("slice-capture.ts"));
    const hits = files.filter((p) =>
      /\bsliceToDocJson\b/.test(codeOnly(fs.readFileSync(p, "utf8"))),
    );
    expect(hits.map((p) => path.relative(process.cwd(), p))).toEqual([]);
  });
});
