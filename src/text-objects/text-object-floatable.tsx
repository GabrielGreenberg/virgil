"use client";

import type { ComponentType, RefObject } from "react";
import type { EditorHandle } from "@/components/Editor";
import type { Floatable, FloatBodyContext } from "@/floats/types";
import { buildFloatKey } from "@/floats/float-key";
import { TEXT_OBJECT_REGISTRY } from "./text-object-registry";
import type { TextObjectFloatBodyProps, TextObjectKind, TextObjectRef } from "./types";

/**
 * The text-object side of the shared `Floatable` contract — the AF analogue of
 * `CARD_REGISTRY[kind].toFloatable`. Folds the old `TextObjectFloat` chrome into
 * `FloatWindow` + `FloatChrome`: the per-kind `floatBodyComponent` is the
 * headerless body; the label/jump/close skeleton is now `FloatChrome`. The
 * heading "Chapter"/"Section" retitle flows through `FloatBodyContext.setTitle`
 * (the generalized `setHeaderLabel`).
 *
 * Stage 3 registers this on `TEXT_OBJECT_REGISTRY[kind].toFloatable`; Stage 2
 * calls it directly from the float dispatcher.
 */
function TextObjectFloatBody({
  kind,
  id,
  editorRef,
  windowKey,
  setTitle,
}: {
  kind: TextObjectKind;
  id: string;
  editorRef: RefObject<EditorHandle | null>;
  windowKey: string;
  setTitle: (next: string | null) => void;
}) {
  const meta = TEXT_OBJECT_REGISTRY[kind];
  const Body = meta.floatBodyComponent as
    | ComponentType<TextObjectFloatBodyProps>
    | null;
  if (!Body) return null;
  return (
    <Body
      cardKey={windowKey}
      id={id}
      editorRef={editorRef}
      cardContext={false}
      setHeaderLabel={setTitle}
    />
  );
}

export function textObjectFloatable(
  ref: TextObjectRef,
  editorRef: RefObject<EditorHandle | null>,
): Floatable | null {
  const meta = TEXT_OBJECT_REGISTRY[ref.kind];
  if (!meta.floatBodyComponent) return null;
  const size = meta.initialFloatSize;
  return {
    key: buildFloatKey({ domain: "textobject", kind: ref.kind, id: ref.id }),
    domain: "textobject",
    kind: ref.kind,
    id: ref.id,
    surface: "card",
    title: meta.label,
    canJump: true,
    // Chip 2: text-object floats get the (re)anchor drop button too. The
    // button is rendered by `FloatChrome` (gated on this flag) and wired by
    // `FloatWindow` to `LiftHost.beginLift({terminalPolicy:"float", …})` — the
    // full lifted-overlay ghost. The drop spec it resolves to always exists
    // (`textObjectDropSpec` / `textRangeMoveDropSpec`), pinned by the
    // textobject-float-droppable contract test.
    canDrop: true,
    jumpToSource: () => editorRef.current?.scrollToParagraphId(ref.id),
    snapshotForStack: () => null, // Stage 5 wires snapshotParagraph/Section
    // No auto-fit: text floats spawn at the lift's authoritative captured
    // height (or `defaultSize` on a cold reload). The old grow-burst explicitly
    // skipped text-object floats; nothing opts in now.
    defaultSize: size ? { w: size.width, h: size.height } : undefined,
    renderBody: (ctx: FloatBodyContext) => (
      <TextObjectFloatBody
        kind={ref.kind}
        id={ref.id}
        editorRef={editorRef}
        windowKey={ctx.windowKey}
        setTitle={ctx.setTitle}
      />
    ),
  };
}
