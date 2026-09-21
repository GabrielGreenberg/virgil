"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { generateShortId } from "@/lib/uuid";
import { readBib } from "@/lib/storage";
import {
  DOC_BIB_CHANGED_EVENT,
  mutateProjectBib,
  type BibMutator,
  type BibWriteResult,
  type DocBibChangedDetail,
} from "@/lib/project-bib";
import { isUnanchored } from "@/links/links";
import type { CitationsState, CitationRef, BibEntry } from "@/lib/types";
import {
  parseBibFile,
  parseCiteCommand,
  citationCommandOrNull,
  formatInlineCitation,
  formatBibliography,
} from "@/lib/bib-parser";
import { usePersistentState } from "./usePersistentState";
import type { PristineKindApi } from "./usePristineCardManager";
import {
  IdentityCascade,
  renameCitekeyChange,
} from "@/lib/identity/identity-cascade";
import { wholeWordPatternFor } from "@/lib/whole-word";
import { mintBibUid } from "@/lib/bib-uid";
import { spliceBibBlock } from "@/lib/bib-source";
import {
  bibAddressOf,
  mapAddressedBibEntry,
  resolveBibEntry,
} from "@/lib/bib-address";
import { validateBibEntryHeadChange } from "@/lib/bib-entry-head";
import { asBibFamily, DEFAULT_BIB_FAMILY, type BibFamily } from "@/lib/bib-family";

/**
 * What ONE Save on a bibliography entry changes (task 691) — the whole of a
 * user gesture in one object, so it can be ONE write.
 *
 * Each part is optional and `undefined` means "not part of this save", never
 * "clear it": a save that does not mention the citekey leaves it alone, and
 * one that passes an EMPTY citekey is refused. `fields`, when present, is the
 * COMPLETE intended field set (set-all), because the bib editor's map IS that
 * set and a field the user cleared must be deleted.
 */
export interface BibEntrySave {
  /** The complete new field set. Omitted ⇒ the entry's fields are untouched. */
  fields?: Record<string, string>;
  /** The new `@type`. Omitted ⇒ unchanged. */
  type?: string;
  /** The new citekey. Omitted, or equal to the current one ⇒ no rename, and
   *  no rename fan-out. */
  key?: string;
}

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
  saveBibEntry: () => {},
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

/**
 * An entry's next BibTeX block — the byte shape every in-place edit below
 * writes. Pure, so a mutation that calls it produces the same block on the
 * view run and on the disk run.
 *
 * Since task 688 this is a **splice, not a rebuild**: it takes the entry's
 * ORIGINAL block and changes only what actually differs between `prev` and
 * `next`. `BibEntry.fields` is a 16-name CSL projection of a BibTeX block, so
 * re-emitting the block FROM it deleted every field the projection does not
 * model — `isbn`, `keywords`, `abstract`, `annote`, `month`, `school`, any
 * custom field — from the user's only copy, on a one-character edit to the
 * title. Splicing cannot: a field nobody named is never addressed.
 *
 * Only fields whose VALUE actually changed are set, which is what keeps a
 * source-side `@string` macro reference (`journal = jphil`) from being
 * overwritten with the projection's expansion of it. Fields that were in
 * `prev.fields` and are gone from `next.fields` are DELETED — that is
 * `replaceBibEntry`'s set-all semantics, now scoped to the fields the editor
 * could actually see rather than to everything the projection omitted.
 *
 * Falls back to the from-scratch emit when there is no block to splice (an
 * entry assembled in memory) or when the block cannot be spliced safely.
 */
function rebuildRaw(prev: BibEntry, next: BibEntry): string {
  // bib-display-exempt: non-display — a DIFF between two field maps on the way
  // to the `.bib`, the WRITE direction. Nothing here reaches a pixel, and
  // projecting a value would write the projection into the user's own file.
  const set: Record<string, string> = {};
  for (const [k, v] of Object.entries(next.fields)) {
    if (prev.fields[k] !== v) set[k] = v;
  }
  const remove = Object.keys(prev.fields).filter((k) => !(k in next.fields));
  if (prev.raw) {
    const spliced = spliceBibBlock(prev.raw, {
      key: next.key,
      type: next.type,
      set,
      remove,
    });
    if (spliced !== null) return spliced;
  }
  return emitBibBlock(next);
}

