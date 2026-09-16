// Task 598 — the leg with TEETH for "a window listener registered per pane".
//
// N `EditorPane`s are alive at once (multi-doc keep-alive + the Library
// Reader), so an app-global `window` / `document` listener in the pane's
// subtree is answered by every pane. The per-doc-services law stated the rule
// for ONE handler (`virgil-stack-drop`); a sweep found the rest of the family
// ungated — a click in paper A discarding a blank card in paper B, and orphan
// events clearing cards in a document nobody touched.
//
// The census walks the static + dynamic import closure of `EditorPane.tsx` and
// requires EVERY `window.addEventListener("…")` / `document.addEventListener("…")`
// in it to be declared in LEDGER with a scope, exactly (events are a multiset
// per file: a new registration fails, a removed one fails as stale). A scope
// is not just a label — each carries a source check the file must pass.
//
// The preferred door for a new per-pane listener is `usePaneScopedListener`
// (visibility-context.tsx), which registers with a non-literal event type and
// therefore needs no ledger row at its call sites. The orphan events have their
// own door (`orphan-events.ts`), censused at the bottom.
//
// STATED LIMITS: the needle sees a literal `window` / `document` receiver and a
// literal event name. An aliased receiver, a `globalThis.` receiver, or an
// event name held in a variable passes unseen outside the two doors (the last
// is refused below). The closure is IMPORT reachability, which over-approximates
// "mounted per pane" — module singletons appear and are declared as such.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { commentsStripped, trackedFiles } from "@/lib/__tests__/_source-scan";

const SRC = path.resolve(__dirname, "../../..");
const ROOT = "components/EditorPane.tsx";

type Scope =
  /** Answers only while its pane is shown (`usePaneScopedListener`, or a
   *  handler reading the visibility ref / the geometry service's flag). */
  | "visible"
  /** Gated on the event's `docId`. */
  | "doc"
  /** Bails unless the event target is inside this pane's own DOM. */
  | "target"
  /** Armed on a gesture's start and removed on its end, inside the pane the
   *  gesture started in. */
  | "gesture"
  /** Registered only while a popup/menu/dialog this pane opened is open; acts
   *  on that popup's local state only. */
  | "open-state"
  /** Every pane MUST answer — each flushes / releases its own document. */
  | "by-design"
  /** Every subscriber mirrors ONE app-wide value, so every pane answering is
   *  correct (a shared pref, a cross-window storage key). */
  | "shared-state"
  /** A module-level install-once (or per-doc service) — not per pane. */
  | "singleton";

interface Row {
  scope: Scope;
  /** `target.event`, one entry per registration. A file whose listeners have
   *  different scopes takes one row per scope, keyed `file#scope`. */
  events: string[];
  why: string;
}

