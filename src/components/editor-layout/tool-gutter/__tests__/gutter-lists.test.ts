/**
 * The reading lists' pure half (Gabriel, 2026-11-08): footnotes grouped under
 * their sections and numbered as the paper does, with the ones that have no
 * place in the text at the end; the bibliography A–Z (as it will print) and as
 * cited (repeats dimmed), both ending in "Needs attention"; examples with their
 * label and how often the paper refers to them.
 */
import { describe, expect, it } from "vitest";
import type { FootnoteInfo, ExampleInfo } from "@/components/Editor";
import type { BibEntry, FootnoteRef, OrphanedFootnote } from "@/lib/types";
import type { HeadingEntry } from "@/lib/tiptap/doc-structure";
import {
  cardListGroups,
  bibliographyGroups,
  exampleGroups,
  footnoteGroups,
  referenceParts,
  sectionIndexAt,
  topSections,
} from "../gutter-lists";

const heading = (pos: number, text: string, level = 2, numbered = true): HeadingEntry => ({
  uuid: `h${pos}`,
  pos,
  level,
  text,
  label: null,
  numbered,
});
const HEADINGS = [
  heading(0, "Introduction"),
  heading(50, "A subsection", 3),
  heading(100, "Acknowledgements", 2, false),
  heading(200, "Method"),
];

const fn = (id: string, number: number, pos: number, extra: Partial<FootnoteInfo> = {}): FootnoteInfo =>
  ({ footnoteId: id, number, pos, content: { type: "doc", content: [] }, ...extra }) as FootnoteInfo;

const bib = (key: string, type: string, fields: Record<string, string>): BibEntry =>
  ({ uid: key, key, type, fields, raw: "" }) as unknown as BibEntry;

describe("sections", () => {
  it("numbers only the top level, skipping unnumbered headings", () => {
    const s = topSections(HEADINGS);
    expect(s.map((x) => [x.text, x.number])).toEqual([
      ["Introduction", "1"],
      ["Acknowledgements", ""],
      ["Method", "2"],
    ]);
    expect(sectionIndexAt(s, 60)).toBe(0);
    expect(sectionIndexAt(s, 250)).toBe(2);
  });
});

describe("footnoteGroups", () => {
  const sections = topSections(HEADINGS);

  it("groups by section in document order and marks as the paper does", () => {
    const groups = footnoteGroups(
      [fn("b", 2, 210), fn("a", 1, 20, { thanks: true }), fn("c", 3, 220, { numberOverride: "9" } as unknown as Partial<FootnoteInfo>)],
      [],
      [],
      sections,
    );
    expect(groups.map((g) => [g.number, g.label, g.rows.map((r) => r.marker)])).toEqual([
      ["1", "Introduction", ["*"]],
      ["2", "Method", ["2", "9"]],
    ]);
  });

  it("puts orphaned and unanchored footnotes in a last group of their own", () => {
    const orphan = { footnoteId: "o", content: {}, orphanedAt: "" } as OrphanedFootnote;
    const ref = { id: "r", content: {}, createdAt: "", unanchored: true } as FootnoteRef;
    const archived = { id: "x", content: {}, createdAt: "", archived: true } as FootnoteRef;
    const groups = footnoteGroups([fn("a", 1, 20)], [orphan], [ref, archived], sections);
    const last = groups[groups.length - 1];
    expect(last.label).toBe("No place in the text");
    expect(last.rows.map((r) => r.card)).toEqual([
      { kind: "orphan", id: "o" },
      { kind: "footnote-ref", id: "r" },
    ]);
    expect(last.rows.every((r) => r.jump === null)).toBe(true);
    const archivedView = footnoteGroups([fn("a", 1, 20)], [orphan], [ref, archived], sections, "archived");
    expect(archivedView.flatMap((g) => g.rows.map((r) => r.entityId))).toEqual(["x"]);
  });
});

