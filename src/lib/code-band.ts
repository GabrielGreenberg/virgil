/**
 * Code-side cursor band — a passive light-red highlight over the source
 * lines of the text-object under the TipTap cursor.
 *
 * This is the read-only counterpart to the (now removed) auto-align
 * behavior: instead of scrolling the code pane to follow the TipTap
 * cursor, the bridge dispatches `setCodeBand` with the CodeMirror char
 * range of the active text-object's source. This StateField turns that
 * range into per-line decorations (the band) without moving the
 * viewport. Manual alignment is offered separately via the divider
 * arrows (see `code-pane-bridge.ts` → `moveCodeToTextCursor`).
 */
import { StateField, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/** Set (or clear, with null) the highlighted source range for the code-side
 *  cursor band. Carries CodeMirror char positions {from,to}. */
export const setCodeBand = StateEffect.define<{ from: number; to: number } | null>();

const lineDeco = Decoration.line({ class: "cm-virgil-band" });

export const codeBandField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setCodeBand)) continue;
      if (!e.value) {
        deco = Decoration.none;
        continue;
      }
      const doc = tr.state.doc;
      const clampPos = (n: number) => Math.max(0, Math.min(n, doc.length));
      const startLine = doc.lineAt(clampPos(e.value.from)).number;
      const endLine = doc.lineAt(clampPos(e.value.to)).number;
      const ranges = [];
      for (let l = startLine; l <= endLine; l++)
        ranges.push(lineDeco.range(doc.line(l).from));
      deco = Decoration.set(ranges, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
