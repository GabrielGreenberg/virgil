// @vitest-environment jsdom
//
// Task 357, hole 3 — THE MOUNT GATE.
//
// The other two preservation gates measure the parse OUTPUT: a JSON model is
// round-tripped to `.tex` and word-counted. Neither asks whether the EDITOR
// kept it — and it need not, because `enableContentCheck` is off (TipTap's
// default, and the one Virgil takes): `createNodeFromContent` catches a
// `schema.nodeFromJSON` throw, `console.warn`s, and returns an EMPTY document.
// So a model naming one node type or one mark this build's schema has not got
// opens the paper BLANK over an intact file, word-complete on the way past —
// and the write gate then steps aside on the user's first keystroke into that
// blank, which is when the file is overwritten with nothing.
//
// The legs below drive the REAL mechanism (a real main-schema `Editor`, mounted
// exactly as `Editor.tsx` mounts it) rather than asserting what TipTap ought to
// do — the swallow IS the premise, so it is pinned first.
//
// The leg with teeth is the CENSUS at the bottom: the probe was never the part
// that could misbehave; a door that hands a model to the main editor without
// asking it is.

// The extension barrel reaches the storage barrel, whose FSA require path does
// not resolve under vitest (the standing pattern).
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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Editor, getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  canMountInSchema,
  checkKeptEverything,
  docIsEffectivelyEmpty,
  jsonCarriesContent,
} from "@/lib/tiptap/schema-mount";
import { reportDocMount } from "@/lib/mount-preservation";
import {
  getPreservationNotice,
  clearPreservationNotice,
  isWriteProtected,
} from "@/lib/preservation-notice";
import {
  retainLoadedCounts,
  noteUserEdit,
  checkWriteAgainstRetained,
  clearRetained,
} from "@/lib/write-preservation";
import { codeOnly } from "@/lib/__tests__/_source-scan";

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
  };
}

const MAIN_EXTENSIONS = buildEditorExtensions(mainCtx());
const MAIN_SCHEMA = getSchema(MAIN_EXTENSIONS);

/** Mount exactly as `Editor.tsx` does — same extensions, same content option,
 *  and crucially the same `enableContentCheck` default (off). */
function mount(content: JSONContent) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: MAIN_EXTENSIONS, content });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

const GOOD: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1, uuid: "h001" },
      content: [{ type: "text", text: "Introduction" }],
    },
    {
      type: "paragraph",
      attrs: { uuid: "p001" },
      content: [{ type: "text", text: "Alpha beta gamma delta epsilon zeta." }],
    },
  ],
};

/** A model from a NEWER Virgil: word-complete, and naming a node kind this
 *  build's schema has never heard of. The realistic reach of this class. */
const FROM_THE_FUTURE: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: "p001" },
      content: [{ type: "text", text: "Alpha beta gamma delta epsilon zeta." }],
    },
    {
      type: "sonnetBlock",
      attrs: { uuid: "s001" },
      content: [{ type: "text", text: "Eta theta iota kappa lambda mu nu xi." }],
    },
  ],
};

/** The same shape one axis over: a MARK the schema has not got. */
const UNKNOWN_MARK: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: "p001" },
      content: [
        {
          type: "text",
          text: "Alpha beta gamma delta epsilon zeta.",
          marks: [{ type: "invisibleInk" }],
        },
      ],
    },
  ],
};

const DOC_ID = "doc-mount-gate";
/** Enough words that the write gate's 4-word floor cannot forgive their loss. */
const LOADED_TEX = `\\documentclass{article}

\\begin{document}

Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi.

\\end{document}
`;

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clearPreservationNotice();
  clearRetained();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // TipTap's swallow logs a warn; it is the premise here, not a surprise.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  clearPreservationNotice();
  clearRetained();
});

// ── 1. THE PREMISE — pinned against the real mechanism ─────────────────────

