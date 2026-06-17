"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { subscribeToasts, dismissToast, type ToastItem } from "@/lib/toast";

/**
 * Toaster — renders the connectivity toast stack (Connectivity Layer 1).
 *
 * Bottom-center, above the bottom nav. Auto-dismisses; tap to dismiss early.
 * Mounted once at the provider root so any mutation failure can surface here.
 */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((t) =>
      setTimeout(() => dismissToast(t.id), 4500),
    );
    return () => timers.forEach(clearTimeout);
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div
      className="fixed inset-x-0 z-[100] flex flex-col items-center gap-2 px-4"
      style={{ bottom: 88, pointerEvents: "none" }}
    >
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismissToast(t.id)}
          role="alert"
          className="flex max-w-sm items-center gap-2 shadow-lg"
          style={{
            pointerEvents: "auto",
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--color-bt-card-float)",
            border: `1px solid ${
              t.tone === "error"
                ? "var(--color-bt-danger-border)"
                : "var(--color-bt-border)"
            }`,
            color: "var(--color-bt-text)",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {t.tone === "error" && (
            <CloudOff size={16} style={{ color: "var(--color-bt-danger)", flexShrink: 0 }} />
          )}
          {t.message}
        </button>
      ))}
    </div>
  );
}