/** The from-scratch block, for an entry that has no source block to splice. */
function emitBibBlock(e: BibEntry): string {
  const lines = Object.entries(e.fields)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  return `@${e.type}{${e.key},\n${lines}\n}`;
}

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
    updateWhenLoaded,
    stateRef,
  } = usePersistentState<CitationsState>(docId, "citations.json", EMPTY, {
    migrate,
    errorLabel: "citations",
  });

  // .bib side — lives outside the factory since it's a different sidecar
  // with its own parse/serialize pipeline. `bibEntries` is a VIEW of the
  // file: every mutation below is applied to it optimistically and then run
  // AGAIN by the authority against the file as it is on disk, whose published
  // result the listener adopts (task 558). `bibRaw` is set from that publish
  // only — the authoritative text — never from a snapshot serialized here.
  const [bibEntries, setBibEntries] = useState<BibEntry[]>([]);
  const [bibRaw, setBibRaw] = useState("");
  const bibEntriesRef = useRef(bibEntries);
  useEffect(() => {
    bibEntriesRef.current = bibEntries;
  }, [bibEntries]);
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

  // Every write of references.bib goes through the ONE authority
  // (`mutateProjectBib`, task 558), which publishes the authoritative
  // post-write list on DOC_BIB_CHANGED_EVENT — this hook's own mutations
  // included, so the optimistic state below converges on what actually
  // landed (a merge over the file as it was on disk, which may hold entries a
  // Library drop, a peer window or an `/editor/*` skill added since this hook
  // last read it). A detail with no payload is a re-hydrate request: re-read.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Partial<DocBibChangedDetail>>).detail;
      const id = docRef.current;
      if (!id) return;
      if (detail?.docId && detail.docId !== id) return;
      if (detail?.bibText !== undefined && detail.entries) {
        setBibRaw(detail.bibText);
        setBibEntries(detail.entries);
        return;
      }
      refreshBib(id);
    };
    window.addEventListener(DOC_BIB_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DOC_BIB_CHANGED_EVENT, handler);
  }, [refreshBib]);

  /**
   * Apply a PURE bib mutation twice: once to the in-memory view (so the UI
   * never waits on a disk round-trip) and once, through the authority, to the
   * file as it is on disk inside the serialized write section. The second run
   * is the one that lands and is published back; the first is a preview of it.
   * No whole-file snapshot leaves this hook — `serializeBibFile` is not
   * imported here, and that is the census's leg (task 558).
   */
  const runBibMutation = useCallback(
    (mutate: BibMutator): Promise<BibWriteResult> => {
      // The optimistic preview. A mutator that says "nothing to change"
      // (`null`) or "the address names no entry here" (`BIB_NO_MATCH`, task
      // 691) leaves the view alone — only a LIST is a new view.
      setBibEntries((prev) => {
        const next = mutate(prev);
        return Array.isArray(next) ? next : prev;
      });
      return mutateProjectBib(docId, mutate).then((result) => {
        // A write that THREW left the file exactly as it was, while the
        // preview above still shows the edit — and nothing else would ever
        // correct it, because only a LANDED write publishes. That phantom is
        // the whole of task 685: the card reads saved, `references.bib` does
        // not hold the entry, and every later read in this session agrees with
        // the screen. The authority has already told the user (the refusal
        // channel); this re-reads the file so the view stops standing as
        // truth. Only on `failed` — the other refusal kinds mean no write was
        // attempted for this pane's doc at all (see `refusedWrite`), and a
        // `declined` one means the disk is already what it should be.
        // `not-found` joins it (task 691): the mutator addressed an entry the
        // FILE does not hold, so the preview above is showing an edit that
        // landed nowhere — the same phantom, reached by a different road.
        if (
          (result.kind === "failed" || result.kind === "not-found") &&
          docRef.current === docId &&
          docId
        ) {
          refreshBib(docId);
        }
        return result;
      });
    },
    [docId, refreshBib],
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
    (entry: BibEntry, fields: Record<string, string>) => {
      const address = bibAddressOf(bibEntriesRef.current, entry);
      runBibMutation((prev) =>
        mapAddressedBibEntry(prev, address, (e) => {
          const updated = { ...e, fields: { ...e.fields, ...fields } };
          updated.raw = rebuildRaw(e, updated);
          return updated;
        }),
      );
    },
    [runBibMutation],
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

  /**
   * THE bib-entry write door — ONE mutator per user GESTURE (task 691).
   *
   * A Save in the bib editor is one intent: these fields, this `@type`, this
   * citekey. It used to be TWO writes, fired back-to-back with nothing awaited
   * between them — `replaceBibEntry` for the fields, then
   * `updateBibKeyAndType` for the head — and both went to the `.bib`'s one
   * serialized door. A queue only orders what has reached it, and neither call
   * could reach it in its caller's tick (the queue key carried the `.bib`
   * FILENAME, which cost three-plus IO round trips to learn; task 691's other
   * half retires that). So the two writes raced. When the RENAME won, the
   * field mutator ran second against a list in which its target no longer had
   * the key it had addressed, matched nothing, and was DECLINED — a silent
   * outcome that triggers no re-read, so the card went on showing field edits
   * that `references.bib` never received.
   *
   * Even in the intended order they were two writes with two publishes: a
   * throw on the second left the disk holding the new fields under the OLD
   * key, and the failure path then re-read the file, so the UI settled on the
   * half-saved state as the truth. Task 685 made a failed write honest; it
   * could not make a two-part edit atomic. One mutator can, and does: one
   * queued read-modify-write covers the whole edit, so the ordering question
   * does not arise and there is no state between the halves to be caught in.
   *
   * The head is validated ONCE (task 690's door, now measuring what the write
   * CHANGES — see `validateBibEntryHeadChange`), and the rename's FAN-OUT runs
   * after that single write SETTLES, and only if the `.bib` half was not
   * refused: rewriting every `\cite{oldKey}` in the paper for a rename that
   * did not reach disk is precisely the dangling reference task 689 exists to
   * prevent, arrived at from the other side.
   */
  const saveBibEntry = useCallback(
    (target: BibEntry, patch: BibEntrySave) => {
      // The entry as this hook currently holds it. A card can hand back a
      // stale copy; the address resolves against the live list either way.
      const address = bibAddressOf(bibEntriesRef.current, target);
      // The VIEW's copy of the addressed entry when it has one, else the
      // caller's own. There used to be a bare `return` when the view held no
      // such entry, and that was a silent swallow (task 692): the user pressed
      // Save and the app answered nothing at all — the very outcome task 691
      // removed from the disk side of the same road. The view does not get a
      // verdict of its own, because it is only ever a PREVIEW of the file: the
      // mutation runs, the disk run answers `BIB_NO_MATCH`, and the ONE door
      // reports `not-found`, voices it on the refusal channel and reconciles
      // the view — including the case where the view is merely STALE and the
      // file does hold the entry, which the bail used to drop on the floor.
      // The rename fan-out is gated on that result below, so a miss still
      // rewrites no `\cite{}`.
      const resolved = resolveBibEntry(bibEntriesRef.current, address);
      const entry = resolved ?? target;
      // `undefined` means "this part of the head is not part of this save" —
      // NOT "clear it". An EMPTY string is a value, and a refused one.
      const newKey = patch.key !== undefined ? patch.key.trim() : entry.key;
      const newType = patch.type !== undefined ? patch.type.trim() : entry.type;
      // THE validation door (task 690), read here as well as at the card, so
      // no caller can route around the UI and write a block the parser cannot
      // read back — an empty `@type` emitted `@{key,…}`, and the next write
      // then deleted the entry from the user's only copy.
      const check = validateBibEntryHeadChange(
        { key: entry.key, type: entry.type },
        { key: newKey, type: newType },
        { entries: bibEntriesRef.current, self: address },
      );
      if (!check.ok) {
        console.warn(`Refusing bib save: ${check.reason}`);
        return;
      }
      const oldKey = entry.key;
      const uid = entry.uid;
      // ONE mutation: fields, type and key together, applied to EXACTLY the
      // entry `address` names (NOT key-matched — two blocks can share a
      // citekey, and `prev.map` rewrote both; task 690).
      void runBibMutation((prev) =>
        mapAddressedBibEntry(prev, address, (e) => {
          const updated: BibEntry = {
            ...e,
            key: newKey,
            type: newType,
            // Set-all when fields are part of the save: the supplied map is
            // the COMPLETE intended field set, so a field the user cleared is
            // DELETED, not silently retained (BIB-A3-02 / BIB-F5-04). Omitted
            // ⇒ the entry's fields are not this save's business.
            ...(patch.fields ? { fields: { ...patch.fields } } : {}),
          };
          updated.raw = rebuildRaw(e, updated);
          return updated;
        }),
      ).then((result) => {
        if (oldKey === newKey) return; // a pure retype/field save moves no identity
        // A rename only follows an entry this bibliography HAS. Where the
        // address named none, the write answered `not-found` and said so —
        // but a door that could not attempt the write at all (no handle, a
        // library paper's read-only `.bib`) answers something else, and
        // fanning out then would rewrite every `\cite{oldKey}` in the paper
        // for a rename that exists nowhere. So the fan-out asks its own
        // precondition rather than reading it off the write's verdict.
        if (!resolved) return;
        // The two outcomes that mean the user's content did NOT reach disk and
        // never will (both voiced on the refusal channel). Fanning out over
        // them would leave the paper citing a key `references.bib` does not
        // hold. The others mean no write was attempted for this pane's doc at
        // all, so nothing was persisted on either side of the rename.
        if (result.kind === "failed" || result.kind === "not-found") return;
        // citation-refs sidecar rewrite (boundary-safe, whole-token).
        rewriteCitationRefs(oldKey, newKey);
        // …then every registered migrator: the editor `\cite{}` doc-rewrite
        // (without which the line above is undone by the next
        // `syncFromEditor`), the float-key + panel-selection re-point, and the
        // annotation / bib-review re-key. A rename with no migrators
        // registered is a well-formed no-op.
        void identityCascade.runIdentityChange(
          renameCitekeyChange({ uid, oldKey, newKey, newType }),
        );
      });
    },
    [runBibMutation, rewriteCitationRefs, identityCascade],
  );

  /**
   * REPLACE an entry's fields (and optionally its type) WHOLESALE (D3 — the
   * set-all half; consumed by "Replace with library"). Unlike
   * {@link updateBibEntry}, the supplied `fields` is the COMPLETE new field
   * set: a field the user cleared (absent from `fields`) is DELETED, not
   * retained (BIB-A3-02 / BIB-F5-04 — "I cleared the field but it came back").
   * The entry's durable `uid` and citekey are untouched.
   *
   * A named intent over the ONE door (task 691), not a second write path —
   * which is what keeps a caller that wants BOTH halves from firing two.
   *
   * NO CASCADE FAN-OUT, deliberately (task 647). D3 dispatched a `retype`
   * identity change whenever `type` really changed, for "single-writer
   * discipline". Both registered `bibEntry` migrators narrow to a rename, so
   * that dispatch never reached a line of code — and the cascade is defined as
   * the writer for identity CHANGES, which a retype (same uid, same citekey)
   * is not.
   */
  const replaceBibEntry = useCallback(
    (entry: BibEntry, fields: Record<string, string>, type?: string) => {
      saveBibEntry(entry, { fields, ...(type !== undefined ? { type } : {}) });
    },
    [saveBibEntry],
  );

  /**
   * THE citekey rename intent — ONE path, no flag (task 689), over the ONE
   * door (task 691).
   *
   * It used to be two paths. The flag-ON branch was the real thing: rewrite
   * the `.bib` key, boundary-rewrite the citation refs, and fan out through
   * the IdentityCascade to every registered migrator (the editor `\cite{}`
   * doc-rewrite, the float-key remap, the panel selection). The flag-OFF
   * branch — which is what every shipping build ran, since
   * `virgil:identity-cascade` is `default: false` — rewrote `references.bib`
   * and patched `citations.json`, and stopped. So a rename left every
   * `\cite{oldKey}` in the paper pointing at a key that no longer existed (a
   * dangling reference that will not compile), the sidecar half was REVERTED
   * the moment `syncFromEditor` re-derived it from those unrewritten atoms,
   * and the entry's annotation stayed under the old key and vanished from the
   * UI. `bib-cite-rewrite.ts`'s own header states this bug as its reason for
   * existing; it was simply not reachable.
   *
   * Nothing the fan-out does has an on-disk FORMAT implication, so nothing in
   * it belonged behind a format-rollout flag. The flag keeps gating exactly
   * what it is about — the uid-keyed v2 sidecar shapes and their on-load
   * migration — and the sidecar migrators (task 689) are written to be correct
   * on BOTH shapes, so flag ON and flag OFF now produce the same rename.
   */
  const updateBibKeyAndType = useCallback(
    (target: BibEntry, newKey: string, newType: string) => {
      saveBibEntry(target, { key: newKey, type: newType });
    },
    [saveBibEntry],
  );

  const addBibEntry = useCallback(
    (entry: BibEntry) => {
      // SSOT uid-mint point: any new entry that arrives without a durable uid
      // (e.g. /editor/find-citation, a library drop, a hand-built BibEntry)
      // gets one minted here, so the identity spine (annotations/bib-review
      // keying, the rename cascade) has a stable id to anchor to from the
      // entry's first moment. An entry that already carries a uid
      // (round-tripped from a `\vbid` marker) keeps it. Minted ONCE, outside
      // the mutator, against the uids this hook knows: the mutator runs twice
      // (the view, then the disk) and must produce the SAME entry both times
      // — a uid minted inside it would differ per run. Only a collision with a
      // uid that is on disk but not yet in this view re-mints, inside, against
      // the disk set, and the publish then converges the view on that answer.
      const knownUids = new Set(
        bibEntriesRef.current.map((e) => e.uid).filter(Boolean) as string[],
      );
      const uid = entry.uid || mintBibUid(knownUids);
      runBibMutation((prev) => {
        if (prev.some((e) => e.key === entry.key)) return null;
        const used = new Set(prev.map((e) => e.uid).filter(Boolean) as string[]);
        // `source` names a span in the file the entry was PARSED from; this
        // entry is arriving from elsewhere (a library drop, find-citation) and
        // is about to be appended to a different file, so the anchor is
        // meaningless here and must not be carried (task 688).
        const { source: _foreign, ...rest } = entry;
        void _foreign;
        const withUid: BibEntry = {
          ...rest,
          uid: used.has(uid) && !entry.uid ? mintBibUid(used) : uid,
        };
        return [...prev, withUid];
      });
    },
    [runBibMutation],
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
   *  forward.
   *
   *  A LOAD-TIME RECONCILE, so it enters `updateWhenLoaded` and never bare
   *  `update` (task 570): its inputs are the editor's atoms, and `prev` must
   *  be the sidecar AS LOADED. Run through `update` from an effect keyed on
   *  the editor alone, a sync that landed before the ~20-file sidecar batch
   *  resolved stamped `hasMutatedRef`, the loader bailed, and the merge ran
   *  over EMPTY — every unanchored/archived card and the stored `bibPackage`
   *  / `citationStyle` / `bibPath` gone, then written over the file 300 ms
   *  later. The door HOLDS the sync until the read resolves (latest call
   *  wins — the W2c resync policy may fire in the same window) and applies
   *  it once, over the loaded state. */
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
      updateWhenLoaded((prev) => {
        const unanchored = prev.citations.filter(isUnanchored);
        return { ...prev, citations: [...refs, ...unanchored] };
      });
    },
    [updateWhenLoaded],
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
      saveBibEntry,
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
      saveBibEntry,
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
