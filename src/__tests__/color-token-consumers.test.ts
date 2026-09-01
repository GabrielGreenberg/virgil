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

/**
 * An icon button states its ink through an `iconbtn-` VARIANT (task
 * 2026-08-31-509).
 *
 * The third member of the cascade-law family. Task 502 wrote the law down for
 * `background-color` and 503 for `box-shadow`; this is the same fact read on
 * `color`, and it is the worst of the three because `.iconbtn-*` writes that
 * property at BOTH rest (`--ink-muted`) and hover (`--ink-body`) — so on an
 * element carrying one of the four size utilities, EVERY Tailwind `text-*` /
 * `hover:text-*` paints nothing whatever the class order.
 *
 * Three shipped sites had that shape and two were bugs: a bib-field remove X
 * whose `hover:text-danger` never painted, and a meta-row button reading
 * `--ink-muted` while the `.card-mono` control eight lines up — which writes
 * no colour, so its utility survives — really did paint `--muted` beside it.
 * The third asked for `--ink-body` on a kebab trigger and had been painting
 * the family default since the day it shipped.
 *
 * The fix that makes this a law rather than three patches is the VARIANT
 * VOCABULARY: `iconbtn-danger-hover` (destructive when you reach for it) and
 * `iconbtn-meta` (the ratified 10px META-tier gray) are the two inks the
 * shipped sites asked for and the family could not express — which is also
 * why three OTHER controls left the family entirely and hand-rolled a 20px
 * box (see the residual note on the last leg).
 *
 * Two populations, both swept:
 *   - `src/app/globals.css` — the four `iconbtn-*` sizes and their variants.
 *   - `library/styles/library.css`, which is `@import`ed INTO globals.css and
 *     is therefore ALSO unlayered. Task 503's sweep named it as a second
 *     population and left it unswept; it is swept here and is CLEAN — its
 *     fifteen colour-writing classes (`.lib-dashboard-*`, `.lib-viewswitch-btn`,
 *     `.page-scroll-lozenge`) are each spelled alone at every call site, with
 *     no co-occurring ink utility anywhere in either silo. Leg 6 keeps it that
 *     way rather than recording the sweep in prose that outlives it.
 */
