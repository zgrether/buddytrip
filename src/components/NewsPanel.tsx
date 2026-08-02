"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pin, Pencil, MoreHorizontal, Trash2, ChevronUp, ChevronDown, HelpCircle } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { Avatar } from "@/components/Avatar";
import { NewsBlocks } from "@/components/news/NewsBlock";
import { NewsComposer } from "@/components/news/NewsComposer";
import { NewsHelpModal } from "@/components/news/NewsHelpModal";
import type { NewsPost } from "@/lib/news";

// ── NewsPanel — the Trip Board ──────────────────────────────────────────────
//
// Owner/organizer announcement posts. Renders as a SEGMENT of `ChatView`
// (normal flow, filling whatever height the caller gives it) — the standalone
// docked-rail/bottom-sheet chrome this used to share with Chat is gone
// (#758); `ChatSheet` is the one surface that owns sizing now. PR1 was
// read-only; the composer (New post / ⋯ Edit) lands in PR2 behind
// onNewPost / onManagePost.

/** What the panel needs to render a post's author. Built on the page from
 *  tripMembers.list (same as chat's memberNames), keyed by user_id. */
export interface NewsAuthorMeta {
  name: string;
  role: "Owner" | "Organizer" | "Member";
  avatarIcon: string | null;
}

interface NewsPanelProps {
  tripId: string;
  isOpen: boolean;
  /** Owner/organizer — drives the owner empty-state variant and (PR2) compose. */
  canPost: boolean;
  /** user_id → author display info. Missing ids fall back to a neutral label. */
  authors: Record<string, NewsAuthorMeta>;
}

/**
 * Unread News count for the title-bar badge. Mounts on the trip page (via the
 * News tool button) so the badge stays live; invalidated by markRead when the
 * panel opens. No realtime in v1 — refetch-on-focus is enough for a low-churn
 * announcement surface.
 */
export function useNewsUnreadCount(tripId: string): number {
  const { data } = trpc.news.unreadCount.useQuery(
    { tripId },
    { enabled: !!tripId }
  );
  return data ?? 0;
}

export function NewsPanel({ tripId, isOpen, canPost, authors }: NewsPanelProps) {
  if (!isOpen) return null;
  return (
    <NewsPanelInner
      tripId={tripId}
      canPost={canPost}
      authors={authors}
    />
  );
}

function roleLine(role: NewsAuthorMeta["role"]): { label: string; color: string } {
  switch (role) {
    case "Owner":
      return { label: "Owner", color: "var(--color-bt-owner)" };
    case "Organizer":
      return { label: "Organizer", color: "var(--color-bt-accent)" };
    default:
      return { label: "Member", color: "var(--color-bt-text-dim)" };
  }
}

/** "2d" / "5h" / "3m" / "now" — frozen against a mount-time `now` so it can't
 *  shift mid-session (and never calls Date.now() during render). */
function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return "now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  const wks = Math.round(days / 7);
  if (wks < 5) return `${wks}w`;
  return `${Math.round(days / 30)}mo`;
}

