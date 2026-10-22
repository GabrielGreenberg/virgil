/**
 * POD-DISCLOSURE CENSUS (task 1187).
 *
 * > A card sub-pod's labelled disclosure — chevron + label, toggling a pod —
 * > is spelled ONCE, by `<PodDisclosure>` in `panel-primitives.tsx`.
 *
 * `Chevron` is only an icon; every card that wanted a disclosure used to
 * hand-roll the button around it, and the copies drifted: the bib card's
 * "BibTeX Fields" / "Annotations" announced no expanded state and showed no
 * focus ring, the suggestion card's "Original text" had no focus ring. The
 * primitive owns `type="button"`, `aria-expanded`, `.focus-ring` and the
 * click/mousedown stopPropagation; this census keeps a fresh `<Chevron
 * expanded=` from re-forking it.
 *
 * Needle: `<Chevron expanded=` in comments-stripped production `.tsx`
 * (`src/` + `library/`) outside `panel-primitives.tsx`. A hit is
 * MIGRATE-it unless it sits in a disclosure named in `RAW_DISCLOSURES`
 * with its count and reason. A canary proves the needle sees the pre-fix spelling.
 *
 * Second needle (task 1237): a disclosure that never wrote `<Chevron` was
 * invisible to the first. The Omni bin pill toggled `aria-expanded` and drew
 * "▾/▸" as TEXT, with no focus ring — the drift task 1187 fixed elsewhere,
 * one spelling over. So EVERY raw `<button … aria-expanded=…>` outside the
 * primitive is a disclosure until named in `RAW_DISCLOSURES` with its count
 * and reason, and each one carries the app's focus indicator and draws no
 * text-glyph chevron.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  commentsStripped,
  elementsNamed,
  resolveConsts,
  stringConsts,
  walkFiles,
} from "@/lib/__tests__/_source-scan";

const ROOT = join(__dirname, "..", "..", "..");
const LEAF = "src/components/panel-primitives.tsx";

const NEEDLE = /<Chevron\s+expanded\s*=/g;

/**
 * Raw `<button aria-expanded>`s that are NOT a labelled pod disclosure, by
 * file — count + reason. A new one is `<PodDisclosure>` or earns a line here.
 */
const RAW_DISCLOSURES: Record<string, { count: number; reason: string }> = {
  "src/panels/_shared/suggestion-fields.tsx": { count: 1, reason: "SpecHeader icon-only fold toggle beside its label" },
  "src/panels/Examples/ExampleCard.tsx": { count: 1, reason: "icon-only `?` help toggle (aria-controls the help panel)" },
  "src/panels/Omni/OmniViewPanel.tsx": {
    count: 1,
    reason: "OmniBinPill: a panel-bin header — full-width bordered pill with a glyph, a label and a TRAILING chevron, not a card sub-pod",
  },
  "src/components/CompileLogDisclosure.tsx": {
    count: 1,
    reason: "bottom drawer header: an up/down chevron for a drawer that opens UPWARD, uppercase strip label",
  },
  "src/components/MenuBar.tsx": { count: 1, reason: "menu group row: roving `menuitem` (focus shown by `data-active`), not a tab stop" },
  "library/components/BibCard.tsx": { count: 1, reason: "inline-styled \"more/less\" chip in the bib card's key row" },
  "library/components/PaperHeader.tsx": { count: 1, reason: "inline-styled \"fields\" chip in the paper header's action row" },
};

