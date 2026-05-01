/**
 * Dev-only API route that serves files from `virgil-data/` on disk.
 *
 * Only active when `NEXT_PUBLIC_DEV_STORAGE=true`. The file uses the
 * `.dev.ts` extension so it is invisible to Next.js during production
 * static-export builds (see pageExtensions in next.config.ts).
 *
 * Paths:
 *   GET  /api/dev/index.json          → virgil-data/index.json
 *   GET  /api/dev/doc/:id/:file       → virgil-data/<folder>/<file>
 *   GET  /api/dev/doc/:id/virgil/:f   → virgil-data/<folder>/virgil/<f>
 *   PUT  /api/dev/doc/:id/:file       → writes to same
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  DOCUMENT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
} from "@/lib/document-templates";
import { generateEntityId } from "@/lib/uuid";

const DATA_DIR = path.join(process.cwd(), "virgil-data");

interface DevDocEntry {
  id: string;
  sourcePath: string;
}

/** Map a doc id to its folder on disk by reading the index. */
function resolveDocFolder(docId: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf-8");
    const index = JSON.parse(raw) as { docs: DevDocEntry[] };
    const doc = index.docs.find((d) => d.id === docId);
    if (!doc) return null;

    // Extract folder from sourcePath:
    //   .../virgil-data/doc_10ee80e8/document.tex → doc_10ee80e8
    //   .../virgil-data/c1834474/main.tex         → c1834474
    const dataIdx = doc.sourcePath.indexOf("virgil-data/");
    if (dataIdx === -1) return null;
    const rel = doc.sourcePath.slice(dataIdx + "virgil-data/".length);
    const folder = rel.split("/")[0];
    return folder;
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path;

  // /api/dev/index.json
  if (segments.length === 1 && segments[0] === "index.json") {
    try {
      const content = fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf-8");
      return NextResponse.json(JSON.parse(content));
    } catch {
      return NextResponse.json({ docs: [] });
    }
  }

  // /api/dev/doc/:id/_all-files → all files in paper folder, base64-encoded,
  // skipping virgil/. Used by the compile pipeline so SwiftLaTeX can see
  // figures and \include'd files.
  if (
    segments[0] === "doc" &&
    segments.length === 3 &&
    segments[2] === "_all-files"
  ) {
    const docId = segments[1];
    const folder = resolveDocFolder(docId);
    if (!folder) {
      return NextResponse.json({ error: "doc not found" }, { status: 404 });
    }
    const rootPath = path.join(DATA_DIR, folder);
    if (!rootPath.startsWith(DATA_DIR)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const files: { path: string; base64: string }[] = [];
    const walk = (dirAbs: string, rel: string) => {
      for (const name of fs.readdirSync(dirAbs)) {
        if (rel === "" && name === "virgil") continue;
        const abs = path.join(dirAbs, name);
        const nextRel = rel ? `${rel}/${name}` : name;
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
          walk(abs, nextRel);
        } else if (stat.isFile()) {
          const buf = fs.readFileSync(abs);
          files.push({ path: nextRel, base64: buf.toString("base64") });
        }
      }
    };
    try {
      walk(rootPath, "");
    } catch {
      return NextResponse.json({ error: "read failed" }, { status: 500 });
    }
    return NextResponse.json({ files });
  }

  // /api/dev/doc/:id/... → resolve to virgil-data/<folder>/...
  if (segments[0] === "doc" && segments.length >= 3) {
    const docId = segments[1];
    const folder = resolveDocFolder(docId);
    if (!folder) {
      return NextResponse.json({ error: "doc not found" }, { status: 404 });
    }
    const filePath = path.join(DATA_DIR, folder, ...segments.slice(2));

    // Prevent path traversal
    if (!filePath.startsWith(DATA_DIR)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    try {
      if (filePath.endsWith(".pdf")) {
        const buf = fs.readFileSync(filePath);
        return new NextResponse(buf, {
          headers: { "Content-Type": "application/pdf" },
        });
      }
      const content = fs.readFileSync(filePath, "utf-8");
      if (filePath.endsWith(".json")) {
        return NextResponse.json(JSON.parse(content));
      }
      return new NextResponse(content, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  return NextResponse.json({ error: "bad path" }, { status: 400 });
}

function sanitizeFolderName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function readIndexFile(): {
  docs: Array<{
    id: string;
    name: string;
    createdAt: string;
    lastModifiedAt: string;
    sourcePath: string;
  }>;
} {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { docs: [] };
  }
}

function writeIndexFile(index: { docs: unknown[] }) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "index.json"),
    JSON.stringify(index, null, 2),
    "utf-8",
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path;

  // /api/dev/_create-doc — create a new doc folder under virgil-data/
  // using a template, then register it in index.json.
  if (segments.length === 1 && segments[0] === "_create-doc") {
    let body: { name?: string; templateId?: string };
    try {
      body = (await req.json()) as { name?: string; templateId?: string };
    } catch {
      return NextResponse.json({ error: "bad json" }, { status: 400 });
    }
    const rawName = (body.name ?? "").trim();
    if (!rawName) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    const tid = body.templateId ?? DEFAULT_TEMPLATE_ID;
    const template = DOCUMENT_TEMPLATES.find((t) => t.id === tid);
    if (!template) {
      return NextResponse.json(
        { error: `unknown template: ${tid}` },
        { status: 400 },
      );
    }

    const folderName = sanitizeFolderName(rawName);
    if (!folderName) {
      return NextResponse.json({ error: "invalid name" }, { status: 400 });
    }

    // Use a unique subfolder so names can collide across dev sessions.
    const id = generateEntityId().slice(0, 8);
    const dirName = `${folderName}_${id}`;
    const absFolder = path.join(DATA_DIR, dirName);
    if (!absFolder.startsWith(DATA_DIR)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (fs.existsSync(absFolder)) {
      return NextResponse.json(
        { error: `folder already exists: ${dirName}` },
        { status: 409 },
      );
    }

    fs.mkdirSync(absFolder, { recursive: true });
    for (const [filename, content] of Object.entries(template.files)) {
      fs.writeFileSync(path.join(absFolder, filename), content, "utf-8");
    }
    fs.mkdirSync(path.join(absFolder, "virgil"), { recursive: true });

    const now = new Date().toISOString();
    const sourcePath = path.join(absFolder, template.mainTexFilename);
    const index = readIndexFile();
    index.docs.push({
      id,
      name: rawName,
      createdAt: now,
      lastModifiedAt: now,
      sourcePath,
    });
    writeIndexFile(index);

    return NextResponse.json({
      id,
      name: rawName,
      texFilename: template.mainTexFilename,
      folderName: dirName,
      createdAt: now,
      lastModifiedAt: now,
    });
  }

  return NextResponse.json({ error: "bad path" }, { status: 400 });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path;

  // /api/dev/index.json
  if (segments.length === 1 && segments[0] === "index.json") {
    const body = await req.text();
    fs.writeFileSync(path.join(DATA_DIR, "index.json"), body, "utf-8");
    return NextResponse.json({ ok: true });
  }

  // /api/dev/doc/:id/...
  if (segments[0] === "doc" && segments.length >= 3) {
    const docId = segments[1];
    const folder = resolveDocFolder(docId);
    if (!folder) {
      return NextResponse.json({ error: "doc not found" }, { status: 404 });
    }
    const filePath = path.join(DATA_DIR, folder, ...segments.slice(2));

    if (!filePath.startsWith(DATA_DIR)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Ensure parent dirs exist
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("octet-stream")) {
      const buf = Buffer.from(await req.arrayBuffer());
      fs.writeFileSync(filePath, buf);
    } else {
      const body = await req.text();
      fs.writeFileSync(filePath, body, "utf-8");
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "bad path" }, { status: 400 });
}
