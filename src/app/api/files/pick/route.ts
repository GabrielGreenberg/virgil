import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * POST /api/files/pick
 * Opens a native macOS file picker dialog and returns the selected path.
 */
export async function POST() {
  try {
    const { stdout } = await execAsync(
      `osascript -e 'POSIX path of (choose file of type {"tex"} with prompt "Select a .tex file")'`
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
