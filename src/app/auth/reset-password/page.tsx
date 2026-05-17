"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const passwordsMatch = password === confirm;
  const canSubmit = password.length >= 6 && passwordsMatch && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) throw updateError;
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--color-bt-base)" }}
    >
      <div
        className="w-full max-w-[400px] rounded-xl border px-6 py-8"
        style={{
          background: "var(--color-bt-card)",
          borderColor: "var(--color-bt-border)",
        }}
      >
        <div className="space-y-5">
          <div className="text-center">
            <h1
              className="flex items-center justify-center gap-2 font-display text-2xl font-semibold tracking-wider"
              style={{ color: "var(--color-bt-text)" }}
            >
              <svg width="24" height="24" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0, color: "var(--color-bt-accent)" }}>
                <path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="currentColor"/>
              </svg>
              BuddyTrip
            </h1>
            <p
              className="mt-1 text-sm"
              style={{ color: "var(--color-bt-text)" }}
            >
              Choose a new password
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="block text-sm font-medium"
                style={{ color: "var(--color-bt-text)" }}
              >
                New password
              </label>
              <input
                id="new-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                style={{
                  background: "var(--color-bt-card-raised)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
                placeholder="••••••••"
              />
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="block text-sm font-medium"
                style={{ color: "var(--color-bt-text)" }}
              >
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 block w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                style={{
                  background: "var(--color-bt-card-raised)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
                placeholder="••••••••"
              />
            </div>

            {confirm.length > 0 && !passwordsMatch && (
              <p className="text-sm" style={{ color: "var(--color-bt-danger)" }}>
                Passwords don&apos;t match.
              </p>
            )}

            {error && (
              <p className="text-sm" style={{ color: "var(--color-bt-danger)" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-base)",
              }}
            >
              {loading ? "Updating..." : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
