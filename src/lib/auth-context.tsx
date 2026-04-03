"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
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
  const router = useRouter();

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

      if (event === "SIGNED_IN") {
        const pendingToken =
          typeof window !== "undefined"
            ? sessionStorage.getItem("pendingInviteToken")
            : null;
        if (pendingToken) {
          sessionStorage.removeItem("pendingInviteToken");
          router.push(`/invite?token=${pendingToken}`);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [queryClient, router]);

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
