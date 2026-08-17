"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { generateShortId } from "@/lib/uuid";
import { readBib, writeBib } from "@/lib/storage";
import { DOC_BIB_CHANGED_EVENT } from "@/lib/project-bib";
import { isUnanchored } from "@/links/links";
import type { CitationsState, CitationRef, BibEntry } from "@/lib/types";
import {
  parseBibFile,
  serializeBibFile,
  parseCiteCommand,
  citationCommandOrNull,
  formatInlineCitation,
  formatBibliography,
} from "@/lib/bib-parser";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import { usePersistentState } from "./usePersistentState";
import type { PristineKindApi } from "./usePristineCardManager";
import { isIdentityCascadeOn } from "@/lib/identity/identity-flag";
import {
  IdentityCascade,
  renameCitekeyChange,
  retypeChange,
} from "@/lib/identity/identity-cascade";
import { wholeWordPatternFor } from "@/lib/whole-word";
import { mintBibUid } from "@/lib/bib-uid";
import { asBibFamily, DEFAULT_BIB_FAMILY, type BibFamily } from "@/lib/bib-family";

/** No stored family: the user has not chosen one. Detection seeds the VIEW
 *  (never the sidecar) and `DEFAULT_BIB_FAMILY` answers until it resolves. */
const EMPTY: CitationsState = {
  citations: [],
  bibPath: "",
  citationStyle: "apa",
};

export type CitationsHook = ReturnType<typeof useCitations>;

/** No-op hook value for paneState-routed consumers (EditorLayout reads
 *  citationsHook back from EditorPane via `paneState.citationsHook`).
 *  Safe default while the pane hasn't bubbled state yet — matches the
 *  COLLAB_INERT precedent. Every action is a no-op; getters return
 *  sensible empties. */
const _emptyArr: never[] = [];
export const CITATIONS_INERT: CitationsHook = {
  citations: _emptyArr,
  bibPath: "",
  citationStyle: "apa",
  bibPackage: DEFAULT_BIB_FAMILY,
  bibEntries: _emptyArr,
  bibRaw: "",
  addCitation: (command: string) => ({
    id: "",
    command,
    keys: [],
    createdAt: new Date(0).toISOString(),
  }),
  updateCitation: () => {},
  deleteCitation: () => {},
  setArchived: () => {},
  cloneCitation: () => null,
  setStyle: () => {},
  setBibPackage: () => {},
  addBibEntry: () => {},
  updateBibEntry: () => {},
  replaceBibEntry: () => {},
  updateBibKeyAndType: () => {},
  getBibEntry: () => undefined,
  getDisplayText: (command: string) => command,
  getFormattedBib: () => "",
  commandFor: () => null,
  markAnchored: () => {},
  syncFromEditor: () => {},
  identityCascade: new IdentityCascade(),
};

function migrate(raw: unknown): CitationsState {
  const s = raw as Partial<CitationsState>;
  if (!Array.isArray(s.citations)) return EMPTY;
  // `bibPackage` is normalized through `asBibFamily`, so an absent key and a
  // value this build doesn't recognize both come back UNSET — the state can
  // then represent "the user has not chosen", which is what makes the
  // seed-not-stomp rule expressible at all (task 344). Fabricating a default
  // here is what made a detection guess indistinguishable from a user choice.
  const stored = asBibFamily(s.bibPackage);
  return {
    citations: s.citations,
    bibPath: s.bibPath ?? "",
    citationStyle: s.citationStyle ?? "apa",
    ...(stored ? { bibPackage: stored } : {}),
  };
}

