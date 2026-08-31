import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  cssCommentsStripped,
  cssRuleBodies,
  strip,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";

/**
 * Color-token CONSUMER contract (task 2026-07-18-171).
 *
 * The sibling `radius-scale.test.ts` locks that the radius tokens exist. This
 * file locks the half that kept getting skipped: that the consumers actually
 * READ them.
 *
 * The bug class — "token defined, consumers never swept" — has now recurred
 * twice (task 135's status-dot hexes, then this task's amber + drag families).
 * A token whose value is re-spelled at every call site makes the codebase LOOK
 * systematized while the literals drift independently; that is how the amber
 * family reached five different hexes (docs/virgil-design-system/10-audit.md
 * item 8).
 *
 * For --drag-highlight the drift is not merely cosmetic: it is a USER
 * PREFERENCE (`dragHighlight`, src/lib/preferences-tree.ts). A glow hardcoded
 * as rgba(59, 130, 246, …) keeps painting blue after the user retints the
 * accent, so the fill moves and the halo around it does not.
 *
 * These are value-keyed regression locks, not a general guard: a general
 * "raw literal duplicates a :root token" guard is the right end state, but it
 * currently reports ~490 pre-existing sites tree-wide and needs its own sweep
 * (deferred; see the task's progress log).
 */
const ROOT = path.resolve(__dirname, "..", "..");
const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Rule bodies only — the `:root` blocks are where literals BELONG. The walker
 *  moved to `_source-scan.ts` when task 195's destructive-red census became its
 *  second caller; one copy, same rule as the two strippers beside it. */
const ruleBodies = cssRuleBodies;

