"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationItem } from "@library/lib/queue";
import { notificationTitle, notificationTtlMs } from "@library/lib/queue";
import { TOAST_Z } from "@/floats/float-policy";
import { Button } from "@/components/Button";

interface ToastEntry extends NotificationItem {
  uid: string;
}

/** How many toasts show at once. The rest wait their turn: a skill sweep can
 *  post dozens in one go, and a stack that tall would run up over the bar. */
const MAX_VISIBLE_TOASTS = 4;

export default function Toaster({ items }: { items: NotificationItem[] }) {
  const [visible, setVisible] = useState<ToastEntry[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  // Ingest only NEW items (dedupe by stable uid). Crucially there are NO
  // timers in this effect — each <Toast> owns its own lifecycle. The old
  // single-effect-clears-all-timers pattern cancelled (and never re-armed)
  // a still-visible toast's timer whenever a sibling arrived, so toasts
  // stuck forever; per-toast timers make that impossible.
  useEffect(() => {
    const newOnes: ToastEntry[] = [];
    for (const item of items) {
      // The summary is part of identity: several failures minted in one
      // gesture (a multi-file drop, task 764) share `at`/`kind` and carry no
      // citekey, and must not collapse into one toast.
      const uid = `${item.at}-${item.kind}-${item.citekey ?? ""}-${item.summary}`;
      if (seenRef.current.has(uid)) continue;
      seenRef.current.add(uid);
      newOnes.push({ ...item, uid });
    }
    if (newOnes.length === 0) return;
    setVisible((prev) => [...prev, ...newOnes]);
  }, [items]);

  const removeToast = useCallback((uid: string) => {
    setVisible((prev) => prev.filter((t) => t.uid !== uid));
  }, []);

  if (visible.length === 0) return null;

  const showing = visible.slice(0, MAX_VISIBLE_TOASTS);
  const waiting = visible.length - showing.length;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: TOAST_Z,
      }}
    >
      {showing.map((t) => (
        <Toast key={t.uid} toast={t} onClose={() => removeToast(t.uid)} />
      ))}
      {waiting > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "6px 14px",
            background: "var(--surface)",
            borderRadius: "var(--panel-radius)",
            boxShadow: "var(--menu-shadow)",
            fontSize: 12,
            color: "var(--ink-muted)",
          }}
        >
          <span>{waiting} more</span>
          <Button variant="ghost" size="sm" onClick={() => setVisible([])}>
            Dismiss all
          </Button>
        </div>
      )}
    </div>
  );
}

function Toast({ toast, onClose }: { toast: ToastEntry; onClose: () => void }) {
  // Severity sets how long a toast stays, not how it looks: a toast is a
  // sentence and a way forward, and red stays the mark of lost data.
  const ttl = notificationTtlMs(toast);

  // Each toast owns one timer. Hovering pauses the countdown (we bank the
  // remaining time); leaving resumes it. A sibling arriving/leaving cannot
  // touch this timer — it lives entirely in this component instance.
  const remainingRef = useRef(ttl);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const armTimer = useCallback(
    (ms: number) => {
      clearTimer();
      startedAtRef.current = Date.now();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        onCloseRef.current();
      }, ms);
    },
    [clearTimer],
  );

  useEffect(() => {
    armTimer(ttl);
    return clearTimer;
  }, [armTimer, clearTimer, ttl]);

  const pause = useCallback(() => {
    if (timerRef.current === null) return;
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    clearTimer();
  }, [clearTimer]);

  const resume = useCallback(() => {
    if (timerRef.current !== null) return;
    if (remainingRef.current <= 0) {
      onCloseRef.current();
      return;
    }
    armTimer(remainingRef.current);
  }, [armTimer]);

  return (
    <div
      role="status"
      onMouseEnter={pause}
      onMouseLeave={resume}
      style={{
        background: "var(--surface)",
        borderRadius: "var(--panel-radius)",
        padding: "10px 12px 12px 14px",
        boxShadow: "var(--menu-shadow)",
        fontSize: 13,
        maxWidth: 360,
        minWidth: 220,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 2,
        }}
      >
        <div
          style={{
            fontWeight: 600,
            color: "var(--ink-strong)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {notificationTitle(toast)}
          {toast.citekey ? ` · ${toast.citekey}` : ""}
        </div>
        <button
          data-iconbtn-exempt="inline-styled library chrome (own palette + geometry in style={})"
          className="focus-ring"
          type="button"
          aria-label="Dismiss notification"
          onClick={onClose}
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            marginTop: -2,
            marginRight: -4,
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            fontSize: 13,
            lineHeight: 1,
            cursor: "pointer",
            borderRadius: "var(--radius-sm)",
          }}
        >
          ×
        </button>
      </div>
      <div style={{ color: "var(--ink-body)" }}>{toast.summary}</div>
    </div>
  );
}
