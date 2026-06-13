"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
} from "./text-object-registry";
import type {
  SelectionRef,
  TextObjectKind,
  TextObjectRef,
} from "./types";
import { getBus } from "@/lib/tiptap/doc-structure";

/**
 * Shared subscription that resolves the active TextObject from the
 * editor's selection. Single subscription replaces N independent ones —
 * before this existed, TextObjectGrabHandle, SelectionActionsMenu,
 * ActionsMenuPanel, and useEditorUIState each subscribed to
 * `selectionUpdate` and ran their own resolver walk.
 *
 * Resolution priority (mirrors the grab handle's 5-step priority, minus
 * the mouse-hover step that is consumer-specific):
 *   1. Non-empty TextSelection            → SelectionRef
 *   2. NodeSelection on a TextObject      → TextObjectRef for that node
 *   3. (caller-specific: mouse hover) — handled in the consumer
 *   4. Collapsed caret in a sub-object    → TextObjectRef for innermost
 *   5. Collapsed caret in a top-level kind → TextObjectRef for outermost
 *      top-level kind (so cursor in a paragraph inside a blockquote
 *      grabs the blockquote, not the inner paragraph)
 */

export type ActiveTextObjectRef = TextObjectRef | SelectionRef | null;

interface Store {
  current: ActiveTextObjectRef;
  subscribers: Set<() => void>;
}

interface ActiveTextObjectContextValue {
  store: Store;
}

const Context = createContext<ActiveTextObjectContextValue | null>(null);

function refsEqual(a: ActiveTextObjectRef, b: ActiveTextObjectRef): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "selection" && b.kind === "selection") {
    return (
      a.from === b.from &&
      a.to === b.to &&
      a.paragraphId === b.paragraphId
    );
  }
  if (a.kind !== "selection" && b.kind !== "selection") {
    return a.id === b.id;
  }
  return false;
}

function resolveFromSelection(editor: Editor): ActiveTextObjectRef {
  const sel = editor.state.selection;
  if (sel.from !== sel.to && !(sel instanceof NodeSelection)) {
    const $from = editor.state.doc.resolve(sel.from);
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      if (
        !isTextObjectKind(node.type.name) ||
        node.type.name === "linkedRange"
      ) {
        continue;
      }
      const uuid = node.attrs?.uuid as string | null;
      if (uuid) {
        return {
          kind: "selection",
          from: sel.from,
          to: sel.to,
          paragraphId: uuid,
        };
      }
    }
  }
  if (sel instanceof NodeSelection) {
    const node = sel.node;
    const name = node.type.name;
    if (
      isTextObjectKind(name) &&
      name !== "linkedRange" &&
      (node.attrs?.uuid as string | null)
    ) {
      return { kind: name, id: node.attrs.uuid as string };
    }
  }
  const $from = editor.state.doc.resolve(sel.from);
  let outermostTopLevel: TextObjectRef | null = null;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    const name = node.type.name;
    if (!isTextObjectKind(name) || name === "linkedRange") continue;
    const id = node.attrs?.uuid as string | null;
    if (!id) continue;
    const meta = TEXT_OBJECT_REGISTRY[name as TextObjectKind];
    if (meta.isSubObject) {
      return { kind: name as TextObjectKind, id };
    }
    outermostTopLevel = { kind: name as TextObjectKind, id };
  }
  return outermostTopLevel;
}

interface ProviderProps {
  editorRef: RefObject<Editor | null>;
  children: ReactNode;
}

export function ActiveTextObjectProvider({ editorRef, children }: ProviderProps) {
  const storeRef = useRef<Store>({ current: null, subscribers: new Set() });

  useEffect(() => {
    const store = storeRef.current;

    function recompute() {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) {
        if (store.current !== null) {
          store.current = null;
          for (const cb of store.subscribers) cb();
        }
        return;
      }
      const next = resolveFromSelection(editor);
      if (!refsEqual(store.current, next)) {
        store.current = next;
        for (const cb of store.subscribers) cb();
      }
    }

    const onSelection = () => recompute();
    // Block-structure changes via DocStructureObserver replace the
    // direct `transaction` subscription. Typing-only transactions
    // don't shift which block the cursor is in; only blocks-added /
    // blocks-removed events matter.
    let busUnsubs: (() => void)[] = [];

    let attached: Editor | null = null;
    let pollAttempts = 0;
    function attach() {
      const editor = editorRef.current;
      if (!editor || editor === attached) return;
      if (attached) {
        attached.off("selectionUpdate", onSelection);
        for (const u of busUnsubs) u();
        busUnsubs = [];
      }
      attached = editor;
      editor.on("selectionUpdate", onSelection);
      const bus = getBus(editor);
      if (bus) {
        busUnsubs.push(bus.onBlocksAdded(recompute));
        busUnsubs.push(bus.onBlocksRemoved(recompute));
      }
      recompute();
    }

    function poll() {
      attach();
      if (!editorRef.current && pollAttempts < 30) {
        pollAttempts += 1;
        window.setTimeout(poll, 50);
      }
    }
    poll();

    return () => {
      if (attached) {
        attached.off("selectionUpdate", onSelection);
        for (const u of busUnsubs) u();
        busUnsubs = [];
        attached = null;
      }
    };
  }, [editorRef]);

  const value = useMemo<ActiveTextObjectContextValue>(
    () => ({ store: storeRef.current }),
    [],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * Read the current active TextObject. Returns `null` when no resolvable
 * TextObject is under the selection. Re-renders only when the resolved
 * ref actually changes (by `refsEqual`), not on every selectionUpdate.
 *
 * Outside an `ActiveTextObjectProvider`, returns `null` instead of
 * throwing — keeps consumers usable in test contexts and mid-mount races.
 */
export function useActiveTextObject(): ActiveTextObjectRef {
  const ctx = useContext(Context);
  const store = ctx?.store;
  return useSyncExternalStore(
    (cb) => {
      if (!store) return () => {};
      store.subscribers.add(cb);
      return () => {
        store.subscribers.delete(cb);
      };
    },
    () => store?.current ?? null,
    () => null,
  );
}
