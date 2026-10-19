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
 * MIGRATE-it unless the file is named in `ICON_ONLY` with its count and
 * reason. A canary proves the needle sees the pre-fix spelling.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { commentsStripped, walkFiles } from "@/lib/__tests__/_source-scan";

const ROOT = join(__dirname, "..", "..", "..");
const LEAF = "src/components/panel-primitives.tsx";

/** Icon-only chevron toggles that are NOT a labelled pod disclosure. */
const ICON_ONLY: Record<string, { count: number; reason: string }> = {
  // SpecHeader's fold toggle: an icon button BESIDE the label (which is not
  // part of the control), with its own iconHint + the iconbtn-exempt
  // outline-chevron contract. Already carries aria-expanded + focus-ring.
  "src/panels/_shared/suggestion-fields.tsx": { count: 1, reason: "SpecHeader icon-only fold toggle" },
};

const NEEDLE = /<Chevron\s+expanded\s*=/g;

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

  it("no `<Chevron expanded=` outside PodDisclosure, bar named icon-only toggles", () => {
    expect(PRODUCTION.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of PRODUCTION) {
      if (file === LEAF) continue;
      const n = hits(readFileSync(join(ROOT, file), "utf8"));
      const allowed = ICON_ONLY[file]?.count ?? 0;
      if (n !== allowed) offenders.push(`${file}: ${n} hand-rolled (allowed ${allowed}) — use <PodDisclosure>`);
    }
    expect(offenders).toEqual([]);
  });
});
