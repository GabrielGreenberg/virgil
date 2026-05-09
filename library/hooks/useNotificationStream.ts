"use client";

import { useEffect, useRef, useState } from "react";
import { readJsonFile, SUBDIRS } from "@library/lib/library-storage";
import type { NotificationInbox, NotificationItem } from "@library/lib/queue";

const POLL_MS = 6000;
const SEEN_AT_KEY = "virgil-notification-seen-at";

export function useNotificationStream(handle: FileSystemDirectoryHandle | null) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const seenAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    let stopped = false;

    if (seenAtRef.current === null) {
      try {
        seenAtRef.current = localStorage.getItem(SEEN_AT_KEY) ?? "";
      } catch {
        seenAtRef.current = "";
      }
    }

    const tick = async () => {
      if (stopped) return;
      const inbox = await readJsonFile<NotificationInbox>(
        handle,
        `${SUBDIRS.notifications}/inbox.json`,
      );
      if (!inbox) return;
      const newest = inbox.items[inbox.items.length - 1]?.at ?? "";
      if (newest !== seenAtRef.current) {
        const prev = seenAtRef.current!;
        seenAtRef.current = newest;
        try { localStorage.setItem(SEEN_AT_KEY, newest); } catch {}
        setItems(inbox.items.filter((i) => i.at > prev));
      }
    };

    void tick();
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [handle]);

  return items;
}