describe("an icon button states its ink through an iconbtn- VARIANT", () => {
  const productionTsx = (): string[] =>
    [...trackedFiles("src", /\.tsx$/), ...trackedFiles("library", /\.tsx$/)].filter(
      (p) => !p.includes("__tests__"),
    );

  /** Comments blanked, string literals KEPT, LINE-ALIGNED — the needle lives
   *  inside a `className` literal, so a `codeOnly`-style scan would make every
   *  leg here unfalsifiable (the trap `_source-scan.ts`'s header records). */
  const scan = (src: string) => strip(src, true, true);

  /** Every quoted/backticked string in a production `.tsx`, with the file and
   *  the line its opening quote sits on. A className is routinely a template
   *  literal split across lines, so a LINE grep sees `iconbtn-sm` and the
   *  `text-*` beside it as unrelated. */
  const classStrings = (): { at: string; s: string }[] => {
    const out: { at: string; s: string }[] = [];
    for (const abs of productionTsx()) {
      const rel = path.relative(REPO_ROOT, abs);
      const src = scan(readFileSync(abs, "utf8"));
      const re = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        out.push({
          at: `${rel}:${src.slice(0, m.index).split("\n").length}`,
          s: m[2].replace(/\s+/g, " ").trim(),
        });
      }
    }
    return out;
  };

  const ICONBTN = /\biconbtn-(?:xs|sm|md|lg)\b/;
  /** A utility that writes `color` / `fill` / `stroke`, in any state prefix.
   *  `text-xs` / `text-left` are NOT ink and must not be flagged — the needle
   *  therefore requires the value to look like a colour token or an arbitrary
   *  value, never a size or an alignment keyword. */
  const INK_UTILITY =
    /(?:^|[\s])(?:hover:|focus:|focus-visible:|active:|disabled:|group-hover:)?(?:text|fill|stroke)-(?:\[|ink-|danger|positive|accent|amber-|white\b|black\b|current\b|muted\b|transparent\b)/;

  it("has no `text-*` ink utility on an element that also carries `iconbtn-*`", () => {
    // A hit is ADD-THE-VARIANT (or delete the utility, if it restates the
    // family default). This allowlist stays EMPTY: there is no shape for which
    // a dead declaration is the right way to say what ink a control takes.
    const hits = classStrings()
      .filter((c) => ICONBTN.test(c.s) && INK_UTILITY.test(c.s))
      .map((c) => `${c.at}  ${c.s.slice(0, 90)}`);
    expect(hits).toEqual([]);
  });

  /** Every `iconbtn-` class spelled in production that is NOT one of the four
   *  sizes — i.e. every variant a call site claims exists. */
  const variantsUsed = (): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const c of classStrings()) {
      if (!ICONBTN.test(c.s)) continue;
      for (const m of c.s.matchAll(/\biconbtn-[\w-]+\b/g)) {
        if (/^iconbtn-(?:xs|sm|md|lg)$/.test(m[0])) continue;
        out.set(m[0], [...(out.get(m[0]) ?? []), c.at]);
      }
    }
    return out;
  };

  it("declares every variant a call site claims", () => {
    // A misspelled variant is the silent failure this law is most likely to
    // produce next: it matches no rule, so the control paints the family
    // default and looks deliberate. TypeScript cannot see a class name.
    const css = cssCommentsStripped(globals);
    for (const [variant, sites] of variantsUsed()) {
      expect(
        css,
        `${variant} is spelled at ${sites.join(", ")} and declared nowhere`,
      ).toMatch(new RegExp(`\\.iconbtn-(?:xs|sm|md|lg)\\.${variant}(?![\\w-])`));
    }
  });

  /** A variant declared with no caller, and the reason it is allowed to stay.
   *  This list may only SHRINK — an entry is a claim, not a habit. */
  const PERMITTED_UNUSED_VARIANTS: Record<string, string> = {
    "iconbtn-on-dark":
      "a CONTEXT variant (the hover fill for an icon button on a tinted card header), correct and well-named; its consumers left with the deleted TargetIcon/TargetFileIcon. Whether a tinted-header icon button needs it TODAY is a visual question a worktree cannot answer — routed rather than guessed.",
  };

  it("keeps no variant that nothing spells", () => {
    // The dual, and the reason `.iconbtn-accent` is gone rather than
    // allowlisted: it was hover-only despite a name the vocabulary reads as
    // rest+hover, so keeping it would ship the naming rule with a
    // counter-example inside it — and it had ZERO callers in either silo, its
    // docstring named three consumers that no longer spell it, and no control
    // anywhere hand-rolls an accent hover. WIRE-it-or-DELETE-it (task 202's
    // law, one medium over).
    const css = cssCommentsStripped(globals);
    const declared = new Set(
      [...css.matchAll(/\.iconbtn-(?:xs|sm|md|lg)\.(iconbtn-[\w-]+)/g)].map((m) => m[1]),
    );
    const used = new Set(variantsUsed().keys());
    const unused = [...declared].filter((v) => !used.has(v)).sort();
    expect(unused).toEqual(Object.keys(PERMITTED_UNUSED_VARIANTS).sort());
    // …and every variant a call site spells must be declared (leg above), so
    // the two sets differ by exactly the stated exemptions.
    expect([...used].filter((v) => !declared.has(v))).toEqual([]);
  });

  /** The naming rule the vocabulary now states: `iconbtn-<role>` owns the ink
   *  at REST, `iconbtn-<role>-hover` owns the HOVER ink only. A `-hover`
   *  variant whose rule is not `:hover`-qualified would silently paint at rest;
   *  a rest variant that out-specifies the base `:hover` block would stop the
   *  button darkening. Both are invisible to any render test. */
  it("holds every UNQUALIFIED rest-ink variant to the naming rule", () => {
    // Scope: a rule whose selector is exactly `.iconbtn-<size>.<variant>` with
    // NOTHING further. A STATE variant (`.iconbtn-toggle[aria-pressed="true"]`)
    // is qualified, sits at (0,3,0) and legitimately out-specifies the base
    // hover — a pressed toggle keeps its accent ink under the cursor, which is
    // the intent. Only an unqualified (0,2,0) rule ties with `.iconbtn-<size>:hover`
    // and is decided by source order.
    const css = cssCommentsStripped(globals);
    for (const [variant] of variantsUsed()) {
      const m = new RegExp(
        `\\.iconbtn-lg\\.${variant}(:not\\(:hover\\))?\\s*\\{([^}]*)\\}`,
      ).exec(css);
      if (!m) continue; // qualified, or hover-only — not this leg's subject
      if (!/(?<![\w-])color\s*:/.test(m[2] ?? "")) continue;
      expect(
        m[1],
        `${variant} states a REST ink without :not(:hover) — it ties with the base :hover rule and would win it on source order`,
      ).toBe(":not(:hover)");
    }
    // …and the two shipped ink variants, pinned by name so a rename has to be
    // a deliberate edit here rather than a silent no-op at every call site.
    expect(css).toMatch(
      /\.iconbtn-lg\.iconbtn-danger-hover:hover[^{]*\{[^}]*color:\s*var\(--danger\)/,
    );
    expect(css).toMatch(
      /\.iconbtn-lg\.iconbtn-meta:not\(:hover\)[^{]*\{[^}]*color:\s*var\(--muted\)/,
    );
  });

  it("CAN SEE a swallowed ink utility (synthetic canary)", () => {
    // A census that reports zero must be shown to report non-zero, or "clean"
    // and "blind" look identical. Both retired spellings, plus the two shapes
    // that must NOT flag: a size/alignment `text-*`, and an ink utility on an
    // element that carries no `iconbtn-*` at all.
    const fixture =
      'const a = "iconbtn-sm text-ink-muted hover:text-danger";\n' +
      'const b = "iconbtn-sm text-[var(--muted)] hover:text-ink-body";\n' +
      'const c = "iconbtn-sm text-xs text-left";\n' +
      'const d = "rounded text-ink-body hover:text-danger";\n';
    const found = [...scan(fixture).matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
      .map((m) => m[2])
      .filter((s) => ICONBTN.test(s) && INK_UTILITY.test(s));
    expect(found).toHaveLength(2);
    // …and the needle survives the stripper it runs through.
    expect(scan('// iconbtn-sm text-ink-muted in prose\n')).not.toContain("iconbtn-sm");
  });

  /**
   * The residue, and a correction to the sweep that filed this task.
   *
   * That sweep reported eight sites spelling `transition-colors` beside an
   * unlayered interaction utility as "dead-but-harmless, worth a sweep". Read
   * as whole className EXPRESSIONS rather than as lines, all eight turn out to
   * be CONDITIONAL — the utility sits in one branch of a ternary and the
   * `transition-colors` in the static prefix, where it is LIVE for the other
   * branch (an `active` / `selected` state that changes bg, border and ink with
   * no unlayered class on it). Deleting them would have removed a working
   * transition from eight controls.
   *
   * So the rule is narrower than the sweep stated, and this is it: a transition
   * utility is dead only where the unlayered class is UNCONDITIONAL. That set
   * is empty today and this keeps it empty.
   */
  it("leaves no transition utility beside an UNCONDITIONAL unlayered class", () => {
    const UNLAYERED = /\b(?:hover-on-light|hover-on-dark|iconbtn-(?:xs|sm|md|lg)|topbarbtn)\b/;
    const dead: string[] = [];
    for (const c of classStrings()) {
      if (!/\btransition-(?:colors|opacity|all)\b/.test(c.s)) continue;
      if (!UNLAYERED.test(c.s)) continue;
      // A `${…}` hole or a `?` means the utility may be absent in some branch,
      // and then the transition utility is the only one that state has.
      if (/[?$]/.test(c.s)) continue;
      dead.push(`${c.at}  ${c.s.slice(0, 90)}`);
    }
    expect(dead).toEqual([]);
  });

  /**
   * The family completion. `:hover` matches a disabled `<button>` in every
   * browser, and `.hover-on-light` / `.hover-on-dark` are unlayered — so a
   * caller's `disabled:hover:bg-transparent` loses and a control disabled by
   * default paints its hover fill anyway. Eleven shipped sites pair one of
   * those two utilities with a `disabled:` treatment; exactly one escaped, and
   * only because it spelled `disabled:pointer-events-none` — a property the
   * utility does not write, so it never competed.
   *
   * The other three unlayered interaction utilities already modelled it
   * (`.iconbtn-*[disabled]` / `.topbarbtn[disabled]` set `pointer-events:
   * none`); these two now do, by killing the FILL rather than pointer events,
   * because they are worn by non-button elements whose cursor and `data-hint`
   * tooltip must survive.
   */
  it("gives the two hover utilities a disabled rule, and no site re-spells it", () => {
    const css = cssCommentsStripped(globals);
    for (const cls of ["hover-on-light", "hover-on-dark"]) {
      for (const q of ['[disabled]', '[aria-disabled="true"]']) {
        expect(css, `${cls}${q} has no disabled hover rule`).toContain(`.${cls}${q}:hover`);
      }
    }
    expect(css).toMatch(
      /\.hover-on-dark\[aria-disabled="true"\]:hover\s*\{[^}]*background-color:\s*transparent/,
    );
    // A hit is DELETE-it: the utility loses to the unlayered rule, so a site
    // spelling it is announcing an intent it does not get.
    const respelt = classStrings()
      .filter((c) => /\bdisabled:hover:bg-/.test(c.s))
      .map((c) => c.at);
    expect(respelt).toEqual([]);
  });

  /**
   * `library/styles/library.css` — the SECOND unlayered population, named as a
   * stated limit by task 503's sweep and swept here. Its colour-writing classes
   * are DISCOVERED from the sheet rather than listed, so a new one is covered
   * by shipping.
   *
   * Residual, stated rather than implied: three controls
   * (`SourcePodNodeView.tsx`'s pod-delete, `CitationCard.tsx`'s two row-remove
   * X's) hand-roll a 20px box with `hover-on-light` + `focus-ring` + their own
   * `hover:text-danger` INSTEAD of joining the family — and they paint
   * correctly, because `.hover-on-light` writes only `background-color`. They
   * are outside this census's population by construction, and the STYLE_GUIDE
   * sanctions the shape ("a button whose ink is accent-when-active —
   * `iconbtn-*` would win the colour"). What changed is that the reason is now
   * one case weaker: `iconbtn-danger-hover` expresses two of the three exactly.
   * Converging them moves visible rest inks, so it is a deliberate visual call
   * and not a fix — left for one.
   */
  it("finds no swallowed ink utility in the library.css population either", () => {
    const libCss = cssCommentsStripped(
      readFileSync(path.join(REPO_ROOT, "library/styles/library.css"), "utf8"),
    );
    const colourClasses = new Set<string>();
    for (const m of libCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim();
      if (sel.startsWith("@") || sel.startsWith(":")) continue;
      if (!/(?<![\w-])color\s*:/.test(m[2])) continue;
      for (const c of sel.matchAll(/(?:^|[\s,>])\.([\w-]+)/g)) colourClasses.add(c[1]);
    }
    // The sweep must have something to sweep, or it passes by finding nothing.
    expect(colourClasses.size).toBeGreaterThan(5);
    const needle = new RegExp(`\\b(?:${[...colourClasses].join("|")})\\b`);
    const hits = classStrings()
      .filter((c) => needle.test(c.s) && INK_UTILITY.test(c.s))
      .map((c) => `${c.at}  ${c.s.slice(0, 90)}`);
    expect(hits).toEqual([]);
  });
});
