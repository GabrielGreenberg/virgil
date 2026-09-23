// @vitest-environment jsdom
/**
 * TASK 729 — a keystroke in a source pod must not RECONFIGURE CodeMirror.
 *
 * `@uiw/react-codemirror` dispatches `StateEffect.reconfigure.of(...)` from an
 * effect keyed on the identity of a fixed list of props (`useCodeMirror.js`):
 *
 *     [theme, extensions, height, minHeight, maxHeight, width, minWidth,
 *      maxWidth, placeholder, editable, readOnly, indentWithTab, basicSetup,
 *      onChange, onUpdate]
 *
 * Both pod wearers used to hand it an inline `extensions` ARRAY, an inline
 * `basicSetup` OBJECT and an `onChange` whose deps included the source string
 * — three identities that change on every render, in a component that
 * re-renders on every keystroke because the keystroke writes the source back.
 * So every character reconfigured the editor, and each reconfigure mounted a
 * BRAND-NEW `defaultThemeOption` StyleModule that `style-mod` never prunes:
 * the page's injected CodeMirror stylesheet grew by one theme per character
 * and was re-serialized whole each time. That is a typing-latency regression
 * on the core-promise path, and it did not recover until reload.
 *
 * This suite counts reconfigures the way the library does — by the identity of
 * exactly those props across mounts — so it measures the real trigger rather
 * than a proxy for it. Legs are planted in the FALSIFYING direction:
 *
 *  - `countsReconfigures` is proved to SEE one (a deliberately churning mount
 *    reads as N reconfigures), so a green stability leg cannot be vacuous;
 *  - the stability legs assert a real edit still LANDS, so "stable" cannot be
 *    satisfied by freezing the first render's handler forever;
 *  - a census leg holds both wearers to the one shared mount, so a third
 *    wearer cannot reintroduce the churn by copying the old shape.
 *
 * The extension barrel transitively imports `@/lib/storage` (the known
 * barrel/storage gotcha) — stub it wholesale; nothing here calls a storage fn.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

/** Every prop `useCodeMirror`'s reconfigure effect watches. A change of
 *  identity in ANY of these dispatches `StateEffect.reconfigure`. */
const RECONFIGURE_KEYS = [
  "theme",
  "extensions",
  "height",
  "minHeight",
  "maxHeight",
  "width",
  "minWidth",
  "maxWidth",
  "placeholder",
  "editable",
  "readOnly",
  "indentWithTab",
  "basicSetup",
  "onChange",
  "onUpdate",
] as const;

type CmProps = Record<string, unknown> & {
  value?: string;
  editable?: boolean;
  onChange?: (v: string) => void;
};

/** Props of every CodeMirror surface mounted in a test, in render order. Only
 *  the React COMPONENT is stubbed — the module's `EditorView` / `EditorState`
 *  re-exports stay real, because the shared pod mount builds its theme and its
 *  extension list from them at module scope. */
const cmMounts: CmProps[] = [];
vi.mock("@uiw/react-codemirror", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: (props: CmProps) => {
    cmMounts.push(props);
    return <div data-testid="cm" data-cm-editable={String(props.editable)} />;
  },
}));

// Partial: the in-place pod's NodeViewWrapper needs a NodeView context it has
// no business having in a unit test, but the module is imported transitively
// by half the editor and must otherwise stay real.
vi.mock("@tiptap/react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NodeViewWrapper: ({ children, ...rest }: { children?: React.ReactNode }) => (
    <div {...rest}>{children}</div>
  ),
}));

// jsdom has no ResizeObserver; some chrome paths measure with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as TiptapEditor, JSONContent, NodeViewProps } from "@tiptap/react";
import SourcePodNodeView, { type SourcePodConfig } from "@/components/SourcePodNodeView";
import {
  SOURCE_POD_BASIC_SETUP,
  SOURCE_POD_EXTENSIONS,
} from "@/components/source-pod-code-mirror";
import { SourcePodFloatBody } from "@/text-objects/floats/source-pod-body";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import type { EditorHandle } from "@/components/Editor";

const ROOT = process.cwd();

beforeEach(() => {
  cmMounts.length = 0;
});
afterEach(cleanup);

const lastCm = () => cmMounts[cmMounts.length - 1];

/**
 * How many times the mounts recorded from `from` onward would have dispatched
 * `StateEffect.reconfigure` — i.e. how many consecutive renders changed the
 * identity of at least one prop the library's effect is keyed on.
 */
