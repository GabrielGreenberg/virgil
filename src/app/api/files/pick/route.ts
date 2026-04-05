import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * POST /api/files/pick
 * Opens a native macOS file picker dialog and returns the selected path.
 * Query param: ?type=bib to pick .bib files (default: tex)
 */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const fileType = url.searchParams.get("type") || "tex";
    const ext = fileType === "bib" ? "bib" : "tex";
    const prompt = ext === "bib" ? "Select a .bib file" : "Select a .tex file";
    const { stdout } = await execAsync(
      `osascript -e 'POSIX path of (choose file of type {"${ext}"} with prompt "${prompt}")'`
    );
    const filePath = stdout.trim();
    if (!filePath) {
      return NextResponse.json({ error: "No file selected" }, { status: 400 });
    }
    return NextResponse.json({ filePath });
  } catch {
    // User cancelled the dialog
    return NextResponse.json({ cancelled: true });
  }
}
