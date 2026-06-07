import EditorLayout from "@/components/EditorLayout";
import { SystemDialogProvider } from "@/components/system-dialog-host";
import { HintLayer } from "@/components/HintLayer";

export default function Home() {
  return (
    <SystemDialogProvider>
      <EditorLayout />
      {/* App-wide hover/focus hint controller (replaces native `title`
          tooltips + Helper Mode rendering). Mounted once, covers everything. */}
      <HintLayer />
    </SystemDialogProvider>
  );
}
