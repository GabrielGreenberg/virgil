// @vitest-environment jsdom
/**
 * TASK 1344 — the source pod's chrome speaks ONE vocabulary: its own
 * `SourcePodConfig`.
 *
 *   - the mode toggle has ONE stable accessible name and announces its state
 *     through `aria-pressed`; only the tooltip flips (STYLE_GUIDE "Naming a
 *     toggle");
 *   - the editor's collapsed preview of an empty pod says the kind's own
 *     `emptyLabel` — the same words its card preview says (task 1171);
 *   - the pod's CSS draws its hover from a token, never an rgba literal, and
 *     the card preview's mono honours the user's mono-font override.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy({}, { get: (_t, p) => (p === "__esModule" ? true : p === "then" ? undefined : noop) });
});
vi.mock("@uiw/react-codemirror", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: () => <div data-testid="cm" />,
}));
vi.mock("@tiptap/react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NodeViewWrapper: ({ children, ...rest }: { children?: React.ReactNode }) => (
    <div {...rest}>{children}</div>
  ),
}));

import { render, cleanup, fireEvent, act } from "@testing-library/react";
import SourcePodNodeView, { type SourcePodConfig } from "@/components/SourcePodNodeView";
import { FOREST_POD_CONFIG } from "@/lib/forest/pod-config";
import { TEX_POD_CONFIG } from "@/lib/tiptap/tex-pod-config";

afterEach(cleanup);

function renderPod(config: SourcePodConfig, attrs: Record<string, unknown>) {
  return render(
    <SourcePodNodeView
      node={{ attrs: { source: "", collapsed: false, parTitle: null, ...attrs } } as never}
      updateAttributes={vi.fn()}
      deleteNode={vi.fn()}
      config={config}
      cardContext={false}
    />,
  );
}

describe("the collapsed preview's empty label is the config's", () => {
  for (const config of [TEX_POD_CONFIG, FOREST_POD_CONFIG]) {
    it(`${config.kindLabel}: "${config.emptyLabel}"`, () => {
      const view = renderPod(config, { source: "", collapsed: true });
      const empty = view.container.querySelector(".source-pod-preview-empty");
      expect(empty?.textContent).toBe(config.emptyLabel);
    });
  }
});

describe("the mode toggle: one stable name, state on aria-pressed", () => {
  it("keeps its accessible name across both modes while aria-pressed flips", () => {
    const view = renderPod(FOREST_POD_CONFIG, { source: "\\begin{forest}[S [NP] [VP]]\\end{forest}" });
    const toggle = () => view.container.querySelector(".source-pod-mode-toggle") as HTMLElement;
    expect(toggle()).toBeTruthy();
    const name = toggle().getAttribute("aria-label");
    expect(name).toBe(`Edit ${FOREST_POD_CONFIG.kindLabel} source`);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    const hintBefore = toggle().getAttribute("data-hint");

    act(() => { fireEvent.click(toggle()); });

    expect(toggle().getAttribute("aria-label")).toBe(name);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    // The tooltip is the one channel that does flip.
    expect(toggle().getAttribute("data-hint")).not.toBe(hintBefore);
  });
});

describe("source-pod CSS draws from tokens", () => {
  const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const rules = [...CSS.matchAll(/(^|\n)([^{}\n]*\.source-pod-[^{}]*)\{([^}]*)\}/g)];

  it("finds the source-pod rules at all (non-vacuous)", () => {
    expect(rules.length).toBeGreaterThan(5);
  });

  it("no source-pod rule paints a bare rgba() literal (a var() fallback is fine)", () => {
    const offenders = rules
      .filter(([, , , body]) => /:\s*rgba\(/.test(body))
      .map(([, , sel]) => sel.trim());
    expect(offenders).toEqual([]);
  });

  it("the card preview's mono honours the user's mono override", () => {
    const body = rules.find(([, , sel]) => sel.trim() === ".source-pod-static-source")?.[3] ?? "";
    expect(body).toMatch(/font-family:\s*var\(--font-mono-override,\s*var\(--font-mono\)\)/);
  });
});
