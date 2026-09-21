// @vitest-environment jsdom
//
// A citekey rename on a DEFAULT build reaches the document and the sidecars
// (task 689) — the user-facing leg.
//
// The suite next door (`useCitations-cascade-rename`) pins that the fan-out is
// DISPATCHED with the flag off. This one pins what the dispatch has to actually
// DO, by wiring the real migrators `EditorPane` registers onto the real hooks
// and driving a real ProseMirror document:
//
//   - every `\cite{oldKey}` in the doc carries the new key — TOP-LEVEL and
//     FOOTNOTE-NESTED. Without this the `.tex` and `references.bib` disagree
//     (a dangling reference that will not compile) AND the sidecar half of the
//     rename is undone the moment `syncFromEditor` re-derives `citations.json`
//     from those unrewritten atoms;
//   - the entry's ANNOTATION moves with it. This is the DATA-LOSS half
//     (BIB-A2-01): with the flag off annotations are a flat citekey → html
//     record, so a rename left the user's note under a key that no longer
//     names an entry and it vanished from the panel;
//   - the entry's BIB-REVIEW rows move with it (BIB-A2-02);
//   - and all of it holds with the flag ON too — the uid sidecar shapes have
//     citekey-keyed corners of their own (`orphanByKey`, a row's `bibKey`),
//     so the migrators are written for both shapes rather than for the
//     flag-off one.
//
// `citekey_keyed_sidecars.json` — the census both halves of the app are checked
// against — already named `annotations.json` and `bib-review-requests.json` as
// surfaces a rename must re-key. The skill side had re-keyers; the app side had
// none.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/storage", async () => {
  const { mockStorageModule } = await import("@/lib/__tests__/_mock-storage");
  const { vi: v } = await import("vitest");
  return mockStorageModule({
    readSidecar: v.fn(async () => ({})),
    readSidecarIfExists: v.fn(async () => ({})),
    readBib: v.fn(async () => ({
      bibText: "@article{smith2020,\n  title = {A}\n}\n",
      detectedPackage: undefined,
    })),
  });
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import { Footnote } from "@/lib/tiptap/footnote";
import { walkJsonContentForCitations } from "@/lib/inline-content";
import { rewriteCiteKeyInDoc } from "@/lib/identity/bib-cite-rewrite";
import { isRenameCitekey } from "@/lib/identity/identity-cascade";
import { setIdentityCascadeFlag } from "@/lib/identity/identity-flag";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { useCitations } from "../useCitations";
import { useAnnotations } from "../useAnnotations";
import { useBibReview } from "../useBibReview";
import { namedBibEntry } from "@/lib/bib-test-entry";

beforeEach(() => {
  __resetForTests();
});
afterEach(() => {
  setIdentityCascadeFlag(undefined);
});

// ---------------------------------------------------------------------------
// A doc citing `smith2020` twice: once at top level, once INSIDE a footnote
// (the nested cite lives in the footnote's `attrs.content` literal, which
// `doc.descendants()` does not enter).
// ---------------------------------------------------------------------------

function mountEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
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
            {
              type: "citation",
              attrs: { citationId: "c-top", command: "\\cite{smith2020}", displayText: "" },
            },
            {
              type: "footnote",
              attrs: {
                footnoteId: "fn-1",
                number: 1,
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "see " },
                        {
                          type: "citation",
                          attrs: {
                            citationId: "c-nested",
                            command: "\\cite{smith2020}",
                            displayText: "",
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  });
}

function allCiteCommands(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") out.push(node.attrs.command as string);
    if (node.type.name === "footnote" && node.attrs.content) {
      walkJsonContentForCitations(node.attrs.content as JSONContent, (c) =>
        out.push(c.command),
      );
    }
    return true;
  });
  return out;
}

/**
 * The three hooks a pane mounts, with the `bibEntry` migrators wired exactly
 * as `EditorPane` wires them (the `\cite{}` doc-rewrite; the sidecar re-keys).
 * The float/selection migrator is EditorPane-local view state and is pinned by
 * `bib-float-selection-migrate.test.ts`.
 */
function usePane(docId: string, editor: Editor) {
  const citations = useCitations(docId);
  const annotations = useAnnotations(docId, citations.getBibEntry, citations.bibEntries);
  const bibReview = useBibReview(docId, citations.getBibEntry, citations.bibEntries);
  return { citations, annotations, bibReview, editor };
}

