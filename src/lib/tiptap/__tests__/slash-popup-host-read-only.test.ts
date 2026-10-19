// @vitest-environment jsdom
//
// Task 1183 — the slash popup asks "can I edit here?" through the ONE door.
//
// THE BUG THIS PINS (a surface that offers commands that silently fail). MAIN
// keeps `view.editable === true` for its whole life; the Library Reader's
// read-only lives only in `editableRef`, which `readOnlyEnforcer` reads and
// `surfaceEditableNow` (`surface-editable.ts`) publishes. The grab menu and the
// lightning panel asked that door. The slash path asked `view.editable` — a
// CONSTANT on MAIN — in both `buildSlashActionContext` (`canEdit`) and
// `runViewOnlyAction` / `runBridgeAction` (`collabReadOnly`). So in the Reader,
// typing `\` opened the popup with every row lit and no reason, and Enter ran a
// row whose write the enforcer then dropped.
//
// WHAT IS PROVEN (the REAL `buildEditorExtensions("main")` stack — so the real
// `readOnlyEnforcer` publishes the real `editableRef` — driving the shipped
// `handleTextInput` / `handleKeyDown` props):
//   1. HOST READ-ONLY OPENS NOTHING — `editableRef.current === false` with
//      `view.editable === true`: typing `\` leaves the popup closed (the same
//      answer PM gives a non-editable view, which never calls handleTextInput).
//   2. CONTROL — the same editor with the host editable opens the popup.
//   3. THE CTX IS HONEST — `buildSlashActionContext(view).canEdit` is `false`
//      on a host-read-only surface, and every row's reason names the HOST
//      ("This paper is open read-only"), not the pen.
//   4. A FLIP WHILE OPEN greys every row — the host turns read-only with the
//      popup up (`announceSurfaceEditability`), the rows go disabled with the
//      host reason, and Enter changes nothing.
//   5. CENSUS — every `ActionContext` builder in `src/` derives `canEdit` from
//      `surfaceEditableNow`, and `commands.ts` no longer asks `collabReadOnly`.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import path from "node:path";
import type { RefObject } from "react";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { slashPopupKey } from "@/lib/tiptap/slash-popup";
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap/commands";
import {
  buildSlashActionContext,
  slashCommandReason,
} from "@/lib/tiptap/slash-applicability";
import { announceSurfaceEditability } from "@/lib/tiptap/surface-editable";
import { SLASH_NAME_TO_ACTION_ID } from "@/lib/actions/action-registry";
import { refusalPhrase } from "@/lib/actions/refusal";
import {
  commentsStripped,
  REPO_ROOT,
  walkFiles,
} from "@/lib/__tests__/_source-scan";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mountHost(hostEditable: boolean): {
  editor: Editor;
  editableRef: RefObject<boolean>;
} {
  const editableRef: RefObject<boolean> = { current: hostEditable };
  const ctx = {
    surface: "main",
    editableRef,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    // The Reader's pin, and MAIN's for its whole life.
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: [{ type: "text", text: "alpha beta" }],
        },
      ],
    },
  });
  const end = editor.state.doc.firstChild!.nodeSize - 1;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
  );
  return { editor, editableRef };
}

/** Offer a lone `\` through the SHIPPED `handleTextInput` prop. */
function offerSlash(ed: Editor): void {
  const from = ed.state.selection.from;
  ed.view.someProp("handleTextInput", (f) =>
    f(ed.view, from, from, "\\", () => ed.state.tr),
  );
}

const popupOpen = (ed: Editor) => !!slashPopupKey.getState(ed.state)?.open;

const HOST = refusalPhrase({ cause: "host" });
const mapped = VIRGIL_COMMAND_NAMES.filter((n) => SLASH_NAME_TO_ACTION_ID[n]);

