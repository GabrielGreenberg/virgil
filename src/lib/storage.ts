import { promises as fs } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import type { DocMeta, FileIndex } from "./types";

const DATA_DIR = path.join(process.cwd(), "virgil-data");

export function getDataPath(filename: string): string {
  return path.join(DATA_DIR, filename);
}

// ---------------------------------------------------------------------------
// Path resolution — new model
//
// The .tex file stays wherever it lives on disk.
// Virgil metadata goes in a `virgil/` folder next to the .tex file.
// Sibling files (like .bib) live next to the .tex file.
// ---------------------------------------------------------------------------

/** Resolve the path for a doc's .tex file */
export async function getTexPath(docId: string): Promise<string> {
  const doc = await getDocMeta(docId);
  return doc.sourcePath;
}

/** Resolve the path for a Virgil metadata file (editor-state, citations, etc.) */
export async function getMetaPath(docId: string, filename: string): Promise<string> {
  const doc = await getDocMeta(docId);
  return path.join(path.dirname(doc.sourcePath), "virgil", filename);
}

/** Resolve the path for a sibling file next to the .tex (e.g. references.bib) */
export async function getSiblingPath(docId: string, filename: string): Promise<string> {
  const doc = await getDocMeta(docId);
  return path.join(path.dirname(doc.sourcePath), filename);
}

/** Look up a DocMeta by id */
async function getDocMeta(docId: string): Promise<DocMeta> {
  const index = await readIndex();
  const doc = index.docs.find((d) => d.id === docId);
  if (!doc) throw new Error(`Document ${docId} not found in index`);
  return doc;
}

/** Ensure the virgil/ metadata folder exists for a document */
async function ensureVirgilDir(docId: string): Promise<void> {
  const metaDir = path.dirname(await getMetaPath(docId, "_"));
  await fs.mkdir(metaDir, { recursive: true });
}

// Keep legacy getDocPath for the migration helper only
function legacyDocDir(docId: string): string {
  return path.join(DATA_DIR, `doc_${docId}`);
}

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// --- Generic file helpers ---

export async function readJsonFile<T>(
  filepath: string,
  defaultValue: T
): Promise<T> {
  try {
    const raw = await fs.readFile(filepath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export async function writeJsonFile<T>(
  filepath: string,
  data: T
): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), "utf-8");
}

export async function readTextFile(
  filepath: string,
  defaultValue: string
): Promise<string> {
  try {
    return await fs.readFile(filepath, "utf-8");
  } catch {
    return defaultValue;
  }
}

export async function writeTextFile(
  filepath: string,
  content: string
): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, content, "utf-8");
}

// --- File index management ---

const INDEX_PATH = path.join(DATA_DIR, "index.json");
const DEFAULT_INDEX: FileIndex = { docs: [] };

export async function readIndex(): Promise<FileIndex> {
  return readJsonFile<FileIndex>(INDEX_PATH, DEFAULT_INDEX);
}

export async function writeIndex(index: FileIndex): Promise<void> {
  await ensureDataDir();
  await writeJsonFile(INDEX_PATH, index);
}

// --- Document CRUD ---

/**
 * Create a new document. If sourcePath is provided, it points to an existing
 * .tex file on disk. Otherwise a new .tex file is created under virgil-data/.
 */
