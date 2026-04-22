/**
 * Built-in document templates used by the "Create new document" flow.
 *
 * A template is the minimal set of files a fresh document starts with —
 * the main .tex, any sibling files the .tex depends on (e.g. a .bib), and
 * the `virgil/` subdirectory (created separately by the storage layer).
 *
 * Templates live in source — to add, rename, or retire one, edit this
 * file. There is no runtime template editor yet, by design: we want the
 * starter set to stay curated.
 *
 * The first entry is the default selection in the picker.
 */

export interface DocumentTemplate {
  /** Stable id used in URLs, logs, and as the picker default. */
  id: string;
  /** Display name in the picker. */
  name: string;
  /** Short one-liner shown under the name. */
  description: string;
  /**
   * The main .tex filename written to disk (e.g. "document.tex" or
   * "main.tex"). Stored on FsaDocMeta so later reads know which file
   * is the entry point.
   */
  mainTexFilename: string;
  /**
   * All files to create in the paper folder, keyed by filename. Values
   * are UTF-8 text. The main .tex must have a key matching
   * `mainTexFilename`.
   */
  files: Record<string, string>;
}

const BLANK_TEX = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\begin{document}

Start writing here...

\\end{document}
`;

const ARTICLE_TEX = `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Untitled}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}

Start writing here...

\\end{document}
`;

const ARTICLE_BIB_TEX = `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{natbib}

\\title{Untitled}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}

Start writing here. Cite a source like this: \\citep{example2024}.

\\bibliographystyle{plainnat}
\\bibliography{references}

\\end{document}
`;

const ARTICLE_BIB_REFERENCES = `@article{example2024,
  author  = {Last, First},
  title   = {An example reference},
  journal = {Journal of Examples},
  year    = {2024},
  volume  = {1},
  number  = {1},
  pages   = {1--10},
}
`;

const REPORT_TEX = `\\documentclass[11pt]{report}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Untitled Report}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle
\\tableofcontents

\\chapter{Introduction}

Start writing here...

\\end{document}
`;

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    description: "Minimal article — just the essentials.",
    mainTexFilename: "document.tex",
    files: { "document.tex": BLANK_TEX },
  },
  {
    id: "article",
    name: "Article",
    description: "Article with title, margins, and hyperref.",
    mainTexFilename: "main.tex",
    files: { "main.tex": ARTICLE_TEX },
  },
  {
    id: "article-bib",
    name: "Article with bibliography",
    description: "Article set up for natbib citations + a references.bib.",
    mainTexFilename: "main.tex",
    files: {
      "main.tex": ARTICLE_BIB_TEX,
      "references.bib": ARTICLE_BIB_REFERENCES,
    },
  },
  {
    id: "report",
    name: "Report",
    description: "Chapters, table of contents, report class.",
    mainTexFilename: "main.tex",
    files: { "main.tex": REPORT_TEX },
  },
];

export function getTemplate(id: string): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((t) => t.id === id);
}

/** The default template used when the caller doesn't specify one. */
export const DEFAULT_TEMPLATE_ID = "blank";
