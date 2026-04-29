/**
 * Print orchestration. Sets per-toggle `data-print-*` attributes on the
 * <html> element and a `--print-font-size` CSS variable, then calls
 * window.print(). The matching CSS lives in `src/app/globals.css` under
 * `@media print`. Cleanup runs from afterprint OR a matchMedia change
 * handler — Safari and some Chromium builds skip the former.
 */

export type PrintElementKey =
  | "title"
  | "sectionNumbers"
  | "latexComments"
  | "footnoteMarkers"
  | "citations"
  | "examples"
  | "displayMath"
  | "marginalia"
  | "linkedAnchorUnderlines";

export type PrintPanelKey =
  | "notes"
  | "footnotes"
  | "citations"
  | "bibliography"
  | "quotations"
  | "examples"
  | "todo"
  | "archive"
  | "revisions"
  | "cutter"
  | "errors";

export interface PrintOptions {
  elements: Record<PrintElementKey, boolean>;
  panels: Record<PrintPanelKey, boolean>;
  fontSizeRem: number;
}

export const PRINT_FONT_SIZES = [0.85, 0.95, 1.05, 1.15, 1.25] as const;
export const PRINT_FONT_LABELS = ["S", "M", "L", "XL", "XXL"] as const;

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  elements: {
    title: true,
    sectionNumbers: true,
    latexComments: false,
    footnoteMarkers: true,
    citations: true,
    examples: true,
    displayMath: true,
    marginalia: false,
    linkedAnchorUnderlines: false,
  },
  panels: {
    notes: false,
    footnotes: true,
    citations: false,
    bibliography: true,
    quotations: false,
    examples: false,
    todo: false,
    archive: false,
    revisions: false,
    cutter: false,
    errors: false,
  },
  fontSizeRem: 1.05,
};

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function applyPrintAttrs(options: PrintOptions): () => void {
  const html = document.documentElement;
  html.dataset.printing = "true";
  for (const [k, v] of Object.entries(options.elements)) {
    html.setAttribute(`data-print-e-${kebab(k)}`, v ? "true" : "false");
  }
  for (const [k, v] of Object.entries(options.panels)) {
    html.setAttribute(`data-print-p-${kebab(k)}`, v ? "true" : "false");
  }
  html.style.setProperty("--print-font-size", `${options.fontSizeRem}rem`);

  // Walk from the editor page up to <body>, tagging each ancestor as
  // a layout-release target and each non-chain sibling as hidden. The
  // matching @media print rules live in globals.css.
  const ancestors: HTMLElement[] = [];
  const hidden: HTMLElement[] = [];
  const editorPage = document.querySelector<HTMLElement>('[data-editor-page]');
  if (editorPage) {
    let el: HTMLElement = editorPage;
    while (el.parentElement && el !== document.body) {
      const parent = el.parentElement;
      parent.dataset.printAncestor = "true";
      ancestors.push(parent);
      for (const child of Array.from(parent.children)) {
        if (child !== el && child instanceof HTMLElement) {
          child.dataset.printHide = "true";
          hidden.push(child);
        }
      }
      el = parent;
    }
  }

  return () => {
    delete html.dataset.printing;
    for (const k of Object.keys(options.elements)) {
      html.removeAttribute(`data-print-e-${kebab(k)}`);
    }
    for (const k of Object.keys(options.panels)) {
      html.removeAttribute(`data-print-p-${kebab(k)}`);
    }
    html.style.removeProperty("--print-font-size");
    for (const a of ancestors) delete a.dataset.printAncestor;
    for (const h of hidden) delete h.dataset.printHide;
  };
}

export async function runPrint(options: PrintOptions): Promise<void> {
  const cleanup = applyPrintAttrs(options);

  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch {}
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cleanup();
    window.removeEventListener("afterprint", finish);
    mql.removeEventListener("change", onMqlChange);
  };
  const mql = window.matchMedia("print");
  const onMqlChange = (e: MediaQueryListEvent) => {
    if (!e.matches) finish();
  };
  window.addEventListener("afterprint", finish);
  mql.addEventListener("change", onMqlChange);

  window.print();
}
