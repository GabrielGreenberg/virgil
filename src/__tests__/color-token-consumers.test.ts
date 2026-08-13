import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cssRuleBodies } from "@/lib/__tests__/_source-scan";

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
