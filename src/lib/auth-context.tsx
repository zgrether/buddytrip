"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase";

const AuthContext = createContext<User | null>(null);

/** Whether the provider has completed initial auth resolution */
const AuthLoadedContext = createContext<boolean>(false);

export function AuthProvider({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // getSession reads from local storage — instant, no network call
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoaded(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setLoaded(true);

      if (event === "SIGNED_OUT") {
        queryClient.clear();
      }

      // NOTE: this used to consume a `pendingInviteToken` from sessionStorage
      // and re-navigate to /invite after sign-in. That hop is gone: the invite
      // destination now travels as `?next=` (login/page.tsx → /auth/callback),
      // which survives a confirmation email opened in a different tab, app, or
      // browser — the exact case sessionStorage cannot cross, and the one an
      // emailed invite always takes.
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  return (
    <AuthContext.Provider value={user}>
      <AuthLoadedContext.Provider value={loaded}>
        {children}
      </AuthLoadedContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuthUser() {
  return useContext(AuthContext);
}

export function useAuthLoaded() {
  return useContext(AuthLoadedContext);
}
