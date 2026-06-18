// @vitest-environment jsdom
//
// T1 Stage 2 — IdentityCascade fan-out + the editor `\cite{}` doc-rewrite.
//
// Pins:
//  - the cascade is the single writer: `runIdentityChange` fans a rename out to
//    every registered migrator in one batch (sync + async).
//  - the `\cite{}` doc-rewrite rewrites a TOP-LEVEL cite AND a FOOTNOTE-NESTED
//    cite (the C10 descend blind spot) in one transaction.
//  - the rewrite uses the boundary matcher: a punctuation citekey rewrites as a
//    whole token, and `foo` does NOT clobber `foobar`.
//
// (The Editor chain pulls `@/` modules; the storage stub guards the
// barrel/storage gotcha, mirroring footnote-nested-citation-delete.test.ts.)
import { describe, it, expect, vi } from "vitest";

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

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import { Footnote } from "@/lib/tiptap/footnote";
import {
  IdentityCascade,
  isRenameCitekey,
  renameCitekeyChange,
} from "../identity-cascade";
import {
  rewriteCiteCommandString,
  rewriteCiteKeyInDoc,
} from "../bib-cite-rewrite";
import { walkJsonContentForCitations } from "@/lib/inline-content";

// ── The cascade fan-out ────────────────────────────────────────────────────

describe("IdentityCascade: the single-writer fan-out", () => {
  it("fans a rename out to every registered bibEntry migrator", async () => {
    const cascade = new IdentityCascade();
    const seen: string[] = [];
    cascade.registerMigrator("bibEntry", (c) => {
      if (isRenameCitekey(c)) seen.push(`A:${c.renameCitekey.oldKey}->${c.renameCitekey.newKey}`);
    });
    cascade.registerMigrator("bibEntry", (c) => {
      if (isRenameCitekey(c)) seen.push(`B:${c.renameCitekey.newKey}`);
    });
    await cascade.runIdentityChange(
      renameCitekeyChange({ uid: "u1", oldKey: "foo", newKey: "bar" }),
    );
    expect(seen).toEqual(["A:foo->bar", "B:bar"]);
  });

  it("awaits async migrators before resolving", async () => {
    const cascade = new IdentityCascade();
    let done = false;
    cascade.registerMigrator("bibEntry", async () => {
      await Promise.resolve();
      done = true;
    });
    await cascade.runIdentityChange(
      renameCitekeyChange({ uid: "u1", oldKey: "a", newKey: "b" }),
    );
    expect(done).toBe(true);
  });

  it("a throwing migrator does not strand the others (DATA-LOSS isolation)", async () => {
    const cascade = new IdentityCascade();
    const ran: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    cascade.registerMigrator("bibEntry", () => { throw new Error("boom"); });
    cascade.registerMigrator("bibEntry", () => { ran.push("survivor"); });
    await cascade.runIdentityChange(
      renameCitekeyChange({ uid: "u1", oldKey: "a", newKey: "b" }),
    );
    expect(ran).toEqual(["survivor"]);
    spy.mockRestore();
  });

  it("a rename with no migrators is a well-formed no-op", async () => {
    const cascade = new IdentityCascade();
    await expect(
      cascade.runIdentityChange(renameCitekeyChange({ uid: "u1", oldKey: "a", newKey: "b" })),
    ).resolves.toBeUndefined();
  });

  it("unregister removes a migrator (no double-fire across a re-register)", async () => {
    const cascade = new IdentityCascade();
    let calls = 0;
    const m = () => { calls += 1; };
    const off = cascade.registerMigrator("bibEntry", m);
    cascade.registerMigrator("bibEntry", m); // Set semantics — still one
    expect(cascade.migratorCount("bibEntry")).toBe(1);
    off();
    await cascade.runIdentityChange(renameCitekeyChange({ uid: "u", oldKey: "a", newKey: "b" }));
    expect(calls).toBe(0);
  });
});

// ── The pure command-string rewrite ─────────────────────────────────────────

