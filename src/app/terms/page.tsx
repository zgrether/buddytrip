import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "BuddyTrip Terms of Service",
};

// Content is a committed first-party file → render it statically at BUILD time
// (baked into the HTML: SEO/crawler-friendly, no runtime fs). Updating the terms
// = editing src/content/legal/terms.md + redeploy, no code change.
export const dynamic = "force-static";

export default function TermsPage() {
  const content = readFileSync(
    join(process.cwd(), "src/content/legal/terms.md"),
    "utf-8"
  );
  return (
    <main style={{ minHeight: "100dvh", background: "var(--color-bt-base)" }}>
      <LegalDoc content={content} />
    </main>
  );
}
