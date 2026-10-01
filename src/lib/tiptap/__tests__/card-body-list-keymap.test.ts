// @vitest-environment jsdom
//
// Task 2026-10-01-879 — task 418's item-scoped list Backspace gate reached only
// the MAIN editor. `listKeymap: false` + `VirgilListKeymap` lived in
// `buildEditorExtensions` alone, while every card-body surface (`RichTextField`,
// `BorrowedMainText`, `renderBorrowed`) mounts `listItem` through
// `starterKitConfigForScope` + `buildCardBodySchema` and so ran StarterKit's
// STOCK keymap. A card/excerpt `listItem` admits `block*` after its first child,
// so Backspace at the start of an item's SECOND block took upstream's
// textblock-scoped item-start branch and LIFTED the whole item out of the list —
// the exact defect 418 retired, one stack over (the task-731 wrapper-gate split
// again: "gated or not depends on which stack you're on").
//
// The fix moves the pair into the card-body SSOT: both scope configs turn the
// stock keymap off and `buildCardBodySchema` registers the gate beside the list
// wrappers, so the gate travels with the list nodes. Every leg drives the real
// card-body stack through `handleKeyDown` — a `tr` dispatch cannot see which
// binding owns the key.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor, getSchema } from "@tiptap/core";
import type { AnyExtension, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { codeOnly } from "@/lib/__tests__/_source-scan";
import {
  buildCardBodySchema,
  starterKitConfigForScope,
  type CardBodySchemaScope,
} from "@/lib/tiptap/borrowed-schema";

const SCOPES: CardBodySchemaScope[] = ["card", "excerpt"];

/** The pair every card-body surface composes (see wrapper-surfaces-guard). */
function cardBodyStack(scope: CardBodySchemaScope): AnyExtension[] {
  return [
    StarterKit.configure({ ...starterKitConfigForScope(scope) }),
    ...buildCardBodySchema(scope, { includeLabelRefFootnote: true }),
  ];
}

function mount(scope: CardBodySchemaScope, content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: cardBodyStack(scope),
    content: { type: "doc", content },
  });
}

function press(ed: Editor, key: "Backspace" | "Delete"): boolean {
  return (
    ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key })),
    ) ?? false
  );
}

/** Caret at the start of the first textblock whose text is exactly `text`. */
function caretAtStartOf(ed: Editor, text: string) {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock && n.textContent === text) pos = p + 1;
    return pos < 0;
  });
  if (pos < 0) throw new Error(`no textblock "${text}"`);
  ed.commands.setTextSelection(pos);
}

/** An indented outline — `type("text")` per node. StarterKit's `trailingNode`
 *  keeps an empty paragraph after a final list; it is not under test, so a
 *  TOP-LEVEL empty paragraph is left out. */
function outline(ed: Editor): string {
  const lines: string[] = [];
  ed.state.doc.descendants((n, pos) => {
    if (n.isText) return false;
    if (n.type.name === "paragraph" && n.content.size === 0 && ed.state.doc.resolve(pos).depth === 0) {
      return false;
    }
    const d = ed.state.doc.resolve(pos).depth;
    lines.push(`${"  ".repeat(d)}${n.type.name}` + (n.isTextblock ? `("${n.textContent}")` : ""));
    return true;
  });
  return lines.join("\n");
}

const P = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const ITEM = (...kids: JSONContent[]): JSONContent => ({ type: "listItem", content: kids });
const LIST = (...items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });

// ── A. the behaviour, at both scopes ─────────────────────────────────────────

describe.each(SCOPES)("879 — card body (%s scope): Backspace in an item's LATER block", (scope) => {
  it("joins into the block above INSIDE the item — the item stays in the list", () => {
    const ed = mount(scope, [LIST(ITEM(P("first")), ITEM(P("Spatial"), P("second")))]);
    caretAtStartOf(ed, "second");
    press(ed, "Backspace");
    expect(outline(ed)).toBe(
      [
        "bulletList",
        "  listItem",
        '    paragraph("first")',
        "  listItem",
        '    paragraph("Spatialsecond")',
      ].join("\n"),
    );
    ed.destroy();
  });

  it("control: the genuine item-start branch still belongs to the list keymap", () => {
    // At the item's own start the gate ALLOWS and upstream's helper runs, so the
    // second item's text joins into the first item — never a bare lift out of
    // the list. Pins that the gate did not simply switch the keymap off.
    const ed = mount(scope, [LIST(ITEM(P("first")), ITEM(P("second")))]);
    caretAtStartOf(ed, "second");
    expect(press(ed, "Backspace")).toBe(true);
    expect(ed.state.doc.firstChild?.type.name).toBe("bulletList");
    expect(ed.state.doc.textContent).toBe("firstsecond");
    ed.destroy();
  });
});

// ── B. the guard — the gate travels with the list nodes ──────────────────────

describe("879 — every stack that mounts listItem runs the gated keymap, never the stock one", () => {
  it.each(SCOPES)("%s scope: listItem mounted ⇒ stock listKeymap OFF and VirgilListKeymap registered", (scope) => {
    const schema = getSchema(cardBodyStack(scope));
    expect(schema.nodes.listItem, "fixture premise: the scope mounts listItem").toBeDefined();
    const config = starterKitConfigForScope(scope) as Record<string, unknown>;
    expect(config.listKeymap).toBe(false);
    const names = buildCardBodySchema(scope).map((e) => e.name);
    expect(names).toContain("virgilListKeymap");
  });

  it("every StarterKit.configure site turns listKeymap off — directly or via the card-body SSOT", () => {
    const ROOT = join(__dirname, "..", "..", "..", "..");
    const files = [
      "src/lib/editor-extensions.ts",
      "src/lib/borrowed-render.ts",
      "src/lib/tiptap/borrowed-schema.ts",
      "src/components/BorrowedMainText.tsx",
      "src/components/RichTextField.tsx",
    ];
    let sites = 0;
    for (const f of files) {
      const src = codeOnly(readFileSync(join(ROOT, f), "utf8"));
      const needle = "StarterKit.configure(";
      for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) {
        // Balanced-paren slice of the call's argument.
        let depth = 0;
        let j = i + needle.length - 1;
        for (; j < src.length; j++) {
          if (src[j] === "(") depth++;
          else if (src[j] === ")" && --depth === 0) break;
        }
        const arg = src.slice(i, j + 1);
        sites++;
        expect(
          /listKeymap:\s*false/.test(arg) || arg.includes("starterKitConfigForScope("),
          `${f}: a StarterKit.configure site that neither disables listKeymap nor uses the card-body SSOT`,
        ).toBe(true);
      }
    }
    // Main editor + borrowed-render + cardBodySchemaFor + BorrowedMainText + RichTextField.
    expect(sites).toBe(5);
  });
});
