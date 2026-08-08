/**
 * Drop spec for popped-out citation cards (`citation:${id}`).
 *
 * The citation card stays; only its inline `\cite{}` atom moves to a
 * new inline cursor position.
 *
 * "Anchor the unanchored": a citation card can exist with NO `\cite{}` atom
 * in the prose (created via the panel "+" / builder). The opt-in `createAtom`
 * factory builds a fresh `citation` atom — reusing the card's EXISTING
 * citationId — and the shared `inlineAtomMoveSpec` inserts it at the drop
 * point. The node shape mirrors the `\cite` create path (`citation.ts`:
 * `{ citationId, command, displayText: "" }`), substituting the existing id
 * instead of minting a new one.
 *
 * The new atom's LaTeX `command` is read from the citations panel hook via
 * the shared inline-atom card accessor (`ctx.atomCards.citation`) — an
 * unanchored card has no marker to read it from. An empty DRAFT citation (no
 * serializable citekey yet) DECLINES (returns null): the drop-button is
 * disabled upstream for that case, but defend here too so a stray drop is a
 * silent no-op, not an empty `\cite{}`.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { inlineAtomMoveSpec } from "@/components/drop-mode/util/inline-atom-move";
import { citationCommandOrNull } from "@/lib/bib-parser";

export const citationDropSpec = inlineAtomMoveSpec({
  nodeName: "citation",
  idAttr: "citationId",
  cardApiKind: "citation",
  createAtom: ({ id, schema, cardAttrs }): PMNode | null => {
    const citationNodeType = schema.nodes.citation;
    if (!citationNodeType) return null;
    // The serializable `\cite{…}` command lives in the citations panel hook,
    // keyed by the card id (the unanchored card has no marker to read it from);
    // the shared factory resolves it into `cardAttrs`. Decline an empty DRAFT —
    // no command, or a command with no real citekeys (`\cite{}`). Anchoring an
    // empty draft would plant a keyless atom that can never serialize; the
    // upstream button is disabled, this is defense. The SAME
    // `citationCommandOrNull` predicate gates the button + the hook accessor,
    // so this re-check can never disagree with them. (Unlike the footnote twin,
    // an UNWIRED accessor must also decline here: a citation with no command is
    // not a legal atom, whereas an empty footnote body is a legal footnote.)
    const command = citationCommandOrNull(cardAttrs?.command);
    if (!command) return null;
    // Same shape the `\cite` typed/slash/menu create path builds (citation.ts),
    // but carry the card's EXISTING citationId so the new atom stays coupled
    // to the card. displayText is empty — the panel/renderer fills it from the
    // command + bib on next derive.
    return citationNodeType.create({ citationId: id, command, displayText: "" });
  },
});
