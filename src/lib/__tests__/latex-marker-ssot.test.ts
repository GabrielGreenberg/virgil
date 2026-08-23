// Task 255 — the `\v*` id-marker vocabulary has ONE spelling.
//
// The audit finding was a DEAD facet: `TEXT_OBJECT_REGISTRY[kind].sourceMarker`
// declared `vexid`/`vxid`/`vlid` under a header advertising "source-marker
// round-trip", and after task 064 removed its last proxy reader (2026-07-06)
// NOTHING read it. But the interesting half is what deleting it alone would
// have left standing: the round trip carried the SAME tokens as hardcoded
// literals in the serializer (9 emit sites), the parser (7 recognition sites +
// a block-boundary command list), the footnote-body parser/serializer, the
// preamble-requirements shim list, the `.bib` uid regexes and a piece of UI
// copy. Nothing held those copies together. Rename a command in one and Virgil
// emits a document it cannot read — no type error, and (before this suite) no
// failing test, because every round-trip suite spells the token the same way
// the code it tests does.
//
// So the guard is a CENSUS, not a unit test of the SSOT: the module was never
// the part that could misbehave — a call site that spells its own copy is. The
// census is the leg that catches the ORIGINAL shape.
//
// Legs:
//   1. CENSUS      — no file in src/ or library/ spells a marker command in
//                    code (comments are prose and may name them freely).
//   1b. THIRD ROOT — every marker-shaped command the SKILL roots (library/,
//                    editor/) teach an agent to write is still a member of the
//                    vocabulary; markdown cannot import the SSOT, so membership
//                    is the strongest statement available, and it is exactly
//                    the rename hazard.
//   2. CANARY      — the needle demonstrably fires, on a synthetic source and
//                    on the pre-fix form; plus a stripper swallow self-check.
//   3. SHIM WIRING — every marker has a preamble `\providecommand`, in order.
//   4. INLINE SET  — the serializer's reparse guard is the inline-tex subset,
//                    facet-derived, and refuses/admits exactly those.
//   5. ROUND TRIP  — per marker, through the REAL parser + serializer, keyed
//                    on the id union so a new marker is a COMPILE error until
//                    someone states how it survives a save/reload.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { commentsStripped, trackedFiles } from "./_source-scan";
import {
  ALL_VIRGIL_MARKERS,
  BLOCK_TEX_MARKERS,
  emitMarker,
  INLINE_TEX_MARKERS,
  markerArgStart,
  markerOpensAt,
  VIRGIL_MARKER_COMMANDS,
  VIRGIL_MARKERS,
  type VirgilMarkerId,
} from "@/lib/latex-markers";
import { buildPreamble, SHIM_COMMAND_NAMES } from "@/lib/latex-requirements";
import {
  containsInternalMarker,
  INTERNAL_MARKER_COMMANDS,
  serializeBodyOnly,
} from "@/lib/latex-serializer";
import { parseLatex } from "@/lib/latex-parser";
import type { JSONContent } from "@tiptap/react";
import {
  orderedVbidBindings,
  serializeVbidMarker,
  VBID_RE,
} from "@/lib/bib-uid";

const REPO = path.resolve(__dirname, "../../..");
const SILOS = ["src", "library"] as const;

/**
 * Files permitted to spell a marker command by hand, each with WHY. A hit that
 * is not on this list is WIRE-it (read the spelling from `latex-markers.ts`)
 * or DELETE-it — never a new entry unless the bytes are genuinely historical.
 */
const PERMITTED_HAND_SPELLED_MARKERS: Record<string, string> = {
  // FROZEN HISTORICAL BYTES, not a live spelling. `LEGACY_CLASSIC_PREAMBLE_V0`
  // / `_V1` are the exact seed preambles two past build generations wrote into
  // users' style libraries, and the v2 migration gate is EXACT BYTE EQUALITY —
  // deriving them from today's vocabulary would silently seal those libraries
  // out of the upgrade (and they legitimately name only the three markers that
  // existed then). The LIVE seed path already builds from the requirements
  // module.
  "src/lib/style-library.ts": "frozen legacy seed preambles; byte-equality migration gate",
};

