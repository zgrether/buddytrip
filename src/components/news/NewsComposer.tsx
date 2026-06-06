"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Pin,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Type,
  Image as ImageIcon,
  ListOrdered,
  Users,
  Trophy,
  RefreshCw,
  Heading,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { Avatar } from "@/components/Avatar";
import { NewsBlocks, Mention } from "@/components/news/NewsBlock";
import { RichTextEditor } from "@/components/news/RichTextEditor";
import type { NewsBlock, NewsBlockType, NewsPerson, NewsPost } from "@/lib/news";

// ── NewsComposer ────────────────────────────────────────────────────────────
//
// New-post / edit-post composer, rendered inside the News rail (NewsPanel
// swaps it in for the feed). Returns a fragment — header + scrollable body +
// footer — placed directly in the rail's flex-col so the header/footer pin and
// the body scrolls.
//
// The six block editors, drag-to-reorder, pin, create/edit/delete. @Crew pulls
// from the trip roster; Teams pulls the draw from Competition. The inline-@
// mentions inside Text paragraphs and the bold/italic/list/link toolbar are a
// later pass (they need a rich-text editor); a plain textarea backs Text here.

// Block types the composer can ADD, in catalog order.
const ADDABLE: { type: NewsBlockType; label: string; icon: LucideIcon }[] = [
  { type: "heading", label: "Heading", icon: Heading },
  { type: "text", label: "Text", icon: Type },
  { type: "crew", label: "@Crew", icon: Users },
  { type: "teams", label: "Teams", icon: Trophy },
  { type: "media", label: "Media", icon: ImageIcon },
  { type: "steps", label: "Steps", icon: ListOrdered },
  { type: "callout", label: "Callout", icon: Pin },
];

function blankBlock(type: NewsBlockType): NewsBlock {
  switch (type) {
    case "heading":
      return { type: "heading", text: "" };
    case "text":
      return { type: "text", text: "" };
    case "crew":
      return { type: "crew", label: "", people: [] };
    case "teams":
      return { type: "teams", teams: [] };
    case "media":
      return { type: "media", kind: "video", src: "", title: "", meta: "" };
    case "steps":
      return { type: "steps", steps: [{ label: "", body: "" }] };
    case "callout":
      return { type: "callout", text: "" };
    default:
      return { type: "text", text: "" };
  }
}

/** Drop blocks the user left empty so we don't post hollow paragraphs/callouts.
 *  crew/teams/media are kept as-is (media may legitimately be just a link). */
function cleanBlocks(blocks: NewsBlock[]): NewsBlock[] {
  const out: NewsBlock[] = [];
  for (const b of blocks) {
    if (b.type === "heading") {
      if (b.text.trim().length > 0) out.push({ type: "heading", text: b.text.trim() });
    } else if (b.type === "text") {
      const hasText = (b.text ?? "").trim().length > 0;
      const hasSegments = (b.segments?.length ?? 0) > 0;
      if (hasText || hasSegments) out.push({ ...b, text: b.text?.trim() });
    } else if (b.type === "callout") {
      if (b.text.trim().length > 0) out.push({ ...b, text: b.text.trim() });
    } else if (b.type === "steps") {
      const steps = b.steps
        .map((s) => ({ label: s.label.trim(), body: s.body.trim() }))
        .filter((s) => s.label || s.body);
      if (steps.length > 0) out.push({ type: "steps", steps });
    } else if (b.type === "media") {
      // Keep a video block only if it has a link; keep photo blocks as-is.
      if (b.kind === "photo" || (b.src ?? "").trim().length > 0) {
        out.push({ ...b, src: b.src?.trim() });
      }
    } else if (b.type === "crew") {
      if (b.people.length > 0) out.push(b);
    } else if (b.type === "teams") {
      if (b.teams.length > 0) out.push(b);
    } else {
      out.push(b);
    }
  }
  return out;
}

interface NewsComposerProps {
  tripId: string;
  variant: "desktop" | "mobile";
  /** Editing an existing post, or null for a new post. */
  post: NewsPost | null;
  /** Return to the feed (Cancel / X / after a successful save). */
  onDone: () => void;
}

