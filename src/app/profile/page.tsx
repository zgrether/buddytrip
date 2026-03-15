"use client";

import { useState, useEffect, startTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut, Save } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { createClient } from "@/lib/supabase";

// ── ProfilePage ───────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const { data: me, isLoading } = trpc.users.getMe.useQuery();

  const [name, setName] = useState(me?.name ?? "");
  const [nickname, setNickname] = useState(me?.nickname ?? "");

  useEffect(() => {
    if (me) {
      startTransition(() => {
        setName(me.name ?? "");
        setNickname(me.nickname ?? "");
      });
    }
  }, [me?.id]);
  const [saved, setSaved] = useState(false);
  const [signOutLoading, setSignOutLoading] = useState(false);

  const updateMe = trpc.users.updateMe.useMutation({
    onSuccess: () => {
      utils.users.getMe.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    updateMe.mutate({
      name: trimmedName,
      ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
    });
  };

  const handleSignOut = async () => {
    setSignOutLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const initial = ((me?.name ?? me?.email) || "?").charAt(0).toUpperCase();

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex h-14 items-center gap-3 px-4"
        style={{ background: "var(--color-bt-base)", borderBottom: "1px solid var(--color-bt-border)" }}
      >
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text)" }}
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h1
          className="flex-1 text-base font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          Profile
        </h1>
      </header>

      <main className="mx-auto max-w-lg px-4 pb-24 pt-8">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2"
              style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
            />
          </div>
        ) : (
          <div key={me?.id ?? "loading"} className="space-y-6">
            {/* Avatar + identity */}
            <div className="flex flex-col items-center gap-3 py-4">
              <div
                data-testid="profile-avatar"
                className="flex h-20 w-20 items-center justify-center rounded-full text-3xl font-bold"
                style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
              >
                {initial}
              </div>
              <div className="text-center">
                {me?.name && (
                  <p
                    className="text-lg font-semibold"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    {me.name}
                  </p>
                )}
                <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
                  {me?.email}
                </p>
              </div>
            </div>

            {/* Edit form */}
            <div
              className="space-y-4 rounded-xl p-5"
              style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
            >
              <h2
                className="text-sm font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Edit Profile
              </h2>

              <div>
                <label
                  htmlFor="name"
                  className="mb-1.5 block text-xs font-medium"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  Full Name
                </label>
                <input
                  id="name"
                  data-testid="profile-name-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "var(--color-bt-base)",
                    borderColor: "var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="nickname"
                  className="mb-1.5 block text-xs font-medium"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  Nickname
                </label>
                <input
                  id="nickname"
                  data-testid="profile-nickname-input"
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. Grether"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "var(--color-bt-base)",
                    borderColor: "var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                  }}
                />
              </div>

              {saved && (
                <p
                  data-testid="save-success"
                  className="text-xs font-medium"
                  style={{ color: "var(--color-bt-accent)" }}
                >
                  ✓ Profile saved
                </p>
              )}

              {updateMe.isError && (
                <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
                  Failed to save. Please try again.
                </p>
              )}

              <button
                data-testid="save-profile-btn"
                onClick={handleSave}
                disabled={updateMe.isPending || !name.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                <Save size={14} />
                {updateMe.isPending ? "Saving…" : "Save Changes"}
              </button>
            </div>

            {/* Sign out */}
            <div
              className="rounded-xl p-5"
              style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
            >
              <button
                data-testid="sign-out-btn"
                onClick={handleSignOut}
                disabled={signOutLoading}
                className="flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-50"
                style={{ borderColor: "var(--color-bt-danger-border)", color: "var(--color-bt-danger)" }}
              >
                <LogOut size={14} />
                {signOutLoading ? "Signing out…" : "Sign Out"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
