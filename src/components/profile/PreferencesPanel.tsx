"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ChevronRight, ArrowLeft } from "lucide-react";
import {
  IconUser,
  IconMail,
  IconLock,
  IconArchive,
  IconTrash,
  IconBell,
} from "@tabler/icons-react";
import { trpc } from "@/lib/trpc-client";
import { createClient } from "@/lib/supabase";
import {
  isDeleteConfirmed,
  normalizeDeleteConfirmationInput,
} from "@/lib/accountDeletionConfirm";
import { useNotificationPreference } from "@/lib/useNotificationPreference";
import {
  NOTIFICATION_TYPES,
  resolvePrefs,
  type NotificationKey,
} from "@/lib/notificationTypes";
import { notificationsRowSummary } from "@/lib/devicePushState";
import { NotificationsSheetBody } from "@/components/profile/NotificationsSheetBody";
import { useDevicePush } from "@/lib/useDevicePush";
import { Checkbox } from "@/components/games/Checkbox";
import { ScrollLock } from "@/hooks/useScrollLock";
import { useAuthUser } from "@/lib/auth-context";
import { Avatar } from "@/components/Avatar";
import { SettingsSlideOver } from "@/components/games/SettingsSlideOver";
import { useModalBackButton } from "@/hooks/useModalBackButton";

