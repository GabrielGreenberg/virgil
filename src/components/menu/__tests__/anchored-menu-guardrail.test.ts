// Anchored-menu guardrail — the grep-allowlist sibling of the keystroke,
// scroll-reposition, pane-drag, window-resize, transient-highlight and
// container-fit censuses, covering the "hand-rolled anchored dropdown" class
// (task 143; doctrine: STYLE_GUIDE "Menus").
//
// The law: *a menu anchored to a trigger is built on the `<Menu>` primitive*
// (`MenuProvider` / `AnchoredMenu` / `useFloatingMenuPosition`) — never a
// bespoke `getBoundingClientRect()` → `pos` state → `position: fixed` surface
// with its own `document.addEventListener("mousedown")` closer.
//
// Why this census exists, and why it is the guard that catches the ORIGINAL
// shape. The law was not missing: `MenuProvider` shipped, `ItemMenu` folded
// onto it, and the STYLE_GUIDE has declared it canonical ("don't hand-roll a
// portal + `z-[9999]` + a bespoke mousedown closer") since. What was missing
// was anything that FAILED when a menu ignored it — so three dropdowns kept
// their hand-rolls for release after release, and each dropped a different
// subset of the guards the primitive provides:
//
//   - `OmniFilterMenu` set `top = rect.bottom + 4` with no flip, no clamp and
//     no `max-height`, on a trigger pinned to the BOTTOM of the strip — so on a
//     short viewport its whole "Display" cluster rendered below the fold with
//     nothing to scroll. A user-facing bug, not a tidiness complaint.
//   - `HeaderAddDropdown` DID flip — off a hard-coded `POPUP_H = 28 · n + 8`
//     estimate no row height was ever checked against, with no clamp behind it.
//   - Search's `MoreScopesDropdown` had no flip in either axis, and no menu
//     semantics at all: ✓ glyphs with no `aria-checked` for them to mean.
//
// None of them repositioned on resize, and none closed on Escape.
//
// The census is scoped to the enclosing DECLARATION, not the file, and that is
// load-bearing: `HeaderAddDropdown` lived in `panel-primitives.tsx`, the same
// file whose `ItemMenu` had already migrated. A file-level participation test
// reads that import and reports the whole file compliant — which is precisely
// how the worst of the three would have escaped its own guard.
//
// Two legs, mirroring the window-resize sibling:
//   1. CENSUS — every declaration that positions a shadowed `fixed`/`absolute`
//      surface from a rect it measures itself is either compliant or listed.
//   2. PARTICIPATION (the leg with teeth) — a censused declaration must
//      actually reference the primitive, unless it is on the allowlist with a
//      why-not justification. Leg 1 alone only proves someone looked.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../../library"); // the Library silo

/**
 * Declarations that position an anchored surface themselves and are NOT on the
 * primitive. Keyed `<repo-relative file>::<declaration>`; every entry says why
 * it is not simply a missed migration.
 *
 * `src/` is drained of MENUS. What remains is one float shell that trips the
 * shape without being a menu — and the two Library-silo holdouts, which are
 * real follow-ups rather than exemptions.
 */
const PERMITTED_HAND_ROLLED_ANCHORED_SURFACES: Record<string, string> = {
  "src/components/FloatingPanel.tsx::FloatingPanelInner":
    "NOT AN ANCHORED MENU — a draggable/resizable float shell (the tool-window taxonomy: `SystemDialog variant=\"draggable\"` / FLOAT_Z tiers), whose position is the user's own drag state persisted per float, not a placement solved against a trigger. It measures rects to CLAMP a dragged window inside the viewport. Nothing about the menu primitive fits it; it would have to grow a drag engine to accept one.",
  "library/components/RowMenu.tsx::RowMenu":
    "LIBRARY-SILO HOLDOUT (known follow-up, not an exemption). The catalog row kebab: portal + `position:fixed`, `role=\"menu\"`, Escape, and a deferred outside-mousedown — so it is the most complete of the hand-rolls — but it flips off an `items.length * ITEM_HEIGHT` ESTIMATE (the `HeaderAddDropdown` mistake), never flips horizontally, and never re-anchors. The silo CAN import the primitive (`PanelTabStrip` already imports `useFloatingMenuPosition`), so this is a migration nobody has done yet.",
  "library/components/PaperAiRequestsMenu.tsx::PaperAiRequestsMenu":
    "LIBRARY-SILO HOLDOUT (known follow-up, not an exemption). The per-paper AI-request checkbox menu: `top`/`left` from the trigger rect with NO flip in either axis, so it runs off the bottom of a short window. It is also the ONE menu in either silo that restores focus to its trigger on Escape — a capability the shared primitive does not have (it navigates by roving `aria-activedescendant` and never focuses items), so migrating it means teaching the primitive focus return, not just swapping the shell.",
};

