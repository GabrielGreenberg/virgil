/**
 * **The schema-mount primitives** — can this JSON model actually be HELD by a
 * ProseMirror schema, and did the editor in fact keep what it was handed?
 *
 * Virgil mounts every editor with TipTap's default `enableContentCheck: false`,
 * and that default has a specific, silent consequence for JSON content:
 * `createNodeFromContent` wraps `schema.nodeFromJSON` in a `try`, and on a
 * throw it `console.warn`s and returns **an empty document**. So a model naming
 * one node type or one mark the schema does not have does not fail loudly — it
 * mounts as a BLANK document over an intact file.
 *
 * That is the same swallow `canMountInCardBody` guards on the capture side
 * (task 308), which is why the probe below is the primitive BOTH now share: one
 * `nodeFromJSON` against the destination's real schema, because asking the
 * schema itself is the one check that cannot drift from what the surface will
 * actually do.
 *
 * ## Detection is the MECHANISM's output; the probe is the diagnosis
 *
 * {@link checkKeptEverything} does not predict the swallow — it observes it.
 * The catch above has exactly one product (an empty doc), so "was I given
 * content and did the editor end up empty?" is both O(1) on the happy path and
 * exactly as complete as re-running `nodeFromJSON` would be. The probe is then
 * run only on the failure path, purely to name the cause in a message a person
 * can act on ("Unknown node type: …").
 *
 * Pure and schema-parameterized on purpose: this module imports no extension
 * list, so the storage/editor layers can take it without pulling a React
 * NodeView tree behind it.
 */
import type { Node as PMNode, Schema } from "@tiptap/pm/model";

/** Result of {@link canMountInSchema}. */
export type SchemaMountCheck = { ok: true } | { ok: false; reason: string };

/**
 * Can `json` be represented by `schema`? A `false` here means the surface
 * mounting it will silently substitute an EMPTY document (see the header), so
 * the caller must refuse rather than proceed.
 *
 * Cheap: one `Schema.nodeFromJSON`, on a discrete action — never on a keystroke
 * path.
 */
export function canMountInSchema(
  schema: Schema,
  json: unknown,
): SchemaMountCheck {
  if (json == null) return { ok: true };
  try {
    schema.nodeFromJSON(json as never);
    return { ok: true };
  } catch (err) {
    // ProseMirror's own messages are precise and user-legible ("Unknown node
    // type: heading"); surface them rather than flattening every cause to one
    // opaque string.
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Is this mounted document empty in the sense TipTap's swallow produces — no
 * children at all, or the single empty textblock `createNodeFromContent("")`
 * yields against a schema whose top node requires a block?
 */
export function docIsEffectivelyEmpty(doc: PMNode): boolean {
  if (doc.childCount === 0) return true;
  if (doc.childCount > 1) return false;
  const only = doc.firstChild;
  return !!only && only.isTextblock && only.content.size === 0;
}

/**
 * Did the JSON we handed over carry anything a reader would miss? Any non-empty
 * text anywhere, or any node that is not one of the empty structural wrappers a
 * blank document is made of.
 *
 * Walked as PLAIN JSON (no schema), and only ever on the failure path — the
 * happy path is answered O(1) by {@link docIsEffectivelyEmpty}.
 */
export function jsonCarriesContent(json: unknown): boolean {
  const EMPTY_WRAPPERS = new Set(["doc", "paragraph"]);
  let found = false;
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    const node = n as { type?: string; text?: string; content?: unknown };
    if (typeof node.text === "string" && node.text.trim() !== "") {
      found = true;
      return;
    }
    if (typeof node.type === "string" && !EMPTY_WRAPPERS.has(node.type)) {
      found = true;
      return;
    }
    walk(node.content);
  };
  walk(json);
  return found;
}

/** The verdict of a mount: did the editor keep what it was given? */
export interface MountVerdict {
  ok: boolean;
  /** Why, when it did not — ProseMirror's own message where one was available. */
  reason: string;
}

const KEPT: MountVerdict = { ok: true, reason: "" };

/**
 * The door: compare what the editor KEPT against what it was GIVEN.
 *
 * Fails CLOSED in the one ambiguous case — content went in, an empty document
 * came out, and the schema probe cannot name a cause. Something coerced the
 * model away; a generic refusal that gates writes is the right answer, because
 * the alternative is a blank editor silently overwriting an intact file.
 */
export function checkKeptEverything(
  schema: Schema,
  mounted: PMNode,
  given: unknown,
): MountVerdict {
  if (!docIsEffectivelyEmpty(mounted)) return KEPT;
  // A genuinely empty document mounting empty is not a loss.
  if (!jsonCarriesContent(given)) return KEPT;
  const probe = canMountInSchema(schema, given);
  return {
    ok: false,
    reason: probe.ok
      ? "the editor produced an empty document from content that was not empty"
      : probe.reason,
  };
}