export async function createDoc(name: string, sourcePath?: string): Promise<DocMeta> {
  const id = uuid().slice(0, 8);
  const now = new Date().toISOString();

  // Default: create a new .tex file inside virgil-data/
  const resolvedPath = sourcePath || path.join(DATA_DIR, `${id}`, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.tex`);

  const meta: DocMeta = { id, name, createdAt: now, lastModifiedAt: now, sourcePath: resolvedPath };

  // Ensure parent directory and virgil/ metadata folder exist
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

  const index = await readIndex();
  index.docs.push(meta);
  await writeIndex(index);

  // Create virgil/ dir next to the .tex file
  const virgilDir = path.join(path.dirname(resolvedPath), "virgil");
  await fs.mkdir(virgilDir, { recursive: true });

  return meta;
}

export async function deleteDoc(id: string): Promise<void> {
  const index = await readIndex();
  const doc = index.docs.find((d) => d.id === id);

  if (doc) {
    const texDir = path.dirname(doc.sourcePath);
    const virgilDir = path.join(texDir, "virgil");

    // Always remove the virgil/ metadata folder
    try {
      await fs.rm(virgilDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    // Only remove the .tex file and its parent dir if it lives inside virgil-data/
    if (texDir.startsWith(DATA_DIR)) {
      try {
        await fs.rm(texDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  // Also clean up legacy doc_ dir if it exists
  try {
    await fs.rm(legacyDocDir(id), { recursive: true, force: true });
  } catch {
    // ignore
  }

  index.docs = index.docs.filter((d) => d.id !== id);
  await writeIndex(index);
}

export async function renameDoc(id: string, name: string): Promise<void> {
  const index = await readIndex();
  const doc = index.docs.find((d) => d.id === id);
  if (doc) {
    doc.name = name;
    await writeIndex(index);
  }
}

export async function updateDocTimestamp(id: string): Promise<void> {
  const index = await readIndex();
  const doc = index.docs.find((d) => d.id === id);
  if (doc) {
    doc.lastModifiedAt = new Date().toISOString();
    await writeIndex(index);
  }
}

// --- Migration from legacy doc_{id}/ structure ---

export async function migrateIfNeeded(): Promise<void> {
  const index = await readIndex();

  let needsWrite = false;

  for (const doc of index.docs) {
    // Fix sourcePath that points to a directory instead of a .tex file
    if (doc.sourcePath && !doc.sourcePath.endsWith(".tex")) {
      const candidate = path.join(doc.sourcePath, "document.tex");
      try {
        await fs.access(candidate);
        doc.sourcePath = candidate;
        needsWrite = true;
      } catch {
        // directory doesn't contain document.tex, will be handled below
      }
    }

    // Skip docs that already have a valid sourcePath pointing to a real .tex file
    if (doc.sourcePath?.endsWith(".tex")) {
      try {
        await fs.access(doc.sourcePath);
        // sourcePath is valid — just ensure virgil/ dir exists and metadata is moved
        const texDir = path.dirname(doc.sourcePath);
        const virgilDir = path.join(texDir, "virgil");
        await fs.mkdir(virgilDir, { recursive: true });

        // Move any loose metadata files into virgil/
        const metaFiles = [
          "editor-state.json", "citations.json", "comments.json",
          "suggestions.json", "archive.json", "todos.json",
        ];
        for (const f of metaFiles) {
          const oldPath = path.join(texDir, f);
          const newPath = path.join(virgilDir, f);
          try {
            await fs.access(oldPath);
            // Only move if not already in virgil/
            try { await fs.access(newPath); } catch {
              await fs.rename(oldPath, newPath);
              needsWrite = true;
            }
          } catch {
            // file doesn't exist at old location, skip
          }
        }
        continue;
      } catch {
        // sourcePath .tex doesn't exist, try legacy
      }
    }

    // Check if this doc has files in the legacy doc_{id}/ directory
    const legacyDir = legacyDocDir(doc.id);
    const legacyTex = path.join(legacyDir, "document.tex");
    try {
      await fs.access(legacyTex);
    } catch {
      continue; // no legacy files either
    }

    // Migrate: set sourcePath to the legacy .tex location
    doc.sourcePath = legacyTex;
    needsWrite = true;
    const virgilDir = path.join(legacyDir, "virgil");
    await fs.mkdir(virgilDir, { recursive: true });

    const metaFiles = [
      "editor-state.json", "citations.json", "comments.json",
      "suggestions.json", "archive.json", "todos.json",
    ];
    for (const f of metaFiles) {
      const oldPath = path.join(legacyDir, f);
      const newPath = path.join(virgilDir, f);
      try {
        await fs.access(oldPath);
        try { await fs.access(newPath); } catch {
          await fs.rename(oldPath, newPath);
        }
      } catch {
        // file doesn't exist, skip
      }
    }
  }

  // Also handle the very old flat structure (single document at virgil-data/document.tex)
  const oldTexPath = path.join(DATA_DIR, "document.tex");
  try {
    await fs.access(oldTexPath);

    if (index.docs.length === 0 || !index.docs.some((d) => d.sourcePath === oldTexPath)) {
      const id = uuid().slice(0, 8);
      const now = new Date().toISOString();
      const newDir = path.join(DATA_DIR, id);
      const newTex = path.join(newDir, "document.tex");
      await fs.mkdir(newDir, { recursive: true });
      await fs.rename(oldTexPath, newTex);

      const virgilDir = path.join(newDir, "virgil");
      await fs.mkdir(virgilDir, { recursive: true });

      for (const f of ["editor-state.json", "comments.json", "suggestions.json"]) {
        const oldPath = path.join(DATA_DIR, f);
        const newPath = path.join(virgilDir, f);
        try {
          await fs.access(oldPath);
          await fs.rename(oldPath, newPath);
        } catch {
          // skip
        }
      }

      index.docs.push({
        id,
        name: "Untitled Document",
        createdAt: now,
        lastModifiedAt: now,
        sourcePath: newTex,
      });
      needsWrite = true;
    }
  } catch {
    // no old flat file
  }

  if (needsWrite) {
    await writeIndex(index);
  }
}