describe("slash popup — host read-only (task 1183)", () => {
  it("does not open on a host-read-only surface whose view.editable is true", () => {
    const { editor: ed } = mountHost(false);
    expect(ed.view.editable).toBe(true); // the lie the old gate asked
    offerSlash(ed);
    expect(popupOpen(ed)).toBe(false);
  });

  it("CONTROL: opens when the host is editable", () => {
    const { editor: ed } = mountHost(true);
    offerSlash(ed);
    expect(popupOpen(ed)).toBe(true);
  });

  it("the slash ctx answers canEdit=false and every reason names the HOST", () => {
    const { editor: ed } = mountHost(false);
    expect(buildSlashActionContext(ed.view).canEdit).toBe(false);
    expect(mapped.length).toBeGreaterThan(5);
    for (const name of mapped) {
      expect(slashCommandReason(ed.view, name), name).toBe(HOST);
    }
  });

  it("a host flip while the popup is open greys every row and Enter changes nothing", () => {
    const { editor: ed, editableRef } = mountHost(true);
    // Type `\` for real so Enter would have something to commit over.
    offerSlash(ed);
    ed.commands.insertContentAt(ed.state.selection.from, "\\");
    expect(popupOpen(ed)).toBe(true);

    editableRef.current = false;
    announceSurfaceEditability(ed.view);

    const st = slashPopupKey.getState(ed.state)!;
    expect(st.open).toBe(true);
    if (!st.open) return;
    const named = st.filtered.filter((n) => SLASH_NAME_TO_ACTION_ID[n]);
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect(st.disabled).toContain(n);

    const before = ed.state.doc.toJSON();
    ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key: "Enter" })),
    );
    expect(ed.state.doc.toJSON()).toEqual(before);
  });
});

// ── CENSUS ────────────────────────────────────────────────────────────────
// Stated limit: the needle is the literal `canEdit: <expr>` property (and the
// `canEdit,` shorthand in a file that builds an ActionContext). A builder that
// spelled the key differently would be invisible here — and would also be
// invisible to `gateApplies`, which reads `ctx.canEdit` by that name.
const SRC = path.join(REPO_ROOT, "src");

function sourceFiles(): { rel: string; src: string }[] {
  return walkFiles(SRC, { skipDirs: ["__tests__"] })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"))
    .map((f) => ({
      rel: path.relative(REPO_ROOT, f),
      src: commentsStripped(readFileSync(f, "utf8")),
    }));
}

describe("CENSUS — every ActionContext builder asks surfaceEditableNow (task 1183)", () => {
  const files = sourceFiles();

  it("every `canEdit: <expr>` value is derived from surfaceEditableNow", () => {
    const offenders: string[] = [];
    let builders = 0;
    for (const { rel, src } of files) {
      for (const m of src.matchAll(/\bcanEdit:\s*([^,\n}]+)/g)) {
        const expr = m[1]!.trim();
        if (/^boolean\b/.test(expr)) continue; // a type annotation
        builders += 1;
        if (!expr.includes("surfaceEditableNow(")) offenders.push(`${rel}: canEdit: ${expr}`);
      }
    }
    expect(offenders).toEqual([]);
    // SELF-CHECK: slash, grab, bridge, menubar at minimum.
    expect(builders).toBeGreaterThanOrEqual(4);
  });

  it("a shorthand `canEdit,` in an ActionContext builder is bound from surfaceEditableNow", () => {
    const offenders: string[] = [];
    for (const { rel, src } of files) {
      if (!/^\s*canEdit,\s*$/m.test(src)) continue;
      if (!/\bActionContext\b|\bsurface:\s*"/.test(src)) continue; // a component prop
      const bound = src.match(/\bconst canEdit\s*=\s*([^;]+);/);
      if (!bound || !bound[1]!.includes("surfaceEditableNow(")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("the slash surface asks the one door in its offer, open gate and commit", () => {
    const read = (f: string) =>
      commentsStripped(readFileSync(path.join(SRC, "lib/tiptap", f), "utf8"));
    expect(read("slash-applicability.ts")).toContain("canEdit: surfaceEditableNow(view)");
    expect(read("slash-popup.ts")).toContain("surfaceEditableNow(view)");
    const commands = read("commands.ts");
    expect(commands).not.toContain("collabReadOnly(");
    expect(commands).toContain("surfaceEditableNow(view)");
  });
});
