// Task 739 — the leg with TEETH for "a per-doc module bus with no doc key".
//
// N `EditorPane`s are alive at once (multi-doc keep-alive + the Library
// Reader). Task 598's census catches a `window`/`document` listener registered
// per pane; it does NOT see a MODULE-LEVEL subscriber Set, which is the same
// defect one layer in: every pane subscribes, every pane hears every other
// pane's publish. That is exactly how the card-lifecycle signal leaked — a
// delete in one paper pruned the same-id card in every open paper (ids are
// only unique per paper; a duplicated folder shares them).
//
// This census walks the same import closure and requires EVERY module-level
// subscriber collection — `const x = new Set<fn | …Listener>()` or
// `new Map<K, Set<fn | …Listener>>()` at top level — to be declared in LEDGER
// with a scope, exactly (a new one fails; a removed one fails as stale). Each
// scope carries a source check the file must pass.
//
// STATED LIMITS: the needle sees a top-level `const`/`let` initialised with a
// generic `new Set<…>` / `new Map<…, Set<…>>`, or annotated with one. A
// subscriber collection hidden in a class field or a closure passes unseen.

import { describe, it, expect } from "vitest";
import path from "node:path";
import { paneImportClosure, relToSrc, SRC } from "./_pane-closure";

type Scope =
  /** Every subscriber mirrors ONE app-wide value (a pref, the browser tab, the
   *  window's chrome, the pointer modality) — every pane answering is right. */
  | "app-wide"
  /** At most one live instance app-wide: a drag / popup / menu that only the
   *  pane that started it can be in. */
  | "gesture"
  /** Keyed by — or gated on — the document's `docId`. */
  | "doc-keyed"
  /** Keyed by an owner object/string minted per mount (a pod, a pane). */
  | "owner-keyed"
  /** KNOWN RESIDUAL: keyed by an identity that is unique only within one
   *  paper (a card id). Declared so it is visible, not blessed — see `why`. */
  | "residual-per-paper-key";

interface Row {
  scope: Scope;
  why: string;
}

/** What each scope requires of the file's code (comments stripped). */
const SCOPE_TEETH: Record<Scope, RegExp> = {
  "app-wide": /./,
  gesture: /./,
  "doc-keyed": /\bdocId\b/,
  "owner-keyed": /new Map</,
  "residual-per-paper-key": /new Map<string/,
};

