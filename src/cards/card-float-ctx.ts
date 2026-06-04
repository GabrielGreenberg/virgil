/**
 * `CardFloatCtx` — the per-doc dependency bag handed to a card's
 * `CARD_REGISTRY[kind].toFloatable(id, ctx)`. It is exactly today's
 * `PoppedCardDeps` (entity collections + selected-id slots + setters +
 * `editorRef` + shared actions, sourced from the EditorLayout shell).
 *
 * Re-homed conceptually to the card spine (`src/cards/`) so the registry owns
 * its own float-context type. AF's `FloatHost` passes the matching bag opaquely
 * (`FloatRenderCtx`) to `toFloatable`. The concrete shape still lives in
 * `floating-cards.tsx` for now (where its many handler closures are wired);
 * this alias is the spine-facing name. A later cleanup may move the definition
 * here and have `floating-cards.tsx` re-export it.
 */
export type { PoppedCardDeps as CardFloatCtx } from "@/components/editor-layout/floating-cards";
