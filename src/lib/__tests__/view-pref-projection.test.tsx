// @vitest-environment jsdom
//
// Task 2026-10-04-927 — the view-pref → CSS projection is DECLARED once (a
// `project` field on the registry row) and applied by ONE projector onto the
// OWNING instance's roots, never `<body>`.
//
// Before: three Display toggles (Card titles, Card outline, Check spelling's
// native half) reached the screen only through EditorLayout's `<body>` writes.
// The Library Reader runs its own `useViewPrefs` instance and renders the same
// registry-driven rows, so toggling them there flipped an in-memory pref and
// changed nothing visible. The other toggles were hand-wired in a second place
// (`viewToggleClasses`'s if-chain) with a different scope and polarity idiom.
import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, cleanup } from "@testing-library/react";

import FloatingPanel from "@/components/FloatingPanel";
import {
  ViewPrefProjectionProvider,
  useStableViewPrefProjection,
} from "@/components/editor-layout/chrome-context";
import {
  viewPrefProjection,
  viewToggleClasses,
} from "@/components/editor-layout/chrome-config";
import type { EditorPaneMenuBarBundle } from "@/components/EditorPane";
import {
  REGISTRY_DEFAULTS,
  VIEW_PREF_KEYS,
  VIEW_PREF_REGISTRY,
  type RegistryPrefs,
  type ViewPrefDef,
} from "@/lib/view-prefs/registry";
import { projectViewPrefs } from "@/lib/view-prefs/projection";
import { commentsStripped, REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";

afterEach(cleanup);

function bundle(prefs: Partial<RegistryPrefs>, levels: number[] = []): EditorPaneMenuBarBundle {
  return {
    prefs: { ...REGISTRY_DEFAULTS, ...prefs },
    activeDividerLevels: new Set(levels),
  } as unknown as EditorPaneMenuBarBundle;
}

// ── A. the registry declares, the projector applies ─────────────────────────

describe("one declaration per projected pref", () => {
  it("every `display` toggle declares a projection or names its prop consumer", () => {
    // A new Display row cannot ship inert: either the registry says how it
    // reaches CSS, or it says which code reads it as a value.
    const inert: string[] = [];
    for (const key of VIEW_PREF_KEYS) {
      const def = VIEW_PREF_REGISTRY[key] as ViewPrefDef;
      if (def.kind !== "toggle" || def.menu !== "display") continue;
      if (!def.project && !def.consumedBy) inert.push(key);
    }
    expect(inert).toEqual([]);
  });

  it("projects each toggle at its declared polarity, and the enum by prefix", () => {
    const off = projectViewPrefs({
      ...REGISTRY_DEFAULTS,
      showParTitles: false,
      showCardTitles: false,
      showLatexComments: false,
      showHeadingLabels: false,
      cardOutlineChrome: true,
      checkSpelling: false,
      dividerWidth: "mid",
    });
    expect(off.classes).toEqual([
      "hide-par-titles",
      "hide-card-titles",
      "hide-latex-comments",
      "hide-heading-labels",
      "card-outline-chrome",
      "dividers-width-mid",
    ]);
    expect(off.attrs).toEqual({ spellcheck: "false" });

    const on = projectViewPrefs({
      ...REGISTRY_DEFAULTS,
      showParTitles: true,
      showCardTitles: true,
      showLatexComments: true,
      showHeadingLabels: true,
      cardOutlineChrome: false,
      checkSpelling: true,
      dividerWidth: "full",
    });
    expect(on.classes).toEqual(["dividers-width-full"]);
    expect(on.attrs).toEqual({});
  });

  it("viewToggleClasses is the projection plus the doc-derived divider levels", () => {
    expect(viewToggleClasses(bundle({ showCardTitles: false, dividerWidth: "text" }, [2])).split(" ")).toEqual(
      expect.arrayContaining(["hide-card-titles", "dividers-width-text", "show-dividers-2"]),
    );
    expect(viewToggleClasses(undefined)).toBe("");
  });
});

// ── B. two instances, two roots, no body ────────────────────────────────────

function Host({ menuBar, id }: { menuBar: EditorPaneMenuBarBundle; id: string }) {
  const projection = useStableViewPrefProjection(viewPrefProjection(menuBar));
  return (
    <ViewPrefProjectionProvider value={projection}>
      <FloatingPanel
        panelId={id as never}
        mode="floating"
        surface="card"
        initialX={10}
        initialY={10}
        initialWidth={200}
        initialHeight={200}
        zIndex={1200}
        onChange={() => {}}
      >
        <div>body</div>
      </FloatingPanel>
    </ViewPrefProjectionProvider>
  );
}

function shell(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-panel-shell-id="${id}"]`)!;
}

describe("each instance projects onto its OWN surfaces (task 927)", () => {
  it("the Reader's toggles reach the Reader's float, not the editor's — and nothing touches <body>", () => {
    const editor = bundle({ showCardTitles: true, cardOutlineChrome: false, checkSpelling: true });
    const reader = bundle({ showCardTitles: false, cardOutlineChrome: true, checkSpelling: false });
    render(
      <>
        <Host menuBar={editor} id="notes" />
        <Host menuBar={reader} id="footnotes" />
      </>,
    );
    const ed = shell("notes");
    const rd = shell("footnotes");

    expect(rd.classList.contains("hide-card-titles")).toBe(true);
    expect(rd.classList.contains("card-outline-chrome")).toBe(true);
    expect(rd.getAttribute("spellcheck")).toBe("false");

    expect(ed.classList.contains("hide-card-titles")).toBe(false);
    expect(ed.classList.contains("card-outline-chrome")).toBe(false);
    expect(ed.hasAttribute("spellcheck")).toBe(false);

    expect(document.body.classList.contains("hide-card-titles")).toBe(false);
    expect(document.body.classList.contains("card-outline-chrome")).toBe(false);
    expect(document.body.hasAttribute("spellcheck")).toBe(false);
  });

  it("vice versa: the editor's toggles stay on the editor's float", () => {
    const editor = bundle({ showCardTitles: false, cardOutlineChrome: true, checkSpelling: false });
    const reader = bundle({ showCardTitles: true, cardOutlineChrome: false, checkSpelling: true });
    render(
      <>
        <Host menuBar={editor} id="notes" />
        <Host menuBar={reader} id="footnotes" />
      </>,
    );
    expect(shell("notes").classList.contains("hide-card-titles")).toBe(true);
    expect(shell("notes").getAttribute("spellcheck")).toBe("false");
    expect(shell("footnotes").classList.contains("hide-card-titles")).toBe(false);
    expect(shell("footnotes").hasAttribute("spellcheck")).toBe(false);
  });

  it("outside any pane (a dialog reusing the shell) there is no projection", () => {
    render(
      <FloatingPanel
        panelId={"notes" as never}
        mode="floating"
        surface="card"
        initialX={10}
        initialY={10}
        initialWidth={200}
        initialHeight={200}
        zIndex={1200}
        onChange={() => {}}
      >
        <div>body</div>
      </FloatingPanel>,
    );
    expect(shell("notes").className).toBe("flex flex-col overflow-hidden");
    expect(shell("notes").hasAttribute("spellcheck")).toBe(false);
  });
});

// ── C. source pins: the applier is the only writer ──────────────────────────

describe("no hand-written projection survives", () => {
  const read = (rel: string) =>
    commentsStripped(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

  it("EditorPane wraps its tree in the provider and paints its root from it", () => {
    const src = read("src/components/EditorPane.tsx");
    expect(src).toMatch(/<ViewPrefProjectionProvider value=\{viewPrefRoot\}>/);
    expect(src).toMatch(/className=\{`editor-pane-root\$\{viewPrefRoot\.className/);
    expect(src).toMatch(/\{\.\.\.viewPrefRootAttrs\}/);
  });

  it("no production file writes a projected class or attribute on <body>", () => {
    const projected = new Set<string>();
    for (const key of VIEW_PREF_KEYS) {
      const def = VIEW_PREF_REGISTRY[key] as ViewPrefDef;
      if (def.kind === "toggle" && def.project && "class" in def.project) projected.add(def.project.class);
    }
    const offenders: string[] = [];
    const files = [
      ...trackedFiles("src", /\.(ts|tsx)$/),
      ...trackedFiles("library", /\.(ts|tsx)$/),
    ].filter((p) => !p.includes("__tests__"));
    for (const abs of files) {
      const rel = abs.slice(REPO_ROOT.length + 1);
      const src = commentsStripped(readFileSync(abs, "utf8"));
      if (!src.includes("document.body")) continue;
      for (const cls of projected) {
        if (src.includes(`"${cls}"`)) offenders.push(`${rel}: ${cls}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the stylesheet gates the projected card classes on an ancestor, not on body", () => {
    const css = readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
    expect(css).not.toMatch(/body\.(card-outline-chrome|hide-card-titles)/);
  });
});
