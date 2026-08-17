/**
 * Task 348 — a `%!v:` anchor is APPENDED where it is DETACHED.
 *
 * The `listItem` was the one block emitter whose anchor position disagreed with
 * the reader's. Emit put it at the end of the item's HEAD LINE and let tail
 * children (a nested list, a second paragraph) follow beneath it; the reader
 * took the anchor from the end of the whole item SLICE. For a tail-bearing item
 * those are different places, so the item took whatever uuid sat at the end of
 * its slice — for a nested list, its own CHILD's — and the child was re-minted
 * as a duplicate. It never converged: each save shuffled again, on a document
 * nobody was editing, orphaning every note / todo / archive / marginalia card
 * anchored to that item or that sub-list.
 *
 * **The shape of this suite is why the pre-fix tree was green.** Every existing
 * list round-trip suite spells its fixtures with SINGLE-paragraph items, where
 * the head line IS the slice end and the two positions coincide by accident.
 * So the disagreement was unrepresentable in all of them. Each leg here runs the
 * REAL `parseLatex` → `assignUuids` → `serializeBodyOnly` pipeline over FOUR
 * cycles, because a single round trip looks perfect for the two-paragraph shape
 * and merely *starts* the shuffle for the nested one — with the simple item and
 * a wrapped item kept as passing CONTROLS so no leg can pass vacuously.
 *
 * The second half of the same defect is structural rather than identity-shaped:
 * the head was separated from the tail by ONE newline, which does not end a
 * paragraph, so an item with a second paragraph came back MERGED into one on the
 * next open — the user's paragraph break destroyed with no edit.
 *
 * Measured by neutering each half in turn: the PRE-FIX pair (emit at the head,
 * read at the slice end) takes 10 legs, the separator 2, the upgrade branch 3.
 * The emit position ALONE takes only 1 behavioural leg — the wrapped head with
 * a tail — and that is worth knowing rather than hiding: the upgrade branch is
 * a fully general reader for a SINGLE-LINE head, so it masks a reverted emit
 * everywhere except the shape where "which line is the head's last?" cannot be
 * guessed. That shape is in `SHAPES` precisely to keep the emit rule honest.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { JSONContent } from "@tiptap/core";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly, assignUuids } from "@/lib/latex-serializer";
import {
  appendUuidAnchor,
  detachUuidAnchor,
  detachItemAnchor,
  uuidAnchorSuffix,
  uuidAnchorToken,
} from "@/lib/uuid";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

const REPO = path.resolve(__dirname, "../../..");

/** One save/load cycle: parse the body, mint uuids, serialize it back. */
function cycle(body: string): { body: string; doc: JSONContent } {
  const doc = parseLatex(`\\begin{document}\n\n${body}\n\n\\end{document}\n`);
  assignUuids(doc);
  return { body: serializeBodyOnly(doc), doc };
}

function cycles(body: string, n: number): { body: string; doc: JSONContent }[] {
  const out: { body: string; doc: JSONContent }[] = [];
  let cur = body;
  for (let i = 0; i < n; i++) {
    const r = cycle(cur);
    out.push(r);
    cur = r.body;
  }
  return out;
}

/**
 * Every uuid in the document, keyed by STRUCTURAL PATH
 * (`bulletList/0/bulletList` …). Keying on the path rather than on document
 * order is what makes "the item stole its child's id" legible: with the paths
 * fixed, a swap shows up as two changed values, and a re-mint as one.
 */
function anchorsByPath(doc: JSONContent): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: JSONContent, prefix: string) => {
    const here = prefix ? `${prefix}/${node.type}` : (node.type ?? "?");
    const uuid = node.attrs?.uuid as string | undefined;
    if (uuid) out[here] = uuid;
    (node.content ?? []).forEach((child, i) => walk(child, `${here}/${i}`));
  };
  (doc.content ?? []).forEach((n, i) => walk(n, String(i)));
  return out;
}

