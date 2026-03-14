"use client";

import { useAuthUser } from "@/lib/auth-context";

export function useCurrentUser() {
  return useAuthUser();
}
