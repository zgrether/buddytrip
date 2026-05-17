export const dynamic = "force-dynamic";

import LoginClient from "./LoginClient";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const params = await searchParams;
  const initialMode = params.mode === "signup" ? "signup" : "signin";
  return <LoginClient initialMode={initialMode} />;
}
