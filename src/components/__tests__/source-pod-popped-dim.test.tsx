// @vitest-environment jsdom
/**
 * TASK 730 — the docked source pod dims for EVERY pod-bearing kind, not just
 * the one that had a thread.
 *
 * `.is-popped` is what keeps the docked pod and its float from both being live
 * over one source attr: `globals.css` gives it `opacity: .45; pointer-events:
 * none`, so the float is the only writer while it is open. The CSS rule was
 * already generalized — `:is(.tex-block, .forest-block).is-popped` — but the
 * PRODUCER was a `(uuid) => boolean` ref that named `texBlock` at every hop
 * from `EditorPane` down, so `forestBlock` never got the class. Typing into the
 * still-live docked forest pod and then touching the float silently discarded
 * the docked edit (the float writes its own buffer back).
 *
 * Each leg is planted in the falsifying direction: the same pod, same kind,
 * with and without its key in the float store, plus an other-kind/other-uuid
 * store proving the class isn't simply always on.
 *
 * The extension barrel transitively imports `@/lib/storage` (the known
 * barrel/storage gotcha) — stub it wholesale; nothing here calls a storage fn.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

vi.mock("@uiw/react-codemirror", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: () => <div data-testid="cm" />,
}));
// Partial: the pod's NodeViewWrapper needs a NodeView context it has no
// business having in a unit test; the rest of the module must stay real.
vi.mock("@tiptap/react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NodeViewWrapper: ({
    children,
    ...rest
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => <div {...rest}>{children}</div>,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup } from "@testing-library/react";
import type { NodeViewProps } from "@tiptap/react";
import SourcePodNodeView from "@/components/SourcePodNodeView";
import { TEX_POD_CONFIG } from "@/lib/tiptap/tex-pod-config";
import { FOREST_POD_CONFIG } from "@/lib/forest/pod-config";
import {
  PoppedCardsContext,
  type PoppedCardsValue,
} from "@/hooks/usePoppedCards";
import { buildFloatKey } from "@/floats/float-key";

afterEach(cleanup);

const UUID = "pod-uuid-1";

const KINDS = [
  {
    kind: "texBlock",
    config: TEX_POD_CONFIG,
    hostClass: "tex-block",
    attrs: { code: "\\emph{x}" },
  },
  {
    kind: "forestBlock",
    config: FOREST_POD_CONFIG,
    hostClass: "forest-block",
    attrs: { source: "\\begin{forest}[a]\\end{forest}" },
  },
] as const;

function poppedValue(keys: string[]): PoppedCardsValue {
  return {
    poppedKeys: keys,
    isPopped: (k) => keys.includes(k),
    toggle: () => {},
    toggleAtAnchor: () => {},
    popOutAtRect: () => {},
    close: () => {},
    getFloatPosition: () => undefined,
    setFloatPosition: () => {},
  };
}

/** A stand-in host editor carrying the one declarative signal the pod's
 *  read-only gate reads (`data-editable`), so the pod renders its full chrome. */
function hostEditor(): NodeViewProps["editor"] {
  const dom = document.createElement("div");
  dom.className = "ProseMirror";
  dom.setAttribute("data-editable", "true");
  document.body.appendChild(dom);
  return { view: { dom } } as unknown as NodeViewProps["editor"];
}

function renderPod(
  entry: (typeof KINDS)[number],
  poppedKeys: string[],
  uuid: string = UUID,
) {
  const node = {
    type: { name: entry.kind },
    attrs: { uuid, collapsed: false, parTitle: null, ...entry.attrs },
  };
  const { container } = render(
    <PoppedCardsContext.Provider value={poppedValue(poppedKeys)}>
      <SourcePodNodeView
        node={node as never}
        updateAttributes={vi.fn()}
        deleteNode={vi.fn()}
        editor={hostEditor()}
        config={entry.config}
        cardContext={false}
      />
    </PoppedCardsContext.Provider>,
  );
  return container.querySelector(`.${entry.hostClass}`) as HTMLElement | null;
}

describe("source pod — `.is-popped` follows the float store, for every wearer", () => {
  for (const entry of KINDS) {
    it(`${entry.kind}: dims when its own float is open`, () => {
      const key = buildFloatKey({
        domain: "textobject",
        kind: entry.kind,
        id: UUID,
      });
      const host = renderPod(entry, [key]);
      expect(host).not.toBeNull();
      expect(host!.className).toContain("is-popped");
    });

    it(`${entry.kind}: stays live when NO float is open`, () => {
      const host = renderPod(entry, []);
      expect(host).not.toBeNull();
      expect(host!.className).not.toContain("is-popped");
    });

    it(`${entry.kind}: stays live when SOMEONE ELSE's float is open`, () => {
      const host = renderPod(entry, [
        buildFloatKey({ domain: "textobject", kind: entry.kind, id: "other" }),
        buildFloatKey({ domain: "textobject", kind: "paragraph", id: UUID }),
        "float:card:note:n1",
      ]);
      expect(host).not.toBeNull();
      expect(host!.className).not.toContain("is-popped");
    });
  }

  it("reads the legacy key spellings too, so a pre-migration store still dims", () => {
    for (const key of [`textobject:forestBlock:${UUID}`, `forestBlock:${UUID}`]) {
      cleanup();
      const host = renderPod(KINDS[1], [key]);
      expect(host!.className).toContain("is-popped");
    }
  });

  it("no PoppedCardsContext at all → the pod stays live rather than inert", () => {
    const { container } = render(
      <SourcePodNodeView
        node={
          {
            type: { name: "forestBlock" },
            attrs: { uuid: UUID, source: "", collapsed: false, parTitle: null },
          } as never
        }
        updateAttributes={vi.fn()}
        deleteNode={vi.fn()}
        editor={hostEditor()}
        config={FOREST_POD_CONFIG}
        cardContext={false}
      />,
    );
    const host = container.querySelector(".forest-block") as HTMLElement;
    expect(host.className).not.toContain("is-popped");
  });
});
