"use client";

export function LoadingScreen({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center bg-[var(--background)] text-[var(--muted)] ${className}`}
    >
      Loading…
    </div>
  );
}