function NewsPanelInner({
  tripId,
  canPost,
  authors,
}: Omit<NewsPanelProps, "isOpen">) {
  const utils = trpc.useUtils();
  const { data: posts = [], isLoading } = trpc.news.list.useQuery({ tripId });

  // Freeze "now" at mount so relative timestamps stay put for the session.
  const [now] = useState(() => Date.now());

  // ── Mark read on open + when new posts arrive while open ──────────────────
  const { mutate: markReadMutate } = trpc.news.markRead.useMutation({
    onSuccess: () => {
      utils.news.unreadCount.invalidate({ tripId });
    },
  });
  const lastMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading) return;
    // Newest post id (or a sentinel for the empty feed) — re-mark only when it
    // changes, so the mutation doesn't loop on every cache refresh.
    const newest = posts[0]?.id ?? "__empty__";
    if (lastMarkedRef.current === newest) return;
    lastMarkedRef.current = newest;
    markReadMutate({ tripId });
  }, [tripId, posts, isLoading, markReadMutate]);

  // ── "How posts work" help (lives next to the News title) ──────────────────
  const [helpOpen, setHelpOpen] = useState(false);
  const helpBtn = (
    <button
      type="button"
      onClick={() => setHelpOpen(true)}
      aria-label="How posts work"
      title="How posts work"
      className="inline-flex items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)] hover:text-[var(--color-bt-accent)]"
      style={{
        height: 28,
        width: 28,
        background: "transparent",
        color: "var(--color-bt-text-dim)",
      }}
    >
      <HelpCircle size={17} />
    </button>
  );

  // ── Compose state — null = viewing the feed ───────────────────────────────
  const [compose, setCompose] = useState<
    { mode: "add" } | { mode: "edit"; post: NewsPost } | null
  >(null);

  const setPinnedM = trpc.news.setPinned.useMutation({
    onSuccess: () => utils.news.list.invalidate({ tripId }),
  });
  const deleteM = trpc.news.delete.useMutation({
    onSuccess: () => {
      utils.news.list.invalidate({ tripId });
      utils.news.unreadCount.invalidate({ tripId });
    },
  });

  // The "New post" header button (owner/organizer only).
  const newPostBtn = canPost ? (
    <button
      type="button"
      onClick={() => setCompose({ mode: "add" })}
      data-testid="news-new-post"
      className="ml-auto inline-flex items-center gap-1.5 rounded-[9px]"
      style={{
        background: "var(--color-bt-accent)",
        color: "#0d1f1a",
        padding: "6px 11px",
        fontSize: 12.5,
        fontWeight: 600,
        cursor: "pointer",
        border: "none",
      }}
    >
      <Pencil size={12} /> New post
    </button>
  ) : null;

  // Embedded header (ChatView's News segment) — same actions minus the
  // title text (the segment button already reads "News") and minus the ×
  // (a segment has nothing to close; you leave by choosing another one).
  const embeddedHeader = (
    <div
      className="flex flex-shrink-0 items-center gap-2 px-3 py-2"
      style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
    >
      {helpBtn}
      {newPostBtn}
    </div>
  );

  // Composing is launched from the pinned "New post" title-bar button, which
  // stays visible while the feed scrolls.
  const feedContent = isLoading ? (
    <NewsLoading />
  ) : posts.length === 0 ? (
    <NewsEmpty canPost={canPost} />
  ) : (
    posts.map((p) => (
      <NewsPostCard
        key={p.id}
        post={p}
        author={authors[p.authorId]}
        now={now}
        canManage={canPost}
        onEdit={() => setCompose({ mode: "edit", post: p })}
        onTogglePin={() =>
          setPinnedM.mutate({ tripId, postId: p.id, pinned: !p.pinned })
        }
        onDelete={() => deleteM.mutate({ tripId, postId: p.id })}
      />
    ))
  );
  const feedScroll = <NewsFeedScroll>{feedContent}</NewsFeedScroll>;

  // Always renders this way now — normal flow, no scrim, no drag-resize, no
  // close × (a segment has nothing to close; you leave by choosing another
  // one, and the container around `ChatView` owns whatever height this gets).
  return (
    <div className="flex h-full min-h-0 flex-col">
      {compose ? (
        <NewsComposer
          tripId={tripId}
          variant="desktop"
          post={compose.mode === "edit" ? compose.post : null}
          onDone={() => setCompose(null)}
        />
      ) : (
        <>
          {embeddedHeader}
          {feedScroll}
        </>
      )}
      <NewsHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

// ── Scrollable feed + jump arrow ───────────────────────────────────────────
// Mirrors chat's jump-to-latest, but the arrow is position-aware: scrolled
// down → up-arrow to the top (newest + pinned live there); at the top →
// down-arrow to the bottom (oldest).
function NewsFeedScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  // Edge fades: shown when content is scrolled off the top / bottom so the
  // feed reads as continuing past the panel chrome rather than hard-cut.
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight > 40;
    // A few px of slack so the fade clears fully at the very top/bottom.
    setFadeTop(scrollable && el.scrollTop > 4);
    setFadeBottom(scrollable && el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    if (!scrollable) {
      setDir(null);
      return;
    }
    setDir(el.scrollTop < 40 ? "down" : "up");
  }, []);

  // Recompute on mount, content changes, and size changes (a wider rail makes
  // images taller, so scrollHeight shifts).
  useEffect(() => {
    // Measuring the scroll container is exactly the "sync from an external
    // system" case the rule whitelists; the value comes from the DOM, not state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, children]);

  const jump = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: dir === "up" ? 0 : el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        onScroll={update}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-[14px]"
        data-testid="news-feed"
      >
        {children}
      </div>
      {/* Top / bottom scroll shadows — a soft black gradient (matching the
          app's other shadows) so off-screen content reads as tucked under the
          chrome, not hard-cut. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 transition-opacity duration-200"
        style={{
          height: 24,
          opacity: fadeTop ? 1 : 0,
          background: "linear-gradient(to bottom, rgba(0,0,0,0.40), transparent)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 transition-opacity duration-200"
        style={{
          height: 24,
          opacity: fadeBottom ? 1 : 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.40), transparent)",
        }}
      />
      {dir && (
        <button
          type="button"
          onClick={jump}
          aria-label={dir === "up" ? "Scroll to top" : "Scroll to bottom"}
          className="absolute bottom-3 left-1/2 z-20 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{
            background: "var(--color-bt-card-float)",
            color: "var(--color-bt-text)",
            border: "1px solid var(--color-bt-border)",
            boxShadow: "var(--shadow-floating)",
          }}
        >
          {dir === "up" ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      )}
    </div>
  );
}

// ── Post card ────────────────────────────────────────────────────────────
function NewsPostCard({
  post,
  author,
  now,
  canManage,
  onEdit,
  onTogglePin,
  onDelete,
}: {
  post: NewsPost;
  author: NewsAuthorMeta | undefined;
  now: number;
  /** Owner/organizer (and, by construction, the author) — shows the ⋯ menu. */
  canManage: boolean;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const name = author?.name ?? "Someone";
  const role = roleLine(author?.role ?? "Member");
  return (
    <div
      className="flex-shrink-0"
      style={{
        border: "1px solid var(--color-bt-border)",
        borderRadius: 14,
        background: "var(--color-bt-card)",
        // A soft lift so posts read as separate cards rather than running into
        // each other (post bg matches the panel bg, so the border alone was too
        // subtle). On dark a plain drop-shadow is invisible, so pair a light
        // inset top-edge highlight with the drop shadow — same recipe as the
        // trip header dock.
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 20px rgba(0,0,0,0.38)",
        overflow: "hidden",
      }}
      data-testid="news-post"
    >
      <div className="flex items-center gap-[11px]" style={{ padding: "14px 16px 0" }}>
        <Avatar name={name} avatarIcon={author?.avatarIcon ?? null} sizePx={38} />
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-bt-text)" }}>{name}</div>
          <div style={{ fontSize: 11, fontWeight: 600, marginTop: 1, color: role.color }}>{role.label}</div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {post.pinned && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--color-bt-owner)",
                background: "var(--color-bt-warning-faint)",
                border: "1px solid var(--color-bt-warning-border)",
                borderRadius: 5,
                padding: "2px 6px",
              }}
            >
              <Pin size={10} /> Pinned
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--color-bt-text-dim)", fontFamily: "var(--font-mono)" }}>
            {relativeTime(post.createdAt, now)}
          </span>
          {canManage && (
            <PostMenu
              pinned={post.pinned}
              onEdit={onEdit}
              onTogglePin={onTogglePin}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>
      <div style={{ padding: "12px 16px 16px" }}>
        <NewsBlocks blocks={post.blocks} />
      </div>
    </div>
  );
}

