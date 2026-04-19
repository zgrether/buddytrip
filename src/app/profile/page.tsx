"use client";

import { useState, useEffect, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, LogOut, Save, Archive, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { createClient } from "@/lib/supabase";
import { TopNav } from "@/components/TopNav";
import { UserAvatar } from "@/components/UserAvatar";
import { useGlobalNotifications } from "@/hooks/useGlobalNotifications";

// ── ProfilePage ───────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { notifications, unreadCount, markAllRead } = useGlobalNotifications();

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: re-seed form only when a different user's data loads, not on every name edit
  }, [me?.id]);
  const [saved, setSaved] = useState(false);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !me) return;
    setAvatarError("");

    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Image must be under 5MB.");
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const allowed = ["jpg", "jpeg", "png", "webp", "gif"];
    if (!allowed.includes(ext)) {
      setAvatarError("Only jpg, png, webp, or gif files are allowed.");
      return;
    }

    setAvatarUploading(true);
    try {
      const supabase = createClient();
      const filePath = `${me.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      // Append timestamp to bust cache
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      await updateMe.mutateAsync({ avatar_url: publicUrl });
      utils.users.getMe.invalidate();
    } catch {
      setAvatarError("Failed to upload. Please try again.");
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      <TopNav
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markAllRead}
      />

      <main className="mx-auto max-w-2xl px-4 pb-24 pt-8">
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
              <button
                data-testid="profile-avatar"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="group relative"
              >
                {avatarUploading ? (
                  <div
                    className="flex items-center justify-center rounded-full"
                    style={{ width: 80, height: 80, background: "var(--color-bt-card-raised)" }}
                  >
                    <div
                      className="h-6 w-6 animate-spin rounded-full border-2"
                      style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
                    />
                  </div>
                ) : (
                  <>
                    <UserAvatar
                      name={me?.name ?? me?.email ?? null}
                      avatarUrl={me?.avatar_url ?? null}
                      sizePx={80}
                    />
                    <div
                      className="absolute inset-0 flex items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ background: "var(--color-bt-overlay)" }}
                    >
                      <Camera size={20} style={{ color: "#fff" }} />
                    </div>
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              {avatarError && (
                <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{avatarError}</p>
              )}
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

            {/* Destination idea archive — per-user snapshots the owner keeps
                to reuse across trips. Managed on a dedicated page so this
                card stays scannable. */}
            <div
              className="rounded-xl p-5"
              style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
            >
              <Link
                href="/profile/archived-ideas"
                data-testid="manage-archived-ideas-link"
                className="flex w-full items-center gap-3 rounded-lg border py-2.5 px-3 text-sm font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              >
                <Archive size={14} />
                <span>Manage destination idea archive</span>
                <ChevronRight size={14} className="ml-auto" style={{ color: "var(--color-bt-text-dim)" }} />
              </Link>
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
