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

//
// ── Where the detectors live (task 459) ────────────────────────────────────
// The population, the three surface signals and the per-entry CLASSIFICATION
// moved to `./_menu-census.ts`, because `menu-surface-guardrail` asks a SECOND
// question of the SAME population (does this menu paint its own chrome?) and
// two censuses that discover their populations separately drift into two ideas
// of what a floating menu is — which is exactly the hole task 459 closed. The
// legs below are unchanged; only their inputs are now imported.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CARET_ANCHOR,
  LIBRARY,
  MEASURED_ANCHOR_FOR_TEST,
  PERMITTED_HAND_ROLLED_ANCHORED_SURFACES,
  SRC,
  censusBothSilos,
  declaresAnchoredSurface,
  isCssAnchored,
  splitDeclarations,
  stripComments,
  usesMenuPrimitive,
  walkSource,
} from "./_menu-census";

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
  it("the primitive check is what keeps the allowlist small — not a wider net", () => {
    // Guards the ordering above: `usesMenuPrimitive` runs INSIDE the census, so
    // if someone renames a primitive symbol out of `PRIMITIVE_API` (or deletes
    // the check), the six already-migrated menus that trip the surface signals
    // reappear as violations rather than silently passing. This asserts the
    // check is load-bearing, which is exactly what an earlier draft of this file
    // got wrong: it declared a participation leg and never called it.
    const withoutPrimitiveCheck: string[] = [];
    for (const [prefix, root] of [
      ["src", SRC],
      ["library", LIBRARY],
    ] as const) {
      for (const file of walkSource(root)) {
        const rel = `${prefix}/${path.relative(root, file).split(path.sep).join("/")}`;
        const source = stripComments(readFileSync(file, "utf8"));
        for (const { name, block } of splitDeclarations(source)) {
          if (declaresAnchoredSurface(block)) withoutPrimitiveCheck.push(`${rel}::${name}`);
        }
      }
    }
    expect(withoutPrimitiveCheck.length).toBeGreaterThan(
      censusBothSilos().length,
    );
  });

  it("every src/ MENU that hand-rolls its own placement is one this task NAMED", () => {
    // Classified by what the declaration IS, not by what it is CALLED. The
    // previous form filtered on `/Menu|Dropdown|Popup|Kebab/i` over the
    // declaration NAME and asserted empty — which was true when written and
    // became false the moment three real hand-rolled menus were allowlisted as
    // follow-ups: not one of `FontPicker`, `MyPapersPod`, `StatusClusterImpl`
    // matches that regex, so the leg whose whole job is "has this class come
    // back?" reported drained while three menus in `src/` still hand-rolled
    // their placement. A name-shaped test of a structural property will go
    // quietly wrong exactly when the next offender is named something else.
    //
    // So: ask the BLOCK whether it declares menu semantics, and pin the answer
    // to an explicit set. A new `src/` menu must be stated here — an allowlist
    // entry alone can no longer absorb it silently.
    const KNOWN_SRC_MENU_HOLDOUTS = [
      "src/components/FontPicker.tsx::FontPicker",
      "src/components/SlashCommandPopup.tsx::SlashCommandPopup",
      "src/components/editor-layout/StatusCluster.tsx::StatusClusterImpl",
      "src/components/library/MyPapersPod.tsx::MyPapersPod",
    ];
    // The classification is the ENTRY'S OWN JUSTIFICATION, not a second guess at
    // it. `NOT AN ANCHORED MENU` is a claim an author had to write and leg 1
    // keeps honest (a stale entry fails); everything else is a menu whose
    // migration is outstanding, and must be named right here. A content-sniffing
    // predicate would have been a third description of the same fact — and the
    // one most likely to drift, since `FontPicker` declares no menu ARIA at all
    // and would have sniffed as "not a menu" while being the clearest holdout of
    // the three.
    const srcMenus = censusBothSilos()
      .filter((h) => h.key.startsWith("src/"))
      .filter(
        (h) =>
          !(PERMITTED_HAND_ROLLED_ANCHORED_SURFACES[h.key] ?? "").startsWith(
            "NOT AN ANCHORED MENU",
          ),
      )
      .map((h) => h.key)
      .sort();
    expect(srcMenus).toEqual([...KNOWN_SRC_MENU_HOLDOUTS].sort());
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

  // The three evasions the first draft of this census shipped, each pinned so
  // the widened detector can't be narrowed back by a later "simplification".
  it("flags a surface whose class and shadow live in DIFFERENT places (the repo's own idiom)", () => {
    const split = `
      function MixedMenu() {
        const r = ref.current.getBoundingClientRect();
        return (
          <div
            className="fixed rounded-lg py-1"
            style={{ top: r.bottom, left: r.left, boxShadow: "var(--pod-shadow)" }}
          />
        );
      }
    `;
    expect(declaresAnchoredSurface(split)).toBe(true);
  });

  it("flags a token shadow (`shadow-[var(--pod-shadow)]`, `shadow-ambient`) — a closed lg|md|xl list missed both", () => {
    for (const token of ["shadow-[var(--pod-shadow)]", "shadow-ambient", "shadow-sm"]) {
      const tokened = `
        function TokenMenu() {
          const r = ref.current.getBoundingClientRect();
          return <div className={\`fixed bg-surface rounded-lg ${token} py-1\`} style={{ top: r.bottom }} />;
        }
      `;
      expect(declaresAnchoredSurface(tokened), token).toBe(true);
    }
  });

  it("flags a POINT-anchored menu (right-click at clientX/clientY) — same class minus the rect", () => {
    const contextMenu = `
      function ContextMenu({ event }) {
        const [pos] = useState({ top: event.clientY, left: event.clientX });
        useEffect(() => {
          document.addEventListener("mousedown", close);
        }, []);
        return <div className="fixed bg-surface shadow-lg z-[9999]" style={pos} />;
      }
    `;
    expect(declaresAnchoredSurface(contextMenu)).toBe(true);
    expect(usesMenuPrimitive(contextMenu)).toBe(false);
  });

  it("flags a template-literal className with a quoted ternary between the tokens", () => {
    const ternary = `
      function TernaryMenu() {
        const r = ref.current.getBoundingClientRect();
        return <div className={\`fixed \${dark ? "bg-black" : "bg-surface"} rounded-lg shadow-lg py-1\`} style={{ top: r.bottom }} />;
      }
    `;
    expect(declaresAnchoredSurface(ternary)).toBe(true);
  });

  // ── The CSS-anchored dialect (task 181). Each of these is a VERBATIM
  //    reduction of a surface that sat in `src/` while this census was green.
  it("flags a CSS-anchored dropdown that reads NO rect (the task-181 hole)", () => {
    // `PanelThemePicker` as it shipped: `absolute … top-full`, `shadow-lg`,
    // `z-[9999]`, a hand-rolled mousedown closer, and not one rect read — so
    // the measured-anchor signal alone reported it compliant.
    const cssAnchored = `
      function PanelThemePicker() {
        const [open, setOpen] = useState(false);
        useEffect(() => {
          document.addEventListener("mousedown", onDocClick);
        }, [open]);
        return (
          <div className="relative">
            <button onClick={() => setOpen(o => !o)} />
            {open && (
              <div className="absolute right-0 top-full mt-1 bg-surface border rounded-lg shadow-lg p-2 z-[9999]" />
            )}
          </div>
        );
      }
    `;
    expect(cssAnchored).not.toMatch(MEASURED_ANCHOR_FOR_TEST);
    expect(declaresAnchoredSurface(cssAnchored)).toBe(true);
    expect(usesMenuPrimitive(cssAnchored)).toBe(false);
  });

  it("flags an absolute surface offset by a MARGIN with no `*-full` edge (the FontPicker shape)", () => {
    // `left-0 right-0 mt-1` — anchored to the wrapper's edge just as surely,
    // with none of the `top-full` vocabulary an edge-only detector looks for.
    const gapped = `
      function FontPicker() {
        return open && (
          <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg border bg-surface shadow-lg" />
        );
      }
    `;
    expect(declaresAnchoredSurface(gapped)).toBe(true);
  });

  it("flags the INLINE-STYLE CSS anchor (`top: \"100%\"`) — the Library silo's dialect", () => {
    // The same split the SHADOWED detector already had to learn: this repo
    // writes half its chrome in classes and half in inline styles, and a
    // detector fluent in only one reads the other as absent.
    const inlineEdge = `
      const MyPapersPod = () => (
        popupOpen && (
          <div
            role="menu"
            style={{ position: "absolute", top: "100%", left: 6, marginTop: 2, boxShadow: "var(--pod-shadow)", zIndex: 50 }}
          />
        )
      );
    `;
    expect(declaresAnchoredSurface(inlineEdge)).toBe(true);
  });

  it("flags a MULTI-LINE conditional className — the idiom this repo actually writes", () => {
    // The near-miss the first draft of this leg shipped: every dialect anchored
    // on `className=[^\n]*`, so the moment a class list wrapped (which it does
    // as soon as it carries a ternary) the detector read the surface as having
    // no anchor edge. A census widened to catch a dialect, still blind to it in
    // the form the codebase writes.
    const wrapped = `
      function WrappedMenu() {
        return open && (
          <div
            className={\`absolute z-50 rounded-lg shadow-lg
              \${align === "end" ? "right-0" : "left-0"}
              top-full mt-1\`}
          />
        );
      }
    `;
    expect(declaresAnchoredSurface(wrapped)).toBe(true);
  });

  it("flags the arbitrary-value and decimal spellings of the same two offsets", () => {
    for (const cls of [
      "absolute top-[100%] mt-1 shadow-lg",
      "absolute top-[calc(100%+4px)] shadow-lg",
      "absolute right-0 mb-1.5 shadow-lg",
      "absolute left-0 mt-[3px] shadow-lg",
    ]) {
      expect(declaresAnchoredSurface(`<div className="${cls}" />`), cls).toBe(true);
    }
    // …and the inline `calc` form of the edge.
    expect(
      declaresAnchoredSurface(
        `<div style={{ position: "absolute", top: "calc(100% + 4px)", boxShadow: "var(--pod-shadow)" }} />`,
      ),
    ).toBe(true);
  });

  // ── The CARET dialect (task 459). A VERBATIM reduction of the surface that
  //    sat in `src/` while BOTH censuses were green.
  it("flags a CARET-anchored popup that reads no rect and mounts no provider (the task-459 hole)", () => {
    // `SlashCommandPopup` as it shipped: placed from `view.coordsAtPos`, which
    // is ProseMirror's rect read through the editor's API rather than the
    // DOM's — so the measured-anchor signal saw nothing, the CSS-edge signal
    // saw nothing (its offsets are computed numbers, not `top-full`), and it
    // mounts no `<MenuProvider>`, so the SURFACE census never looked at it
    // either. Two censuses, one surface, zero coverage.
    const caretAnchored = `
      function SlashCommandPopup() {
        const c = view.coordsAtPos(state.slashPos);
        let top = c.bottom + GAP;
        if (top + popupHeight > vh - VIEWPORT_MARGIN) top = c.top - popupHeight - GAP;
        return createPortal(
          <div
            className="slash-command-popup bg-surface border border-edge-subtle rounded shadow-md py-1"
            style={{ position: "fixed", left, top, zIndex: OPEN_CHROME_MENU_Z }}
          />,
          document.body,
        );
      }
    `;
    // Invisible to BOTH pre-459 dialects — which is what makes the caret
    // dialect the thing that catches it rather than an old signal doing so
    // incidentally.
    expect(caretAnchored).not.toMatch(MEASURED_ANCHOR_FOR_TEST);
    expect(isCssAnchored(caretAnchored)).toBe(false);
    expect(CARET_ANCHOR.test(caretAnchored)).toBe(true);
    expect(declaresAnchoredSurface(caretAnchored)).toBe(true);
    expect(usesMenuPrimitive(caretAnchored)).toBe(false);
  });

  it("keeps watching a caret popup that adopts the shared surface (the reward-for-hiding trap)", () => {
    // The half the retone exposed: once a menu stamps `.menu-surface`, its TSX
    // declares no shadow, so a SHADOWED signal spelled only as `shadow-*` /
    // `boxShadow` dropped the whole declaration — and its hand-rolled
    // PLACEMENT went unowned as a reward for fixing its CHROME. Measured when
    // 459 landed: `FontPicker` and `StatusClusterImpl` both vanished from the
    // population on adoption. `.menu-surface` IS the shadow.
    const adopted = `
      function SlashCommandPopup() {
        const c = view.coordsAtPos(state.slashPos);
        return createPortal(
          <div className="slash-command-popup menu-surface py-1" style={{ position: "fixed", left, top }} />,
          document.body,
        );
      }
    `;
    expect(adopted).not.toMatch(/shadow-|boxShadow/);
    expect(declaresAnchoredSurface(adopted)).toBe(true);
  });

  it("does NOT let the CSS dialect sweep in a positioned surface with no anchor edge", () => {
    // The generalization this detector deliberately refuses: "any conditionally
    // rendered positioned shadowed surface". A centred modal is positioned and
    // shadowed and is not anchored to anything — flagging it would grow an
    // allowlist of non-menus, which proves nothing about menus.
    const modal = `
      function CentredDialog() {
        return open && (
          <div className="fixed inset-0 flex items-center justify-center">
            <div className="bg-surface rounded-lg shadow-lg p-6" />
          </div>
        );
      }
    `;
    expect(isCssAnchored(modal)).toBe(false);
    expect(declaresAnchoredSurface(modal)).toBe(false);
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