/** What each scope requires of the file's code (comments stripped). */
const SCOPE_TEETH: Record<Scope, RegExp> = {
  visible: /\b(?:useIsVisibleRef|usePaneScopedListener|isVisibleRef|visibleRef)\b|\bif\s*\(\s*!visible\b/,
  doc: /\bdocId\s*!==|!==\s*docId\b|\bdocId\b\s*\)\s*return/,
  target: /\.contains\(/,
  gesture: /removeEventListener\(/,
  "open-state": /removeEventListener\(/,
  "by-design": /removeEventListener\(/,
  "shared-state": /removeEventListener\(/,
  singleton:
    /\b(?:installed|attached|\w+Installed|intervalId|cleanups|detach\w*)\b|^if \(typeof window !== "undefined"\) \{\n\s+window\.addEventListener/m,
};

const LEDGER: Record<string, Row> = {
  "components/EditorPane.tsx": {
    scope: "visible",
    events: ["window.virgil-stack-drop"],
    why: "the float→Stack drop is app-global; only the shown pane captures it",
  },
  "components/FloatingPanel.tsx": {
    scope: "gesture",
    events: ["window.mousemove", "window.mouseup"],
    why: "float drag, armed on the header mousedown",
  },
  "components/Marginalia.tsx": {
    scope: "gesture",
    events: ["window.mousemove", "window.mouseup", "document.mousedown", "document.keydown"],
    why: "marker drag pair; the overflow group's click-away/Escape is armed only while that group is open",
  },
  "components/PendingChangePill.tsx": {
    scope: "visible",
    events: ["window.resize"],
    why: "placement re-solve; skipped in a hidden pane, re-poked on show",
  },
  "components/SelectionActionsMenu.tsx": {
    scope: "visible",
    events: ["window.mousedown", "window.mouseup", "window.resize", "window.keydown"],
    why: "resize gated on visibility; mousedown bails unless inside this editor (mouseup follows its flag); keydown bails unless this editor is focused",
  },
  "components/SlashCommandPopup.tsx": {
    scope: "open-state",
    events: ["window.resize"],
    why: "mounted only while the slash popup is open in the focused editor",
  },
  "components/drop-mode/card-drop-gesture.ts": {
    scope: "gesture",
    events: ["window.mouseup"],
    why: "one-shot commit of a drop session the pane started",
  },
  "components/drop-mode/controller.ts": {
    scope: "gesture",
    events: ["window.mousemove", "window.mouseup", "window.keydown"],
    why: "drop-mode session listeners, torn down when the session ends",
  },
  "components/editor-layout/editor-scrollbar.tsx": {
    scope: "visible",
    events: ["window.resize", "window.mousemove", "window.mouseup"],
    why: "resize re-measure gated on visibility; the pair is the thumb drag gesture",
  },
  "components/editor-layout/event-bridges/footnote-sync.ts": {
    scope: "doc",
    events: [
      "window.virgil-footnote-orphaned",
      "window.virgil-footnote-suppress-orphan",
      "window.virgil-footnote-panel-dropped",
      "window.virgil-footnote-consumed-archive",
    ],
    why: "each footnote event carries the originating docId",
  },
  "components/menu/useMenuDismiss.ts": {
    scope: "open-state",
    events: ["window.mousedown", "window.keydown"],
    why: "click-away / Escape for an open menu",
  },
  "components/menu/useMenuKeyboard.ts": {
    scope: "open-state",
    events: ["window.keydown"],
    why: "arrow-key navigation for an open menu",
  },
  "components/panel-primitives.tsx": {
    scope: "gesture",
    events: ["document.pointermove", "window.mousemove", "window.mouseup"],
    why: "one-shot stale-hover restore after an arrow key; a card drag pair",
  },
  "components/system-dialog.tsx": {
    scope: "open-state",
    events: ["document.keydown", "window.keydown", "document.mousedown"],
    why: "key trap and outside-click for an open dialog",
  },
  "hooks/useCollab.ts": {
    scope: "by-design",
    events: ["window.beforeunload"],
    why: "each pane releases its own pen on unload",
  },
  "hooks/useDocument.ts#doc": {
    scope: "doc",
    events: ["window.TEX_DELIMITERS_CHANGED_EVENT"],
    why: "the delimiters event carries its docId",
  },
  "hooks/useDocument.ts": {
    scope: "by-design",
    events: ["window.pagehide", "window.beforeunload"],
    why: "each pane flushes its own document on unload",
  },
  "hooks/useAiRequests.ts": {
    scope: "doc",
    events: ["window.SIDECAR_CHANGED_EVENT"],
    why: "sidecar-changed carries its docId",
  },
  "hooks/useCitations.ts": {
    scope: "doc",
    events: ["window.DOC_BIB_CHANGED_EVENT"],
    why: "bib-changed carries its docId",
  },
  "hooks/useLatexSource.ts": {
    scope: "doc",
    events: ["window.TEX_DELIMITERS_CHANGED_EVENT"],
    why: "the delimiters event carries its docId",
  },
  "hooks/usePersistentState.ts": {
    scope: "doc",
    events: ["window.SIDECAR_CHANGED_EVENT"],
    why: "sidecar-changed carries its docId + filename",
  },
  "hooks/useWordCountConfig.ts": {
    scope: "shared-state",
    events: ["window.CHANGE_EVENT"],
    why: "one app-wide word-count preference, mirrored by every subscriber",
  },
  "lib/doc-products/pipeline.ts": {
    scope: "doc",
    events: ["window.TEX_DELIMITERS_CHANGED_EVENT"],
    why: "the delimiters event carries its docId",
  },
  "hooks/useDragPosition.ts": {
    scope: "gesture",
    events: ["window.mousemove", "window.mouseup"],
    why: "drag pair",
  },
  "hooks/useEmergencyMirror.ts": {
    scope: "by-design",
    events: ["window.pagehide", "window.beforeunload"],
    why: "each pane mirrors its own unsaved document on unload",
  },
  "hooks/useFloatingMenuPosition.ts": {
    scope: "open-state",
    events: ["window.resize", "window.scroll"],
    why: "re-anchors a menu only while it is mounted/open",
  },
  "hooks/useInTextPositions.ts": {
    scope: "visible",
    events: ["window.resize"],
    why: "the deck's schedule early-outs on isVisibleRef",
  },
  "hooks/useMarginEdit.ts": {
    scope: "gesture",
    events: ["window.mousemove", "window.mouseup", "window.blur"],
    why: "margin drag gesture (its Escape goes through usePaneScopedListener)",
  },
  "hooks/useWindowChrome.ts": {
    scope: "singleton",
    events: ["window.resize"],
    why: "one app-wide window-chrome store",
  },
  "lib/cross-window-storage.ts": {
    scope: "shared-state",
    events: ["window.storage"],
    why: "one shared storage-event fan-out",
  },
  "lib/disk-watcher.ts": {
    scope: "singleton",
    events: ["document.visibilitychange", "window.focus"],
    why: "per-doc watcher service; each polls its own file on return",
  },
  "lib/drag-ghost.ts": {
    scope: "gesture",
    events: ["document.dragover", "document.dragend", "document.drop", "document.visibilitychange"],
    why: "HTML5 drag ghost, torn down when the drag ends",
  },
  "lib/editor-geometry/service.ts": {
    scope: "visible",
    events: ["window.resize"],
    why: "per-editor service; its passes bail while the service is not visible",
  },
  "lib/figures/pick-file.ts": {
    scope: "gesture",
    events: ["window.focus"],
    why: "one-shot file-dialog close detection",
  },
  "lib/input-modality.ts": {
    scope: "singleton",
    events: ["document.keydown"],
    why: "one app-wide modality tracker",
  },
  "lib/keystroke-latency-probe.ts": {
    scope: "singleton",
    events: ["window.keydown"],
    why: "dev/test probe, installed once",
  },
  "lib/pane-resize/layout-gesture-bus.ts": {
    scope: "singleton",
    events: ["window.resize"],
    why: "one app-wide gesture publisher",
  },
  "lib/pane-resize/use-pane-resize-handle.ts": {
    scope: "gesture",
    events: ["window.keydown", "document.lostpointercapture", "window.pointerup", "window.pointercancel"],
    why: "the pane-resize engine's gesture listeners",
  },
  "lib/print.ts": {
    scope: "singleton",
    events: ["window.afterprint", "window.beforeprint"],
    why: "module-level browser-menu print hook + the ONE print-posture door's one-shot afterprint, shared by both print doors (task 608); the door resolves the VISIBLE pane itself (task 597)",
  },
  "lib/scroll-reposition-probe.ts": {
    scope: "singleton",
    events: ["window.scroll"],
    why: "dev/test probe, installed once",
  },
  "lib/sidecar-watcher.ts": {
    scope: "singleton",
    events: ["document.visibilitychange", "window.focus"],
    why: "per-doc watcher service; each polls its own sidecars on return",
  },
  "lib/spell/spell-client.ts": {
    scope: "singleton",
    events: ["window.online"],
    why: "one spell engine client",
  },
  "lib/tab-hidden.ts": {
    scope: "singleton",
    events: ["document.visibilitychange", "window.focus"],
    why: "one app-wide tab-return fan-out",
  },
  "lib/tiptap/inline-atom-grab.ts": {
    scope: "gesture",
    events: ["window.click", "window.mousemove", "window.mouseup"],
    why: "atom drag + its one-shot click swallow",
  },
  "panels/Outline/focus-band-drag.ts": {
    scope: "gesture",
    events: ["document.mousemove", "document.mouseup"],
    why: "focus-band drag pair",
  },
  "text-objects/LiftHost.tsx": {
    scope: "gesture",
    events: ["window.mousemove", "window.mouseup"],
    why: "lift drag pair",
  },
  "text-objects/TextObjectGrabHandle.tsx": {
    scope: "visible",
    events: [
      "window.mousemove",
      "window.mouseup",
      "document.mousemove",
      "window.scroll",
      "window.resize",
      "document.selectionchange",
    ],
    why: "hover/scroll/resize gated on visibility; the pair is the grab drag; selectionchange bails unless the range is inside this editor",
  },
};

// ── the closure ──────────────────────────────────────────────────────────────

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/g;
const DYNAMIC_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

function closure(): Map<string, string> {
  const code = new Map<string, string>();
  const stack = [path.join(SRC, ROOT)];
  while (stack.length) {
    const f = stack.pop()!;
    if (code.has(f)) continue;
    const src = readFileSync(f, "utf8");
    code.set(f, commentsStripped(src));
    for (const m of src.matchAll(IMPORT_RE)) {
      if (m[1]) continue; // `import type` erases at build time
      const r = resolveSpec(f, m[2]);
      if (r) stack.push(r);
    }
    for (const m of src.matchAll(DYNAMIC_RE)) {
      const r = resolveSpec(f, m[1]);
      if (r) stack.push(r);
    }
  }
  return code;
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const CODE = closure();

const fileOf = (key: string) => key.split("#")[0];
/** The ledger's events per FILE, all of its rows merged. */
function ledgerEvents(r: string): string[] | null {
  const keys = Object.keys(LEDGER).filter((k) => fileOf(k) === r);
  if (keys.length === 0) return null;
  return keys.flatMap((k) => LEDGER[k].events).sort();
}

/** A literal event name, or a SCREAMING_CASE constant naming one. */
const LITERAL_RE =
  /\b(window|document)\s*\.\s*addEventListener\s*\(\s*(?:["'`]([\w-]+)["'`]|([A-Z][A-Z0-9_]*)\b)/g;
/** Anything else — an event type in a lower-case variable — is a door's. */
const DYNAMIC_TYPE_RE =
  /\b(?:window|document)\s*\.\s*addEventListener\s*\(\s*(?!["'`]|[A-Z][A-Z0-9_]*\b)/;

const DOORS = new Set(["lib/keep-alive/visibility-context.tsx", "lib/tiptap/orphan-events.ts"]);

function hitsOf(code: string): string[] {
  return [...code.matchAll(LITERAL_RE)].map((m) => `${m[1]}.${m[2] ?? m[3]}`).sort();
}

describe("per-pane listener census (task 598)", () => {
  it("the closure is real (canary: it reaches the pane's hooks)", () => {
    const files = [...CODE.keys()].map(rel);
    expect(files).toContain("hooks/usePristineCardManager.ts");
    expect(files).toContain("hooks/useNotes.ts");
    expect(CODE.size).toBeGreaterThan(200);
  });

  it("every window/document listener in the pane's closure is declared, exactly", () => {
    const drift: string[] = [];
    for (const [file, code] of CODE) {
      const r = rel(file);
      const hits = hitsOf(code);
      const declared = ledgerEvents(r);
      if (hits.length === 0) continue;
      if (!declared) {
        drift.push(`UNDECLARED ${r}: ${hits.join(", ")} — route it through usePaneScopedListener, or add a LEDGER row with a scope`);
        continue;
      }
      const want = declared;
      if (JSON.stringify(want) !== JSON.stringify(hits)) {
        drift.push(`MISMATCH ${r}: ledger ${want.join(", ")} ≠ code ${hits.join(", ")}`);
      }
    }
    expect(drift.join("\n")).toBe("");
  });

  it("no ledger row is stale", () => {
    const stale = Object.keys(LEDGER).filter((k) => {
      const code = CODE.get(path.join(SRC, fileOf(k)));
      return !code || hitsOf(code).length === 0;
    });
    expect(stale).toEqual([]);
  });

  it("each declared scope is backed by the file's code", () => {
    const unbacked = Object.entries(LEDGER)
      .filter(([k, row]) => {
        const code = CODE.get(path.join(SRC, fileOf(k)));
        return code !== undefined && !SCOPE_TEETH[row.scope].test(code);
      })
      .map(([r, row]) => `${r} (${row.scope})`);
    expect(unbacked.join("\n")).toBe("");
  });

  it("the teeth bite: a scope check fails on code that lacks its mechanism", () => {
    expect(SCOPE_TEETH.visible.test(`window.addEventListener("resize", f)`)).toBe(false);
    expect(SCOPE_TEETH.doc.test(`const { anchorId } = e.detail;`)).toBe(false);
  });

  it("a non-literal event type is registered only inside a door", () => {
    const offenders = [...CODE]
      .filter(([f, code]) => !DOORS.has(rel(f)) && DYNAMIC_TYPE_RE.test(code))
      .map(([f]) => rel(f));
    expect(offenders.join("\n")).toBe("");
  });

  it("the door itself still names both (canary)", () => {
    const door = readFileSync(path.join(SRC, "lib/tiptap/orphan-events.ts"), "utf8");
    expect(door).toContain('"virgil-anchor-orphaned"');
    expect(door).toContain('"virgil-textobject-orphaned"');
  });
});

// ── the orphan door ──────────────────────────────────────────────────────────

describe("orphan events have ONE door (task 598)", () => {
  it("no production file outside orphan-events.ts names an orphan event literally", () => {
    const offenders: string[] = [];
    for (const f of trackedFiles("src", /\.tsx?$/)) {
      if (/__tests__|\.test\.tsx?$/.test(f)) continue;
      const r = rel(f);
      if (r === "lib/tiptap/orphan-events.ts") continue;
      const code = commentsStripped(readFileSync(f, "utf8"));
      if (/["'`]virgil-(?:anchor|textobject)-orphaned["'`]/.test(code)) offenders.push(r);
    }
    expect(offenders).toEqual([]);
  });

  it("the door itself still names both (canary)", () => {
    const door = readFileSync(path.join(SRC, "lib/tiptap/orphan-events.ts"), "utf8");
    expect(door).toContain('"virgil-anchor-orphaned"');
    expect(door).toContain('"virgil-textobject-orphaned"');
  });
});
