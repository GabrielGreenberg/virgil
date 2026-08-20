// Task 345 — a raw-passthrough block's package DECLARATION is a byte SCAN, so
// it is a DETECTOR, and a detector believes only LIVE bytes.
//
// `declareFromRawLatex` is the one emit-site declaration that scans
// user-authored bytes rather than reading Virgil's own emit: a `texBlock`'s
// `code` and a `figureBlock`'s `extras` are raw LaTeX the editor does not
// model, so the emitter has no idea what they mean and has to look. It looked
// at the RAW string. Its sibling `detectBodyRequirements` asks the same
// question about the same vocabulary and projects first — and
// `assembleLatex` UNIONs the two ("the two never subtract"), so the
// unprojected declaration always won.
//
// Measured at HEAD 0e7f4e60, driving the real `serializeToLatex`:
//
//   A  a fully commented-out tikz + \includegraphics block  → tikz + graphicx
//   B  a paragraph EXPLAINING expex inside \begin{verbatim} → expex + a
//      \newenvironment{xlist} macro written into the preamble
//   D  figure extras with a commented-out \includegraphics  → graphicx
//
// D is the everyday one: commenting an old figure path out while trying a new
// one is ordinary editing, and a raw-passthrough block is precisely where a
// user parks LaTeX they are NOT currently running. B is the worst outcome —
// Virgil defines a macro in the preamble on the strength of prose ABOUT expex,
// which collides with any real `xlist` the document or a package later defines.
// Injecting packages a document never runs can BREAK a previously compiling
// paper, which is the reason the requirements side has projected since P4.
//
// CONTROLS: two live fixtures (C, a tikzpicture in a texBlock; D', a live
// \includegraphics in figure extras) plus the per-member sweep, which supplies
// the live half for every id including expex and xlistenv — without them every
// "declares nothing" leg here passes when the vocabulary is simply broken.
//
// The leg with teeth is the CENSUS, swept over BOTH silos. The declaration
// function was never the part that could misbehave — a caller handing it raw
// bytes is, and so is a SECOND scanner spelling its own copy of the vocabulary
// anywhere. Both are invisible to any behavioural test of this function.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { JSONContent } from "@tiptap/react";
import { codeOnly } from "./_source-scan";
import {
  serializeToLatex,
  serializeTopLevelBlock,
} from "@/lib/latex-serializer";
import { detectBodyRequirements } from "@/lib/latex-requirements";
import { PACKAGE_DETECTORS } from "@/lib/latex-requirement-collector";

// ---------------------------------------------------------------------------
// Fixtures — real documents through the real serializer
// ---------------------------------------------------------------------------

function texBlock(code: string): JSONContent {
  return { type: "texBlock", attrs: { uuid: "aaaa", code } };
}

function texDoc(code: string): JSONContent {
  return { type: "doc", content: [texBlock(code)] };
}

/** The other half of "inert": bytes the compiler prints rather than runs. */
function verbatimQuoted(code: string): string {
  return `Explaining it:\n\\begin{verbatim}\n${code}\n\\end{verbatim}`;
}

function figDoc(extras: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "figureBlock",
        attrs: { uuid: "bbbb", extras, placement: "h", label: "" },
        content: [
          {
            type: "figureCaption",
            content: [{ type: "text", text: "A caption." }],
          },
        ],
      },
    ],
  };
}

// A BARE preamble, because `CLASSIC_PREAMBLE` already ships graphicx / xcolor /
// natbib / expex: against the default seed "did this inject a package?" has no
// observable answer at all.
const BARE_PREAMBLE = "\\documentclass{article}\n\\begin{document}\n";

function serialize(doc: JSONContent): string {
  return serializeToLatex(doc, { preamble: BARE_PREAMBLE });
}

