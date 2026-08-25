// @vitest-environment node
//
// Marker ids are ALLOCATED, never invented (task 465).
//
// A `.tex` identity marker — `\vfid{}` before a `\footnote`, `\vcid{}` before a
// cite, `\vexid{}`/`\vxid{}` on an expex construct, `\vlid{}…\vlidend{}` around
// a linked range — carries the id that IS the atom↔card link (id equality, not
// a pointer: `docs/workspace/identity.md`). The editor silo has exactly one
// allocator for that id space, `create_card.py::_gen_marker_id`, and it is the
// only collision check that exists anywhere: a 4-hex mint rejected against both
// the sidecar ids and a scan of the markers already in the `.tex`.
//
// `draft-footnote` step 2 told the composing agent to write one by hand
// ("Prepend a fresh `\vcid{<uuid>}` before each cite command"), and the body it
// composes is spliced into `document.tex` VERBATIM by `create_card.py` —
// nothing inspects, validates or de-duplicates a marker inside it. So the one
// door that allocates marker ids was bypassed by the one skill that composes
// prose containing them, in two directions at once: a v4 `<uuid>` is 36
// characters and the allocator's `.tex` scan is bounded at `{2,8}` hex, so a
// hand-minted id in that shape is invisible to it; and the same step also says
// to match "the doc's apparatus tone", whose visible house style is `cc01`,
// `cc02`, `cc03`… — so an agent following BOTH instructions writes `cc04` with
// no check that `cc04` is free. Two atoms then answer to one `\vcid`:
// `pendingCitationId` binds the second cite to the first's id, `syncFromEditor`
// appends ONE `CitationRef` for both, and the second cite has no panel row.
// That is the identity-collision class AGENTS.md legislates against ("exactly
// one live presence may answer to a given uuid (or inline-atom id)").
//
// The instruction was also unnecessary, which is what makes the fix a deletion
// rather than a new script: `latex-parser.ts` reads
// `pendingCitationId.take(i) || generateShortId()`, so a BARE `\citet{key}` is
// minted a fresh 4-hex id on the next parse — exactly what happens when a human
// types a cite into a footnote. The card/footnote fork (`footnote-content.ts`)
// does the same. Omitting the marker is the normal path, not a degradation.
//
// THE LEG WITH TEETH IS THE CENSUS. The allocator was never the part that could
// misbehave — a composing skill that never asks it is, and that skill is
// perfectly well-formed markdown no behavioural test of any door could see.
// The allowlist is EMPTY.
//
// The needle is a marker macro spelled with an ANGLE-BRACKET PLACEHOLDER
// argument, because that is this silo's own fill-this-in convention
// (`<docPath>`, `<uuid>`, `<cardId>` throughout) — so a marker spelled that way
// reads as an invitation to write the id whether or not the surrounding
// sentence is imperative. The legitimate DESCRIPTIVE mentions lose nothing by
// naming the shape with an empty or elided argument (`\vfid{}\footnote{}` —
// which is already `create-card.md`'s convention, and is the more accurate
// spelling anyway, since the argument is never the skill's to write). Task 465
// normalized the two that used a placeholder (`draft-footnote.md`'s
// direct-create description, `edit-card.md`'s footnote-body rewrite).
//
// SCOPE — the editor silo only, and the exemption is real rather than
// convenient. The LIBRARY extraction pipeline authors `main.tex` from scratch,
// has no allocator to ask, and deliberately mints its own full-v4 `\vexid` ids
// idempotently (`di-examples.md`); 18 lines under `library/skills/` carry the
// placeholder shape on purpose. The `## Scope excused` leg below pins that, so
// the scoping cannot quietly become a hole once the library changes.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { VIRGIL_MARKER_COMMANDS } from "@/lib/latex-markers";

// editor/skills/__tests__/ → repo root is three levels up.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const EDITOR_SKILLS = "editor/skills";
const LIBRARY_SKILLS = "library/skills";
const DOCTRINE = `${EDITOR_SKILLS}/_latex-allowlist.md`;
const ALLOCATOR = "editor/scripts/create_card.py";

const mdFiles = (rel: string) =>
  readdirSync(join(REPO, rel))
    .filter((f) => f.endsWith(".md"))
    .sort();

/**
 * The marker vocabulary is DERIVED from the app's own SSOT
 * (`src/lib/latex-markers.ts`), never hand-listed — a marker added there is
 * covered here by declaration alone. Longest-first so `\vlidend` matches ahead
 * of its `\vlid` prefix (the SSOT's own prefix-safety rule).
 */
const MARKER_ALT = [...VIRGIL_MARKER_COMMANDS]
  .sort((a, b) => b.length - a.length)
  .join("|");

/** `\vcid{<uuid>}` / `\vfid{<id>}` — a marker macro handed a placeholder id. */
const INVENTED_MARKER = new RegExp(`\\\\(${MARKER_ALT})\\{\\s*<[^>}]*>\\s*\\}`);

