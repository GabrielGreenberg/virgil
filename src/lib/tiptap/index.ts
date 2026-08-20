// Barrel for all custom Virgil TipTap extensions. Each extension lives in
// its own file; import from "@/lib/tiptap-extensions" (which re-exports
// this barrel) to keep call-site imports unchanged.

export { VIRGIL_COMMANDS, VIRGIL_COMMAND_NAMES, COMMAND_MAP, type VirgilCommand } from "./commands";
export { LatexCommandMark, LatexVerbatimMark, LatexCommentTailMark } from "./latex-command";
export { SlashPopupExtension } from "./slash-popup";
export { InlineMath, DisplayMath } from "./math";
export { Footnote } from "./footnote";
export { LatexComment } from "./latex-comment";
export { Citation, consumePendingCitationCreate, markPendingCitationCreate } from "./citation";
export { LabelRef, LabelHandler } from "./label";
export {
  ExampleBlock,
  ExampleItemList,
  ExampleItem,
  ExampleGloss,
  AlignedGlossRow,
  ProseGlossRow,
  GlossCell,
  ExpexNumbering,
} from "./expex";
export { EmptyParagraphTitleCleaner, TitleField, MaketitleMarker } from "./title";
export { InlineAtomGrab } from "./inline-atom-grab";
export {
  LinkedAnchor,
  LinkedAnchorGuard,
  TextObjectOrphanGuard,
  MarginaliaAnchorGuard,
} from "./linked-anchor";
export { PgMarkChip } from "./pgmark";
export { SmartQuotes } from "./smart-quotes";
export { TabIndent } from "./tab-indent";
export { TextColor } from "./text-color";
export { TexBlock, insertTexBlock, collectTexBlockUuids, freshTexBlockAttrs } from "./tex-block";
export { ForestBlock, freshForestSource } from "./forest-block";
export type { ForestBlockOptions } from "./forest-block";
export {
  FigureBlock,
  type FigureBlockOptions,
  insertFigureBlock,
  collectFigureBlockUuids,
  freshFigureBlockAttrs,
} from "./figure-block";
export { FigureCaption } from "./figure-caption";
export {
  GraphicsBlock,
  insertGraphicsBlock,
  collectGraphicsBlockUuids,
  freshGraphicsBlockAttrs,
} from "./graphics-block";
export {
  buildBorrowedAtomSchema,
  buildCardBodySchema,
  canMountInCardBody,
  starterKitConfigForScope,
  CARD_STARTER_KIT_CONFIG,
  EXCERPT_STARTER_KIT_CONFIG,
  BORROWED_INLINE_ATOM_NAMES,
  BORROWED_BLOCK_ATOM_NAMES,
  type BorrowedSchemaOptions,
  type CardBodySchemaScope,
  type CardBodyMountCheck,
} from "./borrowed-schema";
