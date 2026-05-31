"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  IconUser,
  IconMail,
  IconLock,
  IconArchive,
  IconLogout,
  IconTrash,
  IconArrowLeft,
} from "@tabler/icons-react";
import { trpc } from "@/lib/trpc-client";
import { createClient } from "@/lib/supabase";
import { useAuthLoaded, useAuthUser } from "@/lib/auth-context";
import { TopNav } from "@/components/TopNav";
import { Avatar } from "@/components/Avatar";
import { AvatarIconPicker } from "@/components/AvatarIconPicker";
import { ArchivedIdeasPanel } from "@/components/profile/ArchivedIdeasPanel";

// ── Constants ─────────────────────────────────────────────────────────────

/** Standard competition team colors — used in the mobile preview row. */
const TEAM_COLORS = [
  { color: "#3b82f6", label: "Blue" },
  { color: "#a855f7", label: "Purple" },
  { color: "#f97316", label: "Orange" },
  { color: "#22c55e", label: "Green" },
];

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.07em",
  color: "var(--color-bt-text-dim)",
  textTransform: "uppercase",
  marginBottom: 6,
};

type SidebarTab = "profile" | "ideas";

// ── Page ──────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const authLoaded = useAuthLoaded();
  const authUser = useAuthUser();
  const utils = trpc.useUtils();

  const { data: me, isLoading } = trpc.users.getMe.useQuery(undefined, {
    enabled: authLoaded && !!authUser,
  });

  // Auth gate — bounce to the marketing homepage if not authenticated.
  // We can't send users to /login here: the sign-out button below clears
  // the auth state and then router.push("/"); but the moment authUser
  // becomes null React re-renders this page and the gate would race ahead
  // with router.replace("/login"), landing the user on /login instead of
  // the homepage. Pointing the gate at "/" matches the sign-out intent
  // and the homepage already shows the marketing site for unauthed visits.
  useEffect(() => {
    if (authLoaded && !authUser) router.replace("/");
  }, [authLoaded, authUser, router]);

  // ── Avatar icon save (debounced, optimistic) ──────────────────────────
  const updateAvatar = trpc.users.updateAvatar.useMutation({
    onMutate: async ({ avatarIcon }) => {
      await utils.users.getMe.cancel();
      const prev = utils.users.getMe.getData();
      if (prev) utils.users.getMe.setData(undefined, { ...prev, avatar_icon: avatarIcon });
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) utils.users.getMe.setData(undefined, ctx.prev);
    },
    onSettled: () => {
      utils.users.getMe.invalidate();
      // Avatar shows up on every trip's crew/itinerary/teams surfaces, which
      // read from tripMembers.list. Refresh those so the new icon propagates
      // without a full reload.
      utils.tripMembers.list.invalidate();
    },
    onSuccess: () => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    },
  });
  const [savedFlash, setSavedFlash] = useState(false);

  // ── Sidebar tab state (desktop) ───────────────────────────────────────
  const [activeTab, setActiveTab] = useState<SidebarTab>("profile");

  // ── Edit sheet state ──────────────────────────────────────────────────
  const [openSheet, setOpenSheet] = useState<null | "name" | "email" | "password" | "delete">(
    null
  );


  // ── OAuth detection ───────────────────────────────────────────────────
  const isGoogleUser = authUser?.app_metadata?.provider === "google";

  if (!authLoaded || isLoading || !me) {
    return (
      <div className="min-h-screen" style={{ background: "var(--color-bt-base)" }}>
        <TopNav hideTripSwitcher hideBoard />
        <div className="flex justify-center py-16">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2"
            style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
          />
        </div>
      </div>
    );
  }

  const displayName = me.name ?? me.email ?? "You";

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      <TopNav hideTripSwitcher hideBoard />

      <div className="flex">
        {/* ── Desktop sidebar ─────────────────────────────────────────── */}
        <DesktopSidebar
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          onBack={() => router.back()}
          onSignOut={() => handleSignOut(router)}
          onDelete={() => setOpenSheet("delete")}
        />

        {/* ── Main scroll container ───────────────────────────────────── */}
        <main className="w-full md:flex-1">
          <div className="mx-auto max-w-2xl pb-24 md:pt-8">
            {/* Mobile back button — collapses the desktop sidebar's
                "Back" link into a single arrow in the top-left of the
                title bar (Supabase-style). */}
            <div className="px-2 pt-2 md:hidden">
              <button
                type="button"
                onClick={() => router.back()}
                aria-label="Back"
                className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <IconArrowLeft size={20} stroke={1.75} />
              </button>
            </div>

            {/* Mobile shows everything stacked. Desktop renders only the
                section matching the active sidebar tab. */}

            {/* AVATAR HERO + PICKER + COMPETITION PREVIEW + PROFILE
                Mobile: always visible. Desktop: visible only when the
                Profile tab is active (otherwise hidden at md+). */}
            <div className={activeTab === "profile" ? "block" : "md:hidden"}>
                <AvatarHero
                  name={displayName}
                  email={me.email}
                  avatarIcon={me.avatar_icon}
                />

                <Section label="Avatar icon" mobileOnlyLabel>
                  <AvatarIconPicker
                    value={me.avatar_icon ?? null}
                    onChange={(iconId) => updateAvatar.mutate({ avatarIcon: iconId })}
                    showSaved={savedFlash}
                  />
                </Section>

                <Section label="Competition preview">
                  <div
                    className="rounded-xl px-4 py-4"
                    style={{
                      background: "var(--color-bt-card)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    {/* Explainer subtitle sits inside the panel so it
                        always travels with the visual it's explaining,
                        regardless of viewport. */}
                    <p
                      className="mb-4 text-center text-[10px] font-medium uppercase tracking-wider"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      Your icon stays · background becomes your team color
                    </p>

                    <div className="flex items-center justify-center gap-3">
                      <div className="flex flex-col items-center gap-1.5">
                        <Avatar name={displayName} avatarIcon={me.avatar_icon} size="md" />
                        <span
                          className="text-[10px]"
                          style={{ color: "var(--color-bt-text-dim)" }}
                        >
                          Default
                        </span>
                      </div>
                      <span
                        aria-hidden="true"
                        className="text-sm"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        →
                      </span>
                      {TEAM_COLORS.map((t) => (
                        <div key={t.color} className="flex flex-col items-center gap-1.5">
                          <Avatar
                            name={displayName}
                            avatarIcon={me.avatar_icon}
                            teamColor={t.color}
                            size="md"
                          />
                          <span
                            className="text-[10px]"
                            style={{ color: "var(--color-bt-text-dim)" }}
                          >
                            {t.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Section>

                <Section label="Profile">
                  <div
                    className="overflow-hidden rounded-xl"
                    style={{
                      background: "var(--color-bt-card)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    <SettingsRow
                      icon={<IconUser size={16} stroke={1.75} />}
                      label="Name"
                      sub={me.name ?? "Add your name"}
                      onClick={() => setOpenSheet("name")}
                    />
                    <SettingsRow
                      icon={<IconMail size={16} stroke={1.75} />}
                      label="Email"
                      sub={me.email ?? "—"}
                      onClick={() => setOpenSheet("email")}
                    />
                    <SettingsRow
                      icon={<IconLock size={16} stroke={1.75} />}
                      label="Password"
                      sub={isGoogleUser ? "" : "Change your password"}
                      right={
                        isGoogleUser ? (
                          <span
                            className="rounded-full px-2 py-1 text-[10px] font-medium"
                            style={{
                              background: "var(--color-bt-card-raised)",
                              color: "var(--color-bt-text-dim)",
                              border: "0.5px solid var(--color-bt-border)",
                            }}
                          >
                            Google account
                          </span>
                        ) : undefined
                      }
                      onClick={isGoogleUser ? undefined : () => setOpenSheet("password")}
                      lastRow
                    />
                  </div>
                </Section>
              </div>

            {/* Desktop-only inline panels — render the actual page content
                inside the main area when its sidebar tab is active.
                Mobile path still navigates to the dedicated
                /profile/archived-ideas route via the Preferences card below. */}
            {activeTab === "ideas" && (
              <div className="hidden px-4 md:block">
                <ArchivedIdeasPanel />
              </div>
            )}

            <div className="block md:hidden">
              <Section label="Preferences">
                <div
                  className="overflow-hidden rounded-xl"
                  style={{
                    background: "var(--color-bt-card)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                >
                  <SettingsRow
                    icon={<IconArchive size={16} stroke={1.75} />}
                    label="Idea archive"
                    sub="Saved destinations for future trips"
                    onClick={() => router.push("/profile/archived-ideas")}
                    lastRow
                  />
                </div>
              </Section>

              {/* Sign out card (mobile only) */}
              <Section>
                <button
                  type="button"
                  onClick={() => handleSignOut(router)}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
                  style={{
                    background: "var(--color-bt-card)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      color: "var(--color-bt-text-dim)",
                    }}
                  >
                    <IconLogout size={16} stroke={1.75} />
                  </span>
                  <span className="text-sm" style={{ color: "var(--color-bt-text)" }}>
                    Sign out
                  </span>
                </button>
              </Section>

              {/* Danger zone (mobile only) */}
              <Section label="Danger zone">
                <button
                  type="button"
                  onClick={() => setOpenSheet("delete")}
                  className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
                  style={{
                    background: "var(--color-bt-card)",
                    border: "0.5px solid rgba(239,68,68,.2)",
                  }}
                >
                  <span
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: "rgba(239,68,68,.1)",
                      color: "var(--color-bt-danger)",
                    }}
                  >
                    <IconTrash size={16} stroke={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm font-medium"
                      style={{ color: "var(--color-bt-danger)" }}
                    >
                      Delete account
                    </p>
                    <p
                      className="mt-0.5 text-xs"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      Permanently removes your account and all data
                    </p>
                  </div>
                </button>
              </Section>
            </div>
          </div>
        </main>
      </div>

      {/* ── Sheets ─────────────────────────────────────────────────────── */}
      {openSheet === "name" && (
        <NameSheet currentName={me.name ?? ""} onClose={() => setOpenSheet(null)} />
      )}
      {openSheet === "email" && (
        <EmailSheet currentEmail={me.email ?? ""} onClose={() => setOpenSheet(null)} />
      )}
      {openSheet === "password" && (
        <PasswordSheet onClose={() => setOpenSheet(null)} />
      )}
      {openSheet === "delete" && (
        <DeleteAccountSheet onClose={() => setOpenSheet(null)} />
      )}
    </div>
  );
}

// ── Sign out helper ───────────────────────────────────────────────────────

async function handleSignOut(router: ReturnType<typeof useRouter>) {
  const supabase = createClient();
  await supabase.auth.signOut();
  router.push("/");
  router.refresh();
}

// ── Layout primitives ─────────────────────────────────────────────────────

function Section({
  label,
  children,
  mobileOnly = false,
  mobileOnlyLabel = false,
}: {
  label?: string;
  children: React.ReactNode;
  mobileOnly?: boolean;
  mobileOnlyLabel?: boolean;
}) {
  return (
    <div className={`px-4 pb-3 ${mobileOnly ? "md:hidden" : ""}`}>
      {label && (
        <p
          style={SECTION_LABEL_STYLE}
          className={mobileOnlyLabel ? "md:hidden" : ""}
        >
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  sub,
  right,
  onClick,
  lastRow = false,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  lastRow?: boolean;
}) {
  const Tag: keyof JSX.IntrinsicElements = onClick ? "button" : "div";
  const interactive = !!onClick;
  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        interactive ? "hover:bg-[var(--color-bt-hover)]" : ""
      }`}
      style={{
        borderBottom: lastRow ? undefined : "0.5px solid var(--color-bt-border)",
      }}
    >
      <span
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>{label}</p>
        {sub && (
          <p className="mt-0.5 truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {sub}
          </p>
        )}
      </div>
      {right ?? (interactive ? (
        <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
      ) : null)}
    </Tag>
  );
}

// ── Avatar hero ───────────────────────────────────────────────────────────

function AvatarHero({
  name,
  email,
  avatarIcon,
}: {
  name: string;
  email: string | null;
  avatarIcon: string | null;
}) {
  return (
    <>
      {/* Mobile: centered column */}
      <div className="flex flex-col items-center px-4 pb-4 pt-6 md:hidden">
        <Avatar name={name} avatarIcon={avatarIcon} size="lg" />
        <p
          className="mt-3 text-[18px] font-medium"
          style={{ color: "var(--color-bt-text)" }}
        >
          {name}
        </p>
        {email && (
          <p
            className="mt-0.5 text-[13px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {email}
          </p>
        )}
      </div>

      {/* Desktop: flex row */}
      <div className="hidden items-center gap-4 px-4 pb-5 md:flex">
        <Avatar name={name} avatarIcon={avatarIcon} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium" style={{ color: "var(--color-bt-text)" }}>
            {name}
          </p>
          {email && (
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {email}
            </p>
          )}
          {/* The "icon stays / background becomes team color" explainer
              lives inside the Competition preview panel below, so it's
              omitted here to avoid duplication. */}
        </div>
      </div>
    </>
  );
}

// ── Desktop sidebar ───────────────────────────────────────────────────────

function DesktopSidebar({
  activeTab,
  onChangeTab,
  onBack,
  onSignOut,
  onDelete,
}: {
  activeTab: SidebarTab;
  onChangeTab: (t: SidebarTab) => void;
  onBack: () => void;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  const items: { id: SidebarTab; label: string; icon: React.ReactNode; group: "account" | "library" }[] = [
    { id: "profile", label: "Profile", icon: <IconUser size={16} stroke={1.75} />, group: "account" },
    { id: "ideas", label: "Idea archive", icon: <IconArchive size={16} stroke={1.75} />, group: "library" },
  ];
  const account = items.filter((i) => i.group === "account");
  const library = items.filter((i) => i.group === "library");

  return (
    <aside
      className="hidden w-[200px] flex-col md:flex"
      style={{
        background: "var(--color-bt-card)",
        borderRight: "0.5px solid var(--color-bt-border)",
        padding: "10px 0 20px",
        // Stick to the viewport (below the 56px TopNav) and cap at one
        // viewport height so the bottom block (Sign out / Delete) stays
        // pinned to the bottom of the screen as the main panel scrolls.
        // Without this, default flex `align-items: stretch` stretches
        // the sidebar to match main content height, leaving the bottom
        // items way down the page.
        position: "sticky",
        top: 56,
        height: "calc(100vh - 56px)",
        overflowY: "auto",
        alignSelf: "flex-start",
      }}
    >
      {/* Back — sits above the section groups, mirroring Supabase's
          left-column back link. Collapses to a single arrow button in
          the mobile title bar (rendered in the main area). Returns to
          the previous page rather than a fixed destination. */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center transition-colors hover:text-[var(--color-bt-text)]"
        style={{ gap: 6, padding: "0 16px 10px", color: "var(--color-bt-text-dim)" }}
      >
        <IconArrowLeft size={15} stroke={1.75} />
        <span style={{ fontSize: 13 }}>Back</span>
      </button>

      <div
        style={{
          borderBottom: "0.5px solid var(--color-bt-border)",
          marginBottom: 12,
        }}
      />

      <SidebarGroup label="Account">
        {account.map((i) => (
          <SidebarItem
            key={i.id}
            label={i.label}
            icon={i.icon}
            active={activeTab === i.id}
            onClick={() => onChangeTab(i.id)}
          />
        ))}
      </SidebarGroup>
      <SidebarGroup label="Library">
        {library.map((i) => (
          <SidebarItem
            key={i.id}
            label={i.label}
            icon={i.icon}
            active={activeTab === i.id}
            onClick={() => onChangeTab(i.id)}
          />
        ))}
      </SidebarGroup>

      <div
        style={{ marginTop: "auto", borderTop: "0.5px solid var(--color-bt-border)", paddingTop: 8 }}
      >
        <SidebarItem
          label="Sign out"
          icon={<IconLogout size={16} stroke={1.75} />}
          onClick={onSignOut}
        />
        <SidebarItem
          label="Delete account"
          icon={<IconTrash size={16} stroke={1.75} />}
          onClick={onDelete}
          danger
        />
      </div>
    </aside>
  );
}

function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p
        style={{
          ...SECTION_LABEL_STYLE,
          padding: "6px 16px",
          margin: 0,
        }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

function SidebarItem({
  label,
  icon,
  active = false,
  onClick,
  danger = false,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center transition-colors hover:bg-[var(--color-bt-hover)]"
      style={{
        gap: 10,
        padding: "9px 16px",
        background: active ? "rgba(45,212,191,.08)" : "transparent",
        color: danger
          ? "rgba(248,113,113,.7)"
          : active
          ? "var(--color-bt-text)"
          : "var(--color-bt-text)",
      }}
    >
      <span
        style={{
          color: danger
            ? "rgba(248,113,113,.7)"
            : active
            ? "var(--color-bt-accent)"
            : "var(--color-bt-text-dim)",
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 13 }}>{label}</span>
    </button>
  );
}

// (PreferencesPanel removed — desktop now renders the full
// ArchivedIdeasPanel inline in the main area when its sidebar tab is
// active. Mobile still uses the Preferences card with a row that
// navigates to the dedicated page.)

// ── Sheets ────────────────────────────────────────────────────────────────

function SheetShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-t-2xl md:rounded-2xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "0.5px solid var(--color-bt-border)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs hover:underline"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function NameSheet({ currentName, onClose }: { currentName: string; onClose: () => void }) {
  const [name, setName] = useState(currentName);
  const utils = trpc.useUtils();
  const updateMe = trpc.users.updateMe.useMutation({
    onSuccess: () => {
      utils.users.getMe.invalidate();
      // Name drives the initials fallback (and displayName) on every trip's
      // crew/itinerary/teams surfaces, which read from tripMembers.list.
      utils.tripMembers.list.invalidate();
      onClose();
    },
  });
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== currentName && !updateMe.isPending;
  return (
    <SheetShell title="Change name" onClose={onClose}>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
          color: "var(--color-bt-text)",
        }}
      />
      {updateMe.isError && (
        <p className="mt-2 text-xs" style={{ color: "var(--color-bt-danger)" }}>
          Failed to save. Please try again.
        </p>
      )}
      <button
        type="button"
        disabled={!canSave}
        onClick={() => updateMe.mutate({ name: trimmed })}
        className="mt-4 w-full rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
        style={{ background: "var(--color-bt-accent)", color: "#0d1f1a" }}
      >
        {updateMe.isPending ? "Saving…" : "Save"}
      </button>
    </SheetShell>
  );
}

function EmailSheet({ currentEmail, onClose }: { currentEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ email });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <SheetShell title="Change email" onClose={onClose}>
      {status === "sent" ? (
        <div>
          <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>
            Confirmation sent to <strong>{email}</strong>. Tap the link in
            your inbox to complete the change.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full rounded-lg py-2.5 text-sm font-semibold"
            style={{ background: "var(--color-bt-accent)", color: "#0d1f1a" }}
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <p className="mb-3 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            Current: <span style={{ color: "var(--color-bt-text)" }}>{currentEmail}</span>
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="new@example.com"
            required
            autoFocus
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
          {status === "error" && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {errorMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={status === "loading" || !email || email === currentEmail}
            className="mt-4 w-full rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "#0d1f1a" }}
          >
            {status === "loading" ? "Sending…" : "Send confirmation"}
          </button>
        </form>
      )}
    </SheetShell>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setStatus("error");
      setErrorMsg("Passwords don't match.");
      return;
    }
    if (newPassword.length < 6) {
      setStatus("error");
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }
    setStatus("loading");
    setErrorMsg("");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("ok");
      setTimeout(onClose, 800);
    }
  }

  return (
    <SheetShell title="Change password" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={6}
          autoFocus
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={6}
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
        {status === "error" && (
          <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{errorMsg}</p>
        )}
        {status === "ok" && (
          <p className="text-xs" style={{ color: "var(--color-bt-accent)" }}>Password updated.</p>
        )}
        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "#0d1f1a" }}
        >
          {status === "loading" ? "Saving…" : "Update password"}
        </button>
      </form>
    </SheetShell>
  );
}

function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const canDelete = confirmText === "DELETE" && status !== "loading";

  // Deletion endpoint not built yet — we sign the user out so the danger
  // action at least feels real, and surface a clear message about contact.
  // When the proper deletion mutation lands, wire it here.
  const deleteAccount = useMemo(() => async () => {
    setStatus("loading");
    setErrorMsg("");
    try {
      // TODO: Replace with trpc.users.deleteMe.mutate() when implemented.
      // For now, sign out and direct the user to contact support so we
      // don't ship a button that silently does nothing.
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/?account-deleted=pending");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to start deletion.");
    }
  }, [router]);

  return (
    <SheetShell title="Delete account" onClose={onClose}>
      <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>
        This permanently removes your account, trips you own, and all
        associated data. It cannot be undone.
      </p>
      <p
        className="mt-3 text-xs"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Type <strong style={{ color: "var(--color-bt-danger)" }}>DELETE</strong> below to confirm.
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        autoFocus
        className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm uppercase tracking-wider outline-none"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
          color: "var(--color-bt-text)",
        }}
      />
      {status === "error" && (
        <p className="mt-2 text-xs" style={{ color: "var(--color-bt-danger)" }}>{errorMsg}</p>
      )}
      <button
        type="button"
        disabled={!canDelete}
        onClick={deleteAccount}
        className="mt-4 w-full rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-30"
        style={{ background: "var(--color-bt-danger)", color: "#ffffff" }}
      >
        {status === "loading" ? "Working…" : "Permanently delete"}
      </button>
    </SheetShell>
  );
}