/** `vfid|vcid|…` as whole words — the needle. */
const MARKER_NEEDLE = new RegExp(
  `(?<![A-Za-z])(?:${VIRGIL_MARKER_COMMANDS.slice()
    .sort((a, b) => b.length - a.length)
    .join("|")})(?![A-Za-z])`,
);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function censusFiles(): string[] {
  const files: string[] = [];
  for (const silo of SILOS) {
    const root = path.join(REPO, silo);
    if (fs.existsSync(root)) walk(root, files);
  }
  return files
    .map((f) => path.relative(REPO, f))
    .filter((rel) => rel !== "src/lib/latex-markers.ts")
    .sort();
}

describe("marker vocabulary — census (leg 1)", () => {
  const hits = censusFiles().filter((rel) =>
    MARKER_NEEDLE.test(commentsStripped(fs.readFileSync(path.join(REPO, rel), "utf8"))),
  );

  it("nothing outside the SSOT spells a marker command in code", () => {
    const unlisted = hits.filter((h) => !(h in PERMITTED_HAND_SPELLED_MARKERS));
    expect(unlisted).toEqual([]);
  });

  it("the allowlist can only shrink — every entry is still a real hit", () => {
    // A stale exemption is an exemption nobody notices going wrong.
    for (const listed of Object.keys(PERMITTED_HAND_SPELLED_MARKERS)) {
      expect(hits, `${listed} no longer spells a marker — drop its entry`).toContain(listed);
    }
  });

  it("the round-trip layer reads the SSOT rather than its own copy", () => {
    // Positive twin of the census: these files still HANDLE markers, so their
    // silence above must be "derived", not "no longer involved".
    for (const rel of [
      "src/lib/latex-serializer.ts",
      "src/lib/latex-parser.ts",
      "src/lib/latex-requirements.ts",
      "src/lib/bib-uid.ts",
      "src/lib/footnote-content.ts",
    ]) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf8");
      expect(src, rel).toContain("@/lib/latex-markers");
    }
  });
});

describe("marker vocabulary — the third root (leg 1b)", () => {
  // The two-silo habit (src/ + library/) does not reach the AGENT-FACING half:
  // `library/skills/*.md` teaches an indexing agent to write `\vexid{<uuid>}`
  // into a paper, and `editor/`'s Python writers touch the same files Virgil
  // parses. Markdown cannot import the SSOT, so the strongest available
  // statement is MEMBERSHIP: every marker-shaped token those roots spell must
  // be one this vocabulary still knows. That is exactly the rename hazard — a
  // renamed command would leave the skills producing `.tex` Virgil can no
  // longer read, with every TypeScript test green.
  // Scoped to the two SKILL roots on purpose: these are instructions an agent
  // FOLLOWS to produce a `.tex`/`.bib`. `docs/` is deliberately out — a design
  // memo may name a marker that was never built (`\\vlidkind` in the
  // action-menu-anchor diagnosis), and failing CI over a hypothetical would
  // train the next reader to widen the allowlist rather than read the leg.
  const ROOTS = ["library", "editor"];
  const TOKEN = /\\(v[a-z]*id[a-z]*)(?![a-zA-Z])/g;

  // Population = what the repo SHIPS (`trackedFiles`, task 429): `editor/dev/`
  // holds gitignored sandboxes and critique memos that spell marker commands
  // freely, and a disk walk would census them on exactly one machine.
  const proseFiles = (root: string) => trackedFiles(root, /\.(md|py)$/);

  const spelled = new Map<string, string[]>();
  for (const root of ROOTS) {
    for (const f of proseFiles(root)) {
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(TOKEN)) {
        const rel = path.relative(REPO, f);
        const at = spelled.get(m[1]) ?? [];
        if (!at.includes(rel)) at.push(rel);
        spelled.set(m[1], at);
      }
    }
  }

  it("every marker command taught to agents is still in the vocabulary", () => {
    const unknown = [...spelled.entries()]
      .filter(([cmd]) => !VIRGIL_MARKER_COMMANDS.includes(cmd))
      .map(([cmd, files]) => `\\${cmd} (${files.join(", ")})`);
    expect(unknown).toEqual([]);
  });

  it("this leg can see — the skill/doc roots really do spell markers", () => {
    // Without this the leg passes vacuously the day the walk stops finding
    // files, which is the failure mode a membership check invites.
    expect(spelled.size).toBeGreaterThan(3);
  });
});