function hits(rel: string): string[] {
  const out: string[] = [];
  read(rel)
    .split("\n")
    .forEach((line, i) => {
      if (INVENTED_MARKER.test(line)) out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  return out;
}

describe("marker ids — the CENSUS (allowlist EMPTY)", () => {
  it("the vocabulary is derived from the marker SSOT", () => {
    // Not a hand list: a new marker joins the census by being declared.
    expect(VIRGIL_MARKER_COMMANDS).toContain("vcid");
    expect(VIRGIL_MARKER_COMMANDS).toContain("vfid");
    expect(VIRGIL_MARKER_COMMANDS.length).toBeGreaterThanOrEqual(7);
  });

  it("no editor skill spells a marker with an invented id", () => {
    const offenders = mdFiles(EDITOR_SKILLS).flatMap((f) => hits(`${EDITOR_SKILLS}/${f}`));
    expect(
      offenders,
      "a marker macro handed a placeholder id — marker ids are allocated by" +
        ` ${ALLOCATOR}::_gen_marker_id, never invented. Compose the construct` +
        " BARE (the next parse mints a collision-free id), and name the shape" +
        " descriptively as `\\vfid{}` / `\\vfid{…}`.",
    ).toEqual([]);
  });

  it("the census can see a violation, and does not fire on the legitimate shapes (canary)", () => {
    // Synthetic, never a live line — a canary standing on the site the census
    // drains evaporates the moment the census works.
    const violation = "review first. Prepend a fresh `\\vcid{<uuid>}` before each cite command.";
    const descriptive = [
      "| `footnote` | atom-bearing | `footnotes.json` | `\\vfid{}\\footnote{}` | `--body` |",
      "  rewrites the `\\vfid{…}\\footnote{…}` body in the `.tex`.",
      "  Include `\\vcid{...}`, `\\vfid{...}` and inline LaTeX verbatim — don't invent fresh ids.",
      "  the `\\vfid…\\footnote{}` / `\\vcid…\\cite{}` characters in the `.tex`",
    ];
    expect(INVENTED_MARKER.test(violation)).toBe(true);
    for (const line of descriptive) expect(INVENTED_MARKER.test(line)).toBe(false);
  });

  it("the needle is not vacuous — editor skills DO name markers", () => {
    // Without this the census passes just as happily on a needle that matches
    // nothing at all, or on a skill set that stopped mentioning markers.
    const naming = mdFiles(EDITOR_SKILLS).filter((f) =>
      new RegExp(`\\\\(${MARKER_ALT})[{…\\s]`).test(read(`${EDITOR_SKILLS}/${f}`)),
    );
    expect(naming).toContain("create-card.md");
    expect(naming).toContain("draft-footnote.md");
    expect(naming.length).toBeGreaterThan(3);
  });
});

describe("marker ids — the library scope exemption is excusing something", () => {
  it("library skills DO carry the placeholder shape (deliberately)", () => {
    // The library pipeline authors `main.tex` from scratch and owns its own
    // `\vexid` ids. If this ever drains, the editor-only scoping above has
    // become a hole rather than a scope — revisit the doctrine's *Scope.* note.
    const libHits = mdFiles(LIBRARY_SKILLS).flatMap((f) => hits(`${LIBRARY_SKILLS}/${f}`));
    expect(libHits.length).toBeGreaterThan(0);
    expect(libHits.join("\n")).toContain("di-examples.md");
  });
});

describe("marker ids — the doctrine states the rule once", () => {
  // Hard-wrapped prose: every PHRASE assertion runs against a whitespace-
  // collapsed copy, so a future re-wrap cannot fail a rule it did not change.
  const flat = read(DOCTRINE).replace(/\s+/g, " ");

  it("states allocated-never-invented, and names the allocator", () => {
    expect(flat).toMatch(/allocated, never invented/i);
    expect(flat).toContain("_gen_marker_id");
  });

  it("states that a BARE construct is minted an id on the next parse", () => {
    expect(flat).toMatch(/bare `\\citet\{key\}`/);
    expect(flat).toContain("generateShortId()");
  });

  it("states the REWRITE half — carry an existing marker verbatim", () => {
    expect(flat).toMatch(/carry any marker already in it through \*\*verbatim/i);
  });

  it("states the library SCOPE, so the census's editor-only reach is declared", () => {
    expect(flat).toMatch(/\*Scope\.\*[\s\S]{0,400}?library/i);
    expect(flat).toContain("di-examples.md");
  });

  it("ships byte-identical in both silos (the doctrine's own SSOT rule)", () => {
    // `latex-allowlist-doctrine.test.ts` owns this invariant in general; the
    // pin is repeated here because THIS task authored a rule into both copies.
    expect(read(`${LIBRARY_SKILLS}/_latex-allowlist.md`)).toEqual(read(DOCTRINE));
  });
});

describe("marker ids — draft-footnote states the bare-cite rule", () => {
  const flat = read(`${EDITOR_SKILLS}/draft-footnote.md`).replace(/\s+/g, " ");

  it("tells the composer to write the cite BARE", () => {
    expect(flat).toMatch(/Compose the cite \*\*bare\*\* — no `\\vcid\{…\}` marker/);
  });

  it("points at the doctrine rather than re-paraphrasing it", () => {
    expect(flat).toContain("[_latex-allowlist.md](_latex-allowlist.md)");
  });

  it("no longer instructs a hand-minted marker", () => {
    // The retired sentence, pinned by its own words so a revert is loud.
    expect(flat).not.toMatch(/Prepend a fresh `\\vcid/);
  });
});

describe("marker ids — the allocator is still the only collision check", () => {
  const src = read(ALLOCATOR);

  it("mints a 4-hex id checked against the sidecar ids AND the .tex", () => {
    // The premise the doctrine's rule rests on: if this stops being true, the
    // sentence pointing composers at it stops being true too.
    expect(src).toContain("def _gen_marker_id");
    expect(src).toContain("secrets.token_hex(2)");
    expect(src).toContain("([0-9a-fA-F]{2,8})");
  });
});
