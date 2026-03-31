import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { readTextFile, writeTextFile, getTexPath, getSiblingPath } from "@/lib/storage";

function getDocId(request: Request): string | null {
  return new URL(request.url).searchParams.get("docId");
}

/**
 * Resolve the .bib filename for a document.
 * 1. Check for \bibliography{name} or \addbibresource{name} in the .tex
 * 2. If not found, scan the directory for any .bib file
 * 3. Fall back to "references.bib"
 */
async function resolveBibFilename(docId: string): Promise<string> {
  try {
    const texPath = await getTexPath(docId);
    const texDir = path.dirname(texPath);
    const tex = await readTextFile(texPath, "");

    // Try explicit declaration first
    const m = tex.match(/\\(?:bibliography|addbibresource)\{([^}]+)\}/);
    if (m) {
      let name = m[1].trim();
      if (!name.endsWith(".bib")) name += ".bib";
      return name;
    }

    // No explicit declaration — scan directory for .bib files
    try {
      const files = await fs.readdir(texDir);
      const bibFiles = files.filter((f) => f.endsWith(".bib"));
      if (bibFiles.length === 1) {
        return bibFiles[0];
      }
      if (bibFiles.length > 1) {
        // Prefer one matching the tex filename (e.g. main.tex → main.bib)
        const texBase = path.basename(texPath, ".tex");
        const match = bibFiles.find((f) => f === texBase + ".bib");
        if (match) return match;
        // Otherwise return the first one
        return bibFiles[0];
      }
    } catch {
      // directory read failed
    }
  } catch {
    // fall through
  }
  return "references.bib";
}

/** Detect bib package from tex preamble and command usage */
async function detectBibPackage(docId: string): Promise<string> {
  try {
    const texPath = await getTexPath(docId);
    const tex = await readTextFile(texPath, "");
    // Explicit package declaration
    if (/\\usepackage(\[.*?\])?\{biblatex\}/.test(tex)) return "biblatex";
    if (/\\usepackage(\[.*?\])?\{natbib\}/.test(tex)) return "natbib";
    // Infer from command usage: biblatex-specific commands
    if (/\\(textcite|parencite|autocite|footcite|textcites|parencites|cites)\b/.test(tex)) return "biblatex";
    // Infer from natbib-specific commands
    if (/\\(citet|citep|citealt|citealp|citeyearpar)\b/.test(tex)) return "natbib";
  } catch { /* fall through */ }
  return "natbib";
}

export async function GET(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const bibFilename = await resolveBibFilename(docId);
    const bibPath = await getSiblingPath(docId, bibFilename);
    const bibText = await readTextFile(bibPath, "");
    const detectedPackage = await detectBibPackage(docId);
    return NextResponse.json({ bibText, detectedPackage });
  } catch (error) {
    console.error("Error loading bib:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const { bibText } = await request.json();
    const bibFilename = await resolveBibFilename(docId);
    const bibPath = await getSiblingPath(docId, bibFilename);
    await writeTextFile(bibPath, bibText);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving bib:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
