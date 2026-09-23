"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

/**
 * Reactive read of the MAIN editor's editability — the single read-only /
 * partner-claimed signal an embedded editor (the Examples card, the in-editor
 * floats, the source pod) should gate its own `editable` on.
 *
 * The main editor keeps PM's `view.editable` at `true` ALWAYS (so the DOM
 * stays `contenteditable` and PM keeps syncing); read-only is enforced by the
 * `readOnlyEnforcer` plugin's `filterTransaction` and surfaced declaratively
 * as the `data-editable` attribute on the editor root (`Editor.tsx`). So an
 * embedded editor must read THAT attribute, not `mainEditor.isEditable`
 * (which is a constant `true`). We observe the single attribute so a mid-
 * session read-only toggle (collab pen handoff) flips the embed too. Defaults
 * to `true` (editable) when there's no main editor / attribute yet.
 *
 * It lives in its own module, apart from the `editor-ref` CONTEXT it used to
 * share a file with, because a React NodeView is one of its callers and
 * `print-chrome-only-posture`'s population closes over every `.tsx` a NodeView
 * imports — a hook file renders nothing, so pulling the whole `Editor.tsx`
 * tree into that closure through a context module was a false edge. Which
 * modules must call it is `embedded-source-editor-gate-census.test.ts`.
 */
export function useMainEditable(mainEditor: Editor | null | undefined): boolean {
  const [editable, setEditable] = useState(true);
  useEffect(() => {
    const dom = mainEditor?.view?.dom as HTMLElement | undefined;
    if (!dom) {
      setEditable(true);
      return;
    }
    const read = () => setEditable(dom.getAttribute("data-editable") !== "false");
    read();
    const obs = new MutationObserver(read);
    obs.observe(dom, { attributes: true, attributeFilter: ["data-editable"] });
    return () => obs.disconnect();
  }, [mainEditor]);
  return editable;
}