// ── Post ⋯ menu (Edit / Pin / Delete) ──────────────────────────────────────
// The dropdown is portaled to <body> with fixed positioning so it escapes the
// post card's overflow:hidden AND the feed's scroll clipping. It flips above
// the button when there isn't room below, and closes on outside-click / Esc /
// scroll / resize (a fixed-position menu would otherwise drift from its anchor).
const POST_MENU_HEIGHT = 132; // ~3 rows — enough to decide flip direction

function PostMenu({
  pinned,
  onEdit,
  onTogglePin,
  onDelete,
}: {
  pinned: boolean;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setConfirming(false);
  }, []);

  const toggle = () => {
    if (open) return close();
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const flipUp = r.bottom + POST_MENU_HEIGHT > window.innerHeight;
    setCoords({
      top: flipUp ? r.top - POST_MENU_HEIGHT - 4 : r.bottom + 4,
      right: window.innerWidth - r.right,
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // A fixed menu can't follow the anchor — close on scroll/resize instead.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Manage post"
        onClick={toggle}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bt-hover)]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[60] overflow-hidden"
            style={{
              top: coords.top,
              right: coords.right,
              minWidth: 168,
              background: "var(--color-bt-card-float)",
              border: "1px solid var(--color-bt-border)",
              borderRadius: 10,
              boxShadow: "var(--shadow-floating)",
            }}
          >
            <MenuItem
              icon={<Pencil size={14} />}
              label="Edit"
              onClick={() => {
                close();
                onEdit();
              }}
            />
            <MenuItem
              icon={<Pin size={14} />}
              label={pinned ? "Unpin" : "Pin to top"}
              onClick={() => {
                close();
                onTogglePin();
              }}
            />
            <MenuItem
              icon={<Trash2 size={14} />}
              label={confirming ? "Tap to confirm" : "Delete"}
              danger
              onClick={() => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                close();
                onDelete();
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
      style={{
        fontSize: 13,
        fontWeight: 500,
        color: danger ? "var(--color-bt-danger)" : "var(--color-bt-text)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────
// ── Loading skeleton ───────────────────────────────────────────────────────
// Shown while the feed query is in flight so the panel reads as "loading"
// rather than a blank rectangle. Two pulsing post-card shells.
function NewsLoading() {
  const bar = (w: string, h: number) => (
    <div style={{ height: h, width: w, borderRadius: 4, background: "var(--color-bt-card-raised)" }} />
  );
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading news">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex-shrink-0 animate-pulse overflow-hidden"
          style={{
            border: "1px solid var(--color-bt-border)",
            borderRadius: 14,
            background: "var(--color-bt-card)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 20px rgba(0,0,0,0.38)",
          }}
        >
          <div className="flex items-center gap-[11px]" style={{ padding: "14px 16px 0" }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--color-bt-card-raised)" }} />
            <div className="flex flex-1 flex-col gap-1.5">
              {bar("40%", 10)}
              {bar("24%", 8)}
            </div>
          </div>
          <div className="flex flex-col gap-2" style={{ padding: "14px 16px 16px" }}>
            {bar("92%", 9)}
            {bar("70%", 9)}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewsEmpty({ canPost }: { canPost: boolean }) {
  return (
    <div className="flex items-center justify-center text-center" style={{ padding: "40px 8px" }}>
      <div className="flex max-w-[320px] flex-col items-center gap-[13px]">
        <span
          className="inline-flex items-center justify-center"
          style={{
            width: 56,
            height: 56,
            borderRadius: 15,
            background: canPost ? "var(--color-bt-accent-faint)" : "rgba(148,163,184,0.06)",
            border: `1px solid ${canPost ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
          }}
        >
          <Pin size={24} style={{ color: canPost ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }} />
        </span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)" }}>Nothing posted yet</div>
          <p style={{ margin: "7px 0 0", fontSize: 13, lineHeight: 1.45, color: "var(--color-bt-text-dim)", textWrap: "pretty" }}>
            {canPost
              ? "Post the first update — a welcome, the team draw, the schedule. It lands here for the whole crew, newest first."
              : "When the owner or an organizer posts an update, it shows up here. Nothing to do but wait."}
          </p>
        </div>
      </div>
    </div>
  );
}
