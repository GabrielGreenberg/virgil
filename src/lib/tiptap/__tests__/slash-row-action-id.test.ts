// @vitest-environment jsdom
//
// Task 843 — a slash command's action id is written ONCE.
//
// The popup decides whether to OFFER `\name` from `SLASH_NAME_TO_ACTION_ID`
// (`slashCommandVerdict`), and the commit door then runs the row's closure. If
// the closure named its own id, the two copies could drift and the popup would
// gate on action A's `applies()` while running action B — task 398's bug by a
// new road. This pins the contract behaviourally: invoke EVERY `VIRGIL_COMMANDS`
// row and assert the action it actually reaches is exactly the map's id —
// whether it goes through the bridge (`runEditorAction`, stubbed) or the
// view-only path (the registry row's own `run`, spied).
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

const bridgeCalls: string[] = [];
vi.mock("@/lib/actions/editor-actions-bridge", async (orig) => ({
  ...(await orig<typeof import("@/lib/actions/editor-actions-bridge")>()),
  runEditorAction: (_view: unknown, id: string) => {
    bridgeCalls.push(id);
  },
}));

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { VIRGIL_COMMANDS } from "@/lib/tiptap/commands";
import {
  SLASH_NAME_TO_ACTION_ID,
  VIRGIL_ACTION_REGISTRY,
} from "@/lib/actions/action-registry";

function mountEditor(): Editor {
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: buildEditorExtensions(ctx),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: [{ type: "text", text: "Some prose here." }],
        },
      ],
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  bridgeCalls.length = 0;
});

describe("every slash row runs exactly SLASH_NAME_TO_ACTION_ID[name] (task 843)", () => {
  it("covers the whole table (anti-vacuity)", () => {
    expect(VIRGIL_COMMANDS.length).toBeGreaterThanOrEqual(18);
    for (const { name } of VIRGIL_COMMANDS) {
      expect(SLASH_NAME_TO_ACTION_ID[name], `\\${name} unmapped`).toBeDefined();
    }
  });

  for (const { name } of VIRGIL_COMMANDS) {
    it(`\\${name} → ${SLASH_NAME_TO_ACTION_ID[name]}`, () => {
      // Record which registry row's own `run` the view-only path reaches; force
      // every gate open so the question is only "WHICH action", never "may it".
      const viewRuns: string[] = [];
      for (const [id, spec] of Object.entries(VIRGIL_ACTION_REGISTRY)) {
        if (!spec) continue;
        vi.spyOn(spec, "applies").mockReturnValue("ok");
        vi.spyOn(spec, "run").mockImplementation(() => {
          viewRuns.push(id);
        });
      }
      const editor = mountEditor();
      try {
        editor.commands.setTextSelection(3);
        VIRGIL_COMMANDS.find((c) => c.name === name)!.action(
          editor.view,
          "\\" + name,
        );
        expect([...bridgeCalls, ...viewRuns]).toEqual([
          SLASH_NAME_TO_ACTION_ID[name],
        ]);
      } finally {
        editor.destroy();
      }
    });
  }
});