describe("rewriteCiteCommandString: boundary-safe citekey rewrite", () => {
  it("rewrites a plain whole-token citekey", () => {
    expect(rewriteCiteCommandString("\\cite{foo}", "foo", "bar")).toBe("\\cite{bar}");
  });
  it("does NOT clobber a longer key that contains the old key", () => {
    expect(rewriteCiteCommandString("\\cite{foobar}", "foo", "bar")).toBe("\\cite{foobar}");
  });
  it("rewrites one key in a multi-key cite, leaving siblings intact", () => {
    expect(rewriteCiteCommandString("\\cite{foo,foobar}", "foo", "bar")).toBe("\\cite{bar,foobar}");
  });
  it("rewrites a PUNCTUATION citekey as a whole token (bare \\b would miss)", () => {
    expect(rewriteCiteCommandString("\\cite{+foo}", "+foo", "bar")).toBe("\\cite{bar}");
    expect(rewriteCiteCommandString("\\cite{a:b}", "a:b", "x")).toBe("\\cite{x}");
  });
  it("rewrites a colon citekey without touching a superset sibling (BIB-F7-04)", () => {
    // `Smith:2020` must not clobber `Smith:2020a` (W0a boundary contract).
    expect(
      rewriteCiteCommandString("\\cite{Smith:2020,Smith:2020a}", "Smith:2020", "Smith:2021"),
    ).toBe("\\cite{Smith:2021,Smith:2020a}");
  });
  it("is a no-op when old===new or empty", () => {
    expect(rewriteCiteCommandString("\\cite{foo}", "foo", "foo")).toBe("\\cite{foo}");
    expect(rewriteCiteCommandString("", "foo", "bar")).toBe("");
  });
});

// ── The live-doc rewrite (top-level + footnote-nested) ──────────────────────

function mount(citationId: string, command: string, footnoteCommand?: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const fnContent = footnoteCommand
    ? {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "see " },
              {
                type: "citation",
                attrs: { citationId: "nested-1", command: footnoteCommand, displayText: "" },
              },
            ],
          },
        ],
      }
    : undefined;
  return new Editor({
    element,
    extensions: [StarterKit, Citation, Footnote],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Body " },
            { type: "citation", attrs: { citationId, command, displayText: "" } },
            ...(fnContent
              ? [{ type: "footnote", attrs: { footnoteId: "fn-1", number: 1, content: fnContent } }]
              : []),
          ],
        },
      ],
    },
  });
}

function topLevelCommands(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") out.push(node.attrs.command as string);
    return true;
  });
  return out;
}

function footnoteNestedCommands(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "footnote" && node.attrs.content) {
      walkJsonContentForCitations(node.attrs.content as JSONContent, (c) =>
        out.push(c.command),
      );
    }
    return true;
  });
  return out;
}

describe("rewriteCiteKeyInDoc: live-doc rename, footnote-deep", () => {
  it("rewrites a TOP-LEVEL \\cite atom's command", () => {
    const editor = mount("top-1", "\\cite{jones2019}");
    const touched = rewriteCiteKeyInDoc(editor, "jones2019", "jones2020");
    expect(touched).toBe(1);
    expect(topLevelCommands(editor)).toEqual(["\\cite{jones2020}"]);
    editor.destroy();
  });

  it("rewrites a FOOTNOTE-NESTED \\cite (the C10 descend blind spot)", () => {
    // top-level cites a DIFFERENT key; the renamed key lives ONLY in the footnote.
    const editor = mount("top-1", "\\cite{other}", "\\cite{jones2019}");
    const touched = rewriteCiteKeyInDoc(editor, "jones2019", "jones2020");
    expect(touched).toBe(1); // only the footnote host rewritten
    expect(topLevelCommands(editor)).toEqual(["\\cite{other}"]);
    expect(footnoteNestedCommands(editor)).toEqual(["\\cite{jones2020}"]);
    editor.destroy();
  });

  it("rewrites BOTH a top-level and a footnote-nested cite of the same key in one tx", () => {
    const editor = mount("top-1", "\\cite{jones2019}", "\\cite{jones2019}");
    const touched = rewriteCiteKeyInDoc(editor, "jones2019", "jones2020");
    expect(touched).toBe(2);
    expect(topLevelCommands(editor)).toEqual(["\\cite{jones2020}"]);
    expect(footnoteNestedCommands(editor)).toEqual(["\\cite{jones2020}"]);
    editor.destroy();
  });

  it("a punctuation citekey rewrites via the boundary matcher", () => {
    const editor = mount("top-1", "\\cite{smith:2020}");
    rewriteCiteKeyInDoc(editor, "smith:2020", "smith2020");
    expect(topLevelCommands(editor)).toEqual(["\\cite{smith2020}"]);
    editor.destroy();
  });

  it("no matching key → no dispatch (0 touched)", () => {
    const editor = mount("top-1", "\\cite{jones2019}");
    expect(rewriteCiteKeyInDoc(editor, "absent", "x")).toBe(0);
    editor.destroy();
  });
});