function countsReconfigures(from = 0): number {
  let n = 0;
  for (let i = from + 1; i < cmMounts.length; i++) {
    const prev = cmMounts[i - 1];
    const next = cmMounts[i];
    if (RECONFIGURE_KEYS.some((k) => !Object.is(prev[k], next[k]))) n++;
  }
  return n;
}

// ── The counter's own canary ───────────────────────────────────────────────
//
// Without this, every stability leg below could pass on a counter that can
// never return anything but zero — the likeliest way to be wrong.

describe("the reconfigure counter", () => {
  it("sees the churn it exists to forbid", () => {
    cmMounts.length = 0;
    for (let i = 0; i < 5; i++) {
      // The pre-729 shape: fresh literals and a fresh handler per render.
      cmMounts.push({
        value: "x".repeat(i),
        editable: true,
        extensions: [],
        basicSetup: {},
        onChange: () => {},
      });
    }
    expect(countsReconfigures()).toBe(4);
  });

  it("reads a stable mount as zero", () => {
    cmMounts.length = 0;
    const extensions: unknown[] = [];
    const basicSetup = {};
    const onChange = () => {};
    for (let i = 0; i < 5; i++) {
      cmMounts.push({ value: "x".repeat(i), editable: true, extensions, basicSetup, onChange });
    }
    expect(countsReconfigures()).toBe(0);
  });
});

// ── The docked pod (SourcePodNodeView) ─────────────────────────────────────

const CONFIG: SourcePodConfig = {
  hostClass: "tex-block",
  sourceAttr: "code",
  chipLabel: ".tex",
  kindLabel: "LaTeX block",
  emptyLabel: "(empty .tex)",
  confirmMessage: "Delete this block?",
};

/** A stand-in for the pod's host editor carrying the ONE declarative signal
 *  `useMainEditable` reads (task 728). */
function hostEditor(): NodeViewProps["editor"] {
  const dom = document.createElement("div");
  dom.className = "ProseMirror";
  dom.setAttribute("data-editable", "true");
  document.body.appendChild(dom);
  return { view: { dom } } as unknown as NodeViewProps["editor"];
}

describe("docked source pod — typing does not reconfigure CodeMirror", () => {
  it("stays identity-stable across a typing burst, and the edits still land", () => {
    const editor = hostEditor();
    const writes: string[] = [];

    /** One render of the pod as TipTap gives it: a FRESH node object and a
     *  FRESH `updateAttributes` closure per render, which is what made the
     *  pod's own `setSource` churn in the first place. */
    const podAt = (code: string) => (
      <SourcePodNodeView
        node={{ attrs: { code, collapsed: false, parTitle: null } } as never}
        updateAttributes={(attrs: Record<string, unknown>) => {
          writes.push(attrs.code as string);
        }}
        deleteNode={() => {}}
        editor={editor}
        config={CONFIG}
        cardContext={false}
      />
    );

    let code = "";
    const { rerender } = render(podAt(code));
    act(() => {});
    expect(cmMounts.length).toBeGreaterThan(0);
    const settled = cmMounts.length - 1;

    // 40 keystrokes, each one the real round trip: CodeMirror reports the new
    // bytes, the pod writes them back, the node re-renders with them.
    for (let i = 0; i < 40; i++) {
      const next = code + "x";
      act(() => {
        lastCm().onChange?.(next);
      });
      code = next;
      act(() => {
        rerender(podAt(code));
      });
    }

    // The pod really did re-render per keystroke — otherwise the leg below is
    // measuring nothing.
    expect(cmMounts.length - settled).toBeGreaterThanOrEqual(40);
    // …and every one of those renders was free.
    expect(countsReconfigures(settled)).toBe(0);
    // The shared module's one extension set and one basicSetup, not a copy.
    expect(lastCm().extensions).toBe(SOURCE_POD_EXTENSIONS);
    expect(lastCm().basicSetup).toBe(SOURCE_POD_BASIC_SETUP);
    // Stability is not staleness: the handler CodeMirror holds forwards to the
    // pod's current one, so the last keystroke landed with the last bytes.
    expect(writes.length).toBe(40);
    expect(writes[writes.length - 1]).toBe("x".repeat(40));
  });
});

// ── The float twin (SourcePodFloatBody) ────────────────────────────────────

const TEX_UUID = "texflt01";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

function texDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "texBlock", attrs: { uuid: TEX_UUID, code: "" } },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ],
  };
}

