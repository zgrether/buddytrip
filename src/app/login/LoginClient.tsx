"use client";

import { useState } from "react";
import { ArrowLeft, Check, Loader2, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Mode =
  | "signin"
  | "signup"
  | "magic-link"
  | "magic-link-sent"
  | "confirm-pending"
  | "forgot-password";

// ── Google "G" logo (inline SVG, no dependency) ────────────────────────
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.08 24.08 0 0 0 0 21.56l7.98-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// ── Divider with centered text ─────────────────────────────────────────
function Divider({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 border-t" style={{ borderColor: "var(--color-bt-border)" }} />
      <span className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>{text}</span>
      <div className="flex-1 border-t" style={{ borderColor: "var(--color-bt-border)" }} />
    </div>
  );
}

// ── Shared input component ─────────────────────────────────────────────
function Input({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required = true,
  minLength,
  autoFocus,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        minLength={minLength}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
        style={{
          background: "var(--color-bt-card-raised)",
          borderColor: "var(--color-bt-border)",
          color: "var(--color-bt-text)",
        }}
        placeholder={placeholder}
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────
export default function LoginClient({
  initialMode = "signin",
}: {
  initialMode?: "signin" | "signup";
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  // Tracks which primary panel (signin | signup) opened the magic-link flow
  // so the back button returns to the right place.
  const [magicLinkReturn, setMagicLinkReturn] = useState<"signin" | "signup">(
    initialMode === "signup" ? "signup" : "signin"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resending, setResending] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  function switchMode(m: Mode) {
    setMode(m);
    setError("");
    setResetSent(false);
  }

  function enterMagicLink(from: "signin" | "signup") {
    setMagicLinkReturn(from);
    switchMode("magic-link");
  }

  // ── Google OAuth ─────────────────────────────────────────────────────
  async function handleGoogleAuth() {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback` },
    });
  }

  // ── Email/password sign in ──────────────────────────────────────────
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  // ── Email/password sign up ──────────────────────────────────────────
  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, nickname } },
      });
      if (signUpError) throw signUpError;

      if (data.session === null) {
        // Email confirmation required — show confirm-pending
        switchMode("confirm-pending");
      } else {
        // Session returned immediately (confirmation disabled in dev)
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  // ── Magic link ──────────────────────────────────────────────────────
  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      if (otpError) throw otpError;
      switchMode("magic-link-sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  // ── Forgot password ─────────────────────────────────────────────────
  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/reset-password`,
      });
      if (resetError) throw resetError;
      setResetSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  // ── Resend confirmation email ───────────────────────────────────────
  async function handleResendConfirmation() {
    setResending(true);
    try {
      await supabase.auth.resend({ type: "signup", email });
    } catch {
      // best effort
    } finally {
      setResending(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────

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
        {/* ── signin mode ─────────────────────────────────────────── */}
        {mode === "signin" && (
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
              <p className="mt-1 text-sm" style={{ color: "var(--color-bt-text)" }}>
                Welcome back
              </p>
            </div>

            {/* Google OAuth */}
            <button
              type="button"
              onClick={handleGoogleAuth}
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
              style={{
                background: "var(--color-bt-card-raised)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
              data-testid="google-auth-btn"
            >
              <GoogleLogo />
              Continue with Google
            </button>

            <Divider text="or" />

            {/* Magic link */}
            <button
              type="button"
              onClick={() => enterMagicLink("signin")}
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-opacity hover:opacity-90"
              style={{
                background: "transparent",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text-dim)",
              }}
            >
              <Mail size={16} />
              Sign in with a magic link
            </button>

            <Divider text="or" />

            {/* Email/password form */}
            <form onSubmit={handleSignIn} className="space-y-4">
              <Input id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
              <Input id="password" label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" minLength={6} />

              {error && (
                <p className="text-sm" style={{ color: "var(--color-bt-danger)" }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>

              <div className="text-right">
                <button
                  type="button"
                  onClick={() => switchMode("forgot-password")}
                  className="text-xs hover:underline"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  Forgot password?
                </button>
              </div>
            </form>

            <p className="text-center text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Don&apos;t have an account?{" "}
              <button onClick={() => switchMode("signup")} className="font-medium hover:underline" style={{ color: "var(--color-bt-accent)" }}>
                Sign up
              </button>
            </p>
          </div>
        )}

        {/* ── signup mode ─────────────────────────────────────────── */}
        {mode === "signup" && (
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
              <p className="mt-1 text-sm" style={{ color: "var(--color-bt-text)" }}>
                Create your account
              </p>
            </div>

            {/* Google OAuth */}
            <button
              type="button"
              onClick={handleGoogleAuth}
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
              style={{
                background: "var(--color-bt-card-raised)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
              data-testid="google-auth-btn-signup"
            >
              <GoogleLogo />
              Continue with Google
            </button>

            <Divider text="or" />

            {/* Magic link */}
            <button
              type="button"
              onClick={() => enterMagicLink("signup")}
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-opacity hover:opacity-90"
              style={{
                background: "transparent",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text-dim)",
              }}
            >
              <Mail size={16} />
              Continue with a magic link
            </button>

            <Divider text="or" />

            {/* Signup form */}
            <form onSubmit={handleSignUp} className="space-y-4">
              <Input id="signup-name" label="Full Name" value={name} onChange={setName} placeholder="Zach Grether" />
              <Input id="signup-nickname" label="Nickname" value={nickname} onChange={setNickname} placeholder="What your crew calls you" required={false} />
              <Input id="signup-email" label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
              <Input id="signup-password" label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" minLength={6} />

              {error && (
                <p className="text-sm" style={{ color: "var(--color-bt-danger)" }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {loading ? "Creating account..." : "Create account"}
              </button>
            </form>

            <p className="text-center text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Already have an account?{" "}
              <button onClick={() => switchMode("signin")} className="font-medium hover:underline" style={{ color: "var(--color-bt-accent)" }}>
                Sign in
              </button>
            </p>
          </div>
        )}

        {/* ── magic-link mode ─────────────────────────────────────── */}
        {mode === "magic-link" && (
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => switchMode(magicLinkReturn)}
              className="flex items-center gap-1 text-sm hover:opacity-80"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <ArrowLeft size={16} />
            </button>

            <div>
              <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
                Sign in with a magic link
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
                Enter your email and we&apos;ll send you a link to sign straight in — no password needed.
              </p>
            </div>

            <form onSubmit={handleMagicLink} className="space-y-4">
              <Input id="magic-email" label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoFocus />

              {error && (
                <p className="text-sm" style={{ color: "var(--color-bt-danger)" }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Sending...
                  </span>
                ) : (
                  "Send magic link"
                )}
              </button>
            </form>
          </div>
        )}

        {/* ── magic-link-sent mode ────────────────────────────────── */}
        {mode === "magic-link-sent" && (
          <div className="space-y-5 text-center">
            <div
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "var(--color-bt-tag-bg)" }}
            >
              <Check size={24} style={{ color: "var(--color-bt-accent)" }} />
            </div>

            <div>
              <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
                Check your email
              </h2>
              <p className="mt-2 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
                We sent a magic link to <strong style={{ color: "var(--color-bt-text)" }}>{email}</strong>.
                Tap it to sign in instantly.
              </p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleMagicLink}
                disabled={loading}
                className="w-full rounded-xl border px-4 py-2.5 text-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
              >
                Resend
              </button>
              <button
                type="button"
                onClick={() => switchMode(magicLinkReturn)}
                className="w-full text-sm hover:underline"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Use a different method
              </button>
            </div>
          </div>
        )}

        {/* ── confirm-pending mode ────────────────────────────────── */}
        {mode === "confirm-pending" && (
          <div className="space-y-5 text-center">
            <div
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "var(--color-bt-tag-bg)" }}
            >
              <Mail size={24} style={{ color: "var(--color-bt-accent)" }} />
            </div>

            <div>
              <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
                Check your email
              </h2>
              <p className="mt-2 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
                We sent a confirmation link to{" "}
                <strong style={{ color: "var(--color-bt-text)" }}>{email}</strong>.
                Tap it to activate your account and you&apos;ll be taken straight in.
              </p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resending}
                className="w-full rounded-xl border px-4 py-2.5 text-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
              >
                {resending ? "Resending..." : "Resend email"}
              </button>
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="w-full text-sm hover:underline"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Back to sign in
              </button>
            </div>
          </div>
        )}

        {/* ── forgot-password mode ────────────────────────────────── */}
        {mode === "forgot-password" && (
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="flex items-center gap-1 text-sm hover:opacity-80"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <ArrowLeft size={16} />
            </button>

            <div>
              <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
                Reset your password
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
                Enter your email and we&apos;ll send you a reset link.
              </p>
            </div>

            {resetSent ? (
              <p className="text-sm font-medium" style={{ color: "var(--color-bt-accent)" }}>
                Reset link sent — check your email.
              </p>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <Input id="reset-email" label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoFocus />

                {error && (
                  <p className="text-sm" style={{ color: "var(--color-bt-danger)" }}>{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                >
                  {loading ? "Sending..." : "Send reset link"}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
