"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";

const AuthContext = createContext<User | null>(null);

/** Whether the provider has completed initial auth resolution */
const AuthLoadedContext = createContext<boolean>(false);

export function AuthProvider({ children }: { children: React.ReactNode }) {
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoaded(true);
    });

    return () => subscription.unsubscribe();
  }, []);

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
