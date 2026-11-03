/**
 * Tool-gutter rows (task 1440) — every card kind projected to ONE line of
 * text with the jump a click should take.
 */
import { describe, expect, it } from "vitest";
import type { FootnoteInfo, ExampleInfo } from "@/components/Editor";
import type { BibEntry, CitationRef, RevisionCard, TodoItem } from "@/lib/types";
import {
  bibShortLabel,
  bibliographyRows,
  citationRows,
  exampleBodyText,
  exampleRows,
  footnoteRows,
  oneLine,
  readableInline,
  revisionRows,
  rowEntityId,
  todoRows,
} from "../gutter-rows";

const para = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const bib = (key: string, author: string, year: string, title = "T"): BibEntry => ({
  uid: `u-${key}`,
  key,
  type: "book",
  fields: { author, year, title },
  raw: "",
});

const NONE = new Set<string>();

describe("oneLine", () => {
  it("collapses whitespace and never leaves a row blank", () => {
    expect(oneLine("  a\n\n b  ")).toBe("a b");
    expect(oneLine("")).toBe("(empty)");
  });
});

describe("footnoteRows", () => {
  it("orders by number, prefers the title, and reads citations as names", () => {
    const fns = [
      { footnoteId: "b", number: 2, pos: 20, content: para("Later \\citet{smith2001} note") },
      { footnoteId: "a", number: 1, pos: 10, content: para("ignored"), title: "Titled" },
    ] as unknown as FootnoteInfo[];
    const rows = footnoteRows(fns, [bib("smith2001", "Smith, Jane", "2001")]);
    expect(rows.map((r) => [r.marker, r.text])).toEqual([
      ["1", "Titled"],
      ["2", "Later Smith 2001 note"],
    ]);
    expect(rows[0].jump).toEqual({ kind: "footnote", id: "a" });
  });
});

describe("readableInline", () => {
  it("rewrites every cite variant, with options, to short labels", () => {
    const entries = [bib("a", "Ann Lee and Bo Ray", "1999"), bib("b", "{Kant}, Immanuel", "1781")];
    expect(readableInline("see \\citep[p.~2][]{a, b}.", entries)).toBe("see Lee 1999; Kant 1781.");
    expect(readableInline("\\cite{missing}")).toBe("missing");
    expect(readableInline("no commands")).toBe("no commands");
  });
});

describe("exampleRows", () => {
  it("numbers in parentheses and falls back through the example's texts", () => {
    const exs = [
      { exampleId: "e2", number: 2, pos: 5, bodyContent: null, bodyText: "", items: [{ text: "first item", content: null }], preview: "p" },
      { exampleId: "e1", number: 1, pos: 1, bodyContent: para("Body text"), bodyText: "x", items: [], preview: "p" },
    ] as unknown as ExampleInfo[];
    expect(exampleRows(exs).map((r) => [r.marker, r.text])).toEqual([
      ["(1)", "Body text"],
      ["(2)", "first item"],
    ]);
  });
});

describe("exampleBodyText", () => {
  it("reads a glossed example's source tier cell by cell", () => {
    const cell = (t: string) => ({ type: "glossCell", content: [{ type: "text", text: t }] });
    const body = {
      type: "doc",
      content: [
        {
          type: "exampleGloss",
          content: [
            { type: "alignedGlossRow", attrs: { tier: "gla" }, content: [cell("in"), cell("principio"), cell("erat")] },
            { type: "alignedGlossRow", attrs: { tier: "glb" }, content: [cell("in"), cell("fruma"), cell("wæs")] },
            { type: "proseGlossRow", content: [{ type: "text", text: "In the beginning was" }] },
          ],
        },
      ],
    };
    expect(exampleBodyText(body)).toBe("in principio erat");
  });
});

describe("todoRows", () => {
  it("lists open tasks first, leaves archived ones out, and carries the checkbox", () => {
    const t = (id: string, done: boolean, archived = false) =>
      ({ id, text: `task ${id}`, done, archived, notes: "", aiRequest: false, createdAt: "", links: [] }) as TodoItem;
    const rows = todoRows([t("a", true), t("b", false), t("c", false, true), t("d", false)], new Set(["d"]));
    expect(rows.map((r) => r.key)).toEqual(["todo:b", "todo:a"]);
    expect(rows[1]).toMatchObject({ todo: { id: "a", done: true }, muted: true });
    expect(rowEntityId(rows[0])).toBe("b");
  });
});

describe("citationRows / bibliographyRows", () => {
  const entries = [bib("z", "Zed, A", "2010", "{Zeta}"), bib("a", "Abel, B", "1990", "Alpha")];
  const cites = [
    { id: "c2", command: "\\cite{a}", keys: ["a"], createdAt: "" },
    { id: "c1", command: "\\cite{z,a}", keys: ["z", "a"], createdAt: "" },
    { id: "c3", command: "\\cite{a}", keys: ["a"], createdAt: "", unanchored: true },
  ] as CitationRef[];

  it("orders citations by their place in the paper", () => {
    const pos = new Map([["c1", 10], ["c2", 50]]);
    const rows = citationRows(cites, entries, NONE, (id) => pos.get(id));
    expect(rows.map((r) => r.text)).toEqual(["Zed 2010; Abel 1990", "Abel 1990", "Abel 1990"]);
    expect(rows[2].muted).toBe(true);
  });

  it("sorts the bibliography and jumps to an entry's first anchored citation", () => {
    const rows = bibliographyRows(entries, cites);
    expect(rows.map((r) => r.text)).toEqual(["Abel 1990 · Alpha", "Zed 2010 · Zeta"]);
    expect(rows[0].jump).toEqual({ kind: "bib", key: "a", citationId: "c2" });
    expect(bibShortLabel(undefined, "k")).toBe("k");
  });
});

describe("revisionRows", () => {
  it("says a suggestion as original → suggested and dims a settled one", () => {
    const cards = [
      { kind: "comment", id: "r1", text: "Tighten this", content: null, aiRequest: false, createdAt: "", links: [] },
      { kind: "suggestion", id: "r2", original_text: "old", suggested_text: "new", status: "applied", explanation: "", user_text: "", instructions: "", author: "ai", createdAt: "", links: [] },
    ] as unknown as RevisionCard[];
    const rows = revisionRows(cards, NONE);
    expect(rows.map((r) => [r.marker, r.text, !!r.muted])).toEqual([
      ["", "Tighten this", false],
      ["applied", "old → new", true],
    ]);
  });
});