/** Referencing any of these IS building on the primitive. */
const PRIMITIVE_API =
  /\b(?:MenuProvider|AnchoredMenu|useFloatingMenuPosition|useMenuItem|MenuToggleRow|MenuActionRow)\b/;

/** Strip comments so the doctrine prose in this repo (which quotes the guarded
 *  literals heavily, including in this very file) can't read as live code. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * The guarded shape, in BOTH forms it is written in. A Tailwind className
 * carrying a positioned + shadowed surface, and the inline-style object the
 * Library silo uses instead (`position: "fixed"` near a `boxShadow`) — a census
 * narrower than its doctrine is the hole that let a `document.body` listener
 * through the pane-drag guard (task 187), and here it would have made the whole
 * `library/` silo invisible.
 */
const SURFACE_CLASS =
  /className=(?:"|\{`|\{")[^"`]*?\b(?:fixed|absolute)\b[^"`]*?\b(?:shadow-lg|shadow-xl|shadow-md)\b|className=(?:"|\{`|\{")[^"`]*?\b(?:shadow-lg|shadow-xl|shadow-md)\b[^"`]*?\b(?:fixed|absolute)\b/;
const SURFACE_STYLE =
  /position:\s*["']fixed["'][\s\S]{0,400}?boxShadow|boxShadow[\s\S]{0,400}?position:\s*["']fixed["']/;

export function declaresAnchoredSurface(block: string): boolean {
  return (
    block.includes("getBoundingClientRect") &&
    (SURFACE_CLASS.test(block) || SURFACE_STYLE.test(block))
  );
}

export function usesMenuPrimitive(block: string): boolean {
  return PRIMITIVE_API.test(block);
}

/**
 * TOP-LEVEL declarations (column 0), sliced by their opening line — the unit a
 * component is written in, and the unit the allowlist can name stably.
 *
 * Deliberately not finer. Splitting on indented declarations too would attach
 * each literal to whatever inner `const handleX = () => …` happened to precede
 * it — unstable names that any refactor invalidates, and a `getBoundingClientRect`
 * separated from the JSX it positions. The residual, stated rather than
 * papered over: a hand-rolled menu written as an INDENTED inner component is
 * attributed to its enclosing top-level declaration, so an enclosing component
 * that uses the primitive elsewhere would vouch for it. The case this census
 * was built to catch is the real one — `HeaderAddDropdown` and `ItemMenu` as
 * SIBLINGS in one file, where a file-level test reads the migrated sibling's
 * import and pronounces the hand-roll compliant.
 */
const DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/gm;

export function splitDeclarations(
  source: string,
): Array<{ name: string; block: string }> {
  const matches = [...source.matchAll(DECL)];
  return matches.map((m, i) => ({
    name: m[1],
    block: source.slice(m.index ?? 0, matches[i + 1]?.index ?? source.length),
  }));
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function censusBothSilos(): Array<{ key: string; block: string }> {
  const hits: Array<{ key: string; block: string }> = [];
  for (const [prefix, root] of [
    ["src", SRC],
    ["library", LIBRARY],
  ] as const) {
    for (const file of walkSource(root)) {
      const rel = `${prefix}/${path.relative(root, file).split(path.sep).join("/")}`;
      const source = stripComments(readFileSync(file, "utf8"));
      if (!source.includes("getBoundingClientRect")) continue;
      for (const { name, block } of splitDeclarations(source)) {
        if (!declaresAnchoredSurface(block)) continue;
        hits.push({ key: `${rel}::${name}`, block });
      }
    }
  }
  return hits;
}

describe("anchored-menu guardrail — the census (both silos)", () => {
  const hits = censusBothSilos();

  it("flags exactly the allowlisted hand-rolled anchored surfaces", () => {
    // An EXTRA entry means a new anchored popup positions itself. Before
    // listing it, put it on the primitive: `<AnchoredMenu>` for a
    // trigger-anchored menu, `MenuProvider` when the caller already owns the
    // open state, `useFloatingMenuPosition` for a caret/point-anchored popover.
    // The allowlist is for surfaces the primitive genuinely does not model.
    expect(hits.map((h) => h.key).sort()).toEqual(
      Object.keys(PERMITTED_HAND_ROLLED_ANCHORED_SURFACES).sort(),
    );
  });

  it("keeps the allowlist free of stale entries", () => {
    const found = new Set(hits.map((h) => h.key));
    for (const key of Object.keys(PERMITTED_HAND_ROLLED_ANCHORED_SURFACES)) {
      expect(
        found.has(key),
        `${key} no longer hand-rolls an anchored surface — drop its allowlist entry`,
      ).toBe(true);
    }
  });
});

describe("anchored-menu guardrail — doctrine participation", () => {
  it("every censused declaration is allowlisted (nothing hand-rolls silently)", () => {
    // The leg with teeth, at DECLARATION granularity: a file-level test would
    // have read `panel-primitives.tsx`'s `MenuProvider` import — pulled in for
    // `ItemMenu` — and pronounced the hand-rolled `HeaderAddDropdown` sitting
    // 200 lines above it compliant.
    const offenders = censusBothSilos()
      .filter(
        (h) =>
          !Object.prototype.hasOwnProperty.call(
            PERMITTED_HAND_ROLLED_ANCHORED_SURFACES,
            h.key,
          ),
      )
      .map((h) => h.key);
    expect(offenders).toEqual([]);
  });

  it("no src/ MENU hand-rolls its own placement (the class this task drained)", () => {
    const menuish = censusBothSilos().filter(
      (h) =>
        h.key.startsWith("src/") &&
        /Menu|Dropdown|Popup|Kebab/i.test(h.key.split("::")[1] ?? ""),
    );
    expect(menuish.map((h) => h.key)).toEqual([]);
  });
});

describe("anchored-menu guardrail — detector fixtures", () => {
  it("flags the plain shape a new hand-rolled dropdown would be written in", () => {
    const naive = `
      function MyDropdown() {
        const [pos, setPos] = useState({ top: 0, left: 0 });
        useEffect(() => {
          const r = btnRef.current.getBoundingClientRect();
          setPos({ top: r.bottom + 4, left: r.left });
          document.addEventListener("mousedown", close);
        }, [open]);
        return <div className="fixed bg-surface rounded-lg shadow-lg z-[9999]" style={pos} />;
      }
    `;
    expect(declaresAnchoredSurface(naive)).toBe(true);
    expect(usesMenuPrimitive(naive)).toBe(false);
  });

  it("flags the inline-style form the Library silo writes (a narrow census is the task-187 hole)", () => {
    const inline = `
      const RowThing = () => {
        const r = ref.current.getBoundingClientRect();
        return createPortal(
          <div style={{ position: "fixed", top: r.bottom, boxShadow: "var(--pod-shadow)" }} />,
          document.body,
        );
      };
    `;
    expect(declaresAnchoredSurface(inline)).toBe(true);
  });

  it("does not flag a menu that measures its trigger and hands the rect to the primitive", () => {
    const compliant = `
      function GoodMenu() {
        const toggle = () => setAnchorRect(btnRef.current.getBoundingClientRect());
        return <AnchoredMenu ariaLabel="Options" trigger={() => "x"}>{rows}</AnchoredMenu>;
      }
    `;
    expect(usesMenuPrimitive(compliant)).toBe(true);
  });

  it("splits declarations so a compliant sibling can't cover a hand-rolled one", () => {
    // Column-0 declarations, as real source writes them — this IS the
    // `HeaderAddDropdown` / `ItemMenu` shape that motivated the split.
    const twoDecls = [
      `function Migrated() { return <MenuProvider anchorRect={r} />; }`,
      `function HandRolled() {`,
      `  const r = ref.current.getBoundingClientRect();`,
      `  return <div className="fixed shadow-lg" style={{ top: r.bottom }} />;`,
      `}`,
    ].join("\n");
    const decls = splitDeclarations(twoDecls);
    const flagged = decls.filter((d) => declaresAnchoredSurface(d.block));
    expect(flagged.map((d) => d.name)).toEqual(["HandRolled"]);
    expect(usesMenuPrimitive(flagged[0].block)).toBe(false);
  });
});