/** The first `listItem`'s child node types — the paragraph-merge probe. */
function firstItemChildTypes(doc: JSONContent): string[] {
  let found: string[] | null = null;
  const walk = (node: JSONContent) => {
    if (found) return;
    if (node.type === "listItem") {
      found = (node.content ?? []).map((c) => c.type ?? "?");
      return;
    }
    (node.content ?? []).forEach(walk);
  };
  (doc.content ?? []).forEach(walk);
  return found ?? [];
}

// ---------------------------------------------------------------------------
// Leg 1 — identity and bytes are a FIXED POINT, per item shape
// ---------------------------------------------------------------------------

const SHAPES: { name: string; body: string; control?: true }[] = [
  {
    name: "simple item (CONTROL — head line IS the slice end)",
    body: "\\begin{itemize}\n  \\item One.\n\\end{itemize}",
    control: true,
  },
  {
    name: "wrapped single-paragraph item (CONTROL — head spans two lines)",
    body:
      "\\begin{itemize}\n  \\item This is a long item that wraps\n" +
      "  across two lines.\n\\end{itemize}",
    control: true,
  },
  {
    name: "item with a NESTED LIST",
    body:
      "\\begin{itemize}\n  \\item Head.\n    \\begin{itemize}\n" +
      "      \\item inner\n    \\end{itemize}\n\\end{itemize}",
  },
  {
    name: "item with a SECOND PARAGRAPH",
    body:
      "\\begin{itemize}\n  \\item First para.\n\n" +
      "  Second para of same item.\n\\end{itemize}",
  },
  {
    name: "item with an \\item[label] AND a nested list (task 340's argument)",
    body:
      "\\begin{itemize}\n  \\item[(a)] Head.\n    \\begin{itemize}\n" +
      "      \\item inner\n    \\end{itemize}\n\\end{itemize}",
  },
  {
    name: "DEEP 3-level nesting",
    body:
      "\\begin{itemize}\n  \\item L1.\n    \\begin{itemize}\n" +
      "      \\item L2.\n        \\begin{itemize}\n          \\item L3\n" +
      "        \\end{itemize}\n    \\end{itemize}\n\\end{itemize}",
  },
  {
    // The shape that makes the EMIT position load-bearing rather than merely
    // tidy. With the anchor back on the head, the reader can only find it by
    // guessing where the head ends — and a head that wrapped across lines puts
    // it on the head's LAST line, indistinguishable from a child's. The
    // upgrade branch's first-line signature deliberately does not reach here
    // (it is a stated gap), so this is the leg that fails when the anchor is
    // written anywhere but the end of the item's body.
    name: "item with a WRAPPED head AND a nested list",
    body:
      "\\begin{itemize}\n  \\item This head wraps\n  across two lines.\n" +
      "    \\begin{itemize}\n      \\item inner\n    \\end{itemize}\n" +
      "\\end{itemize}",
  },
  {
    name: "item whose tail is an ordered list",
    body:
      "\\begin{enumerate}\n  \\item Head.\n    \\begin{enumerate}\n" +
      "      \\item inner\n    \\end{enumerate}\n\\end{enumerate}",
  },
];