describe("amber highlight role-set", () => {
  it.each([
    ["--amber-highlight-wash", "#fef3c3"],
    ["--amber-highlight-wash-active", "#fef08a"],
    ["--amber-highlight-ink", "#4a3f20"],
  ])("defines %s = %s in :root", (token, value) => {
    expect(globals).toMatch(new RegExp(`${token}:\\s*${value}\\s*;`));
  });

  it("derives the highlight edge from the amber scale rather than re-spelling it", () => {
    expect(globals).toMatch(/--amber-highlight-edge:\s*var\(--amber-500\)/);
    expect(globals).toMatch(/--amber-500:\s*#d4a843\s*;/);
  });

  it.each(["#d4a843", "#fef3c3", "#fef08a", "#4a3f20", "rgba(212, 168, 67"])(
    "has no %s literal left in a globals.css rule body",
    (literal) => {
      expect(ruleBodies(globals)).not.toContain(literal);
    },
  );
});

describe("drag glow layers derive from the --drag-highlight preference", () => {
  it.each([
    "--drag-outline-border",
    "--drag-glow-outline",
    "--drag-glow-line",
    "--drag-glow-knob",
    "--drag-ring-faint",
  ])("defines %s", (token) => {
    expect(globals).toMatch(new RegExp(`${token}:`));
  });

  it("spells every drag glow as a derivation of the live token", () => {
    // Each layer must reference var(--drag-highlight) — a color-mix against the
    // token, never a re-spelled channel triple.
    for (const token of ["--drag-glow-outline", "--drag-glow-line", "--drag-glow-knob", "--drag-ring-faint"]) {
      const decl = new RegExp(`${token}:\\s*([^;]+);`).exec(globals)?.[1] ?? "";
      expect(decl).toMatch(/var\(--drag-highlight\)/);
      expect(decl).not.toMatch(/\d+\s*,\s*\d+\s*,\s*\d+/);
    }
  });

  it.each([
    "src/components/CardLiftOutline.tsx",
    "src/components/editor-layout/DockOutline.tsx",
    "src/components/EditorPane.tsx",
  ])("leaves no rgb(59, 130, 246) literal in %s", (rel) => {
    expect(read(rel)).not.toMatch(/59\s*,\s*130\s*,\s*246/);
  });

  it("gives the two body-portaled outlines ONE shared definition", () => {
    // They used to carry byte-identical copies of the same two-layer halo.
    // Both must now read the same tokens, so the pair cannot drift apart.
    for (const rel of ["src/components/CardLiftOutline.tsx", "src/components/editor-layout/DockOutline.tsx"]) {
      const src = read(rel);
      expect(src).toContain('const OUTLINE_BORDER = "var(--drag-outline-border)"');
      expect(src).toContain('const OUTLINE_GLOW = "var(--drag-glow-outline)"');
    }
  });
});

/**
 * ErrorCard's `info` severity color (task 2026-08-07-310).
 *
 * `#7191b0` was the last untokenized status literal in a *.tsx — a
 * STYLE_GUIDE:38 bypass with no CI guard (check:radius covers radii only, and
 * the per-file guards above don't scan src/panels/Errors/). It is latent, not
 * live: `"info"` is a declared LatexErrorSeverity member but no producer emits
 * it yet, so the raw hex would ship the instant a future lint/compile rule sets
 * severity:"info". Folded onto a DEDICATED --status-info (its own member of the
 * status-dot family task 135 established) — NOT aliased to the coincidental
 * --latex-comment-color / archive accent, honoring ErrorCard's own intent.
 */
describe("ErrorCard info severity reads a status token, not a raw hex", () => {
  it("defines --status-info in the status-dot family", () => {
    expect(globals).toMatch(/--status-info:\s*#7191b0\s*;/);
  });

  it("leaves no #7191b0 literal in src/panels/Errors/ErrorCard.tsx", () => {
    expect(read("src/panels/Errors/ErrorCard.tsx")).not.toContain("#7191b0");
  });
});

/**
 * The PROMOTE-DEFAULTS block re-declares promoted preference tokens on the same
 * :root ON PURPOSE — CSS last-wins lets one managed block override the
 * descriptive declarations above without disturbing the comments that explain
 * them (see the block's own header, and tools/promote-defaults.mjs which
 * regenerates it from the JSON sidecars).
 *
 * This is locked because the repeated `--drag-highlight` reads as a redundant
 * duplicate to anyone grepping — task 171 was filed asking for its deletion.
 * Deleting it would drop the first-paint default AND be silently reinstated by
 * the next promote-defaults run.
 */
describe("PROMOTE-DEFAULTS re-declarations are intentional", () => {
  it("keeps the managed block's --drag-highlight", () => {
    const block = /PROMOTE-DEFAULTS-START([\s\S]*?)PROMOTE-DEFAULTS-END/.exec(globals)?.[1];
    expect(block).toBeDefined();
    expect(block).toMatch(/--drag-highlight:\s*#3b82f6\s*;/);
  });

  it("keeps the descriptive declaration above it too", () => {
    const beforeBlock = globals.slice(0, globals.indexOf("PROMOTE-DEFAULTS-START"));
    expect(beforeBlock).toMatch(/--drag-highlight:\s*#3b82f6\s*;/);
  });
});

/**
 * ONE neutral hover (task 2026-08-31-502).
 *
 * `docs/virgil-design-system/10-audit.md` item 2 ("Hover backgrounds spelled
 * six ways") was marked LANDED on the evidence "zero raw `hover:bg-stone-*`
 * remain". That measurement was true and it measured the wrong axis: the sweep
 * converged the VALUES onto tokens and never converged the ROLE, so 29
 * controls went on hand-rolling a hover at three different greys through four
 * different spellings — 15 of them by painting `--edge-subtle`, whose own
 * declaration names it a BORDER token, as a surface fill.
 *
 * This is the same bug class the file's header names ("token defined,
 * consumers never swept") read one level up: not a re-spelled VALUE, a
 * re-spelled ROLE. The utility was never the part that could misbehave — a
 * control that spells its own hover is, and it renders perfectly.
 *
 * The ONE reason a site may legitimately keep a hand-rolled spelling is that
 * `.hover-on-light` / `.hover-on-dark` are UNLAYERED, so they own the
 * element's whole transition (see the law in globals.css). An element whose
 * own transition is BROADER than the utility's property list must keep it.
 * Every such site says so in place with a `hover-on-light-exempt:` marker, and
 * the second leg below verifies the marker is really there — an allowlist
 * whose entries have stopped excusing anything is a standing licence.
 */
describe("the neutral hover has ONE spelling per resting bg", () => {
  /** Production `.tsx` in BOTH silos — a hover drift in `library/` is the same
   *  drift. Suites are excluded: a fixture may spell the retired form on
   *  purpose (this file's own canary does). */
  const productionTsx = (): string[] =>
    [...trackedFiles("src", /\.tsx$/), ...trackedFiles("library", /\.tsx$/)].filter(
      (p) => !p.includes("__tests__"),
    );

  /** Comments blanked, string literals KEPT, LINE-ALIGNED. The needle lives
   *  inside a `className` literal, so blanking strings makes the leg
   *  unfalsifiable — the trap `_source-scan.ts`'s own header records and task
   *  205 was burned by. Line alignment is what lets the report name a site. */
  const scan = (src: string) => strip(src, true, true);

  const hits = (needle: RegExp): string[] => {
    const out: string[] = [];
    for (const abs of productionTsx()) {
      const rel = path.relative(REPO_ROOT, abs);
      scan(readFileSync(abs, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (needle.test(line)) out.push(`${rel}:${i + 1}`);
        });
    }
    return out;
  };

  /** The stated exemptions, per LINE — a file-scoped entry would excuse the
   *  next hand-rolled hover added beside them. Each names what it aligns to at
   *  its own site; leg 3 proves the marker is still there. */
  const PERMITTED_HAND_ROLLED_HOVERS: Record<string, string> = {
    "src/components/panel-primitives.tsx:CARD_DEFAULT":
      "a CARD-scale wash, deliberately one step FAINTER than the control SSOT and paired with a border retint",
    "src/components/panel-primitives.tsx:BUTTON_VARIANT.secondary":
      "BUTTON_BASE owns `transition-all` (transform + filter), which is BROADER than the utility's property list",
    "src/components/panel-primitives.tsx:BUTTON_VARIANT.ghost":
      "BUTTON_BASE owns `transition-all` (transform + filter), which is BROADER than the utility's property list",
  };

  it("uses --edge-subtle as a BORDER token, never as a hover fill", () => {
    // A hit is CONVERT-it. This allowlist stays EMPTY: there is no shape for
    // which a border token is the right surface fill, and if a surface needs a
    // heavier hover that is a new named role with its own token — not this one
    // borrowed.
    expect(hits(/hover:bg-edge-subtle/)).toEqual([]);
  });

  it("routes every remaining hand-rolled neutral hover through a stated exemption", () => {
    const found = hits(/hover:bg-surface-muted/);
    // Exactly the three lines the allowlist names, and no more. Reported as
    // `file:line` so a new one names itself.
    expect(found).toEqual([
      "src/components/panel-primitives.tsx:410",
      // Line drift only (task 508 added the drop-halo composition ~26 lines
      // above these two): the SITES are the unchanged `secondary` and `ghost`
      // button variants. `file:line` is this leg's own stated reporting form,
      // so an unrelated edit above a site costs a number update here.
      "src/components/panel-primitives.tsx:1966",
      "src/components/panel-primitives.tsx:1972",
    ]);
    expect(Object.keys(PERMITTED_HAND_ROLLED_HOVERS)).toHaveLength(found.length);
  });

  it("keeps every exemption's reason AT THE SITE, not only in this list", () => {
    // Read RAW (markers are comments). An exemption whose marker has been
    // deleted is an allowlist entry excusing nothing.
    const raw = readFileSync(path.join(REPO_ROOT, "src/components/panel-primitives.tsx"), "utf8");
    expect(raw.match(/hover-on-light-exempt:/g) ?? []).toHaveLength(2);
    expect(raw).toMatch(/hover-on-light-exempt:[\s\S]{0,200}CARD-scale WASH/);
    expect(raw).toMatch(/hover-on-light-exempt:[\s\S]{0,200}BUTTON_BASE/);
  });

  it("CAN SEE the retired spellings (synthetic canary)", () => {
    // A census that reports zero must be shown to report non-zero, or "clean"
    // and "blind" look identical.
    const fixture = `const a = "px-1 hover:bg-edge-subtle rounded";\nconst b = "hover:bg-surface-muted-strong";\n`;
    const lines = scan(fixture).split("\n");
    expect(lines.filter((l) => /hover:bg-edge-subtle/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => /hover:bg-surface-muted/.test(l))).toHaveLength(1);
    // …and that it survives the stripper it runs through: the needle lives in
    // a string literal, so a `codeOnly`-style scan would report nothing here.
    expect(scan(`// hover:bg-edge-subtle in prose\n`)).not.toContain("hover:bg-edge-subtle");
  });

  /**
   * The property list is the load-bearing half. `.hover-on-light` is
   * UNLAYERED, so it beats every Tailwind `transition-*` utility whatever the
   * class order — naming `background-color` alone silently DISABLED each
   * site's own `transition-colors` / `transition-opacity`, which is both why
   * 23 shipped sites flashed their ink while fading their fill and why 29
   * others hand-rolled instead of taking the utility.
   */
  /** The selector group is EVERY unlayered interaction utility. `.iconbtn-*`
   *  and `.topbarbtn` hover to the same two values as component-shaped twins
   *  of the two hover classes, and each carried its own NARROWER shorthand —
   *  so four shipped sites spelling `transition-opacity` beside them had a
   *  reveal that never faded. A utility missing from this group is a fourth
   *  copy of the contract waiting to drift. */
  const SHARED_TRANSITION_GROUP = [
    ".hover-on-light",
    ".hover-on-dark",
    ".iconbtn-xs",
    ".iconbtn-sm",
    ".iconbtn-md",
    ".iconbtn-lg",
    ".topbarbtn",
  ];

  const sharedBlock = (): string => {
    const head = SHARED_TRANSITION_GROUP.join(",\\s*\\n\\s*");
    const m = new RegExp(`${head.replace(/\./g, "\\.")}\\s*\\{([\\s\\S]*?)\\}`).exec(
      cssCommentsStripped(globals),
    );
    expect(m, "the shared transition group must list every unlayered interaction utility").not.toBeNull();
    return m![1];
  };

  it("gives EVERY unlayered interaction utility the same transition contract", () => {
    const block = sharedBlock();
    // …and none of them may re-declare a narrower one LATER in the sheet,
    // where a shorthand would win and silently re-narrow the list. Read
    // COMMENT-STRIPPED: the pointer note each converted rule now carries
    // quotes the very declaration this needle looks for, so a raw-source
    // scan indicts the explanation instead of a defect.
    const css = cssCommentsStripped(globals);
    const after = css.slice(css.indexOf(block) + block.length);
    for (const sel of SHARED_TRANSITION_GROUP) {
      const local = new RegExp(`\\${sel}\\s*\\{[^}]*?\\btransition\\s*:`, "s");
      expect(after).not.toMatch(local);
    }
  });

  it("names a SUPERSET of transition-colors + opacity, at one 120ms ease-out", () => {
    const block = sharedBlock();
    const props = /transition-property:([\s\S]*?);/.exec(block)?.[1] ?? "";
    for (const p of [
      // Tailwind's own `transition-colors` list…
      "color",
      "background-color",
      "border-color",
      "text-decoration-color",
      "fill",
      "stroke",
      // …plus the reveal property, so a group-hover fade needs no utility.
      "opacity",
    ]) {
      expect(props).toMatch(new RegExp(`(^|[\\s,])${p}\\s*(,|$)`));
    }
    expect(block).toMatch(/transition-duration:\s*120ms\s*;/);
    expect(block).toMatch(/transition-timing-function:\s*ease-out\s*;/);
    // No `transition-delay`, so a site's own `delay-*` still composes.
    expect(block).not.toMatch(/transition-delay/);
  });

  it("leaves no dead `transition-opacity` beside a utility that already owns it", () => {
    // Each of these paired a reveal with a utility whose unlayered shorthand
    // replaced it — the fade never ran. Now that the shared list names
    // `opacity`, the utility IS the transition and the class is noise.
    const dead: string[] = [];
    for (const abs of productionTsx()) {
      for (const line of scan(readFileSync(abs, "utf8")).split("\n")) {
        if (!/transition-opacity/.test(line)) continue;
        if (/hover-on-light|hover-on-dark|iconbtn-|topbarbtn/.test(line)) {
          dead.push(`${path.relative(REPO_ROOT, abs)}: ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(dead).toEqual([]);
  });

  /** The four top-bar badges are a FAMILY: they sit side by side on
   *  `--topbar-bg` (#dcdbd7) and are meant to read as one. They took
   *  `hover:bg-surface-muted` (#fafaf9) — a near-white LIGHTEN on a mid-grey
   *  bar, i.e. the wrong direction as well as the wrong token. */
  it.each([
    "src/components/SyncConflictBadge.tsx",
    "src/components/ExternalChangeBadge.tsx",
    "src/components/CollabStatusPill.tsx",
    "src/components/PreservationNoticeBadge.tsx",
  ])("hovers %s's kebab on the DARK variant, like its siblings", (rel) => {
    const src = strip(readFileSync(path.join(REPO_ROOT, rel), "utf8"), true);
    expect(src).toContain("rounded hover-on-dark text-ink-subtle focus-ring");
  });
});

/**
 * ONE focus ring, and nothing out-specifies it (task 2026-08-31-503).
 *
 * The sibling law above is about an UNLAYERED class beating a Tailwind
 * utility. This is the same law read INSIDE the stylesheet: `globals.css` is
 * unlayered throughout, so between two of its own rules the winner is decided
 * by SPECIFICITY — and the shared focus-indicator block is only (0,2,0).
 *
 * `.iconbtn-*.iconbtn-toggle[aria-pressed="true"]` is (0,3,0) and sets a
 * `box-shadow` of its own (the inset accent ring). So a PRESSED toggle — the
 * sidebar strip toggles, the code/compile mode buttons — won the whole
 * property and the focus ring vanished, while the focus rule's `outline: none`
 * still applied: a keyboard-reachable control with NO indicator at all. That
 * is the same end state task 281 recorded for a control whose elevation is an
 * inline `box-shadow`, arriving from the other direction.
 *
 * The fix is a COMPOSITION, not a bigger literal: both halves are tokens
 * (`--focus-ring-shadow`, `--control-selected-inset-ring`) and the focused
 * twin reads both, so the ring is spelled once however many rules must carry
 * it. The legs below pin the two things a future edit could quietly break —
 * that the value has one spelling, and that the twin still out-specifies the
 * rule it composes with.
 */
describe("the focus ring is spelled once and always wins", () => {
  /** `selector { body }` pairs at depth 0, comments stripped. */
  const cssRules = (): { selector: string; body: string }[] => {
    const css = cssCommentsStripped(globals);
    const out: { selector: string; body: string }[] = [];
    let i = 0;
    let selStart = 0;
    let depth = 0;
    let bodyStart = -1;
    while (i < css.length) {
      const c = css[i];
      if (c === "{") {
        depth++;
        if (depth === 1) bodyStart = i + 1;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          out.push({
            selector: css.slice(selStart, bodyStart - 1).trim(),
            body: css.slice(bodyStart, i),
          });
          selStart = i + 1;
        }
      }
      i++;
    }
    return out;
  };

  /** (id, class/attr/pseudo-class, element) — enough to compare two selectors
   *  in the same unlayered sheet. Computed on the FIRST comma-part; every
   *  selector list this leg reads is homogeneous. */
  const specificity = (sel: string): [number, number, number] => {
    const s = sel.split(",")[0].trim();
    const ids = (s.match(/#[\w-]+/g) ?? []).length;
    const classes =
      (s.match(/\.[\w-]+/g) ?? []).length +
      (s.match(/\[[^\]]*\]/g) ?? []).length +
      (s.match(/:(?!:)[\w-]+/g) ?? []).length;
    const els = (s.match(/(?:^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
    return [ids, classes, els];
  };
  const gt = (a: number[], b: number[]) =>
    a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

  /** Every rule that paints a `box-shadow` on a control carrying the app's
   *  focus indicator. */
  const INDICATOR = /\.(?:focus-ring|topbarbtn|iconbtn-(?:xs|sm|md|lg))(?![\w-])/;
  const shadowRules = cssRules().filter(
    (r) => INDICATOR.test(r.selector) && /(?<![\w-])box-shadow\s*:/.test(r.body),
  );

  it("sees the rules worth censusing (self-check)", () => {
    // Exactly two: the shared indicator block, and the pressed-toggle pair
    // (its own rule plus the focused twin that composes with it).
    expect(shadowRules.length).toBe(3);
  });

  it("no rule re-spells the ring — every one reads a token", () => {
    for (const r of shadowRules) {
      const decl = /(?<![\w-])box-shadow\s*:([^;}]*)/.exec(r.body)?.[1] ?? "";
      expect(
        decl.trim(),
        `${r.selector.split(",")[0]} spells its own shadow`,
      ).toMatch(/^var\(--(?:focus-ring-shadow|control-selected-inset-ring)\)/);
    }
    // …and the ring's literal lives in the token home, once.
    expect(globals.match(/--focus-ring-shadow:\s*0 0 0 2px var\(--edge-strong\)/g) ?? [])
      .toHaveLength(1);
    expect(ruleBodies(cssCommentsStripped(globals))).not.toContain(
      "0 0 0 2px var(--edge-strong)",
    );
  });

  it("a pressed toggle's own box-shadow is out-specified by its focused twin", () => {
    const pressed = shadowRules.find(
      (r) => /aria-pressed/.test(r.selector) && !/:focus-visible/.test(r.selector),
    );
    const focused = shadowRules.find(
      (r) => /aria-pressed/.test(r.selector) && /:focus-visible/.test(r.selector),
    );
    expect(pressed, "the pressed-toggle rule went missing").toBeTruthy();
    expect(focused, "the pressed toggle has no focused twin — the ring vanishes").toBeTruthy();
    // The load-bearing claim: (0,4,0) beats (0,3,0), so the focused twin wins.
    expect(gt(specificity(focused!.selector), specificity(pressed!.selector))).toBe(true);
    // …and it must beat the SHARED block too, or it would never apply.
    const shared = shadowRules.find((r) => /\.focus-ring:focus-visible/.test(r.selector))!;
    expect(gt(specificity(focused!.selector), specificity(shared.selector))).toBe(true);
    // The twin COMPOSES rather than replacing: both halves paint.
    expect(focused!.body).toContain("var(--control-selected-inset-ring)");
    expect(focused!.body).toContain("var(--focus-ring-shadow)");
    // Its selector list covers all four sizes — a size left out is a size
    // whose pressed toggle silently keeps the pre-503 behaviour.
    for (const size of ["xs", "sm", "md", "lg"]) {
      expect(focused!.selector).toContain(`.iconbtn-${size}.iconbtn-toggle`);
    }
  });

  it("the specificity comparator CAN SEE an inversion (self-check)", () => {
    // A comparator that always answered `true` would make the leg above pass
    // on the pre-503 sheet, where the twin does not exist at all.
    expect(gt(specificity(".a:focus-visible"), specificity(".a.b[c]"))).toBe(false);
    expect(gt(specificity(".a.b[c]:focus-visible"), specificity(".a.b[c]"))).toBe(true);
    expect(gt(specificity(".focus-ring:focus-visible"), specificity(".focus-ring"))).toBe(true);
  });
});
