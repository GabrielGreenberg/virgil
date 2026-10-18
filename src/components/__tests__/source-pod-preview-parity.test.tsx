// @vitest-environment jsdom
/**
 * TASK 1171 — a source pod's card preview is ONE picture with two renderers.
 *
 * The live card-context branch of `SourcePodNodeView` (T2/T3) and the node's
 * own `renderHTML` (the T1 static card tier via `renderBorrowedHtml`, and the
 * clipboard) used to be spelled twice: the live one drew a title line and an
 * italic empty label, the static one a bare `<pre>` — so a titled pod lost its
 * title at T1 and an empty one painted a blank box. Both now read
 * `sourcePodPreview` + `SOURCE_POD_PREVIEW_CLASSES`; this suite pins the two to
 * the same visible text AND the same class skeleton, for titled, untitled and
 * empty pods of both kinds.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@tiptap/react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NodeViewWrapper: ({ children, ...rest }: { children?: React.ReactNode }) => (
    <div {...rest}>{children}</div>
  ),
}));

import { render, cleanup } from "@testing-library/react";
import type { NodeViewProps } from "@tiptap/react";
import SourcePodNodeView, { type SourcePodConfig } from "@/components/SourcePodNodeView";
import { renderBorrowedHtml } from "@/lib/borrowed-render";
import { TEX_POD_CONFIG } from "@/lib/tiptap/tex-pod-config";
import { FOREST_POD_CONFIG } from "@/lib/forest/pod-config";
import { SOURCE_POD_PREVIEW_CLASSES } from "@/lib/tiptap/source-pod-static";

afterEach(cleanup);

const KINDS: Array<{ type: string; config: SourcePodConfig }> = [
  { type: "texBlock", config: TEX_POD_CONFIG },
  { type: "forestBlock", config: FOREST_POD_CONFIG },
];

const CASES: Array<{ name: string; source: string; title: string | null }> = [
  { name: "titled", source: "\\begin{x}\n  ZZBODY\n\\end{x}", title: "Setup" },
  { name: "untitled", source: "\\begin{x}ZZBODY\\end{x}", title: null },
  { name: "empty", source: "", title: null },
  { name: "titled + empty", source: "", title: "Setup" },
];

/** Element skeleton (tag.class, in document order) + visible text. */
function shape(root: Element): { skeleton: string[]; text: string } {
  const skeleton: string[] = [];
  root.querySelectorAll("*").forEach((el) => {
    skeleton.push(`${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`);
  });
  return { skeleton, text: root.textContent ?? "" };
}

function staticPreview(type: string, attrName: string, source: string, title: string | null) {
  const html = renderBorrowedHtml(
    {
      type: "doc",
      content: [{ type, attrs: { [attrName]: source, parTitle: title } }],
    } as never,
    "excerpt",
  );
  expect(html, "the excerpt scope refused the body").not.toBeNull();
  const host = document.createElement("div");
  host.innerHTML = html ?? "";
  const wrapper = host.querySelector(`.${SOURCE_POD_PREVIEW_CLASSES.wrapper}`);
  expect(wrapper, "static projection lost its wrapper class").not.toBeNull();
  return wrapper!;
}

function livePreview(config: SourcePodConfig, source: string, title: string | null) {
  const node = {
    attrs: { [config.sourceAttr]: source, parTitle: title, collapsed: false, uuid: "u1" },
  } as unknown as NodeViewProps["node"];
  const { container } = render(
    <SourcePodNodeView
      node={node}
      updateAttributes={() => {}}
      deleteNode={() => {}}
      config={config}
      cardContext
    />,
  );
  const wrapper = container.querySelector(`.${SOURCE_POD_PREVIEW_CLASSES.wrapper}`);
  expect(wrapper, "live preview lost its wrapper class").not.toBeNull();
  return wrapper!;
}

describe("source-pod card preview: T1 static === live card context", () => {
  for (const { type, config } of KINDS) {
    for (const c of CASES) {
      it(`${type} · ${c.name}`, () => {
        const s = shape(staticPreview(type, config.sourceAttr, c.source, c.title));
        const l = shape(livePreview(config, c.source, c.title));
        expect(s).toEqual(l);
        if (c.title) expect(s.text).toContain(c.title);
        if (c.source) expect(s.text).toContain("ZZBODY");
        else expect(s.text).toContain(config.emptyLabel);
      });
    }
  }

  it("neither renderer carries its own look (the CSS rule is the one spelling)", () => {
    const l = livePreview(TEX_POD_CONFIG, "x", "T");
    l.querySelectorAll("*").forEach((el) => {
      expect(el.getAttribute("style"), el.outerHTML).toBeNull();
    });
  });
});