export function NewsComposer({ tripId, variant, post, onDone }: NewsComposerProps) {
  const editing = post !== null;
  const utils = trpc.useUtils();

  const [blocks, setBlocks] = useState<NewsBlock[]>(
    () => post?.blocks ?? [{ type: "text", text: "" }]
  );
  const [pinned, setPinned] = useState<boolean>(post?.pinned ?? false);
  const [view, setView] = useState<"edit" | "preview">("edit");

  const refresh = () => {
    utils.news.list.invalidate({ tripId });
    utils.news.unreadCount.invalidate({ tripId });
  };

  const create = trpc.news.create.useMutation({ onSuccess: () => { refresh(); onDone(); } });
  const update = trpc.news.update.useMutation({ onSuccess: () => { refresh(); onDone(); } });
  const del = trpc.news.delete.useMutation({ onSuccess: () => { refresh(); onDone(); } });

  const pending = create.isPending || update.isPending || del.isPending;
  const cleaned = cleanBlocks(blocks);
  const canSubmit = cleaned.length > 0 && !pending;

  const setBlock = (i: number, next: NewsBlock) =>
    setBlocks((bs) => bs.map((b, j) => (j === i ? next : b)));
  const removeBlock = (i: number) => setBlocks((bs) => bs.filter((_, j) => j !== i));
  const moveBlock = (i: number, dir: -1 | 1) =>
    setBlocks((bs) => {
      const j = i + dir;
      if (j < 0 || j >= bs.length) return bs;
      const copy = bs.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const addBlock = (type: NewsBlockType) => setBlocks((bs) => [...bs, blankBlock(type)]);

  // Drag-to-reorder (desktop, via the grip). Up/down arrows stay as the
  // touch/keyboard fallback.
  //
  // `ins` is the insertion slot in the *original* array (0..length) — the gap
  // the block should land in. Agenda-style: the indicator only appears once the
  // cursor crosses the midpoint of a NEIGHBOURING block, and never on the
  // dragged block's own two adjacent slots (which would be a no-op).
  const [dragState, setDragState] = useState<{ from: number; ins: number | null } | null>(null);

  const reorderTo = (from: number, ins: number) =>
    setBlocks((bs) => {
      if (from < 0 || from >= bs.length) return bs;
      if (ins === from || ins === from + 1) return bs; // own slot — no-op
      const copy = bs.slice();
      const [moved] = copy.splice(from, 1);
      const target = Math.max(0, Math.min(copy.length, ins > from ? ins - 1 : ins));
      copy.splice(target, 0, moved);
      return copy;
    });

  const onBlockDragOver = (i: number, clientY: number, rect: DOMRect) =>
    setDragState((s) => {
      if (!s) return s;
      const isTop = clientY < rect.top + rect.height / 2;
      let ins: number | null = isTop ? i : i + 1;
      // The two slots touching the dragged block are no-ops — hide the line so
      // it can't bounce between them while you wiggle over your own tile.
      if (ins === s.from || ins === s.from + 1) ins = null;
      return s.ins === ins ? s : { ...s, ins };
    });

  const onBlockDrop = () => {
    if (dragState && dragState.ins != null) reorderTo(dragState.from, dragState.ins);
    setDragState(null);
  };

  const submit = () => {
    if (!canSubmit) return;
    if (editing && post) {
      update.mutate({ tripId, postId: post.id, blocks: cleaned, pinned });
    } else {
      create.mutate({ tripId, blocks: cleaned, pinned });
    }
  };

  const px = variant === "mobile" ? "px-4" : "px-3";

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        className={`flex flex-shrink-0 items-center gap-2 ${px} py-2`}
        style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
      >
        <span
          className="inline-flex items-center gap-2"
          style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)" }}
        >
          <Pin size={16} style={{ color: "var(--color-bt-accent)" }} />
          {editing ? "Edit post" : "New post"}
        </span>
        <button
          type="button"
          onClick={onDone}
          aria-label="Cancel"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Edit / Preview toggle ──────────────────────────────────────── */}
      <div className={`flex flex-shrink-0 gap-1 ${px} pt-2.5`}>
        {(["edit", "preview"] as const).map((v) => {
          const on = view === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 600,
                textTransform: "capitalize",
                cursor: "pointer",
                color: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                background: on ? "var(--color-bt-accent-faint)" : "transparent",
                border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
              }}
            >
              {v}
            </button>
          );
        })}
      </div>

      {/* ── Preview: the post rendered as the crew will see it ─────────── */}
      {view === "preview" ? (
        <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${px} py-3`}>
          {cleaned.length === 0 ? (
            <p
              className="text-center"
              style={{ margin: "32px 0", fontSize: 13, color: "var(--color-bt-text-dim)" }}
            >
              Nothing to preview yet — add a block.
            </p>
          ) : (
            <div
              style={{
                border: "1px solid var(--color-bt-border)",
                borderRadius: 14,
                background: "var(--color-bt-card)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 20px rgba(0,0,0,0.38)",
                padding: "14px 16px 16px",
              }}
            >
              {pinned && (
                <span
                  className="mb-3 inline-flex items-center gap-1"
                  style={{
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
              <NewsBlocks blocks={cleaned} />
            </div>
          )}
        </div>
      ) : (
      /* ── Body: block editor stack + add-a-block ─────────────────────── */
      <div className={`flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto ${px} py-3`}>
        {blocks.map((b, i) => (
          <BlockEditor
            key={i}
            tripId={tripId}
            block={b}
            index={i}
            count={blocks.length}
            onChange={(next) => setBlock(i, next)}
            onRemove={() => removeBlock(i)}
            onMove={(dir) => moveBlock(i, dir)}
            dragging={dragState?.from === i}
            dropIndicator={
              dragState?.ins === i
                ? "top"
                : i === blocks.length - 1 && dragState?.ins === blocks.length
                  ? "bottom"
                  : null
            }
            onDragStartBlock={() => setDragState({ from: i, ins: null })}
            onDragOverBlock={(clientY, rect) => onBlockDragOver(i, clientY, rect)}
            onDropBlock={onBlockDrop}
            onDragEndBlock={() => setDragState(null)}
          />
        ))}

        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-bt-text-dim)",
              marginBottom: 8,
            }}
          >
            Add a block
          </div>
          {/* Wrap to multiple lines on every width — no horizontal swipe. */}
          <div className="flex flex-wrap gap-1.5">
            {ADDABLE.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => addBlock(type)}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-[9px] transition-colors hover:bg-[var(--color-bt-accent-faint)]"
                style={{
                  padding: "8px 11px",
                  border: "1px dashed var(--color-bt-border)",
                  background: "transparent",
                  color: "var(--color-bt-text)",
                  fontSize: 12.5,
                  fontWeight: 500,
                }}
              >
                <Icon
                  size={14}
                  style={type === "callout" ? { color: "var(--color-bt-warning)" } : undefined}
                />{" "}
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div
        className={`flex flex-shrink-0 items-center gap-2 ${px} py-2.5`}
        style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
      >
        {editing ? (
          <button
            type="button"
            onClick={() => post && del.mutate({ tripId, postId: post.id })}
            disabled={pending}
            className="inline-flex items-center gap-1.5 disabled:opacity-40"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-bt-danger)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPinned((p) => !p)}
            aria-pressed={pinned}
            className="inline-flex items-center gap-1.5"
            style={{
              background: "transparent",
              border: "none",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              color: pinned ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            }}
          >
            <Pin size={13} style={{ color: pinned ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }} />
            {pinned ? "Pinned to top" : "Pin to top"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onDone}
            disabled={pending}
            style={{
              background: "transparent",
              border: "1px solid var(--color-bt-border)",
              color: "var(--color-bt-text-dim)",
              borderRadius: 9,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="news-composer-submit"
            style={{
              background: "var(--color-bt-accent)",
              color: "#0d1f1a",
              border: "none",
              borderRadius: 9,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.4,
            }}
          >
            {pending ? "Saving…" : editing ? "Save changes" : "Post"}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Block editor shell ──────────────────────────────────────────────────────
function BlockEditor({
  tripId,
  block,
  index,
  count,
  onChange,
  onRemove,
  onMove,
  dragging,
  dropIndicator,
  onDragStartBlock,
  onDragOverBlock,
  onDropBlock,
  onDragEndBlock,
}: {
  tripId: string;
  block: NewsBlock;
  index: number;
  count: number;
  onChange: (b: NewsBlock) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  /** This block is the one currently being dragged (dim it). */
  dragging: boolean;
  /** Where the insertion line sits relative to this block, if at all. */
  dropIndicator: "top" | "bottom" | null;
  onDragStartBlock: () => void;
  onDragOverBlock: (clientY: number, rect: DOMRect) => void;
  onDropBlock: () => void;
  onDragEndBlock: () => void;
}) {
  // Drag is armed only while the grip is held, so dragging the block never
  // hijacks text selection inside its inputs.
  const [armed, setArmed] = useState(false);

  const kindLabel: Record<NewsBlockType, string> = {
    heading: "Heading",
    text: "Text",
    crew: "@Crew · from the roster",
    teams: "Teams · from Competition",
    media: "Media",
    steps: "Steps",
    callout: "Callout",
  };
  const kindIcon: Record<NewsBlockType, LucideIcon> = {
    heading: Heading,
    text: Type,
    crew: Users,
    teams: Trophy,
    media: ImageIcon,
    steps: ListOrdered,
    callout: Pin,
  };
  const Icon = kindIcon[block.type];
  // Callout is the amber "panel" block — color its kind label amber so the
  // block self-identifies instead of the label literally reading "(amber)".
  const isCallout = block.type === "callout";
  const kindColor = isCallout ? "var(--color-bt-warning)" : "var(--color-bt-accent)";

  return (
    <div
      className="flex-shrink-0"
      draggable={armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStartBlock();
      }}
      onDragEnd={() => {
        setArmed(false);
        onDragEndBlock();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverBlock(e.clientY, e.currentTarget.getBoundingClientRect());
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropBlock();
      }}
      style={{
        position: "relative",
        border: "1px solid var(--color-bt-border)",
        borderRadius: 11,
        background: "var(--color-bt-card-raised)",
        padding: "10px 12px 12px",
        opacity: dragging ? 0.4 : 1,
      }}
    >
      {dropIndicator && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 2,
            right: 2,
            [dropIndicator === "top" ? "top" : "bottom"]: -6,
            height: 2,
            borderRadius: 2,
            background: "var(--color-bt-accent)",
            boxShadow: "0 0 0 2px var(--color-bt-accent-faint)",
            pointerEvents: "none",
          }}
        />
      )}
      <div className="mb-2 flex items-center gap-1.5">
        {/* Drag handle — arms HTML5 drag on press (desktop). */}
        <span
          aria-hidden="true"
          onMouseDown={() => setArmed(true)}
          onMouseUp={() => setArmed(false)}
          title="Drag to reorder"
          className="flex h-5 w-4 cursor-grab items-center justify-center active:cursor-grabbing"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <GripVertical size={14} />
        </span>
        {/* Up/down — touch/keyboard fallback for reordering. */}
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Move up"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-30"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            aria-label="Move down"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-30"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <ChevronDown size={14} />
          </button>
        </div>
        <span
          className="inline-flex items-center gap-1.5"
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: isCallout ? "var(--color-bt-warning)" : "var(--color-bt-text-dim)",
          }}
        >
          <Icon size={11} style={{ color: kindColor }} />
          {kindLabel[block.type]}
        </span>
        <button
          type="button"
          aria-label="Remove block"
          onClick={onRemove}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bt-hover)] hover:text-[var(--color-bt-danger)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={14} />
        </button>
      </div>

      <BlockFields tripId={tripId} block={block} onChange={onChange} />
    </div>
  );
}

// ── Per-type fields ───────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--color-bt-card)",
  border: "1px solid var(--color-bt-border)",
  borderRadius: 8,
  padding: "9px 10px",
  fontSize: 14,
  color: "var(--color-bt-text)",
  outline: "none",
};

function BlockFields({
  tripId,
  block,
  onChange,
}: {
  tripId: string;
  block: NewsBlock;
  onChange: (b: NewsBlock) => void;
}) {
  switch (block.type) {
    case "heading":
      return (
        <input
          value={block.text}
          onChange={(e) => onChange({ type: "heading", text: e.target.value })}
          placeholder="Section title…"
          style={{ ...inputStyle, fontSize: 16, fontWeight: 700 }}
        />
      );

    case "text":
      return <RichTextEditor tripId={tripId} block={block} onChange={onChange} />;

    case "callout":
      return (
        <input
          value={block.text}
          onChange={(e) => onChange({ type: "callout", text: e.target.value })}
          placeholder="The one must-not-miss line…"
          style={inputStyle}
        />
      );

    case "media":
      return (
        <div className="flex flex-col gap-2">
          <div className="flex gap-1.5">
            {(["video", "photo"] as const).map((k) => {
              const on = block.kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => onChange({ ...block, kind: k })}
                  style={{
                    padding: "5px 11px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: "capitalize",
                    cursor: "pointer",
                    color: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                    background: on ? "var(--color-bt-accent-faint)" : "transparent",
                    border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                  }}
                >
                  {k}
                </button>
              );
            })}
          </div>
          {block.kind === "video" ? (
            <>
              <input
                value={block.src ?? ""}
                onChange={(e) => onChange({ ...block, src: e.target.value })}
                placeholder="Paste a video link (YouTube, Vimeo…)"
                style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 13 }}
              />
              <input
                value={block.title ?? ""}
                onChange={(e) => onChange({ ...block, title: e.target.value })}
                placeholder="Title (optional)"
                style={inputStyle}
              />
              <input
                value={block.meta ?? ""}
                onChange={(e) => onChange({ ...block, meta: e.target.value })}
                placeholder="Meta — e.g. Charlie Piper · 8 min (optional)"
                style={inputStyle}
              />
            </>
          ) : (
            <>
              <input
                value={block.src ?? ""}
                onChange={(e) => onChange({ ...block, src: e.target.value })}
                placeholder="Paste an image or GIF link (…/clip.gif)"
                style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 13 }}
              />
              <input
                value={block.ph ?? ""}
                onChange={(e) => onChange({ ...block, ph: e.target.value })}
                placeholder="Caption (optional) — e.g. 18th green · 2024"
                style={inputStyle}
              />
              <p style={{ margin: 0, fontSize: 11, color: "var(--color-bt-text-dim)" }}>
                Paste a direct image or GIF link and it renders here. (File upload is coming soon.)
              </p>
            </>
          )}
        </div>
      );

    case "steps":
      return <StepsFields block={block} onChange={onChange} />;

    case "crew":
      return <CrewFields tripId={tripId} block={block} onChange={onChange} />;

    case "teams":
      return <TeamsFields tripId={tripId} block={block} onChange={onChange} />;

    default:
      return null;
  }
}

function StepsFields({
  block,
  onChange,
}: {
  block: Extract<NewsBlock, { type: "steps" }>;
  onChange: (b: NewsBlock) => void;
}) {
  const setStep = (i: number, key: "label" | "body", value: string) =>
    onChange({
      type: "steps",
      steps: block.steps.map((s, j) => (j === i ? { ...s, [key]: value } : s)),
    });
  const addStep = () => onChange({ type: "steps", steps: [...block.steps, { label: "", body: "" }] });
  const removeStep = (i: number) =>
    onChange({ type: "steps", steps: block.steps.filter((_, j) => j !== i) });

  return (
    <div className="flex flex-col gap-2">
      {block.steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className="flex flex-shrink-0 items-center justify-center"
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: "1px solid var(--color-bt-accent-border)",
              color: "var(--color-bt-accent)",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {i + 1}
          </span>
          <input
            value={s.label}
            onChange={(e) => setStep(i, "label", e.target.value)}
            placeholder="Label"
            style={{ ...inputStyle, flex: "0 0 110px", fontSize: 13 }}
          />
          <input
            value={s.body}
            onChange={(e) => setStep(i, "body", e.target.value)}
            placeholder="what to do…"
            style={{ ...inputStyle, fontSize: 13 }}
          />
          {block.steps.length > 1 && (
            <button
              type="button"
              aria-label="Remove step"
              onClick={() => removeStep(i)}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bt-hover)] hover:text-[var(--color-bt-danger)]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addStep}
        className="inline-flex items-center gap-1.5 self-start rounded-[9px] transition-colors hover:bg-[var(--color-bt-hover)]"
        style={{
          padding: "6px 10px",
          border: "1px solid var(--color-bt-border)",
          background: "transparent",
          color: "var(--color-bt-text)",
          fontSize: 12.5,
          fontWeight: 500,
        }}
      >
        <Plus size={13} /> Add step
      </button>
    </div>
  );
}

// ── @Crew editor ────────────────────────────────────────────────────────────
// Optional label ("Captains") + a searchable roster picker → people pills.
function CrewFields({
  tripId,
  block,
  onChange,
}: {
  tripId: string;
  block: Extract<NewsBlock, { type: "crew" }>;
  onChange: (b: NewsBlock) => void;
}) {
  const { data: roster = [] } = trpc.news.roster.useQuery({ tripId });
  const [query, setQuery] = useState("");

  const chosen = new Set(block.people.map((p) => p.userId).filter(Boolean) as string[]);
  const q = query.trim().toLowerCase();
  const matches = roster
    .filter((p) => !chosen.has(p.userId ?? ""))
    // Match on word starts, not any substring — "t" matches "Taj"/"Tyler L",
    // not the t inside "Grether".
    .filter((p) =>
      q ? p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) : true
    )
    .slice(0, 6);

  const add = (p: NewsPerson) => {
    onChange({ ...block, people: [...block.people, p] });
    setQuery("");
  };
  const remove = (i: number) =>
    onChange({ ...block, people: block.people.filter((_, j) => j !== i) });

  return (
    <div className="flex flex-col gap-2">
      <input
        value={block.label ?? ""}
        onChange={(e) => onChange({ ...block, label: e.target.value })}
        placeholder="Label (optional) — e.g. Captains, Pairing"
        style={inputStyle}
      />

      {block.people.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {block.people.map((p, i) => (
            // The displayed chip is the exact same <Mention> the feed renders,
            // so the edit view matches preview; the remove control sits beside it.
            <span key={i} className="inline-flex items-center" style={{ gap: 3 }}>
              <Mention person={p} />
              <button
                type="button"
                aria-label={`Remove ${p.name}`}
                onClick={() => remove(i)}
                className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-[var(--color-bt-hover)]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Add crew — type a name…"
        style={inputStyle}
      />
      {query && matches.length > 0 && (
        <div
          className="flex flex-col overflow-hidden"
          style={{ border: "1px solid var(--color-bt-border)", borderRadius: 8, background: "var(--color-bt-card)" }}
        >
          {matches.map((p) => (
            <button
              key={p.userId}
              type="button"
              onClick={() => add(p)}
              className="flex items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ background: "transparent", border: "none", cursor: "pointer" }}
            >
              <Avatar name={p.name} avatarIcon={p.avatarIcon ?? null} teamColor={p.color ?? undefined} muted={!!p.placeholder} sizePx={20} />
              <span style={{ fontSize: 13, color: "var(--color-bt-text)" }}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
      {query && matches.length === 0 && (
        <p style={{ margin: 0, fontSize: 11, color: "var(--color-bt-text-dim)" }}>
          No one left to add by that name.
        </p>
      )}
    </div>
  );
}

// ── Teams editor (pulled from Competition) ──────────────────────────────────
function TeamsFields({
  tripId,
  block,
  onChange,
}: {
  tripId: string;
  block: Extract<NewsBlock, { type: "teams" }>;
  onChange: (b: NewsBlock) => void;
}) {
  const { data: draw, isLoading } = trpc.news.competitionDraw.useQuery({ tripId });

  // Auto-fill once when a freshly-added (empty) Teams block first sees a draw.
  const filledRef = useRef(false);
  useEffect(() => {
    if (filledRef.current) return;
    if (block.teams.length === 0 && draw && draw.teams.length > 0) {
      filledRef.current = true;
      onChange({ ...block, teams: draw.teams });
    }
  }, [draw, block, onChange]);

  if (isLoading) {
    return <p style={{ margin: 0, fontSize: 12, color: "var(--color-bt-text-dim)" }}>Loading the draw…</p>;
  }

  if (!draw || draw.teams.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 12, color: "var(--color-bt-text-dim)", lineHeight: 1.45 }}>
        No draw yet — set up teams in the Competition tab, then come back and add this block.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center gap-2"
        style={{
          padding: "8px 10px",
          borderRadius: 8,
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        <Trophy size={15} style={{ color: "var(--color-bt-accent)" }} />
        <span style={{ fontSize: 12.5, color: "var(--color-bt-text)" }}>
          The draw · {block.teams.length || draw.teams.length} teams
        </span>
        <button
          type="button"
          onClick={() => onChange({ ...block, teams: draw.teams })}
          className="ml-auto inline-flex items-center gap-1.5"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-bt-accent)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "var(--color-bt-text-dim)" }}>
        Rosters stay in sync with Competition — you don&rsquo;t retype them.
      </p>
    </div>
  );
}