/** Not a tab stop / its focus door lives elsewhere: the ring question is moot. */
const RING_EXEMPT = new Set(["src/components/MenuBar.tsx"]);
const FOCUS_INDICATOR = /(?<![\w-])(?:focus-ring(?![\w-])|iconbtn-(?:xs|sm|md|lg)|topbarbtn)|withFocusIndicator\s*\(/;
const TEXT_CHEVRON = /[▾▸▴◂►▼▲◀]/;
const EXPANDED = /(?<![\w-])aria-expanded\s*=/;

/** Every raw `<button aria-expanded>` in a file, its tag resolved through the
 *  file's string consts (a ring spelled by a const is a ring). */
function rawDisclosures(raw: string): { tag: string; subtree: string }[] {
  const src = commentsStripped(raw);
  const consts = stringConsts(src);
  return elementsNamed(src, "button")
    .filter((h) => EXPANDED.test(h.tag))
    .map((h) => ({ tag: resolveConsts(h.tag, consts), subtree: h.subtree ?? "" }));
}

function hits(src: string): number {
  return (commentsStripped(src).match(NEEDLE) ?? []).length;
}

const PRODUCTION = [
  ...walkFiles(join(ROOT, "src"), { skipDirs: ["__tests__"] }),
  ...walkFiles(join(ROOT, "library"), { skipDirs: ["__tests__"] }),
]
  .filter((p) => /\.tsx$/.test(p))
  .map((p) => relative(ROOT, p));

describe("pod-disclosure census", () => {
  it("canary: the needle sees a hand-rolled chevron disclosure", () => {
    const preFix = `<button onClick={() => setOpen((p) => !p)}>
      <Chevron expanded={fieldsOpen} />
      <span>BibTeX Fields</span>
    </button>`;
    expect(hits(preFix)).toBe(1);
  });

  it("the primitive itself renders the chevron", () => {
    const src = readFileSync(join(ROOT, LEAF), "utf8");
    expect(src).toMatch(/export function PodDisclosure/);
    expect(hits(src)).toBeGreaterThan(0);
  });

  it("no `<Chevron expanded=` outside PodDisclosure, bar named raw disclosures", () => {
    expect(PRODUCTION.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of PRODUCTION) {
      if (file === LEAF) continue;
      const n = hits(readFileSync(join(ROOT, file), "utf8"));
      // A `<Chevron expanded=` outside the primitive may only sit inside one of
      // the file's NAMED raw disclosures (the second needle counts those exactly).
      const allowed = RAW_DISCLOSURES[file]?.count ?? 0;
      if (n > allowed) offenders.push(`${file}: ${n} hand-rolled (allowed ${allowed}) — use <PodDisclosure>`);
    }
    expect(offenders).toEqual([]);
  });

  it("canary: the second needle sees a glyph-drawn, unringed disclosure (task 1237)", () => {
    const preFix = `<button type="button" onClick={t} className="omni-bin-pill px-2 rounded" aria-expanded={expanded}>
      <span>{label}</span>
      <span className="ml-auto">{expanded ? "▾" : "▸"}</span>
    </button>`;
    const [d] = rawDisclosures(preFix);
    expect(d).toBeDefined();
    expect(FOCUS_INDICATOR.test(d.tag)).toBe(false);
    expect(TEXT_CHEVRON.test(d.subtree)).toBe(true);
    // …and a ring spelled through a const is read as a ring.
    const viaConst = `const RING = "focus-ring";\n<button className={\`px-2 \${RING}\`} aria-expanded={x}>a</button>`;
    expect(FOCUS_INDICATOR.test(rawDisclosures(viaConst)[0].tag)).toBe(true);
  });

  it("every raw `<button aria-expanded>` is <PodDisclosure> or named, ringed, and draws a real chevron", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const file of PRODUCTION) {
      if (file === LEAF) continue;
      const found = rawDisclosures(readFileSync(join(ROOT, file), "utf8"));
      seen += found.length;
      const allowed = RAW_DISCLOSURES[file]?.count ?? 0;
      if (found.length !== allowed) {
        offenders.push(`${file}: ${found.length} raw aria-expanded button(s) (named ${allowed}) — use <PodDisclosure> or name it`);
      }
      for (const d of found) {
        if (!RING_EXEMPT.has(file) && !FOCUS_INDICATOR.test(d.tag)) offenders.push(`${file}: disclosure without focus-ring`);
        if (TEXT_CHEVRON.test(d.subtree)) offenders.push(`${file}: text-glyph chevron — render <Chevron expanded=…>`);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(Object.keys(RAW_DISCLOSURES).length);
    expect(offenders).toEqual([]);
  });

  it("RAW_DISCLOSURES / RING_EXEMPT name only live files", () => {
    for (const file of [...Object.keys(RAW_DISCLOSURES), ...RING_EXEMPT]) {
      expect(PRODUCTION, file).toContain(file);
      expect(RAW_DISCLOSURES[file], `${file} ring-exempt but not a named disclosure`).toBeDefined();
    }
  });
});