/** `file#binding` → scope. */
const LEDGER: Record<string, Row> = {
  "lib/text-metrics.ts#fontReadyCallbacks": { scope: "app-wide", why: "document.fonts readiness is a window fact" },
  "lib/panel-theme.ts#listeners": { scope: "app-wide", why: "panel color theme is a global pref" },
  "lib/panel-typography.ts#listeners": { scope: "app-wide", why: "panel typography is a global pref" },
  "lib/tab-hidden.ts#hiddenSubscribers": { scope: "app-wide", why: "browser-tab visibility edge" },
  "lib/tab-hidden.ts#returnSubscribers": { scope: "app-wide", why: "browser-tab return edge" },
  "hooks/useViewPrefs.ts#sameWindowListeners": { scope: "app-wide", why: "view prefs are one app-wide localStorage value" },
  "components/confirm-suppression.ts#listeners": { scope: "app-wide", why: "\"don't show again\" is a global pref" },
  "lib/print-intent.ts#subscribers": { scope: "app-wide", why: "one window print at a time" },
  "lib/pane-resize/layout-gesture-bus.ts#listeners": { scope: "app-wide", why: "a layout gesture resizes the whole window's panes" },
  "lib/pane-resize/layout-gesture-bus.ts#setListeners": { scope: "app-wide", why: "same bus, the active-set edge" },
  "hooks/useStack.ts#sameWindowListeners": { scope: "app-wide", why: "the Stack is a window-scoped clipboard shared by every paper" },
  "lib/spell/global-dictionary.ts#listeners": { scope: "app-wide", why: "the user's global dictionary" },
  "lib/spell/spell-client.ts#availabilityListeners": { scope: "app-wide", why: "the one spell worker's availability" },
  "hooks/useWindowChrome.ts#_listeners": { scope: "app-wide", why: "OS/browser window chrome geometry" },
  "lib/input-modality.ts#listeners": { scope: "app-wide", why: "pointer vs keyboard is an app-level fact" },
  "lib/stack/stack-terminal.ts#openListeners": { scope: "app-wide", why: "the one Stack strip-open signal" },

  "components/card-lift.ts#targetListeners": { scope: "gesture", why: "one card lift-off drag at a time" },
  "components/drop-mode/inline-atom-ghost.ts#_listeners": { scope: "gesture", why: "one inline-atom drag ghost at a time" },
  "components/drop-mode/controller.ts#sessionListeners": { scope: "gesture", why: "one drop-mode session at a time" },
  "components/drop-mode/controller.ts#sessionEndListeners": { scope: "gesture", why: "same session, its end edge" },
  "lib/spell/spell-menu-store.ts#listeners": { scope: "gesture", why: "one spelling menu open at a time" },
  "lib/stack/stack-drop-target.ts#listeners": { scope: "gesture", why: "the Stack drop target of the one live drag" },
  "components/editor-layout/dock-drag.ts#listeners": { scope: "gesture", why: "the dock target of the one live drag" },

  "lib/multi-window/bus.ts#handlers": { scope: "doc-keyed", why: "cross-window messages carry docId" },
  "lib/mirror-recovery.ts#listeners": { scope: "doc-keyed", why: "recovery offers are per docId" },
  "lib/unsaved-work.ts#listeners": { scope: "doc-keyed", why: "unsaved-work state is per docId" },
  "lib/preservation-notice.ts#listeners": { scope: "doc-keyed", why: "refusals are published per docId" },
  "lib/sidecar-refusal.ts#listeners": { scope: "doc-keyed", why: "sidecar refusals are per docId" },
  "lib/cowork-pen.ts#listeners": { scope: "doc-keyed", why: "the pen is held per docId" },
  "lib/save-request.ts#listeners": { scope: "doc-keyed", why: "save requests are addressed by docId" },
  "panels/Outline/outline-prefs-store.ts#listeners": { scope: "doc-keyed", why: "outline prefs are stored per docId" },
  "lib/ai-request-events.ts#listeners": { scope: "doc-keyed", why: "inbox events are keyed by docId" },
  "lib/compile/compile-progress.ts#listeners": { scope: "doc-keyed", why: "compile progress is per docId" },

  "components/editor-layout/omni-pin-store.ts#_listeners": { scope: "owner-keyed", why: "pins are keyed by a per-pod minted owner (task 583)" },
  "lib/stack/stack-terminal.ts#registryListeners": { scope: "owner-keyed", why: "terminals are registered per pane object" },

  "links/pending-preview-store.ts#listeners": {
    scope: "residual-per-paper-key",
    why:
      "RESIDUAL (found by task 739): the applied-suggestion Original/Suggested preview is keyed by CARD ID only, so two open papers sharing an id (a duplicated folder) share the toggle's display state. Needs a doc (or pane) key threaded through pending-change-actions.",
  },
};

// ── the needle ────────────────────────────────────────────────────────────────

/** A top-level `Set<E>` / `Map<K, Set<E>>` binding (initialiser or annotation). */
const ELEM = String.raw`((?:=>|[^<>\n])+)`; // a type arg; `=>` is not a closing `>`
const COLLECTION_RE = new RegExp(
  String.raw`^(?:export\s+)?(?:const|let)\s+(\w+)\b[^\n]*?\b(?:Set<${ELEM}>|Map<[^,<>\n]+,\s*Set<${ELEM}>>)`,
  "gm",
);
const NAMED_FN = /(?:Listener|Handler|Callback|Subscriber)\w*$/;