// Lazy-loaded — both panels are heavy (AvatarIconPicker statically
// references all 96 Tabler icons via AVATAR_ICON_COMPONENTS; the
// archived-ideas panel pulls its own tRPC query and list UI). Splitting
// them into their own chunks keeps the panel's own chunk small so it paints
// as soon as it opens. Each ships a tiny skeleton placeholder so the layout
// doesn't reflow when the chunk lands. This matters MORE as an overlay than
// it did as a route: there is no navigation to hide the load behind, so the
// panel is expected on screen the instant the menu item is tapped —
// `UserMenu` warms this chunk when the dropdown opens for the same reason.
const AvatarIconPicker = dynamic(
  () =>
    import("@/components/AvatarIconPicker").then((m) => ({
      default: m.AvatarIconPicker,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className="rounded-xl"
        style={{
          background: "var(--color-bt-card)",
          border: "0.5px solid var(--color-bt-border)",
          height: 244,
        }}
        aria-hidden
      />
    ),
  },
);

const ArchivedIdeasPanel = dynamic(
  () =>
    import("@/components/profile/ArchivedIdeasPanel").then((m) => ({
      default: m.ArchivedIdeasPanel,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex justify-center py-12">
        <div
          className="h-5 w-5 animate-spin rounded-full border-2"
          style={{
            borderColor: "var(--color-bt-accent)",
            borderTopColor: "transparent",
          }}
        />
      </div>
    ),
  },
);

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

/** Which screen the panel is showing. The idea archive was its own ROUTE
 *  (`/profile/archived-ideas`) reached by a `router.push`; inside an overlay it
 *  is a second view of the same panel, so it needs no URL. */
type PanelView = "settings" | "ideas";

// ── Panel ─────────────────────────────────────────────────────────────────

/**
 * PreferencesPanel — account settings as an OVERLAY.
 *
 * ── Why this stopped being a route ───────────────────────────────────────────
 * It was `/profile`, the last surface in the app that still navigated: trip
 * settings, game settings, chat and the danger confirmations are all overlays.
 * It survived the navigation refactor the same way `TripSwitcher` did — nobody
 * re-homed it. Nothing about it ever needed a URL: no deep link pointed at it,
 * no form required one, no OAuth flow returned to it (auth callbacks resolve to
 * `/dashboard`, `/trips/new`, `/login` or `/`), and the name / email / password /
 * delete flows were ALREADY overlays (`SheetShell`) nested inside the page.
 *
 * ── The shell is reused, not rebuilt ─────────────────────────────────────────
 * `SettingsSlideOver` — full-page on mobile, 440px right drawer at sm+, portaled
 * to body, scroll-locked. Its own doc calls it "the crew/lodging trip-settings
 * idiom", and issue #647 tracks migrating more surfaces onto it, so this is the
 * codebase's stated direction rather than a new pattern. No footer: game settings
 * are draft-then-save and need a save bar, account rows self-persist and have
 * nothing to commit.
 *
 * `useModalBackButton` gives it back-button dismissal, the same hook
 * `TripSettingsModal` uses — an overlay that ignores back would be worse than the
 * route it replaced, which at least popped.
 *
 * NO new dismiss implementation: scrim tap comes from the shell, back from the
 * hook. The seven hand-rolled `mousedown`-outside copies (#877) stay seven —
 * `UserMenu`, which opens this, was already one of them.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────────
 * Sign out. It lived here AND in the avatar dropdown AND in this page's old
 * desktop sidebar — three entry points to one action. It is a single tap with no
 * structure, so it belongs in the dropdown and only there. Delete account is the
 * mirror of that argument: it keeps its danger-zone home below and is reachable
 * ONLY from here, because it should not be one tap from an avatar.
 */
export function PreferencesPanel({ onClose }: { onClose: () => void }) {
  const authUser = useAuthUser();
  const utils = trpc.useUtils();

  // No `enabled` gate and no auth bounce: the panel only mounts from the avatar
  // menu, which only renders for a signed-in user. The route needed both because
  // it could be navigated to cold.
  const { data: me } = trpc.users.getMe.useQuery();

  // ── View state ────────────────────────────────────────────────────────
  // Replaces the desktop-only sidebar tabs AND the mobile `/profile/archived-ideas`
  // route with one thing. The old page had both: tabs that swapped the main area
  // at md+, and a separate route for the same content on mobile.
  const [view, setView] = useState<PanelView>("settings");

  // ── Back button ───────────────────────────────────────────────────────
  // TWO layers, not one, because the archive used to be its own ROUTE: back from
  // it returned to `/profile`, and collapsing both into a single handler would
  // have made back from the archive dismiss the whole panel — strictly worse
  // than the route it replaced. `useModalBackButton` is already stack-aware
  // (only the top layer answers a pop; a layer's own teardown pops its own
  // phantom and marks it programmatic), so the second call with `enabled` is the
  // hook's documented pattern, not a new mechanism.
  //
  // Do NOT collapse these into `useModalBackButton(view === "ideas" ? backToSettings : onClose)`.
  // The hook pushes ONE phantom entry per enabled mount and only re-runs on
  // `enabled`; a handler that returns without unmounting consumes that entry and
  // leaves the panel open holding nothing, so the NEXT back navigates off the
  // page instead of closing it.
  useModalBackButton(onClose);
  useModalBackButton(() => setView("settings"), view === "ideas");

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

  // ── Edit sheet state ──────────────────────────────────────────────────
  const [openSheet, setOpenSheet] = useState<
    null | "name" | "email" | "password" | "delete" | "notifications"
  >(null);

  // ── OAuth detection ───────────────────────────────────────────────────
  const isGoogleUser = authUser?.app_metadata?.provider === "google";

  const dataReady = !!me;
  const displayName = me?.name ?? me?.email ?? "You";

  return (
    <SettingsSlideOver
      title={view === "ideas" ? "Idea archive" : "Settings"}
      onClose={onClose}
      testId="preferences-panel"
    >
      {/* The archive is a SECOND VIEW of this panel, not a route. Its own back
          arrow returns to the settings list; the panel's ✕ / scrim / browser-back
          still close the whole thing. */}
      {view === "ideas" ? (
        <div>
          <button
            type="button"
            onClick={() => setView("settings")}
            className="mb-3 flex items-center gap-1.5 text-xs transition-colors hover:opacity-80"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="preferences-archive-back"
          >
            <ArrowLeft size={14} /> Settings
          </button>
          <ArchivedIdeasPanel />
        </div>
      ) : (
        // `-mx-4` cancels the shell body's own `px-4`, because every `Section`
        // already supplies that padding — without it the rows inset twice and
        // stop lining up with the header. One stacked column at every width: the
        // old page split this between a desktop sidebar (tabs swapping a main
        // area) and a mobile stack, and a 440px drawer has room for neither.
        <div className="-mx-4">
            {!dataReady ? (
              // Body-only loading state — the shell's header has already
              // rendered, so the panel reads as open while users.getMe finishes.
              <div className="flex justify-center py-16">
                <div
                  className="h-6 w-6 animate-spin rounded-full border-2"
                  style={{
                    borderColor: "var(--color-bt-accent)",
                    borderTopColor: "transparent",
                  }}
                />
              </div>
            ) : (
            <>
            <div>
                <AvatarHero
                  name={displayName}
                  email={me.email}
                  avatarIcon={me.avatar_icon}
                />

                <Section label="Avatar icon">
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

            {/* Was `block md:hidden`, which hid the whole card on desktop. That
                was tolerable while it held only device-scoped controls, and
                stopped being tolerable when it gained a CATEGORY preference:
                muting a category is stored on the USER and applies to every
                device, so a desktop-only user could not reach a setting that
                governs their phone. The device rows come along, which is
                correct — desktop browsers support push, and the row reports its
                real state on any of them. */}
            <div>
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
                    onClick={() => setView("ideas")}
                  />
                  <NotificationSettings onOpen={() => setOpenSheet("notifications")} />
                </div>
              </Section>

              {/* NO sign-out card. It was here, in the avatar dropdown, AND in
                  this page's desktop sidebar — three routes to one action. It is
                  a single tap with no structure, so the dropdown is its home and
                  its only one. Delete account, below, is the mirror: it stays
                  here and nowhere else, because it should not be one tap from an
                  avatar. */}

              {/* Danger zone */}
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
            </>
            )}
        </div>
      )}

      {/* ── Sheets ─────────────────────────────────────────────────────────
          Unchanged: these were already overlays nested inside the page, so
          they nest inside the panel exactly as they did. Each portals/fixes to
          the viewport at z-50, above the slide-over's own body. */}
      {me && openSheet === "name" && (
        <NameSheet currentName={me.name ?? ""} onClose={() => setOpenSheet(null)} />
      )}
      {me && openSheet === "email" && (
        <EmailSheet currentEmail={me.email ?? ""} onClose={() => setOpenSheet(null)} />
      )}
      {openSheet === "password" && (
        <PasswordSheet onClose={() => setOpenSheet(null)} />
      )}
      {openSheet === "delete" && (
        <DeleteAccountSheet onClose={() => setOpenSheet(null)} />
      )}
      {openSheet === "notifications" && (
        <NotificationsSheet onClose={() => setOpenSheet(null)} />
      )}
    </SettingsSlideOver>
  );
}

// ── Layout primitives ─────────────────────────────────────────────────────

/**
 * A labelled block of rows.
 *
 * The `mobileOnly` / `mobileOnlyLabel` props are GONE, and their removal is the
 * point rather than a tidy-up. They existed because the route had two layouts —
 * a stacked mobile page and a sidebar-plus-main desktop one — so a `md:hidden`
 * meant "the desktop layout shows this another way". The panel is a 440px column
 * at every viewport, so `md:` no longer describes the panel; it describes the
 * SCREEN BEHIND the panel. Left in place, `mobileOnlyLabel` on the avatar-icon
 * section would have hidden that label on a desktop browser while showing it on
 * a phone — at identical rendered widths.
 */
function Section({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pb-3">
      {label && <p style={SECTION_LABEL_STYLE}>{label}</p>}
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
  const borderStyle: React.CSSProperties = {
    borderBottom: lastRow ? undefined : "0.5px solid var(--color-bt-border)",
  };
  const iconBlock = (
    <span
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
      style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
    >
      {icon}
    </span>
  );
  const textBlock = (
    <div className="min-w-0 flex-1">
      <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>{label}</p>
      {sub && (
        <p className="mt-0.5 truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          {sub}
        </p>
      )}
    </div>
  );

  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        interactive ? "hover:bg-[var(--color-bt-hover)]" : ""
      }`}
      style={borderStyle}
    >
      {iconBlock}
      {textBlock}
      {right ?? (interactive ? (
        <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
      ) : null)}
    </Tag>
  );
}

// ── Notification settings — the ONE location ───────────────────────────────
//
// A ROW THAT OPENS A MODAL, matching name / email / password. This replaces a
// row with TWO tap targets doing unrelated things: tapping the row toggled the
// device on and off, while a small chevron beside it revealed the categories.
//
// That failed in the way that mattered most. Nobody taps a chevron, so nobody
// found the categories — and the discoverable target was the DESTRUCTIVE one.
// The two actions were not even related: a chevron means "more of the same
// thing", and here it meant "the actual settings" while the row itself was a
// master switch.
//
// It also defeated the reason the category row was required to ship alongside
// the chat sender in the first place (#1054). Someone opens preferences to turn
// chat off, finds no such control, concludes it does not exist, and mutes
// BuddyTrip at the OS level — the exact outcome this subsystem exists to
// prevent, produced by the shape of the control rather than by any missing
// feature.
//
// The row now shows its STATE (`notificationsRowSummary`) so it can be read
// without opening it, and everything that can be changed lives in the modal.
function NotificationSettings({ onOpen }: { onOpen: () => void }) {
  const device = useDevicePush();
  const prefs = trpc.notifications.getPreferences.useQuery(undefined, { staleTime: 60_000 });

  // Only categories that can actually fire, resolved through the registry
  // defaults so the summary is right in the ~200ms before prefs land rather
  // than reading "every category is muted" and then correcting itself.
  const resolved = resolvePrefs(prefs.data ?? null);
  const activeLabels = EXPOSED_CATEGORIES.filter((k) => resolved[k]).map(
    (k) => NOTIFICATION_TYPES.find((t) => t.key === k)?.shortLabel ?? k
  );

  return (
    <SettingsRow
      icon={<IconBell size={16} stroke={1.75} />}
      label="Notifications"
      sub={device.settling ? "Checking…" : notificationsRowSummary(device.state, activeLabels)}
      // ALWAYS opens the modal — including when blocked or unsupported, which is
      // deliberate. Those two states are the ones a person most needs explained,
      // and a row that refuses to open leaves them with a dead control and no
      // account of why. The modal explains; it just has nothing to toggle.
      onClick={onOpen}
      lastRow
    />
  );
}


/**
 * The categories that have a live sender, in registry order.
 *
 * Deliberately NOT `NOTIFICATION_KEYS` — the registry defines four and only two
 * can currently produce a notification. Rendering the other two (`planning`,
 * `invites`) would put switches on screen that mute nothing.
 *
 * `chat` LANDED IN THE SAME COMMIT AS ITS SENDER, and that ordering is the rule
 * rather than a coincidence. Every category defaults ON — the device toggle is
 * the consent gate, and the list that appears at that moment is a menu of what
 * to MUTE. So a sender wired while its category is unexposed does not mean "on
 * by default and easy to find"; it means every subscribed user receives it with
 * no way to stop short of revoking notifications at the OS level. That is the
 * outcome this whole subsystem is built to avoid, and it is reachable by
 * shipping two correct commits in the wrong order. A sender and its row go
 * together.
 */
const EXPOSED_CATEGORIES: NotificationKey[] = ["game_results", "chat"];

/**
 * One category row, inside the notifications modal beneath the activation
 * control. It used to sit indented inside a `Collapse` hanging off the settings
 * row; both the indent and the collapse are gone with the row's second tap
 * target.
 *
 * A top hairline separates each category from the activation control and from
 * each other. In the old shape it deliberately had NO border, because the row
 * above already drew one and the pair doubled the hairline — inside the modal
 * there is no such row, so it draws its own.
 *
 * Uses `Checkbox` — the app's boolean control, extracted precisely so surfaces
 * stop inventing their own. There is no switch/pill primitive in this codebase
 * (nothing renders `role="switch"`), so building one here would be the
 * divergence this project has spent weeks removing.
 */
function NotificationCategoryRow({ categoryKey }: { categoryKey: NotificationKey }) {
  const { enabled, loading, toggle } = useNotificationPreference(categoryKey);
  const def = NOTIFICATION_TYPES.find((t) => t.key === categoryKey);

  return (
    <div className="flex w-full items-start gap-3 py-3" style={{ borderTop: "0.5px solid var(--color-bt-border)" }}>
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 14, color: "var(--color-bt-text)" }}>
          {/* The user-facing LABEL, never the key. "Competition & game alerts",
              not "game_results" — the old name read as "every score entered",
              which is the one thing this category must never send. */}
          {def?.label ?? categoryKey}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-bt-text-dim)", marginTop: 2 }}>
          {def?.description ?? ""}
        </div>
      </div>
      <Checkbox
        on={enabled}
        onClick={toggle}
        disabled={loading}
        label={`${def?.label ?? categoryKey} notifications`}
        className="mt-0.5"
      />
    </div>
  );
}

/**
 * NotificationsSheet — the activation control, and the categories beneath it.
 *
 * ── Why a parent control rather than deriving activation from the boxes ─────
 * The simpler design was no parent at all: check a category and it turns
 * notifications on. It cannot work. Push needs an OS permission prompt, the
 * prompt needs a user gesture, and it can be refused PERMANENTLY — so the first
 * check fires a prompt, the person taps Block, and what is left is a checked box
 * with nothing behind it. A control asserting a state it does not have is worse
 * than an absent one.
 *
 * The parent is also where the two non-control states live. `blocked` and
 * `unsupported` are EXPLANATIONS, not switches; without a parent element there
 * is nowhere to put them, which is how "why do I get nothing?" became
 * unanswerable in the previous shape.
 *
 * ── Checkbox, not a switch ──────────────────────────────────────────────────
 * Including for the parent, which reads like a master switch. There is no
 * switch/pill primitive in this codebase — nothing renders `role="switch"` —
 * and inventing one here for a single control is the divergence this project
 * has spent weeks removing. `Checkbox` is the app's boolean control.
 *
 * ── The categories are for turning things OFF ───────────────────────────────
 * Both default ON (NOTIFICATIONS.md: a category defaulting off means someone
 * enables notifications and receives nothing, which reads as broken). So this
 * opens with everything checked, and the copy says so — this is where you come
 * to STOP getting something, not to start.
 */
function NotificationsSheet({ onClose }: { onClose: () => void }) {
  const device = useDevicePush();

  return (
    <SheetShell title="Notifications" onClose={onClose}>
      <NotificationsSheetBody
        state={device.state}
        settling={device.settling}
        busy={device.busy}
        onToggleActivation={device.toggle}
        sectionLabelStyle={SECTION_LABEL_STYLE}
        categorySlot={EXPOSED_CATEGORIES.map((key) => (
          <NotificationCategoryRow key={key} categoryKey={key} />
        ))}
      />
    </SheetShell>
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
  // ONE centered column, at every width. There were two variants — this one and
  // a left-aligned `md:flex` row for the old page's wide main column. The row
  // has nowhere to be now: the panel is 440px whether the viewport is a phone or
  // a 27" monitor, so the `md:` variant would have swapped the layout based on
  // the size of the screen BEHIND the drawer. Same reasoning as `Section`'s
  // removed `mobileOnly*` props.
  return (
    <div className="flex flex-col items-center px-4 pb-4 pt-2">
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
      {/* The "icon stays / background becomes team color" explainer lives inside
          the Competition preview below, with the visual it explains. */}
    </div>
  );
}


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
    <ScrollLock>
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
    </ScrollLock>
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
  // `isBlocked` is folded in below (defined after the query) — the button is
  // disabled for a blocked account, but that is presentation only: the server
  // refuses regardless (#957 §4.3, a disabled button is not the fix).
  //
  // Regression fix: the field displays uppercase via CSS only (`uppercase`
  // class below) — that never touched the stored value, so a lowercase type-out
  // (the mobile-keyboard default) rendered as "DELETE" but compared false
  // forever. `normalizeDeleteConfirmationInput` keeps the stored value in sync
  // with what's on screen; `isDeleteConfirmed` also trims a trailing space.
  // See src/lib/accountDeletionConfirm.ts.
  const canType = isDeleteConfirmed(confirmText) && status !== "loading";

  // Permanently delete the account: server deletes the auth user (cascading /
  // anonymizing their rows per migrations 025+027), then we sign out locally
  // and land on the marketing page.
  const deleteMe = trpc.users.deleteMe.useMutation();
  // #957 — state the blocker BEFORE the button rather than after a failed
  // press. The server re-checks in `deleteMe` and is the authority; this is
  // the courtesy on top of it, so a stale/absent read can never let a delete
  // through that the server would refuse.
  const { data: blockerInfo } = trpc.users.deletionBlockers.useQuery();
  const blockedBy = blockerInfo?.blockers ?? [];
  const isBlocked = blockedBy.length > 0;
  const canDelete = canType && !isBlocked;

  const deleteAccount = async () => {
    setStatus("loading");
    setErrorMsg("");
    try {
      await deleteMe.mutateAsync();
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/?account-deleted=1");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to delete account.");
    }
  };

  return (
    <SheetShell title="Delete account" onClose={onClose}>
      {/* The old copy claimed this removed "trips you own", which was never
          true — trips SURVIVE the account (that is #957's whole bug). Saying so
          accurately matters most on the screen where someone is deciding. */}
      <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>
        This permanently removes your account and your personal data. It cannot
        be undone.
      </p>

      {isBlocked && (
        <div
          data-testid="delete-account-blocked"
          className="mt-3 rounded-lg p-3"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-danger)",
          }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--color-bt-danger)" }}>
            You can&rsquo;t delete your account yet
          </p>
          <p className="mt-1.5 text-xs" style={{ color: "var(--color-bt-text)" }}>
            {blockerInfo?.message}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {blockedBy.map((b) => (
              <li key={b.tripId} className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                <span style={{ color: "var(--color-bt-text)" }}>{b.title}</span>
                {" — "}
                {b.hasTransferTarget
                  ? "transfer ownership to another member"
                  : "no one eligible to take it over; delete the trip instead"}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p
        className="mt-3 text-xs"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Type <strong style={{ color: "var(--color-bt-danger)" }}>DELETE</strong> below to confirm.
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(normalizeDeleteConfirmationInput(e.target.value))}
        autoFocus
        // The `uppercase` class below is COSMETIC ONLY — it paints the text
        // uppercase but does not touch `value`. `normalizeDeleteConfirmationInput`
        // above is what's authoritative: it keeps `confirmText` itself uppercase,
        // which is what `isDeleteConfirmed` compares. This class used to be the
        // ONLY uppercasing, which was the bug — don't drop the JS normalization
        // and lean on this class alone again.
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
