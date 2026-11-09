// @vitest-environment jsdom
//
// Task 1532 — a rename commits the user's EDIT, rebased from the seed the box
// opened with onto the LIVE text; a foreign change made while the box was open
// survives, and an edit that overlaps it is REFUSED out loud.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { projectInline } from "@/lib/inline-content";
import { rebaseTextEdit } from "@/lib/rebase-text-edit";
import { registerEditRefusalVoice, type EditRefusalNotice } from "@/lib/edit-refusal";
import {
  findNodeByUuid,
  renameHeadingByUuid,
  renameParTitleByUuid,
} from "@/lib/tiptap/structural-edit";

describe("rebaseTextEdit — the three-way text commit", () => {
  it("nothing moved → the draft; nothing typed → the live text", () => {
    expect(rebaseTextEdit("Intro", "Introduction", "Intro")).toBe("Introduction");
    expect(rebaseTextEdit("Intro", "Intro", "Intro to X")).toBe("Intro to X");
  });

  it("disjoint edits compose, whichever side the foreign one is on", () => {
    // user edits the START, foreign appended at the END
    expect(rebaseTextEdit("Intro", "An Intro", "Intro to X")).toBe("An Intro to X");
    // user edits the END, foreign edited the START
    expect(rebaseTextEdit("The intro", "The intro proper", "A intro")).toBe("A intro proper");
  });

  it("overlapping or touching edits are a conflict (null)", () => {
    // both extend the end of "Intro"
    expect(rebaseTextEdit("Intro", "Introduction", "Intro to X")).toBeNull();
    // select-all retype vs any foreign change
    expect(rebaseTextEdit("Intro", "Overview", "Intro!")).toBeNull();
  });

  it("both sides making the same change is no conflict", () => {
    expect(rebaseTextEdit("Intro", "Introduction", "Introduction")).toBe("Introduction");
  });
});

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

let editor: Editor | null = null;
let unregister: (() => void) | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  unregister?.();
  unregister = null;
});

function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, uuid: "h" }, content: [{ type: "text", text: "Intro" }] },
        { type: "paragraph", attrs: { uuid: "p", parTitle: "Claim" }, content: [{ type: "text", text: "Body." }] },
      ],
    },
  });
  return editor;
}

const headingText = (e: Editor) => projectInline(findNodeByUuid(e, "h")!.node).text;
const parTitle = (e: Editor) => findNodeByUuid(e, "p")!.node.attrs.parTitle as string | null;

/** Another surface changes the heading while the Outline's box is open. */
function foreignHeadingEdit(e: Editor, text: string) {
  expect(renameHeadingByUuid(e, "h", text)).toBe(true);
}

function listen(): EditRefusalNotice[] {
  const heard: EditRefusalNotice[] = [];
  unregister = registerEditRefusalVoice((n) => heard.push(n));
  return heard;
}

describe("renameHeadingByUuid with a seed", () => {
  it("keeps a foreign change the user's edit did not touch", () => {
    const e = mount();
    const heard = listen();
    foreignHeadingEdit(e, "Intro to X");
    expect(renameHeadingByUuid(e, "h", "An Intro", "Intro")).toBe(true);
    expect(headingText(e)).toBe("An Intro to X");
    expect(heard).toEqual([]);
  });

  it("refuses — and says so, handing the draft back — when the edits overlap", () => {
    const e = mount();
    const heard = listen();
    foreignHeadingEdit(e, "Intro to X");
    expect(renameHeadingByUuid(e, "h", "Introduction", "Intro")).toBe(false);
    expect(headingText(e)).toBe("Intro to X"); // the foreign change is not overwritten
    expect(heard).toHaveLength(1);
    expect(heard[0].title).toBe("Heading not renamed");
    expect(heard[0].draft).toBe("Introduction");
  });
});

describe("renameParTitleByUuid with a seed", () => {
  it("keeps a foreign change, refuses an overlapping one", () => {
    const e = mount();
    const heard = listen();
    expect(renameParTitleByUuid(e, "p", "Claim two")).toBe(true); // foreign
    expect(renameParTitleByUuid(e, "p", "Main Claim", "Claim")).toBe(true);
    expect(parTitle(e)).toBe("Main Claim two");
    expect(heard).toEqual([]);

    expect(renameParTitleByUuid(e, "p", "Main Claim three", "Main Claim")).toBe(false);
    expect(parTitle(e)).toBe("Main Claim two");
    expect(heard.map((n) => n.title)).toEqual(["Title not renamed"]);
  });
});