/** Is `elem` a function type — inline (`() => void`), conventionally named
 *  (`…Listener`), or a local alias to one (`type L = (s: X) => void`)? */
function isFnElem(elem: string, code: string): boolean {
  const e = elem.trim();
  if (e.includes("=>") || NAMED_FN.test(e)) return true;
  if (!/^\w+$/.test(e)) return false;
  return new RegExp(String.raw`\btype\s+${e}\s*=\s*[^;]*=>`).test(code);
}

function subscribersOf(code: string): string[] {
  return [...code.matchAll(COLLECTION_RE)]
    .filter((m) => isFnElem(m[2] ?? m[3], code))
    .map((m) => m[1]);
}

const CODE = paneImportClosure();
const fileOf = (key: string) => key.split("#")[0];

function census(): string[] {
  const out: string[] = [];
  for (const [f, code] of CODE) {
    for (const name of subscribersOf(code)) out.push(`${relToSrc(f)}#${name}`);
  }
  return out.sort();
}

describe("module-subscriber scope census (task 739)", () => {
  it("the needle is real (canary: it finds known app-wide and doc-keyed buses)", () => {
    const found = census();
    expect(found).toContain("lib/input-modality.ts#listeners");
    expect(found).toContain("lib/save-request.ts#listeners");
    expect(found.length).toBeGreaterThan(20);
  });

  it("every module-level subscriber collection in the pane's closure is declared", () => {
    const undeclared = census().filter((k) => !LEDGER[k]);
    expect(
      undeclared,
      "A module-level subscriber Set is reachable from EditorPane. Every mounted pane will hear every publish. " +
        "If the value it carries is per-document, key it by docId or inject the sink per pane (task 739); " +
        "otherwise declare it here with its scope.",
    ).toEqual([]);
  });

  it("no ledger row is stale", () => {
    const found = new Set(census());
    expect(Object.keys(LEDGER).filter((k) => !found.has(k))).toEqual([]);
  });

  it("each declared scope is backed by the file's code", () => {
    const bad: string[] = [];
    for (const [k, row] of Object.entries(LEDGER)) {
      const code = CODE.get(path.join(SRC, fileOf(k)));
      if (!code || !SCOPE_TEETH[row.scope].test(code)) bad.push(`${k} (${row.scope})`);
      if (!row.why.trim()) bad.push(`${k} (no why)`);
    }
    expect(bad).toEqual([]);
  });

  it("the teeth bite: the pre-739 card-lifecycle bus is caught and can't claim doc-keyed", () => {
    // The shape task 739 deleted, verbatim in its load-bearing lines.
    const pre739 = [
      "type Listener = (signal: CardLifecycleSignal) => void;",
      "const _listeners = new Set<Listener>();",
      "export function publishCardLifecycle(signal: CardLifecycleSignal): void {",
      "  for (const fn of _listeners) fn(signal);",
      "}",
    ].join("\n");
    expect(subscribersOf(pre739)).toEqual(["_listeners"]);
    expect(SCOPE_TEETH["doc-keyed"].test(pre739)).toBe(false);
    // Annotated and nested forms are seen too.
    expect(subscribersOf("const a: Set<() => void> = new Set();")).toEqual(["a"]);
    expect(subscribersOf("const b = new Map<string, Set<() => void>>();")).toEqual(["b"]);
    // An alias of any name resolves (the neuter that first slipped past).
    expect(subscribersOf("type L = (s: X) => void;\nconst c = new Set<L>();")).toEqual(["c"]);
    // A plain data Set is not a subscriber collection.
    expect(subscribersOf("const KINDS = new Set<TextObjectKind>();")).toEqual([]);
  });

  it("the card-lifecycle signal is not a module bus (the defect this census exists for)", () => {
    expect(census().filter((k) => k.startsWith("cards/lifecycle/"))).toEqual([]);
  });
});