/** Did the requirements pass write `id`'s line into the preamble? */
function injects(latex: string, id: string): boolean {
  const preamble = latex.split("\\begin{document}")[0] ?? "";
  return id === "xlistenv"
    ? /\\newenvironment\{xlist\}/.test(preamble)
    : new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{[^}]*\\b${id}\\b`).test(
        preamble,
      );
}

/** The requirement ids ONE block's emit-sites declared — the declaration
 *  itself, read without the preamble pass's always-required floor (`xcolor`
 *  and the marker shims ship unconditionally, so for those the injected bytes
 *  have no observable answer). */
function declared(node: JSONContent): string[] {
  return [...serializeTopLevelBlock(node).requirementIds].sort();
}

// The live control. Its package must be injected before AND after the fix, or
// every "declares nothing" assertion below is satisfied by a dead vocabulary.
const LIVE_TIKZ = "\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}";

describe("raw passthrough declares only from LIVE bytes", () => {
  it("control C — a live tikzpicture in a texBlock still injects tikz", () => {
    expect(injects(serialize(texDoc(LIVE_TIKZ)), "tikz")).toBe(true);
  });

  it("A — a fully commented-out tikz + \\includegraphics block injects nothing", () => {
    const out = serialize(
      texDoc(
        "% \\begin{tikzpicture}\n" +
          "%   \\includegraphics{fig.png}\n" +
          "% \\end{tikzpicture}\n" +
          "\\textbf{live text}",
      ),
    );
    expect(injects(out, "tikz")).toBe(false);
    expect(injects(out, "graphicx")).toBe(false);
    // The bytes themselves still round-trip: this is a DECLARATION fix, never
    // a content one — the commented block is still written to the `.tex`.
    expect(out).toContain("% \\begin{tikzpicture}");
  });

  it("B — expex quoted inside \\begin{verbatim} injects neither expex nor the xlist shim", () => {
    const out = serialize(
      texDoc(
        "Here is how expex nesting looks:\n" +
          "\\begin{verbatim}\n" +
          "\\begin{xlist}\n" +
          "\\a one\n" +
          "\\end{xlist}\n" +
          "\\end{verbatim}",
      ),
    );
    expect(injects(out, "expex")).toBe(false);
    expect(injects(out, "xlistenv")).toBe(false);
  });

  it("D — figure extras with a commented-out \\includegraphics injects nothing", () => {
    const out = serialize(
      figDoc("\\centering\n% \\includegraphics[width=3cm]{old.png}"),
    );
    expect(injects(out, "graphicx")).toBe(false);
    expect(out).toContain("% \\includegraphics[width=3cm]{old.png}");
  });

  it("control D' — figure extras with a LIVE \\includegraphics still injects graphicx", () => {
    const out = serialize(
      figDoc("\\centering\n\\includegraphics[width=3cm]{new.png}"),
    );
    expect(injects(out, "graphicx")).toBe(true);
  });

  it("declaration and detection now agree on the SAME raw bytes, per vocabulary member", () => {
    // The property the fix establishes, swept from the SSOT rather than
    // enumerated: for every package in the shared vocabulary, an INERT
    // occurrence inside a texBlock declares exactly what the projected
    // fallback detector would say about the same string — nothing — and a LIVE
    // one declares exactly what it would say. Before the fix the two answered
    // from opposite premises and the union let the declaration win.
    for (const d of PACKAGE_DETECTORS) {
      const live = SAMPLE_FOR[d.id];
      for (const inert of [`% ${live}`, verbatimQuoted(live)]) {
        expect(
          [...detectBodyRequirements(inert)],
          `detector on inert ${d.id}`,
        ).toEqual([]);
        expect(
          declared(texBlock(inert)),
          `declaration on inert ${d.id}`,
        ).toEqual([]);
      }

      expect(
        [...detectBodyRequirements(live)],
        `detector on live ${d.id}`,
      ).toContain(d.id);
      expect(declared(texBlock(live)), `declaration on live ${d.id}`).toContain(
        d.id,
      );
    }
  });
});

/** One LIVE occurrence per vocabulary member, keyed so a new member fails the
 *  coverage leg below rather than silently skipping the sweep. */
const SAMPLE_FOR: Record<string, string> = {
  expex: "\\pex one",
  xlistenv: "\\begin{xlist}\\a one\\end{xlist}",
  graphicx: "\\includegraphics{fig.png}",
  tikz: "\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}",
  xcolor: "\\textcolor[HTML]{FF0000}{red}",
  forest: "\\begin{forest}[S [NP] [VP]]\\end{forest}",
};

describe("the vocabulary sweep covers every member", () => {
  it("every PACKAGE_DETECTORS id has a live sample", () => {
    expect(PACKAGE_DETECTORS.map((d) => d.id).sort()).toEqual(
      Object.keys(SAMPLE_FOR).sort(),
    );
  });

  it("no member carries /g — the table is shared by two callers", () => {
    // A `/g` RegExp keeps `lastIndex` across `.test()` calls, so five module
    // singletons now read by two call sites would silently skip matches on
    // alternate calls: a package injected for some documents and not others,
    // with no error. Pre-fix only `TIKZ_RE` was shared, so the surface for this
    // grew from one member to five with the consolidation.
    for (const d of PACKAGE_DETECTORS) {
      expect(d.re.global, d.id).toBe(false);
      expect(d.re.sticky, d.id).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Census — the leg with teeth
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..", "..", "..");
const SERIALIZER = join(ROOT, "src", "lib", "latex-serializer.ts");
const COLLECTOR = join(ROOT, "src", "lib", "latex-requirement-collector.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

// BOTH silos, as the sibling census in this class does
// (bib-family-detection-authority.test.ts). The pre-fix fork lived in two named
// files, but a census scoped to the files that already drifted can only ever
// re-find the drift someone already knew about.
const PRODUCTION_FILES = [join(ROOT, "src"), join(ROOT, "library")].flatMap(
  (d) => walk(d),
);

/**
 * One needle per vocabulary member, each matching that member's REGEX SOURCE as
 * it appears in code — which is what a second scanner looks like. Every needle
 * fires on BOTH pre-fix forks (measured on HEAD^: the serializer's four inline
 * copies and `BODY_DETECTORS`' four) except the tikz one, which fires only in
 * the collector because `TIKZ_RE` was the one member already shared.
 *
 * Two stated limits, since a guard that overstates its reach is the failure
 * mode this whole class is about. (1) `codeOnly` BLANKS string and template
 * literals as well as comments, so a fork built as
 * `new RegExp("\\\\includegraphics(?![a-zA-Z])")` is invisible here — measured,
 * no such construction exists for these five vocabularies in either silo today.
 * Blanking is nonetheless the right choice: needle-shaped prose in a doc comment
 * or an error string is not a scanner, and a regex LITERAL is not a string
 * literal, so the drift this watches for survives the blanking. (2) The needles
 * are exact spellings; a semantically equivalent respelling
 * (`\\includegraphics(?![A-Za-z])`) would pass.
 */
const VOCAB_NEEDLES: ReadonlyArray<RegExp> = [
  /\\\\includegraphics\(\?!/,
  /\\\\textcolor\(\?!/,
  /\\\\begin\\\{xlist\\\}/,
  /\\\\\(\?:begingl\|getfullref/,
  /\\\\begin\\\{tikzpicture\\\}/,
];

function vocabularyHits(code: string): string[] {
  return VOCAB_NEEDLES.filter((re) => re.test(code)).map((re) => re.source);
}

describe("census — one vocabulary, one projection", () => {
  it("the package vocabulary is spelled in exactly ONE file, both silos swept", () => {
    // A second scanner anywhere is the drift this task deleted: four of the
    // five regexes were hand-copied between `declareFromRawLatex` and
    // `BODY_DETECTORS`, byte-for-byte, with only `TIKZ_RE` shared. A hit is
    // MIGRATE-it, never an allowlist entry — measured, the sweep over 763
    // production files needs no allowlist because the collector is the only one.
    const offenders = PRODUCTION_FILES.filter((f) => {
      if (f === COLLECTOR) return false;
      return vocabularyHits(codeOnly(readFileSync(f, "utf8"))).length > 0;
    }).map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("EVERY needle is live — no needle rides on another's evidence", () => {
    // A slack "at least N-1 fire" leg lets one silently-broken needle (a single
    // wrong backslash) sit undetected forever, and the tikz needle in particular
    // matches nothing outside the collector, so this exact leg is its ONLY
    // evidence anywhere in the suite.
    expect(vocabularyHits(codeOnly(readFileSync(COLLECTOR, "utf8")))).toEqual(
      VOCAB_NEEDLES.map((re) => re.source),
    );
  });

  it("the raw-passthrough declaration projects, through the NAMED door", () => {
    const code = codeOnly(readFileSync(SERIALIZER, "utf8"));
    expect(code).toContain("projectDetectableLatex");
    // Not an option bag: a second spelling of "which bytes are inert?" is how
    // the P3 fork-F1 family decision gets re-made per caller, and the whole
    // point is that declaration and detection cannot disagree about it.
    expect(code).not.toContain("VERBATIM_ENVS_NARROW");
    expect(code).not.toMatch(/projectLiveLatex\s*\(/);
  });

  it("the projection lives INSIDE the declaration, not at its call sites", () => {
    // A projection at the call site is a rule a third caller can forget. There
    // must be exactly one `projectDetectableLatex(` in the serializer, and every
    // `declareFromRawLatex(` call must hand it the raw attr directly.
    // Deliberately brittle: a second legitimate use of the PROJECTION door in
    // this file would fail here, and that is the right outcome — it means the
    // serializer has grown a SECOND byte-scanning detector, which is exactly the
    // decision this census exists to surface rather than wave through.
    //
    // The DECLARER's caller count moves with the raw-passthrough node family
    // rather than with a detector decision, so it is pinned by NAME: `texBlock`,
    // `forestBlock` (task 383) and the figure's `extras` halves. Each is a node
    // whose model IS its bytes, declaring from its own attr.
    const code = codeOnly(readFileSync(SERIALIZER, "utf8"));
    expect(code.match(/projectDetectableLatex\s*\(/g) ?? []).toHaveLength(1);
    const calls = code.match(/declareFromRawLatex\((.*?)\);/g) ?? [];
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c).not.toContain("project");
  });

  it("the census can see, and the stripper swallows nothing (canary)", () => {
    // Synthetic, not standing on the drained defect: the fixture spells ALL
    // FIVE shapes, so a needle broken by one backslash fails here too rather
    // than resting on the collector leg alone.
    const fixture = codeOnly(
      `if (/\\\\includegraphics(?![a-zA-Z])/.test(raw)) need("graphicx");\n` +
        `if (/\\\\textcolor(?![a-zA-Z])/.test(raw)) need("xcolor");\n` +
        `if (/\\\\begin\\{xlist\\}/.test(raw)) need("xlistenv");\n` +
        `if (/\\\\(?:begingl|getfullref|getref|pex|ex)(?![a-zA-Z])/.test(raw)) need("expex");\n` +
        `if (/\\\\begin\\{tikzpicture\\}/.test(raw)) need("tikz");\n`,
    );
    expect(vocabularyHits(fixture)).toEqual(VOCAB_NEEDLES.map((r) => r.source));

    // The stripper self-check the 202b runaway earned: a backtick inside a
    // double-quoted string once ate 7 kB of a real file, silently, with the
    // suite green. Declaration counts must survive `codeOnly` on the files this
    // census actually reads.
    for (const f of [SERIALIZER, COLLECTOR]) {
      const raw = readFileSync(f, "utf8");
      const decls = (s: string) =>
        (s.match(/\b(?:function|const|export)\s/g) ?? []).length;
      expect(decls(codeOnly(raw)), f).toBeGreaterThanOrEqual(
        Math.floor(decls(raw) * 0.6),
      );
    }
    expect(PRODUCTION_FILES.length).toBeGreaterThan(300);
  });
});