describe("a list item's %!v: anchor is a fixed point (task 348)", () => {
  for (const shape of SHAPES) {
    it(`${shape.name} — bytes and EVERY uuid are unchanged across 4 saves`, () => {
      const runs = cycles(shape.body, 4);

      // Bytes settle on the first save and never move again. The pre-fix
      // nested/deep shapes moved on EVERY save (non-converging), which is the
      // property that distinguishes this defect from the rest of its class.
      for (let i = 1; i < runs.length; i++) {
        expect(runs[i].body, `save ${i + 1} differs from save 1`).toBe(
          runs[0].body,
        );
      }

      // Every anchor, at every structural path, is the SAME id it was after
      // the first save. A steal shows as two changed paths; a re-mint as one.
      const first = anchorsByPath(runs[0].doc);
      expect(Object.keys(first).length).toBeGreaterThan(1);
      for (let i = 1; i < runs.length; i++) {
        expect(anchorsByPath(runs[i].doc), `save ${i + 1}`).toEqual(first);
      }

      // No id is ever shared by two nodes — the "child re-minted as a
      // duplicate" half, asserted directly rather than inferred.
      const ids = Object.values(first);
      expect(new Set(ids).size).toBe(ids.length);

      // Virgil's own marker never reaches the text as escaped prose.
      expect(runs[0].body).not.toContain("\\%!v:");
    });
  }

  it("an item's second PARAGRAPH survives the round trip as its own block", () => {
    const body =
      "\\begin{itemize}\n  \\item First para.\n\n" +
      "  Second para of same item.\n\\end{itemize}";
    const runs = cycles(body, 4);
    // Pre-fix the single `\n` separator merged the two into one paragraph on
    // the FIRST reparse — the user's paragraph break destroyed, silently.
    for (const r of runs) {
      expect(firstItemChildTypes(r.doc)).toEqual(["paragraph", "paragraph"]);
    }
  });

  it("a nested list keeps a single newline before it — bytes unchanged", () => {
    // The separator is derived from the parser's OWN boundary vocabulary, so a
    // self-delimiting `\begin{itemize}` needs no blank line and every existing
    // document's nested lists reformat by nothing at all.
    const { body } = cycle(
      "\\begin{itemize}\n  \\item Head.\n    \\begin{itemize}\n" +
        "      \\item inner\n    \\end{itemize}\n\\end{itemize}",
    );
    expect(body).toContain("\\item Head.\n  \\begin{itemize}");
    expect(body).not.toContain("\\item Head.\n\n");
  });
});

// ---------------------------------------------------------------------------
// Leg 2 — the UPGRADE: a pre-348 document keeps its identities
// ---------------------------------------------------------------------------

describe("pre-348 on-disk shapes keep their identities (task 348)", () => {
  it("a legacy nested item keeps its own uuid AND its child's", () => {
    // Exactly what a pre-348 build wrote: the item's anchor at the end of its
    // head line, the nested list's after its own `\end{itemize}`.
    const legacy =
      "\\begin{itemize}\n  \\item Head. %!v:0bc7\n  \\begin{itemize}\n" +
      "    \\item inner %!v:cc01\n  \\end{itemize} %!v:8cde\n" +
      "\\end{itemize} %!v:4b2b";
    const runs = cycles(legacy, 3);
    const ids = anchorsByPath(runs[0].doc);
    // Reading with the new rule ALONE would take `8cde` for the item (the
    // slice-end anchor — its child's), shuffling identity one more time on the
    // upgrade save. Every one of these four ids survives.
    expect(new Set(Object.values(ids))).toEqual(
      new Set(["0bc7", "cc01", "8cde", "4b2b"]),
    );
    for (let i = 1; i < runs.length; i++) {
      expect(anchorsByPath(runs[i].doc)).toEqual(ids);
      expect(runs[i].body).toBe(runs[0].body);
    }
  });

  it("a legacy two-paragraph item keeps its own uuid", () => {
    const legacy =
      "\\begin{itemize}\n  \\item First para. %!v:9148\n" +
      "Second para of same item.\n\\end{itemize} %!v:aaaa";
    const runs = cycles(legacy, 3);
    expect(new Set(Object.values(anchorsByPath(runs[0].doc)))).toContain("9148");
    expect(runs[1].body).toBe(runs[0].body);
  });
});

// ---------------------------------------------------------------------------
// Leg 3 — the pair itself: append and detach are exact inverses
// ---------------------------------------------------------------------------

