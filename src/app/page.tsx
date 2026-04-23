import EditorLayout from "@/components/EditorLayout";
import { SystemDialogProvider } from "@/components/system-dialog-host";

export default function Home() {
  return (
    <SystemDialogProvider>
      <EditorLayout />
    </SystemDialogProvider>
  );
}
