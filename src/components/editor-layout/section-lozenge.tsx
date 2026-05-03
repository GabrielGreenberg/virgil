import { useEffect, useRef, useState } from "react";
import { type SectionPathEntry } from "@/panels/Outline";
import { findRowScroll } from "./layout-scroll";

/**
 * Floating section-path lozenge that appears at the top of an editor pane
 * on scroll, then fades out after a short idle period. The pill itself is
 * `relative` so it can be placed inside an externally-positioned sticky
 * wrapper (see EditorLayout, where it's pinned right under the pod cap).
 */
export function SectionLozenge({ sectionPath }: { sectionPath: SectionPathEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Mirror lozenge: use mirror's own scroll. Canonical lozenge: use row.
    const mirrorScroll = ref.current?.parentElement?.querySelector(
      "[data-virgil-mirror-scroll]",
    ) as HTMLElement | null;
    const scrollEl = mirrorScroll ?? findRowScroll();
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
      className="pointer-events-none transition-opacity duration-300"
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