describe("appendUuidAnchor / detachUuidAnchor are inverses", () => {
  const BODIES = [
    "One.",
    "Head.\n  \\begin{itemize}\n    \\item inner\n  \\end{itemize}",
    "First para.\n\nSecond para.",
    "A line ending in a user comment % note",
    "",
  ];

  for (const body of BODIES) {
    it(`detach(append(${JSON.stringify(body.slice(0, 24))})) === identity`, () => {
      const got = detachUuidAnchor(appendUuidAnchor(body, "ab12"));
      expect(got).toEqual({ text: body, uuid: "ab12" });
    });
  }

  it("takes exactly ONE anchor — the LAST — so a stacked child anchor survives", () => {
    // This is what makes the item's anchor safe on a line that already carries
    // its last child's. The block-level `stripUuidAnchor` consumes a whole run
    // and would destroy the child's id here.
    const stacked = appendUuidAnchor("  \\end{itemize} %!v:cc01", "8cde");
    expect(stacked).toBe("  \\end{itemize} %!v:cc01 %!v:8cde");
    expect(detachUuidAnchor(stacked)).toEqual({
      text: "  \\end{itemize} %!v:cc01",
      uuid: "8cde",
    });
  });

  it("carries a user comment REMAINDER back as content (task 347's rule)", () => {
    expect(detachUuidAnchor("Head. %!v:aaaa % my note")).toEqual({
      text: "Head. % my note",
      uuid: "aaaa",
    });
  });

  it("does not mistake a trailing \\url{…%20…} for an anchor", () => {
    const s = "See \\url{http://ex.com/a%20b}";
    expect(detachUuidAnchor(s)).toEqual({ text: s, uuid: null });
  });

  it("uuidAnchorSuffix is exactly what appendUuidAnchor appends", () => {
    expect(appendUuidAnchor("x", "ab12")).toBe("x" + uuidAnchorSuffix("ab12"));
    expect(uuidAnchorSuffix(null)).toBe("");
    expect(uuidAnchorToken("ab12")).toBe("%!v:ab12");
  });

  it("detachItemAnchor prefers the legacy HEAD LINE only when there is a tail", () => {
    // Legacy: first line carries an anchor and more lines follow.
    expect(
      detachItemAnchor("Head. %!v:0bc7\n  \\begin{itemize}\n  \\end{itemize} %!v:8cde"),
    ).toEqual({
      text: "Head.\n  \\begin{itemize}\n  \\end{itemize} %!v:8cde",
      uuid: "0bc7",
    });
    // Current shape: the first line is the head's prose, so the slice end wins.
    expect(
      detachItemAnchor("Head.\n  \\begin{itemize}\n  \\end{itemize} %!v:cc01 %!v:8cde"),
    ).toEqual({
      text: "Head.\n  \\begin{itemize}\n  \\end{itemize} %!v:cc01",
      uuid: "8cde",
    });
    // Single-line item: there is no second line, so the legacy branch is
    // unreachable and the ordinary detach answers.
    expect(detachItemAnchor("One. %!v:747c")).toEqual({
      text: "One.",
      uuid: "747c",
    });
  });
});

// ---------------------------------------------------------------------------
// Leg 4 — the CENSUS: the anchor's emit form is spelled ONCE
// ---------------------------------------------------------------------------
//
// The pair was never the part that could misbehave — an emitter that spells its
// own `%!v:` template is, and that is exactly what shipped: fifteen hand-built
// anchor strings, one of which (the list item's) put it somewhere the reader
// does not look. No behavioural test of `appendUuidAnchor` can see that.
//
// Scope, stated: this censuses the EMIT form (a `%!v:` immediately followed by
// an interpolation, plus the `%!v:blank` sentinel). The READ side still has
// several private regexes (`stripUuidAnchor`, `latex-paragraph-map`, the two
// preamble helpers) which answer differently-shaped questions; unifying those
// is a separate sweep and is deliberately not claimed here.

function productionFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__") continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  walk(path.join(REPO, root));
  return out;
}

