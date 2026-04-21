// Barrel for all custom Virgil TipTap extensions. Each extension lives in
// its own file; import from "@/lib/tiptap-extensions" (which re-exports
// this barrel) to keep call-site imports unchanged.

export { VIRGIL_COMMANDS, VIRGIL_COMMAND_NAMES, COMMAND_MAP, type VirgilCommand } from "./commands";
export { LatexCommandMark } from "./latex-command";
export { InlineMath, DisplayMath } from "./math";
export { Footnote } from "./footnote";
export { LatexComment } from "./latex-comment";
export { ArchiveMarker } from "./archive-marker";
export { Citation, consumePendingCitationCreate, markPendingCitationCreate } from "./citation";
export { LabelRef, LabelHandler } from "./label";
export { EmptyParagraphTitleCleaner, TitleField, MaketitleMarker } from "./title";
export { AiRequestMarker } from "./ai-request";
export { LinkedAnchor, LinkedAnchorGuard, MarginaliaAnchorGuard } from "./linked-anchor";
