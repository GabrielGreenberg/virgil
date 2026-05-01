"use client";

/**
 * Bridge from Virgil's editor state into the Library tab.
 *
 * The Project Library is a built-in tab that mirrors the currently-open
 * document's `.bib` file (with an option to restrict to keys actually
 * cited in the body text). Library code reads this context to filter
 * entries when the project tab is active.
 *
 * The provider is mounted in `src/components/library/LibraryTabView.tsx`
 * (the Virgil-side shim), where `useFiles()` and `useCitations()` are
 * available; the Library subsystem itself only consumes the context.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Compact subset of a BibEntry — just the fields the project tab needs
 *  to synthesize a CatalogEntry-shaped row when an entry exists in the
 *  doc's bib but not yet in the indexed library catalog. */
export interface ProjectBibMeta {
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
}

export interface ProjectLibraryValue {
  /** True if a Virgil document is currently open. */
  hasDoc: boolean;
  /** Optional human-readable doc label, used in empty-state copy. */
  docLabel?: string;
  /** All citekeys present in the doc's `.bib` file. */
  bibKeys: ReadonlySet<string>;
  /** Subset of `bibKeys` actually `\cite`-d in the doc's body. */
  citedKeys: ReadonlySet<string>;
  /** Per-key bib metadata for synthesizing bib-only rows. */
  bibMeta: ReadonlyMap<string, ProjectBibMeta>;
  /** Toggle: restrict the project tab to citedKeys only. */
  citedOnly: boolean;
  setCitedOnly: (value: boolean) => void;
}

const EMPTY_PROJECT: ProjectLibraryValue = {
  hasDoc: false,
  bibKeys: new Set(),
  citedKeys: new Set(),
  bibMeta: new Map(),
  citedOnly: false,
  setCitedOnly: () => {},
};

const ProjectLibraryContext = createContext<ProjectLibraryValue>(EMPTY_PROJECT);

const CITED_ONLY_KEY = "virgil-library-project-cited-only";

interface ProviderProps {
  hasDoc: boolean;
  docLabel?: string;
  bibKeys: Iterable<string>;
  citedKeys: Iterable<string>;
  /** Map of citekey → metadata pulled from the doc's bib entries. Lets
   *  the project tab synthesize bib-only rows for entries the library
   *  hasn't indexed yet. */
  bibMeta?: ReadonlyMap<string, ProjectBibMeta>;
  children: ReactNode;
}

export function ProjectLibraryProvider({
  hasDoc,
  docLabel,
  bibKeys,
  citedKeys,
  bibMeta,
  children,
}: ProviderProps) {
  const [citedOnly, setCitedOnlyState] = useState<boolean>(false);

  // Hydrate the toggle from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CITED_ONLY_KEY);
      if (raw === "1") setCitedOnlyState(true);
    } catch {
      // ignore (private mode)
    }
  }, []);

  const setCitedOnly = useMemo(
    () => (next: boolean) => {
      setCitedOnlyState(next);
      try {
        localStorage.setItem(CITED_ONLY_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
    },
    [],
  );

  // Memoize the Sets so identity is stable across renders that don't
  // change membership — keeps downstream `useMemo`s from invalidating
  // on every editor keystroke.
  const bibSet = useMemo(() => new Set(bibKeys), [stableJoin(bibKeys)]);
  const citedSet = useMemo(
    () => new Set(citedKeys),
    [stableJoin(citedKeys)],
  );

  const metaMap = useMemo(
    () => bibMeta ?? new Map<string, ProjectBibMeta>(),
    [bibMeta],
  );

  const value = useMemo<ProjectLibraryValue>(
    () => ({
      hasDoc,
      docLabel,
      bibKeys: bibSet,
      citedKeys: citedSet,
      bibMeta: metaMap,
      citedOnly,
      setCitedOnly,
    }),
    [hasDoc, docLabel, bibSet, citedSet, metaMap, citedOnly, setCitedOnly],
  );

  return (
    <ProjectLibraryContext.Provider value={value}>
      {children}
    </ProjectLibraryContext.Provider>
  );
}

export function useProjectLibrary(): ProjectLibraryValue {
  return useContext(ProjectLibraryContext);
}

/** Stable string key for an iterable-of-strings, used as a useMemo dep so
 *  Sets only get rebuilt when membership actually changes. Sorted to
 *  ignore order. */
function stableJoin(keys: Iterable<string>): string {
  return Array.from(keys).sort().join("\0");
}