/**
 * `%!v:` followed by an interpolation, or the emitted `%!v:blank` LINE.
 *
 * The blank sentinel needs its trailing `\n` in the needle: the parser
 * legitimately READS it (`rest.startsWith("%!v:blank")`), and a read is not a
 * second spelling of the emit position — it is the other half of the same
 * question, guarded by the round-trip legs above.
 */
const HAND_BUILT_ANCHOR = /%!v:(\$\{|blank\\n)/;

describe("census — nothing spells a %!v: anchor EMIT by hand", () => {
  it("no production file outside uuid.ts builds an anchor string", () => {
    const hits: string[] = [];
    for (const root of ["src", "library"]) {
      for (const file of productionFiles(root)) {
        const rel = path.relative(REPO, file);
        if (rel === "src/lib/uuid.ts") continue;
        // Literals are KEPT (the drift lives in template literals); only
        // comments are stripped, since the anchor is discussed in prose in
        // dozens of files that emit nothing.
        // The stripper DROPS comment bytes rather than blanking them, so a
        // line NUMBER taken from its output drifts. Report the matched line's
        // text instead — which is what a reader has to act on anyway.
        const src = commentsStripped(fs.readFileSync(file, "utf8"));
        for (const line of src.split("\n")) {
          if (HAND_BUILT_ANCHOR.test(line)) hits.push(`${rel} · ${line.trim()}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("the census can SEE a hand-built anchor (canary)", () => {
    // Synthetic, not one of the lines the fix drained — a canary standing on
    // the defect evaporates the moment the defect is fixed.
    const uuid = "x";
    const fixture = [
      "const anchor = uuid ? ` %!v:${uuid}` : \"\";",
      'return `%!v:${uuid}\\n`;',
      'return "%!v:blank\\n";',
    ];
    void uuid;
    for (const line of fixture) expect(HAND_BUILT_ANCHOR.test(line)).toBe(true);
    // …and does not fire on the shapes that are legitimately not emits.
    expect(HAND_BUILT_ANCHOR.test('rest.startsWith("%!v:")')).toBe(false);
    expect(HAND_BUILT_ANCHOR.test('rest.startsWith("%!v:blank")')).toBe(false);
    expect(HAND_BUILT_ANCHOR.test("/%!v:([0-9a-f]{4})/")).toBe(false);
  });

  it("the parser carries no private list-item anchor regex", () => {
    const src = commentsStripped(
      fs.readFileSync(path.join(REPO, "src/lib/latex-parser.ts"), "utf8"),
    );
    // The pre-348 `ITEM_TRAILING_UUID_REGEX` — a second, independently-anchored
    // statement of where an item's marker lives. `parseList` asks the shared
    // door instead.
    expect(src).not.toContain("ITEM_TRAILING_UUID_REGEX");
    expect(src).toContain("detachItemAnchor(slice.text)");
  });

  it("the serializer derives its item separator from the parser's boundary rule", () => {
    const src = commentsStripped(
      fs.readFileSync(path.join(REPO, "src/lib/latex-serializer.ts"), "utf8"),
    );
    // Not a hand list of self-delimiting child kinds (the shape that goes
    // stale) — the lexer predicate `readParagraph` itself reads.
    expect(src).toContain("startsBlockBoundary(");
    expect(src).toContain("appendUuidAnchor(body, uuid)");
  });

  it("the boundary predicate has exactly one declaration, in the lexer", () => {
    const decls: string[] = [];
    for (const root of ["src", "library"]) {
      for (const file of productionFiles(root)) {
        const src = commentsStripped(fs.readFileSync(file, "utf8"));
        if (/BLOCK_BOUNDARY_COMMAND_RE\s*=/.test(src)) {
          decls.push(path.relative(REPO, file));
        }
      }
    }
    expect(decls).toEqual(["src/lib/latex-lexer.ts"]);
  });
});
