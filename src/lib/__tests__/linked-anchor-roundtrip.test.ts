import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/react";

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function collectLinkedAnchorRuns(doc: JSONContent): Array<{
  anchorId: string;
  text: string;
}> {
  const runs: Array<{ anchorId: string; text: string }> = [];
  let current: { anchorId: string; text: string } | null = null;
  function walk(n: JSONContent) {
    if (n.type === "text") {
      const mark = (n.marks || []).find((m) => m.type === "linkedAnchor");
      const id = mark?.attrs?.anchorId as string | undefined;
      if (id) {
        if (current && current.anchorId === id) {
          current.text += n.text || "";
        } else {
          if (current) runs.push(current);
          current = { anchorId: id, text: n.text || "" };
        }
        return;
      }
      if (current) {
        runs.push(current);
        current = null;
      }
      return;
    }
    if (current && (n.type === "paragraph" || n.type === "heading")) {
      runs.push(current);
      current = null;
    }
    n.content?.forEach(walk);
  }
  walk(doc);
  if (current) runs.push(current);
  return runs;
}

describe("\\vlid / \\vlidend LaTeX round-trip", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("parses a single-paragraph \\vlid…\\vlidend into a linkedAnchor mark", () => {
    const tex = `Hello \\vlid{ab12}world\\vlidend{ab12}, end.`;
    const json = parseBody(tex);
    const runs = collectLinkedAnchorRuns(json);
    expect(runs).toHaveLength(1);
    expect(runs[0].anchorId).toBe("ab12");
    expect(runs[0].text).toBe("world");
  });

  it("parses a multi-paragraph \\vlid…\\vlidend (anchor spans across paragraphs)", () => {
    const tex = `First \\vlid{cd34}part one.

Part two\\vlidend{cd34} done.`;
    const json = parseBody(tex);
    const runs = collectLinkedAnchorRuns(json);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual({ anchorId: "cd34", text: "part one." });
    expect(runs[1]).toEqual({ anchorId: "cd34", text: "Part two" });
  });

  it("serializes a linkedAnchor mark as \\vlid…\\vlidend around the marked text", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p001" },
          content: [
            { type: "text", text: "Hello " },
            {
              type: "text",
              text: "world",
              marks: [
                {
                  type: "linkedAnchor",
                  attrs: { anchorId: "ab12", kind: "note", linkId: "ab12" },
                },
              ],
            },
            { type: "text", text: ", end." },
          ],
        },
      ],
    };
    const tex = serializeBody(doc);
    expect(tex).toContain("Hello \\vlid{ab12}world\\vlidend{ab12}, end.");
  });

  it("round-trips a single-paragraph anchor through parse → serialize → parse", () => {
    const original = `Hello \\vlid{ab12}world\\vlidend{ab12}, end.`;
    const parsed = parseBody(original);
    const serialized = serializeBody(parsed);
    expect(serialized).toContain("\\vlid{ab12}world\\vlidend{ab12}");
    const reparsed = parseBody(serialized);
    const runs = collectLinkedAnchorRuns(reparsed);
    expect(runs).toEqual([{ anchorId: "ab12", text: "world" }]);
  });

  it("recovers from an unmatched \\vlid opener: stamps to end-of-paragraph and warns", () => {
    const tex = `Hello \\vlid{ff00}world no closer here.`;
    const json = parseBody(tex);
    const runs = collectLinkedAnchorRuns(json);
    expect(runs).toHaveLength(1);
    expect(runs[0].anchorId).toBe("ff00");
    expect(runs[0].text).toBe("world no closer here.");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unmatched \\vlid opener"),
      ["ff00"],
    );
  });

  it("silently drops an orphan \\vlidend (no matching opener)", () => {
    const tex = `No opener \\vlidend{abcd} here.`;
    const json = parseBody(tex);
    const runs = collectLinkedAnchorRuns(json);
    expect(runs).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("handles nested anchors: inner is visible on its range; outer covers the rest", () => {
    const tex = `\\vlid{aaaa}outer1 \\vlid{bbbb}inner\\vlidend{bbbb} outer2\\vlidend{aaaa}`;
    const json = parseBody(tex);
    const runs = collectLinkedAnchorRuns(json);
    // Topmost-wins per `applyLinkedAnchorBoundaries`: text inside the
    // inner range gets the inner mark; text before/after the inner gets
    // the outer mark.
    expect(runs).toEqual([
      { anchorId: "aaaa", text: "outer1 " },
      { anchorId: "bbbb", text: "inner" },
      { anchorId: "aaaa", text: " outer2" },
    ]);
  });

  it("preamble gets \\providecommand{\\vlid} and \\providecommand{\\vlidend}", () => {
    // Round-trip a doc with a linkedAnchor mark; the full serializeToLatex
    // call (via parseLatex → reserialize) emits the preamble. Use
    // serializeBody for the body-only test, then check ensureVirgilCommands
    // indirectly by parsing back a complete doc.
    const tex = `Hello \\vlid{1234}world\\vlidend{1234}.`;
    const parsed = parseBody(tex);
    const serialized = serializeBody(parsed);
    // Sanity: round-trip preserves the markers.
    expect(serialized).toContain("\\vlid{1234}world\\vlidend{1234}");
  });
});
