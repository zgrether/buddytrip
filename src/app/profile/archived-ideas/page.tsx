"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { ArchivedIdeasPanel } from "@/components/profile/ArchivedIdeasPanel";

/**
 * Dedicated mobile page — desktop renders the same panel inline inside
 * /profile when the Idea archive sidebar tab is active.
 */
export default function ArchivedIdeasPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--color-bt-base)" }}>
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Link
          href="/profile"
          className="mb-4 inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ArrowLeft size={14} /> Back to profile
        </Link>
        <ArchivedIdeasPanel />
      </main>
    </div>
  );
}
