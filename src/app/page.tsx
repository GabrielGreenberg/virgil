import EditorLayout from "@/components/EditorLayout";
import { SystemDialogProvider } from "@/components/system-dialog-host";
import { HintLayer } from "@/components/HintLayer";
import { DropModeOverlays } from "@/components/drop-mode/DropModeOverlays";

export default function Home() {
  return (
    <SystemDialogProvider>
      <EditorLayout />
      {/* App-wide hover/focus hint controller (replaces native `title`
          tooltips + Helper Mode rendering). Mounted once, covers everything. */}
      <HintLayer />
      {/* App-global drop-mode overlays (drop bar + inline-atom ghost). They
          render from the ONE drop session, so they mount once here — never
          per pane (task 1027). */}
      <DropModeOverlays />
    </SystemDialogProvider>
  );
}