describe("the swallow this gate exists for", () => {
  it("TipTap mounts an EMPTY document from a model naming an unknown node type", () => {
    const { editor, cleanup } = mount(FROM_THE_FUTURE);
    try {
      // Not "the sonnet was dropped" — the WHOLE document is gone, including
      // the perfectly ordinary paragraph beside it.
      expect(editor.getText()).not.toContain("Alpha beta");
      expect(docIsEffectivelyEmpty(editor.state.doc)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("…and from a model carrying an unknown MARK", () => {
    const { editor, cleanup } = mount(UNKNOWN_MARK);
    try {
      expect(docIsEffectivelyEmpty(editor.state.doc)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("mounts a well-formed document intact (the control)", () => {
    const { editor, cleanup } = mount(GOOD);
    try {
      expect(editor.getText()).toContain("Alpha beta");
      expect(docIsEffectivelyEmpty(editor.state.doc)).toBe(false);
    } finally {
      cleanup();
    }
  });
});

// ── 2. THE GATE ────────────────────────────────────────────────────────────

describe("reportDocMount", () => {
  it("refuses a blank mount and raises the write-protecting notice", () => {
    retainLoadedCounts(DOC_ID, LOADED_TEX);
    const { editor, cleanup } = mount(FROM_THE_FUTURE);
    try {
      const verdict = reportDocMount(
        editor.schema,
        editor.state.doc,
        FROM_THE_FUTURE,
        DOC_ID,
      );
      expect(verdict.ok).toBe(false);
      // ProseMirror's own diagnosis, carried through to the user.
      expect(verdict.reason).toMatch(/sonnetBlock/);

      const notice = getPreservationNotice(DOC_ID);
      expect(notice?.source).toBe("mount");
      expect(notice?.reason).toMatch(/sonnetBlock/);
      expect(isWriteProtected(DOC_ID)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("quotes the write gate's OWN baseline, so the two cannot disagree", () => {
    retainLoadedCounts(DOC_ID, LOADED_TEX);
    const { editor, cleanup } = mount(FROM_THE_FUTURE);
    try {
      reportDocMount(editor.schema, editor.state.doc, FROM_THE_FUTURE, DOC_ID);
      const notice = getPreservationNotice(DOC_ID);
      // The editor kept nothing, so the loss IS the loaded body.
      expect(notice?.before).toBeGreaterThan(4);
      expect(notice?.after).toBe(0);
      expect(notice?.lost).toBe(notice?.before);
    } finally {
      cleanup();
    }
  });

  it("a refused mount closes the write path even after the user types", () => {
    retainLoadedCounts(DOC_ID, LOADED_TEX);
    const { editor, cleanup } = mount(FROM_THE_FUTURE);
    try {
      reportDocMount(editor.schema, editor.state.doc, FROM_THE_FUTURE, DOC_ID);
      // The step-aside would otherwise open here — this is exactly the gesture
      // that turns a blank editor into an emptied file.
      noteUserEdit(DOC_ID);
      const blankSave = "\\documentclass{article}\n\n\\begin{document}\n\n\\end{document}\n";
      expect(checkWriteAgainstRetained(DOC_ID, blankSave)?.ok).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("says nothing about a healthy mount (the control)", () => {
    retainLoadedCounts(DOC_ID, LOADED_TEX);
    const { editor, cleanup } = mount(GOOD);
    try {
      expect(
        reportDocMount(editor.schema, editor.state.doc, GOOD, DOC_ID).ok,
      ).toBe(true);
      expect(getPreservationNotice(DOC_ID)).toBeNull();
      expect(isWriteProtected(DOC_ID)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("an empty document that mounts empty is not a loss", () => {
    const EMPTY: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "p001" } }],
    };
    retainLoadedCounts(DOC_ID, LOADED_TEX);
    const { editor, cleanup } = mount(EMPTY);
    try {
      expect(
        reportDocMount(editor.schema, editor.state.doc, EMPTY, DOC_ID).ok,
      ).toBe(true);
      expect(getPreservationNotice(DOC_ID)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("refuses without publishing when there is no document behind the mount", () => {
    // The Library Reader and the pop-out surfaces mount main-schema content
    // with no docId. Nothing of theirs reaches disk, so a banner naming a
    // document the user is not editing would report a hazard that isn't there.
    const { editor, cleanup } = mount(FROM_THE_FUTURE);
    try {
      expect(
        reportDocMount(editor.schema, editor.state.doc, FROM_THE_FUTURE, null).ok,
      ).toBe(false);
      expect(getPreservationNotice(DOC_ID)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ── 3. THE PRIMITIVES — and the direction they fail in ─────────────────────

describe("schema-mount primitives", () => {
  it("canMountInSchema names the offending type", () => {
    const check = canMountInSchema(MAIN_SCHEMA, FROM_THE_FUTURE);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toMatch(/sonnetBlock/);
    expect(canMountInSchema(MAIN_SCHEMA, GOOD).ok).toBe(true);
  });

  it("fails CLOSED when content vanished for a cause the probe cannot name", () => {
    // A model the schema accepts, an empty doc out. Nothing in the code can
    // explain that — and a blank editor silently overwriting an intact file is
    // the worse of the two failures, so the ambiguous case refuses.
    const emptyDoc = MAIN_SCHEMA.nodeFromJSON({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    const verdict = checkKeptEverything(MAIN_SCHEMA, emptyDoc, GOOD);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/empty document/);
  });

  it("jsonCarriesContent sees text, and sees a node that is not an empty wrapper", () => {
    expect(jsonCarriesContent({ type: "doc", content: [{ type: "paragraph" }] })).toBe(false);
    expect(jsonCarriesContent({ type: "doc", content: [] })).toBe(false);
    expect(jsonCarriesContent(GOOD)).toBe(true);
    // A figure with no prose is still something the user would miss.
    expect(
      jsonCarriesContent({
        type: "doc",
        content: [{ type: "paragraph", content: [] }, { type: "horizontalRule" }],
      }),
    ).toBe(true);
  });
});

// ── 4. THE CENSUS — the leg with teeth ─────────────────────────────────────
//
// Every door that hands a JSON model to the MAIN editor asks the schema first.
// A behavioural test of the probe structurally cannot see a door that never
// calls it, and a new door type-checks perfectly while reintroducing the whole
// defect.

const REPO = join(__dirname, "..", "..", "..");
const read = (rel: string) => codeOnly(readFileSync(join(REPO, rel), "utf8"));

/**
 * `editor.commands.setContent(` sites that legitimately DON'T ask, keyed by
 * file with the reason. A hit that is not here is WIRE-it, not list-it.
 */
const PERMITTED_UNPROBED_SETCONTENT: Record<string, string> = {
  "src/components/RichTextField.tsx":
    "a CARD body, whose capture side already asks the same primitive through " +
    "`canMountInCardBody` before anything is deleted (task 308).",
  "src/components/BorrowedMainText.tsx":
    "a read-only card body; it renders a projection and nothing it holds " +
    "reaches disk.",
  "src/lib/reseed-caret.ts":
    "re-seeds a float/card body FROM the live main doc — content that came " +
    "OUT of a schema cannot fail to go back into one.",
};

describe("census: the main-editor content doors", () => {
  it("the LOAD door measures the mount", () => {
    const src = read("src/components/Editor.tsx");
    expect(src).toContain("reportDocMount(");
    // Measured against what the editor KEPT, not against the model it was
    // handed — that distinction IS the fix.
    expect(src).toMatch(/reportDocMount\(\s*editor\.schema,\s*editor\.state\.doc/);
  });

  it("the CODE-PANE door asks before it commits", () => {
    const src = read("src/lib/code-pane-bridge.ts");
    const probeAt = src.indexOf("canMountInSchema(");
    const commitAt = src.indexOf("commands.setContent(");
    expect(probeAt).toBeGreaterThan(-1);
    expect(commitAt).toBeGreaterThan(-1);
    expect(probeAt).toBeLessThan(commitAt);
  });

  it("no OTHER production setContent door is unaccounted for", () => {
    const files = execFileSync(
      "git",
      ["grep", "-l", "commands.setContent(", "--", "src", "library"],
      { cwd: REPO, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.includes("__tests__"));

    const unaccounted = files.filter((f) => {
      if (f === "src/lib/code-pane-bridge.ts") return false;
      return !(f in PERMITTED_UNPROBED_SETCONTENT);
    });
    expect(
      unaccounted,
      "A new door hands a JSON model to an editor without asking whether the " +
        "schema can hold it. TipTap answers a mismatch by mounting an EMPTY " +
        "document (see the premise legs above), so an unprobed door blanks its " +
        "surface silently. Call `canMountInSchema` (or `reportDocMount` for a " +
        "main document), or add the file here with the reason it cannot lose " +
        "content.",
    ).toEqual([]);
  });
});
