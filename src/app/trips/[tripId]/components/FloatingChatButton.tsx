"use client";

import { MessageCircle } from "lucide-react";

interface FloatingChatButtonProps {
  onClick: () => void;
  unreadCount?: number;
}

export function FloatingChatButton({ onClick, unreadCount = 0 }: FloatingChatButtonProps) {
  return (
    <button
      onClick={onClick}
      data-testid="floating-chat-btn"
      className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 lg:hidden"
      style={{ background: "var(--color-bt-accent)" }}
      aria-label="Open crew chat"
    >
      <MessageCircle size={20} style={{ color: "var(--color-bt-base)" }} />
      {unreadCount > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: "var(--color-bt-warning)" }}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );
}
