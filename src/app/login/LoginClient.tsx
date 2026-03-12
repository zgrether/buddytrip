"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Mode = "sign-in" | "sign-up";

export default function LoginClient() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "sign-up") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name, nickname },
          },
        });
        if (signUpError) throw signUpError;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "#0d1117" }}>
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold" style={{ color: "#00d4aa" }}>
            BuddyTrip
          </h1>
          <p className="mt-2 text-sm" style={{ color: "#8b949e" }}>
            Group trip planning & competition
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "sign-up" && (
            <>
              <div>
                <label htmlFor="name" className="block text-sm font-medium"
                  style={{ color: "#e6edf3" }}>
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{
                    background: "#161b22",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                  }}
                  placeholder="Zach Grether"
                />
              </div>
              <div>
                <label htmlFor="nickname" className="block text-sm font-medium"
                  style={{ color: "#e6edf3" }}>
                  Nickname
                </label>
                <input
                  id="nickname"
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{
                    background: "#161b22",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                  }}
                  placeholder="Grether"
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium"
              style={{ color: "#e6edf3" }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{
                background: "#161b22",
                borderColor: "#30363d",
                color: "#e6edf3",
              }}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium"
              style={{ color: "#e6edf3" }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{
                background: "#161b22",
                borderColor: "#30363d",
                color: "#e6edf3",
              }}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "#ef4444" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            style={{
              background: "#00d4aa",
              color: "#0d1117",
            }}
          >
            {loading
              ? "Loading..."
              : mode === "sign-in"
                ? "Sign In"
                : "Create Account"}
          </button>
        </form>

        <p className="text-center text-sm" style={{ color: "#8b949e" }}>
          {mode === "sign-in" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => { setMode("sign-up"); setError(""); }}
                className="font-medium hover:underline"
                style={{ color: "#00d4aa" }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("sign-in"); setError(""); }}
                className="font-medium hover:underline"
                style={{ color: "#00d4aa" }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