describe("bibliography", () => {
  const entries = [
    bib("grafton1997", "article", { author: "Grafton, Anthony", year: "1997", title: "The Footnote", journal: "History and Theory" }),
    bib("bolter2001", "book", { author: "Jay David Bolter", year: "2001", title: "Writing Space", publisher: "Erlbaum" }),
    bib("mckenzie1999", "book", { author: "McKenzie, D. F.", year: "1999", title: "Bibliography" }),
  ];
  const cites = [
    { citationId: "c1", keys: ["grafton1997"], pos: 30 },
    { citationId: "c2", keys: ["bolter2001", "nonexistent2026"], pos: 210 },
    { citationId: "c3", keys: ["grafton1997"], pos: 220 },
  ];
  const sections = topSections(HEADINGS);

  it("formats a reference the way it will print", () => {
    expect(referenceParts(entries[0])).toMatchObject({
      surname: "Grafton",
      rest: "A.",
      year: "1997",
      title: "The Footnote",
      titleStyle: "quoted",
      venue: "History and Theory",
      venueItalic: true,
    });
    expect(referenceParts(entries[1])).toMatchObject({ surname: "Bolter", rest: "J. D.", titleStyle: "italic", venue: "Erlbaum" });
  });

  it("A–Z: letter dividers, a count for repeat citations, then Needs attention", () => {
    const groups = bibliographyGroups(entries, cites, sections, "az");
    expect(groups.map((g) => g.label)).toEqual(["B", "G", "Needs attention"]);
    expect(groups[1].rows[0].count).toBe(2);
    const attention = groups[2].rows;
    expect(attention[0]).toMatchObject({ entityId: "nonexistent2026", missing: true });
    expect(attention[1]).toMatchObject({ entityId: "mckenzie1999", muted: true });
  });

  it("as cited: section groups in citation order, a later use dimmed with ↺", () => {
    const groups = bibliographyGroups(entries, cites, sections, "cited");
    expect(groups.map((g) => g.label)).toEqual(["Introduction", "Method", "Needs attention"]);
    const method = groups[1].rows;
    expect(method.map((r) => [r.entityId, r.marker])).toEqual([
      ["bolter2001", ""],
      ["grafton1997", "↺"],
    ]);
    expect(method[1].repeat).toBe(true);
  });

  it("as cited: one row per entry within a section, with N×; ↺ only across sections", () => {
    const again = [
      ...cites,
      { citationId: "c4", keys: ["bolter2001"], pos: 230 },
      { citationId: "c5", keys: ["bolter2001"], pos: 240 },
    ];
    const method = bibliographyGroups(entries, again, sections, "cited")[1].rows;
    expect(method.map((r) => [r.entityId, r.count, r.repeat])).toEqual([
      ["bolter2001", 3, false],
      ["grafton1997", undefined, true],
    ]);
  });
});

describe("exampleGroups", () => {
  it("shows the label and how often the paper refers to it", () => {
    const ex = (id: string, number: number, label: string) =>
      ({ exampleId: id, number, label, pos: number * 10, items: [] }) as unknown as ExampleInfo;
    const [g] = exampleGroups([ex("e2", 2, ""), ex("e1", 1, "ex:one")], (l) => (l === "ex:one" ? 2 : 0));
    expect(g.rows.map((r) => [r.marker, r.sub])).toEqual([
      ["(1)", "ex:one · referred to 2×"],
      ["(2)", undefined],
    ]);
  });
});

describe("cardListGroups", () => {
  it("opens every row into its omni card, keeps a to-do's box, renders a rich body", () => {
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] };
    const [g] = cardListGroups("notes", [
      { key: "note:n1", marker: "", text: "Body", jump: { kind: "card", slot: "note", card: { id: "n1", content } as never } },
      { key: "todo:t1", marker: "", text: "Do it", todo: { id: "t1", done: false }, jump: { kind: "card", slot: "todo", card: { id: "t1" } as never } },
    ]);
    expect(g.rows.map((r) => r.card)).toEqual([
      { kind: "omni", id: "n1" },
      { kind: "omni", id: "t1" },
    ]);
    expect(g.rows[0].snippet.kind).toBe("rich");
    expect(g.rows[1]).toMatchObject({ snippet: { kind: "text", text: "Do it" }, todo: { id: "t1", done: false } });
  });
});