/** Declaration-shaped lines — the stripper self-check's unit of measure (the
 *  `margin-side-ssot` shape). A declaration cannot live inside a comment, so a
 *  correct comment-stripper preserves every one of them. */
const DECL_RE =
  /^[ \t]*(export[ \t]+)?(default[ \t]+)?(async[ \t]+)?(function|class|interface|type|const|let)[ \t]+[A-Za-z_$]/gm;
const countDecls = (s: string) => (s.match(DECL_RE) ?? []).length;

describe("marker vocabulary — census canary (leg 2)", () => {
  it("the needle fires on a hand-spelled marker, in code and in a literal", () => {
    expect(MARKER_NEEDLE.test(commentsStripped(`const m = "\\\\vfid{" + id;`))).toBe(true);
    expect(MARKER_NEEDLE.test(commentsStripped('const names = ["vlidend", "vlid"];'))).toBe(
      true,
    );
    // The pre-fix parser form, verbatim.
    expect(
      MARKER_NEEDLE.test(commentsStripped(`const m = rest.match(/^\\\\vexid\\{/);`)),
    ).toBe(true);
  });

  it("the needle does NOT fire on a marker merely named in prose", () => {
    expect(
      MARKER_NEEDLE.test(commentsStripped("// \\vfid{uuid} — the footnote marker\nconst x = 1;")),
    ).toBe(false);
  });

  it("a near-miss name is not a marker", () => {
    expect(MARKER_NEEDLE.test("const providevfidx = 1;")).toBe(false);
  });

  it("the stripper does not swallow the files it scans", () => {
    // 202b's runaway (a backtick inside a double-quoted string ate 7 kB
    // silently) is the reason every census that strips carries this check.
    //
    // The measure is the surviving DECLARATION COUNT, not a surviving-BYTES
    // ratio — the shape task 205 settled on, adopted here in task 347 after
    // the ratio form failed for the wrong reason. A ratio conflates the two
    // things it must separate: "the stripper ate a contiguous run of code"
    // (the 202b defect, which drops declarations wholesale) and "this file is
    // heavily commented" (which this repo's own doctrine drives toward, and
    // past, 50%). `latex-serializer.ts` crossed the old 0.5 line by GAINING
    // documentation, so the canary was rewarding thinner comments — the exact
    // opposite of what it is here to protect. Declarations cannot hide inside
    // a comment, so a correct stripper can only ever preserve every one.
    for (const rel of ["src/lib/latex-parser.ts", "src/lib/latex-serializer.ts"]) {
      const raw = fs.readFileSync(path.join(REPO, rel), "utf8");
      const stripped = commentsStripped(raw);
      expect(countDecls(stripped), rel).toBe(countDecls(raw));
      expect(countDecls(raw), rel).toBeGreaterThan(20);
      expect(stripped, rel).toContain("export function");
    }
  });
});

describe("marker vocabulary — shim wiring (leg 3)", () => {
  it("every marker is shimmed, in declaration order", () => {
    expect([...SHIM_COMMAND_NAMES]).toEqual([...VIRGIL_MARKER_COMMANDS]);
    expect(VIRGIL_MARKER_COMMANDS.length).toBe(ALL_VIRGIL_MARKERS.length);
  });

  it("the injected preamble declares a no-op for each", () => {
    const preamble = buildPreamble("\\documentclass{article}");
    for (const m of ALL_VIRGIL_MARKERS) {
      expect(preamble, m.command).toContain(`\\providecommand{${m.macro}}[1]{}`);
    }
  });

  it("the map keys ARE the kind→marker table", () => {
    expect(VIRGIL_MARKERS.exampleBlock.command).toBe("vexid");
    expect(VIRGIL_MARKERS.exampleItem.command).toBe("vxid");
    expect(VIRGIL_MARKERS.linkedRangeOpen.command).toBe("vlid");
    expect(VIRGIL_MARKERS.linkedRangeClose.command).toBe("vlidend");
    expect(VIRGIL_MARKERS.footnote.command).toBe("vfid");
    expect(VIRGIL_MARKERS.citation.command).toBe("vcid");
    expect(VIRGIL_MARKERS.bibEntry.command).toBe("vbid");
  });
});