function buildMain(): TiptapEditor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el,
    extensions: buildEditorExtensions(mainCtx()),
    content: texDoc(),
  }) as unknown as TiptapEditor;
  ed.view.dom.setAttribute("data-editable", "true");
  return ed;
}

function codeAttr(ed: TiptapEditor): string {
  let found = "";
  ed.state.doc.descendants((n) => {
    if (n.type.name === "texBlock" && n.attrs.uuid === TEX_UUID) {
      found = (n.attrs.code as string) ?? "";
      return false;
    }
    return true;
  });
  return found;
}

describe("float source pod — typing does not reconfigure CodeMirror", () => {
  it("stays identity-stable across a typing burst, and the edits still land", () => {
    const ed = buildMain();
    render(
      <SourcePodFloatBody
        cardKey="textobject:texBlock:texflt01"
        id={TEX_UUID}
        editorRef={{ current: { getEditor: () => ed } as unknown as EditorHandle }}
        cardContext={false}
        setHeaderLabel={() => {}}
        config={{ kind: "texBlock", sourceAttr: "code", chipLabel: ".tex" }}
      />,
    );
    act(() => {});
    expect(cmMounts.length).toBeGreaterThan(0);
    const settled = cmMounts.length - 1;

    // The float owns `code` in local state, so its own `onChange` re-renders
    // it — no external rerender needed; this is the real keystroke path.
    let code = "";
    for (let i = 0; i < 40; i++) {
      code += "x";
      const next = code;
      act(() => {
        lastCm().onChange?.(next);
      });
    }

    expect(cmMounts.length - settled).toBeGreaterThanOrEqual(40);
    expect(countsReconfigures(settled)).toBe(0);
    expect(lastCm().extensions).toBe(SOURCE_POD_EXTENSIONS);
    expect(lastCm().basicSetup).toBe(SOURCE_POD_BASIC_SETUP);
    // The write-back really ran on the LAST handler, not a frozen first one.
    expect(codeAttr(ed)).toBe("x".repeat(40));
  });
});

// ── The census: one mount, so a third wearer inherits the stability ────────

describe("both wearers take the one shared pod mount", () => {
  const WEARERS = [
    "src/components/SourcePodNodeView.tsx",
    "src/text-objects/floats/source-pod-body.tsx",
  ];

  it("neither wearer mounts CodeMirror itself", () => {
    for (const rel of WEARERS) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, `${rel} must go through source-pod-code-mirror.tsx`).toContain(
        "SourcePodCodeMirror",
      );
      expect(
        src,
        `${rel} imports @uiw/react-codemirror directly — mount the shared ` +
          "SourcePodCodeMirror instead, or the per-keystroke reconfigure comes back",
      ).not.toMatch(/from ["']@uiw\/react-codemirror["']/);
    }
  });

  it("neither wearer hands CodeMirror a per-render literal", () => {
    for (const rel of WEARERS) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      // `extensions={[…]}` / `basicSetup={{…}}` in a render body is exactly the
      // pre-729 shape: a new identity every render, a reconfigure every render.
      expect(src, `${rel} passes an inline basicSetup`).not.toMatch(/basicSetup=\{\{/);
      expect(src, `${rel} passes an inline extensions array`).not.toMatch(/extensions=\{\[/);
    }
  });

  it("the shared mount's configuration really is module-scope", () => {
    // Declared at column 0 — inside the component body these would be minted
    // per render again, which is the whole defect, and the burst legs above
    // would not catch it if the component also memoized them by luck.
    const src = readFileSync(join(ROOT, "src/components/source-pod-code-mirror.tsx"), "utf8");
    expect(src).toMatch(/^export const SOURCE_POD_EXTENSIONS = \[/m);
    expect(src).toMatch(/^export const SOURCE_POD_BASIC_SETUP = \{/m);
    expect(src).toMatch(/^const sourcePodTheme = EditorView\.theme\(/m);
    expect(SOURCE_POD_EXTENSIONS.length).toBeGreaterThan(0);
    expect(Object.keys(SOURCE_POD_BASIC_SETUP).length).toBeGreaterThan(0);
  });

  it("the pod's theme is one object, not a copy per wearer", () => {
    // The float used to carry its own `sourcePodFloatTheme`, a hand-synced
    // duplicate of the docked pod's — two StyleModules for one look, and a
    // second place for the framing to drift out of step on release.
    for (const rel of WEARERS) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, `${rel} declares its own CodeMirror theme`).not.toMatch(
        /EditorView\.theme\(/,
      );
    }
  });
});