type Pane = ReturnType<typeof usePane>;

function wireMigrators(pane: Pane) {
  pane.citations.identityCascade.registerMigrator("bibEntry", (change) => {
    if (!isRenameCitekey(change)) return;
    const { oldKey, newKey } = change.renameCitekey;
    if (oldKey === newKey) return;
    rewriteCiteKeyInDoc(pane.editor, oldKey, newKey);
  });
  pane.citations.identityCascade.registerMigrator("bibEntry", (change) => {
    if (!isRenameCitekey(change)) return;
    const { oldKey, newKey } = change.renameCitekey;
    if (oldKey === newKey) return;
    pane.annotations.renameAnnotationKey(oldKey, newKey);
    pane.bibReview.renameBibKey(oldKey, newKey);
  });
}

async function renameOnPane(flag: boolean, docId: string) {
  setIdentityCascadeFlag(flag);
  beginDocPipeline(docId);
  const editor = mountEditor();
  const { result } = renderHook(() => usePane(docId, editor));
  await waitFor(() => {
    expect(result.current.citations.bibEntries.some((e) => e.key === "smith2020")).toBe(true);
  });

  let citId = "";
  act(() => {
    wireMigrators(result.current);
    result.current.annotations.setAnnotation("smith2020", "<p>my note</p>");
    result.current.bibReview.requestReview("smith2020", "fields", "check the year");
    citId = result.current.citations.addCitation("\\cite{smith2020}").id;
  });
  await waitFor(() => {
    expect(result.current.annotations.getAnnotation("smith2020")).toBe("<p>my note</p>");
    expect(result.current.citations.citations.some((c) => c.id === citId)).toBe(true);
  });

  act(() => {
    result.current.citations.updateBibKeyAndType(namedBibEntry(result.current.citations.bibEntries, "smith2020"), "smith2021", "article");
  });
  await waitFor(() => {
    expect(result.current.citations.bibEntries.some((e) => e.key === "smith2021")).toBe(true);
  });

  return { result, editor };
}

describe.each([
  ["cascade flag OFF (the shipping default)", false],
  ["cascade flag ON", true],
])("a citekey rename fans out — %s", (label, flag) => {
  const slug = flag ? "on" : "off";

  it("rewrites the `\\cite{}` atoms in the live doc, top-level AND footnote-nested", async () => {
    // Pre-fix (flag off) this is `["\\cite{smith2020}", "\\cite{smith2020}"]`:
    // the cascade never ran, so nothing touched the document.
    const { editor } = await renameOnPane(flag, `doc-fanout-doc-${slug}`);
    expect(allCiteCommands(editor)).toEqual([
      "\\cite{smith2021}",
      "\\cite{smith2021}",
    ]);
    editor.destroy();
  });

  it("moves the entry's ANNOTATION with it (the DATA-LOSS half)", async () => {
    const { result, editor } = await renameOnPane(flag, `doc-fanout-annot-${slug}`);
    await waitFor(() => {
      expect(result.current.annotations.getAnnotation("smith2021")).toBe("<p>my note</p>");
    });
    expect(result.current.annotations.getAnnotation("smith2020")).toBe("");
    editor.destroy();
  });

  it("moves the entry's BIB-REVIEW rows with it", async () => {
    const { result, editor } = await renameOnPane(flag, `doc-fanout-review-${slug}`);
    await waitFor(() => {
      expect(result.current.bibReview.getRequestStatus("smith2021", "fields")).toBe("pending");
    });
    // No row is left naming the old key for a skill to pick up.
    expect(result.current.bibReview.requests.map((r) => r.bibKey)).toEqual(["smith2021"]);
    editor.destroy();
  });

  it("leaves the citation sidecar refs agreeing with the doc", async () => {
    // The two halves must agree, or the next `syncFromEditor` re-derive picks a
    // winner the user did not choose.
    const { result, editor } = await renameOnPane(flag, `doc-fanout-refs-${slug}`);
    const fromDoc = new Set(allCiteCommands(editor));
    expect([...fromDoc]).toEqual(["\\cite{smith2021}"]);
    expect(result.current.citations.citations.length).toBeGreaterThan(0);
    for (const c of result.current.citations.citations) {
      expect(c.keys).toEqual(["smith2021"]);
      expect(c.command).toBe("\\cite{smith2021}");
    }
    editor.destroy();
  });

  void label;
});