describe("marker vocabulary — inline reparse guard (leg 4)", () => {
  it("the guard set is the inline-tex subset, derived from the facets", () => {
    expect([...INTERNAL_MARKER_COMMANDS]).toEqual(INLINE_TEX_MARKERS.map((m) => m.command));
    expect(INTERNAL_MARKER_COMMANDS).toContain("vlid");
    expect(INTERNAL_MARKER_COMMANDS).toContain("vfid");
  });

  it("longest-first, so `\\vlidend` can never be matched as `\\vlid`", () => {
    const lens = INLINE_TEX_MARKERS.map((m) => m.command.length);
    expect([...lens].sort((a, b) => b - a)).toEqual(lens);
  });

  it("refuses text carrying any inline marker", () => {
    for (const m of INLINE_TEX_MARKERS) {
      expect(containsInternalMarker(`before ${emitMarker(m, "ab12")} after`), m.command).toBe(
        true,
      );
    }
  });

  it("admits block/bib markers — deliberately, and this pins that choice", () => {
    // The guard protects a splice into INLINE content, which is the only place
    // these could mint a phantom atom. A `\vexid` in a suggestion body is inert
    // text. Stated here so a future reader sees a decision, not an omission.
    for (const m of [...BLOCK_TEX_MARKERS, VIRGIL_MARKERS.bibEntry]) {
      expect(containsInternalMarker(emitMarker(m, "ab12")), m.command).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Leg 5 — per-marker round trip through the REAL parser/serializer.
// ---------------------------------------------------------------------------

function parseBody(input: string): JSONContent {
  return parseLatex(`\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`);
}

function findNode(doc: JSONContent, type: string): JSONContent | null {
  let found: JSONContent | null = null;
  const walkDoc = (n: JSONContent) => {
    if (found) return;
    if (n.type === type) {
      found = n;
      return;
    }
    n.content?.forEach(walkDoc);
  };
  walkDoc(doc);
  return found;
}

function findMark(doc: JSONContent, type: string): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  const walkDoc = (n: JSONContent) => {
    if (found) return;
    const m = (n.marks || []).find((mk) => mk.type === type);
    if (m) {
      found = (m.attrs || {}) as Record<string, unknown>;
      return;
    }
    n.content?.forEach(walkDoc);
  };
  walkDoc(doc);
  return found;
}

/** Concatenated text of every node carrying `type` — so a leg can assert where
 *  a range STOPS, not merely that it started. */
function markedText(doc: JSONContent, type: string): string {
  let out = "";
  const walkDoc = (n: JSONContent) => {
    if (n.type === "text" && (n.marks || []).some((mk) => mk.type === type)) {
      out += n.text || "";
    }
    n.content?.forEach(walkDoc);
  };
  walkDoc(doc);
  return out;
}

/**
 * A marker earns its place by SURVIVING a save→reload, so each one states its
 * own witness. Keyed on `VirgilMarkerId`, so adding a marker to the vocabulary
 * without stating how it round-trips does not typecheck.
 */
const ROUND_TRIP: Record<VirgilMarkerId, () => void> = {
  footnote: () => {
    const m = VIRGIL_MARKERS.footnote;
    const doc = parseBody(`Text${emitMarker(m, "ab12")}\\footnote{Body}.`);
    expect(findNode(doc, "footnote")?.attrs?.footnoteId).toBe("ab12");
    expect(serializeBodyOnly(doc)).toContain(emitMarker(m, "ab12"));
  },
  citation: () => {
    const m = VIRGIL_MARKERS.citation;
    const doc = parseBody(`See ${emitMarker(m, "cd34")}\\citep{smith2020}.`);
    expect(findNode(doc, "citation")?.attrs?.citationId).toBe("cd34");
    expect(serializeBodyOnly(doc)).toContain(emitMarker(m, "cd34"));
  },
  exampleBlock: () => {
    const m = VIRGIL_MARKERS.exampleBlock;
    const doc = parseBody(`${emitMarker(m, "ef56")}\\ex\nA sentence.\n\\xe`);
    expect(findNode(doc, "exampleBlock")?.attrs?.uuid).toBe("ef56");
    expect(serializeBodyOnly(doc)).toContain(emitMarker(m, "ef56"));
  },
  exampleItem: () => {
    const block = VIRGIL_MARKERS.exampleBlock;
    const m = VIRGIL_MARKERS.exampleItem;
    const doc = parseBody(
      `${emitMarker(block, "aa11")}\\pex\n${emitMarker(m, "bb22")}\\a First item.\n\\xe`,
    );
    expect(findNode(doc, "exampleItem")?.attrs?.uuid).toBe("bb22");
    expect(serializeBodyOnly(doc)).toContain(emitMarker(m, "bb22"));
  },
  linkedRangeOpen: () => {
    const open = VIRGIL_MARKERS.linkedRangeOpen;
    const close = VIRGIL_MARKERS.linkedRangeClose;
    const doc = parseBody(`Hello ${emitMarker(open, "cc33")}world${emitMarker(close, "cc33")}.`);
    expect(findMark(doc, "linkedAnchor")?.anchorId).toBe("cc33");
    expect(serializeBodyOnly(doc)).toContain(emitMarker(open, "cc33"));
  },
  linkedRangeClose: () => {
    const open = VIRGIL_MARKERS.linkedRangeOpen;
    const close = VIRGIL_MARKERS.linkedRangeClose;
    const doc = parseBody(
      `Hello ${emitMarker(open, "dd44")}world${emitMarker(close, "dd44")} tail.`,
    );
    // The mark must STOP at the close. Asserting only that the serializer
    // re-emits `\\vlidend` would pass on a parser that ignored the token
    // entirely, because `serializeInlineSequence` auto-closes every anchor
    // still open at the end of a block — so the emit half is over-determined
    // and the parse half is what this leg has to witness.
    expect(markedText(doc, "linkedAnchor")).toBe("world");
    expect(serializeBodyOnly(doc)).toContain(emitMarker(close, "dd44"));
  },
  bibEntry: () => {
    // The one marker that lives in the `.bib`: its own writer/reader pair.
    const marker = serializeVbidMarker("ee55");
    expect(marker).toBe(emitMarker(VIRGIL_MARKERS.bibEntry, "ee55"));
    expect(marker.match(VBID_RE)?.[1]).toBe("ee55");
    const bib = `${marker}\n@article{smith2020,\n  title = {T},\n}\n`;
    expect(orderedVbidBindings(bib).map((b) => b.uid)).toEqual(["ee55"]);
  },
};

describe("marker vocabulary — round trip (leg 5)", () => {
  for (const id of Object.keys(ROUND_TRIP) as VirgilMarkerId[]) {
    it(`${id} (\\${VIRGIL_MARKERS[id].command}) survives a save→reload`, () => {
      ROUND_TRIP[id]();
    });
  }

  it("a block-position marker at a line head still breaks the paragraph", () => {
    // The parser's block-boundary command list is built from the SSOT. If a
    // block marker fell out of it, the marker would be absorbed as paragraph
    // TEXT and re-emitted verbatim on the next save — one stray marker per
    // round trip, growing forever.
    const m = VIRGIL_MARKERS.exampleBlock;
    const doc = parseBody(`A paragraph.\n${emitMarker(m, "ff66")}\\ex\nAn example.\n\\xe`);
    const para = doc.content?.[0];
    expect(para?.type).toBe("paragraph");
    expect(JSON.stringify(para)).not.toContain(m.command);
    expect(findNode(doc, "exampleBlock")?.attrs?.uuid).toBe("ff66");
  });

  it("the parse helpers agree with the emit helper", () => {
    const m = VIRGIL_MARKERS.exampleItem;
    const src = `xx${emitMarker(m, "9999")}yy`;
    expect(markerOpensAt(src, 2, m)).toBe(true);
    expect(markerOpensAt(src, 0, m)).toBe(false);
    expect(src.slice(markerArgStart(2, m))).toBe("{9999}yy");
  });
});
