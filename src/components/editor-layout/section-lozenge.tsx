import { useEffect, useRef, useState } from "react";
import { type SectionPathEntry } from "@/panels/Outline";

/**
 * Floating section-path lozenge that appears at the top of an editor pane
 * on scroll, then fades out after a short idle period.
 */
export function SectionLozenge({ sectionPath }: { sectionPath: SectionPathEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const scrollEl = ref.current?.parentElement?.querySelector(".overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) return;

    const onScroll = () => {
      setVisible(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setVisible(false), 1800);
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      clearTimeout(timerRef.current);
    };
  }, []);

  const show = visible && sectionPath.length > 0;

  return (
    <div
      ref={ref}
      className="absolute top-1 left-1/2 -translate-x-1/2 z-20 pointer-events-none transition-opacity duration-300"
      style={{ opacity: show ? 1 : 0 }}
    >
      <div className="px-3 py-0.5 rounded-full text-[11px] font-medium backdrop-blur-sm shadow-sm whitespace-nowrap max-w-[320px] truncate" style={{ background: 'rgba(255, 255, 255, 0.7)', color: '#44403c', border: '1px solid var(--heading-annotation-border)' }}>
        {sectionPath.map((entry, i) => (
          <span key={i}>
            {i > 0 && <span className="mx-1 opacity-50">›</span>}
            {entry.sectionNumber && (
              <span className="opacity-60 mr-1">{entry.sectionNumber}</span>
            )}
            <span className={i === sectionPath.length - 1 ? "font-semibold" : "opacity-80"}>
              {entry.text}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
