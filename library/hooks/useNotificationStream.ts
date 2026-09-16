"use client";

import { useEffect, useRef, useState } from "react";
import { readJsonFile, SUBDIRS } from "@library/lib/library-storage";
import type { NotificationInbox, NotificationItem } from "@library/lib/queue";
import {
  subscribeToStorageKey,
  writeStorageIfChanged,
} from "@/lib/cross-window-storage";

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

    // A peer window that already surfaced the newest notification advances
    // the mark here too, so this window does not re-show it (task 599).
    const offPeer = subscribeToStorageKey(SEEN_AT_KEY, () => {
      try {
        seenAtRef.current = localStorage.getItem(SEEN_AT_KEY) ?? "";
      } catch {
        /* keep the cached mark */
      }
    });

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
        writeStorageIfChanged(SEEN_AT_KEY, newest);
        setItems(inbox.items.filter((i) => i.at > prev));
      }
    };

    void tick();
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      offPeer();
      window.clearInterval(interval);
    };
  }, [handle]);

  return items;
}
