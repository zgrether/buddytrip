"use client";

import { ChevronLeft } from "lucide-react";
import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * Entering a sheet for someone who cannot, or did not.
 *
 * The LIST itself is `PickemSheetsList` (Screen I), reached from the Sheets
 * button rather than from a block at the bottom of the page. What stays here is
 * the vocabulary both surfaces share — who needs chasing, and what their row
 * says — plus the banner that sits over a proxy sheet.
 *
 * ── Why it is here and not in the phase strip ──────────────────────────────
 *
 * The phase strip carries COMMANDS — open, lock. This is neither: it is the
 * thing a captain reaches for ten minutes before the deadline, standing where
 * their own sheet already is.
 *
 * ── The list IS the permission ─────────────────────────────────────────────
 *
 * `pickem_sheet_status` returns exactly the people the caller may act for, as
 * decided by `_pickem_can_proxy_for` — the same predicate that gates the write
 * and the read. A plain participant gets one row (themselves), so this control
 * does not render for them AT ALL, without any role test in the client.
 *
 * That matters more than it looks: a client-side role check is a second copy of
 * the policy, and two copies drift. This one cannot, because it is not a copy.
 */

export interface ProxyTarget {
  userId: string;
  name: string;
  submitted: boolean;
  /** How far along, from `pickem_sheet_status` (migration 167). `submitted` is
   *  `picked > 0` and kept because several readers only need the yes/no. */
  picked: number;
  total: number;
  isGuest: boolean;
  /** Their team, for the row's second line. Null when they are on none. */
  side?: string | null;
}

/**
 * Guests first, then people who have not submitted, then the rest — the order
 * of who needs chasing.
 *
 * A guest can NEVER enter their own sheet (no `auth.uid()`, so
 * `pickem_picks_write` can never match them), which is why they lead and why
 * their row says "hasn't signed up" rather than "hasn't submitted". Implying a
 * guest might yet do it themselves would send someone off to chase a person who
 * structurally cannot act.
 */
export function sortTargets(targets: ProxyTarget[]): ProxyTarget[] {
  const rank = (t: ProxyTarget) => (t.isGuest && !t.submitted ? 0 : t.submitted ? 2 : 1);
  return [...targets].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)
  );
}

/** What a row says about someone's state. Guests read differently on purpose. */
export function targetStatusLabel(t: ProxyTarget): string {
  if (t.submitted) return "Sheet in";
  return t.isGuest ? "Hasn’t signed up" : "Nothing submitted";
}

/**
 * WHO typed the sheet you are about to replace.
 *
 * ── The banner asserted this, and was wrong about it ──────────────────────
 *
 * It said "{name} submitted their own sheet — saving replaces it" over ANY
 * sheet that already had rows in it, including one the reader had entered for
 * them ninety seconds earlier. So the one screen whose job is to stop a proxy
 * confusing whose work they are looking at was itself confusing it.
 *
 * ── Why "self" wins over the others ───────────────────────────────────────
 *
 * The states are ranked by what the reader would regret, not by how many rows
 * each covers. Overwriting picks somebody made for themselves is the outcome
 * this banner exists to prevent, so ANY self-entered row makes the whole sheet
 * read as theirs — a mixed sheet (they picked three, a captain proxied the
 * rest) still contains their work, and the warning is about that work.
 *
 * ── null is UNKNOWN, and must not read as "they did it" ───────────────────
 *
 * `entered_by` is null for every row written before migration 163, which is why
 * that migration refused to spell self-entry as null. So a null-bearing sheet
 * gets the attribution-free sentence: it still warns about replacement, which
 * is the part that is certainly true, and claims nothing about the author.
 */
export type SheetAuthor = "none" | "self" | "you" | "someone" | "unknown";

export function sheetAuthor(
  rows: { enteredBy?: string | null }[],
  targetUserId: string,
  myUserId: string | null
): SheetAuthor {
  if (rows.length === 0) return "none";
  if (rows.some((r) => r.enteredBy != null && r.enteredBy === targetUserId)) return "self";
  if (rows.some((r) => r.enteredBy == null)) return "unknown";
  if (myUserId != null && rows.every((r) => r.enteredBy === myUserId)) return "you";
  return "someone";
}

/**
 * The banner over a proxy sheet.
 *
 * PERSISTENT, and not a subtitle. The only way this feature goes badly is
 * someone editing what they think is their own sheet, and the sheet is
 * POPULATED in proxy mode — it looks exactly like a filled-in sheet, because it
 * is one. So the subject is stated as its own band, and the copy underneath it
 * is swept of "your" as well: a banner over second-person copy is a mixed
 * message, and mixed is how the misread happens.
 */
export function PickemProxyBanner({
  name,
  isGuest,
  author,
  onBack,
}: {
  name: string;
  isGuest: boolean;
  /** Drives the overwrite warning — and ONLY when there is something to
   *  overwrite. Warning on an empty sheet is the common case, and friction
   *  there is noise. */
  author: SheetAuthor;
  onBack: () => void;
}) {
  return (
    <div
      data-testid="pickem-proxy-banner"
      className="flex flex-col gap-1.5 rounded-xl px-3 py-2.5"
      style={{
        background: "var(--color-bt-accent-faint)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          data-testid="pickem-proxy-back"
          aria-label="Back to your own sheet"
          className="-ml-1 flex shrink-0 items-center rounded-lg"
          style={{ minHeight: 32, minWidth: 32, color: "var(--color-bt-text)" }}
        >
          <ChevronLeft size={18} />
        </button>
        <span
          className="min-w-0 flex-1"
          style={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}
        >
          You&rsquo;re entering {name}&rsquo;s sheet
        </span>
      </div>

      {author !== "none" ? (
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
          {author === "self"
            ? `${name} submitted their own sheet — saving replaces it.`
            : author === "you"
              ? "You entered this sheet — saving replaces it."
              : author === "someone"
                ? "Someone else entered this sheet — saving replaces it."
                : /* unknown */ `${name} already has a sheet — saving replaces it.`}
        </span>
      ) : isGuest ? (
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
          {name} has no account, so this is the only way they get a sheet.
        </span>
      ) : null}
    </div>
  );
}