export function useCitations(docId: string | null, pristine?: PristineKindApi | null) {
  const {
    state,
    update,
    stateRef,
  } = usePersistentState<CitationsState>(docId, "citations.json", EMPTY, {
    migrate,
    errorLabel: "citations",
  });

  // .bib side — lives outside the factory since it's a different sidecar
  // with its own parse/serialize pipeline.
  const [bibEntries, setBibEntries] = useState<BibEntry[]>([]);
  const [bibRaw, setBibRaw] = useState("");
  /**
   * What the `.tex` DETECTS (task 344). Deliberately local component state and
   * NOT part of the persisted `CitationsState`: detection can never distinguish
   * "found natbib" from "found nothing" (it defaults), so writing it into the
   * sidecar would let a guess overwrite the user's own Package choice — which
   * it did, on every doc open and every `DOC_BIB_CHANGED_EVENT`, with the next
   * unrelated citations write making the guess durable on disk.
   *
   * Keeping it out of the persisted state also retires the ordering hazard a
   * gated write would have carried: `refreshBib` is async and races the sidecar
   * load, so any "write only if unset" guard would have to be evaluated against
   * the LOADED state rather than the pre-load default. A non-writer has no race
   * to lose.
   *
   * It carries the `docId` it was detected FOR rather than being cleared on a
   * doc switch: a family detected from another paper's `.tex` then cannot
   * answer for this one BY CONSTRUCTION, with no clearing step to get wrong (and
   * no setState in an effect body).
   */
  const [detected, setDetected] = useState<{
    docId: string;
    family: BibFamily | null;
  } | null>(null);
  const detectedFamily =
    detected && detected.docId === docId ? detected.family : null;
  const docRef = useRef(docId);

  /**
   * The family every consumer reads, resolved at READ time from one authority
   * chain: the user's STORED choice wins; failing that the `.tex` DETECTION
   * seeds it; failing that `DEFAULT_BIB_FAMILY` (Virgil's baseline) answers
   * until the read resolves.
   *
   * The last rung is why the baseline is spelled once (task 344): this hook
   * used to open at `"biblatex"` while the detector defaulted to `"natbib"`,
   * so on the majority of documents an ordinary doc OPEN changed this value —
   * and `CitationCard`'s package-change effect reads any change of it as a
   * package switch and re-derives every citation's command shape. Agreeing
   * with the detector makes the common case settle with no change at all.
   */
  const storedFamily = asBibFamily(state.bibPackage);
  const bibPackage: BibFamily =
    storedFamily ?? detectedFamily ?? DEFAULT_BIB_FAMILY;

  // The IdentityCascade — the single writer for identity-changing ops, owned
  // here (one per doc, NOT a module singleton — D1.4 / T1 §3.2c). A stable
  // instance across renders (lazy `useState` initializer) so external surfaces
  // (the editor `\cite{}` doc-rewrite, future citekey-keyed sidecars) can
  // register migrators against it once. Gated behind `virgil:identity-cascade`:
  // when the flag is OFF the cascade is never invoked, so the legacy
  // `updateBibKeyAndType` path is the only writer and behavior is byte-identical
  // to today.
  const [identityCascade] = useState(() => new IdentityCascade());

  // Pin the bib write handle to docId's currently-active pipeline.
  // Stale handles (from a doc switch) are rejected by writeBib.
  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  const refreshBib = useCallback((id: string) => {
    readBib(id)
      .then((data) => {
        if (docRef.current !== id) return;
        setBibRaw(data.bibText || "");
        if (data.bibText) {
          try {
            setBibEntries(parseBibFile(data.bibText));
          } catch {
            setBibEntries([]);
          }
        } else {
          setBibEntries([]);
        }
        // SEED the detected family into the view. It does NOT touch the
        // persisted state: a stored family is the user's choice and detection
        // is never entitled to overwrite it (task 344).
        setDetected({ docId: id, family: asBibFamily(data.detectedPackage) });
      })
      .catch((e) => {
        console.warn(`readBib failed for ${id}:`, e);
      });
  }, []);

  useEffect(() => {
    docRef.current = docId;
    if (!docId) {
      setBibEntries([]);
      setBibRaw("");
      return;
    }
    refreshBib(docId);
  }, [docId, refreshBib]);

  // Out-of-band writes to references.bib (e.g. dropping an entry onto a
  // Project library tab) dispatch DOC_BIB_CHANGED_EVENT — re-read so the
  // doc's citation UI reflects the new entry without a manual refresh.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ docId?: string }>).detail;
      const id = docRef.current;
      if (!id) return;
      if (detail?.docId && detail.docId !== id) return;
      refreshBib(id);
    };
    window.addEventListener(DOC_BIB_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DOC_BIB_CHANGED_EVENT, handler);
  }, [refreshBib]);

  const persistBib = useCallback(
    async (text: string) => {
      if (!handle) return;
      try {
        await writeBib(handle, text);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to save bib:", err);
      }
    },
    [handle],
  );

  const addCitation = useCallback(
    (command: string, existingId?: string, markUnanchored?: boolean): CitationRef => {
      const parsed = parseCiteCommand(command);
      const ref: CitationRef = {
        id: existingId || generateShortId(),
        command,
        keys: parsed?.keys || [],
        createdAt: new Date().toISOString(),
        ...(markUnanchored ? { unanchored: true as const } : {}),
      };
      // Pristine when created with no cite keys (e.g. toolbar "+" insert:
      // `\cite{}`). Once the user fills in a key, updateCitation clears it.
      if (ref.keys.length === 0) pristine?.markNew(ref.id);
      update((prev) => {
        const existing = prev.citations.find((c) => c.id === ref.id);
        if (existing) {
          // Entry already in state. If we're (re)anchoring an
          // unanchored entry — i.e. dragging an unanchored card into
          // the editor — clear the unanchored flag so syncFromEditor
          // won't resurrect it on next reload. Also clear `archived`:
          // `setArchived` sets `archived`+`unanchored` JOINTLY (archiving
          // splices the atom out), so re-anchoring an ARCHIVED card must
          // un-set BOTH — the citation is now a live in-text reference,
          // neither archived nor an unanchored draft. Clearing only
          // `unanchored` (task 079) left it filed in the archive tray while
          // anchored in the prose.
          if (isUnanchored(existing) && !markUnanchored) {
            return {
              ...prev,
              citations: prev.citations.map((c) =>
                c.id === ref.id
                  ? { ...c, unanchored: undefined, archived: undefined }
                  : c,
              ),
            };
          }
          return prev;
        }
        return { ...prev, citations: [...prev.citations, ref] };
      });
      return ref;
    },
    [update, pristine],
  );

  const updateCitation = useCallback(
    (id: string, command: string) => {
      const parsed = parseCiteCommand(command);
      if (parsed?.keys && parsed.keys.length > 0) pristine?.markDirty(id);
      update((prev) => ({
        ...prev,
        citations: prev.citations.map((c) =>
          c.id === id ? { ...c, command, keys: parsed?.keys || [] } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const deleteCitation = useCallback(
    (id: string) => {
      pristine?.markDirty(id);
      update((prev) => ({
        ...prev,
        citations: prev.citations.filter((c) => c.id !== id),
      }));
    },
    [update, pristine],
  );

  /** Flip a citation ref's archived (set-aside) flag. The caller (EditorPane's
   *  archive handler) additionally splices the `\cite` atom out of the doc. Since
   *  `syncFromEditor` only carries forward `isUnanchored` refs, archiving ALSO
   *  marks the ref `unanchored: true` — which is now literally true (the atom is
   *  gone), so the archived ref survives the next parse with its content + the
   *  `archived` flag intact. Unarchive (archived=false) leaves it as a normal
   *  unanchored draft citation — the atom is NOT re-inserted. */
  const setArchived = useCallback(
    (id: string, archived: boolean) => {
      pristine?.markDirty(id);
      update((prev) => ({
        ...prev,
        citations: prev.citations.map((c) =>
          c.id === id
            ? { ...c, archived, ...(archived ? { unanchored: true as const } : {}) }
            : c,
        ),
      }));
    },
    [update, pristine],
  );

  /** Deep-copy a citation sidecar entry with a fresh id. Returns the new
   *  id, or null if the source id wasn't found. The cite command + keys
   *  (which reference shared .bib entries) are copied verbatim. */
  const cloneCitation = useCallback(
    (sourceId: string): string | null => {
      const source = stateRef.current.citations.find((c) => c.id === sourceId);
      if (!source) return null;
      const newRef: CitationRef = {
        id: generateShortId(),
        command: source.command,
        keys: [...source.keys],
        createdAt: new Date().toISOString(),
      };
      update((prev) => ({
        ...prev,
        citations: [...prev.citations, newRef],
      }));
      return newRef.id;
    },
    [update, stateRef],
  );

  const setStyle = useCallback(
    (style: string) => {
      update((prev) => ({ ...prev, citationStyle: style }));
    },
    [update],
  );

  /** The ONE writer of the stored family — the user's Package control. Every
   *  other path (detection, a doc open, a `.bib` change) may only SEED the
   *  view. */
  const setBibPackage = useCallback(
    (pkg: string) => {
      update((prev) => ({ ...prev, bibPackage: pkg }));
    },
    [update],
  );

  /**
   * MERGE field updates into an entry (D3 — the `updateBibEntry`=merge half).
   * `fields` is shallow-merged over the entry's existing `fields`, so a field
   * absent from `fields` is KEPT. This is the incremental-edit primitive
   * (typing in one field of the bib editor, an `answer-bib-review` field fill).
   * For wholesale set-all semantics that honor field DELETION use
   * {@link replaceBibEntry}.
   */
  const updateBibEntry = useCallback(
    (key: string, fields: Record<string, string>) => {
      setBibEntries((prev) => {
        const next = prev.map((e) => {
          if (e.key !== key) return e;
          const updated = { ...e, fields: { ...e.fields, ...fields } };
          const lines = Object.entries(updated.fields)
            .map(([k, v]) => `  ${k} = {${v}}`)
            .join(",\n");
          updated.raw = `@${updated.type}{${updated.key},\n${lines}\n}`;
          return updated;
        });
        const newRaw = serializeBibFile(next);
        setBibRaw(newRaw);
        void persistBib(newRaw);
        return next;
      });
    },
    [persistBib],
  );

  /**
   * REPLACE an entry's fields (and optionally its type) WHOLESALE (D3 — the
   * `replaceBibEntry`=set-all half; consumed by T6-C16's "Replace with library"
   * and the bib-editor Save). Unlike {@link updateBibEntry}, the supplied
   * `fields` is the COMPLETE new field set: a field the user cleared (absent
   * from `fields`) is DELETED, not retained (BIB-A3-02 / BIB-F5-04 — "I cleared
   * the field but it came back"). The entry's durable `uid` and citekey are
   * untouched (this is not an identity move — a rename routes through
   * `updateBibKeyAndType`/the cascade).
   *
   * Single-writer discipline (D3): under the `virgil:identity-cascade` flag the
   * cascade is the canonical writer for every bib-entry mutation, so a `retype`
   * (type changed) is fanned through `runIdentityChange` so any registered
   * `bibEntry` migrator observes it. The `.bib`-side set-all + persist is done
   * here regardless (it owns the entries array). Flag OFF: the cascade is never
   * invoked — the on-disk write is byte-identical to a direct set-all, so the
   * existing suite is unaffected.
   */
  const replaceBibEntry = useCallback(
    (key: string, fields: Record<string, string>, type?: string) => {
      setBibEntries((prev) => {
        const next = prev.map((e) => {
          if (e.key !== key) return e;
          const nextType = type ?? e.type;
          // set-all: replace the field map entirely (cleared fields are gone).
          const updated: BibEntry = { ...e, type: nextType, fields: { ...fields } };
          const lines = Object.entries(updated.fields)
            .map(([k, v]) => `  ${k} = {${v}}`)
            .join(",\n");
          updated.raw = `@${updated.type}{${updated.key},\n${lines}\n}`;
          return updated;
        });
        const newRaw = serializeBibFile(next);
        setBibRaw(newRaw);
        void persistBib(newRaw);
        return next;
      });
      // Fan a REAL type change through the single writer so any registered
      // migrator observes it. Resolve the retype decision from the live
      // `bibEntries` (hook scope) — NOT from inside the state updater, whose
      // run timing isn't synchronous under concurrent React.
      if (isIdentityCascadeOn() && type !== undefined) {
        const entry = bibEntries.find((e) => e.key === key);
        if (entry?.uid && entry.type !== type) {
          void identityCascade.runIdentityChange(
            retypeChange({ uid: entry.uid, newType: type }),
          );
        }
      }
    },
    [persistBib, bibEntries, identityCascade],
  );

  /** Apply the `.bib`-side `key`+`type` mutation for the entry currently
   *  carrying `oldKey` (legacy path) OR the entry with `uid` (cascade path).
   *  Reconstructs the entry's `raw` block + reserializes + persists. Shared by
   *  both flag paths so the on-disk write is identical. */
  const applyBibKeyType = useCallback(
    (match: (e: BibEntry) => boolean, newKey: string, newType: string) => {
      setBibEntries((prev) => {
        const next = prev.map((e) => {
          if (!match(e)) return e;
          const updated = { ...e, key: newKey, type: newType };
          const lines = Object.entries(updated.fields)
            .map(([k, v]) => `  ${k} = {${v}}`)
            .join(",\n");
          updated.raw = `@${updated.type}{${updated.key},\n${lines}\n}`;
          return updated;
        });
        const newRaw = serializeBibFile(next);
        setBibRaw(newRaw);
        void persistBib(newRaw);
        return next;
      });
    },
    [persistBib],
  );

  /** Rewrite the citation SIDECAR refs that reference `oldKey` → `newKey`.
   *  Uses the boundary-class matcher (W0a) so a punctuation citekey rewrites
   *  as a whole token and `foo` doesn't clobber `foobar`. */
  const rewriteCitationRefs = useCallback(
    (oldKey: string, newKey: string) => {
      if (oldKey === newKey) return;
      const re = new RegExp(wholeWordPatternFor(oldKey), "g");
      update((prev) => ({
        ...prev,
        citations: prev.citations.map((c) => {
          if (!c.keys.includes(oldKey)) return c;
          const newKeys = c.keys.map((k) => (k === oldKey ? newKey : k));
          return { ...c, keys: newKeys, command: c.command.replace(re, newKey) };
        }),
      }));
    },
    [update],
  );

  const updateBibKeyAndType = useCallback(
    (oldKey: string, newKey: string, newType: string) => {
      if (isIdentityCascadeOn()) {
        // CASCADE PATH (flag ON): the IdentityCascade is the single writer.
        // Resolve the durable uid so the rename targets the entry by identity
        // (not by the about-to-change key), then fan out atomically.
        const entry = bibEntries.find((e) => e.key === oldKey);
        const uid = entry?.uid;
        // 1. `.bib` key+type mutation (by uid when available, else by old key).
        applyBibKeyType(
          uid ? (e) => e.uid === uid : (e) => e.key === oldKey,
          newKey,
          newType,
        );
        // 2. citation-refs sidecar rewrite (boundary-safe).
        if (oldKey !== newKey) rewriteCitationRefs(oldKey, newKey);
        // 3. fan out to every registered migrator (the editor `\cite{}`
        //    doc-rewrite, future citekey-keyed sidecars). annotations/bib-review
        //    are uid-keyed → their migrator (if registered) is a no-op on a
        //    pure rename. A rename with no migrators is a well-formed no-op.
        if (uid) {
          void identityCascade.runIdentityChange(
            renameCitekeyChange({ uid, oldKey, newKey, newType }),
          );
        }
        return;
      }

      // LEGACY PATH (flag OFF) — byte-identical to pre-cascade behavior,
      // including the original bare-`\b` ref rewrite, so the existing suite is
      // green. Do NOT route this through the boundary matcher: that's the
      // flag-ON behavior change.
      setBibEntries((prev) => {
        const next = prev.map((e) => {
          if (e.key !== oldKey) return e;
          const updated = { ...e, key: newKey, type: newType };
          const lines = Object.entries(updated.fields)
            .map(([k, v]) => `  ${k} = {${v}}`)
            .join(",\n");
          updated.raw = `@${updated.type}{${updated.key},\n${lines}\n}`;
          return updated;
        });
        const newRaw = serializeBibFile(next);
        setBibRaw(newRaw);
        void persistBib(newRaw);
        return next;
      });
      if (oldKey !== newKey) {
        update((prev) => ({
          ...prev,
          citations: prev.citations.map((c) => {
            if (!c.keys.includes(oldKey)) return c;
            const newKeys = c.keys.map((k) => (k === oldKey ? newKey : k));
            const newCommand = c.command.replace(
              new RegExp(`\\b${oldKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
              newKey,
            );
            return { ...c, keys: newKeys, command: newCommand };
          }),
        }));
      }
    },
    [persistBib, update, bibEntries, applyBibKeyType, rewriteCitationRefs, identityCascade],
  );

  const addBibEntry = useCallback(
    (entry: BibEntry) => {
      setBibEntries((prev) => {
        if (prev.some((e) => e.key === entry.key)) return prev;
        // SSOT uid-mint point: any new entry that arrives without a durable uid
        // (e.g. /editor/find-citation, a library drop, a hand-built BibEntry)
        // gets one minted here, avoiding collisions with the entries already in
        // state, so the identity spine (annotations/bib-review keying, the
        // rename cascade) has a stable id to anchor to from the entry's first
        // moment. An entry that already carries a uid (round-tripped from a
        // `\vbid` marker) keeps it. Under the flag this guarantees `entry.uid`
        // is always present; flag-off it is harmless extra metadata.
        const withUid: BibEntry = entry.uid
          ? entry
          : { ...entry, uid: mintBibUid(new Set(prev.map((e) => e.uid).filter(Boolean) as string[])) };
        const next = [...prev, withUid];
        const newRaw = serializeBibFile(next);
        setBibRaw(newRaw);
        void persistBib(newRaw);
        return next;
      });
    },
    [persistBib],
  );

  const getBibEntry = useCallback(
    (key: string): BibEntry | undefined => bibEntries.find((e) => e.key === key),
    [bibEntries],
  );

  const bibEntryMap = useMemo(
    () => new Map(bibEntries.map((e) => [e.key, e])),
    [bibEntries],
  );

  // Depends on the RESOLVED family rather than `stateRef.current.bibPackage`:
  // the stored field is now only the user's explicit choice and is absent on
  // most documents (task 344). A real dependency rather than a ref read — the
  // family changes at most once per doc load plus per user toggle, so this
  // callback's identity is no less stable than `bibEntries` already makes it.
  const getDisplayText = useCallback(
    (command: string): string =>
      formatInlineCitation(command, bibEntries, bibPackage, bibEntryMap),
    [bibEntries, bibEntryMap, bibPackage],
  );

  /** Reconcile a ref's own anchor intent once its `\cite{}` atom is back in the
   *  prose (the drop spec's `onAnchored`, task 233). The SAME rule the
   *  `addCitation` re-anchor branch above applies — clear `unanchored` AND
   *  `archived`, since `setArchived` sets them jointly — but reachable from the
   *  drop path, which builds its atom directly and never calls `addCitation`.
   *  Before this the flag survived until the next mount-only `syncFromEditor`.
   *  Idempotent + no-write when neither flag is set. */
  const markAnchored = useCallback(
    (id: string) => {
      update((prev) => {
        const existing = prev.citations.find((c) => c.id === id);
        if (!existing || !isUnanchored(existing)) return prev;
        return {
          ...prev,
          citations: prev.citations.map((c) =>
            c.id === id ? { ...c, unanchored: undefined, archived: undefined } : c,
          ),
        };
      });
    },
    [update],
  );

  /** The citation card's serialized `\cite{…}` command, read for the drop
   *  spec's "anchor the unanchored" create branch, reached through the shared
   *  inline-atom card accessor (`ctx.atomCards.citation`, task 233).
   *  An unanchored card has no `\cite{}` atom in any editor, so the atom
   *  builder reads the command from here — the SAME `CitationRef.command`
   *  field the code-edit / drag-anchor paths already serialize and round-trip
   *  (no second serializer). Returns null for an empty / keyless DRAFT (no
   *  parseable citekey): anchoring it would plant a `\cite{}` that can never
   *  serialize, so the create branch declines — matching the upstream
   *  disabled drop button. Reads `stateRef` for a stable identity (the live
   *  citations array would re-create this callback on every keystroke-adjacent
   *  edit). */
  const commandFor = useCallback(
    (id: string): string | null => {
      const cit = stateRef.current.citations.find((c) => c.id === id);
      if (!cit) return null;
      // SSOT keyless-citation predicate — same one the upstream disabled drop
      // button (`CitationCard.dropDisabled`) and the downstream spec decline
      // (`citationDropSpec.createAtom`) consume, so all three agree.
      return citationCommandOrNull(cit.command);
    },
    [stateRef],
  );

  const getFormattedBib = useCallback(
    (entry: BibEntry): string => formatBibliography(entry, state.citationStyle),
    [state.citationStyle],
  );

  /** Sync anchored citations from the editor while preserving unanchored
   *  panel-only citations. The editor regenerates citation ids on each
   *  parse, so prev anchored ids never match new editor ids — they must
   *  be dropped. Only entries flagged via `isUnanchored` are carried
   *  forward. */
  const syncFromEditor = useCallback(
    (editorCitations: Array<{ citationId: string; command: string }>) => {
      const refs: CitationRef[] = editorCitations.map((ec) => {
        const parsed = parseCiteCommand(ec.command);
        return {
          id: ec.citationId,
          command: ec.command,
          keys: parsed?.keys || [],
          createdAt: new Date().toISOString(),
        };
      });
      update((prev) => {
        const unanchored = prev.citations.filter(isUnanchored);
        return { ...prev, citations: [...refs, ...unanchored] };
      });
    },
    [update],
  );

  // Memoize the returned hook so EditorLayout (which now reads it via
  // `paneState.citationsHook`) can hand a stable reference into deps
  // without triggering a re-render every render. Without this, every
  // EditorPane render produced a fresh hook object → onPaneStateChange
  // fires → EditorLayout re-renders → EditorPane re-renders inside it
  // → fresh hook again → infinite "Maximum update depth" loop. Same
  // pattern as the COLLAB hook precedent in useCollab.ts.
  return useMemo(
    () => ({
      citations: state.citations,
      bibPath: state.bibPath,
      citationStyle: state.citationStyle,
      bibPackage,
      bibEntries,
      bibRaw,
      addCitation,
      updateCitation,
      deleteCitation,
      setArchived,
      cloneCitation,
      setStyle,
      setBibPackage,
      addBibEntry,
      updateBibEntry,
      replaceBibEntry,
      updateBibKeyAndType,
      getBibEntry,
      getDisplayText,
      getFormattedBib,
      commandFor,
      markAnchored,
      syncFromEditor,
      identityCascade,
    }),
    [
      state.citations,
      state.bibPath,
      state.citationStyle,
      bibPackage,
      bibEntries,
      bibRaw,
      addCitation,
      updateCitation,
      deleteCitation,
      setArchived,
      cloneCitation,
      setStyle,
      setBibPackage,
      addBibEntry,
      updateBibEntry,
      replaceBibEntry,
      updateBibKeyAndType,
      getBibEntry,
      getDisplayText,
      getFormattedBib,
      commandFor,
      markAnchored,
      syncFromEditor,
      identityCascade,
    ],
  );
}
