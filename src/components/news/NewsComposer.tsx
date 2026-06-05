"use client";

import { useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Pin,
  ChevronUp,
  ChevronDown,
  Type,
  Image as ImageIcon,
  ListOrdered,
  Users,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { NewsBlock, NewsBlockType, NewsPost } from "@/lib/news";

// ── NewsComposer ────────────────────────────────────────────────────────────
//
// New-post / edit-post composer, rendered inside the News rail (NewsPanel
// swaps it in for the feed). Returns a fragment — header + scrollable body +
// footer — placed directly in the rail's flex-col so the header/footer pin and
// the body scrolls.
//
// PR2 scope: Text · Media · Steps · Callout editors, up/down reorder, remove,
// pin toggle, create/edit/delete. The @Crew picker, Teams-from-Competition
// picker, drag-reorder, and the Text formatting toolbar land in PR3. When
// EDITING a post that already contains crew/teams blocks (e.g. the seed
// welcome post), those render as read-only reference rows here and are
// preserved on save — never silently dropped.

// Block types the composer can ADD in PR2.
const ADDABLE: { type: NewsBlockType; label: string; icon: LucideIcon }[] = [
  { type: "text", label: "Text", icon: Type },
  { type: "media", label: "Media", icon: ImageIcon },
  { type: "steps", label: "Steps", icon: ListOrdered },
  { type: "callout", label: "Callout", icon: Pin },
];

function blankBlock(type: NewsBlockType): NewsBlock {
  switch (type) {
    case "text":
      return { type: "text", text: "" };
    case "media":
      return { type: "media", kind: "video", src: "", title: "", meta: "" };
    case "steps":
      return { type: "steps", steps: [{ label: "", body: "" }] };
    case "callout":
      return { type: "callout", text: "" };
    default:
      // crew/teams aren't addable in PR2; fall back to text.
      return { type: "text", text: "" };
  }
}

/** Drop blocks the user left empty so we don't post hollow paragraphs/callouts.
 *  crew/teams/media are kept as-is (media may legitimately be just a link). */
function cleanBlocks(blocks: NewsBlock[]): NewsBlock[] {
  const out: NewsBlock[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
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
    } else {
      // crew / teams — preserved untouched.
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

      {/* ── Body: block editor stack + add-a-block ─────────────────────── */}
      <div className={`flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto ${px} py-3`}>
        {blocks.map((b, i) => (
          <BlockEditor
            key={i}
            block={b}
            index={i}
            count={blocks.length}
            onChange={(next) => setBlock(i, next)}
            onRemove={() => removeBlock(i)}
            onMove={(dir) => moveBlock(i, dir)}
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
            Add a block{variant === "mobile" ? " · swipe" : ""}
          </div>
          <div
            className={
              variant === "mobile"
                ? "flex gap-1.5 overflow-x-auto pb-1"
                : "flex flex-wrap gap-1.5"
            }
          >
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
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

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
  block,
  index,
  count,
  onChange,
  onRemove,
  onMove,
}: {
  block: NewsBlock;
  index: number;
  count: number;
  onChange: (b: NewsBlock) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const kindLabel: Record<NewsBlockType, string> = {
    text: "Text",
    crew: "@Crew · from the roster",
    teams: "Teams · from Competition",
    media: "Media",
    steps: "Steps",
    callout: "Callout · panel (amber)",
  };
  const kindIcon: Record<NewsBlockType, LucideIcon> = {
    text: Type,
    crew: Users,
    teams: Trophy,
    media: ImageIcon,
    steps: ListOrdered,
    callout: Pin,
  };
  const Icon = kindIcon[block.type];

  return (
    <div
      className="flex-shrink-0"
      style={{
        position: "relative",
        border: "1px solid var(--color-bt-border)",
        borderRadius: 11,
        background: "var(--color-bt-card-raised)",
        padding: "10px 12px 12px",
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        {/* Reorder (up/down — drag handle upgrade is PR3) */}
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
            color: "var(--color-bt-text-dim)",
          }}
        >
          <Icon size={11} style={{ color: "var(--color-bt-accent)" }} />
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

      <BlockFields block={block} onChange={onChange} />
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

function BlockFields({ block, onChange }: { block: NewsBlock; onChange: (b: NewsBlock) => void }) {
  switch (block.type) {
    case "text":
      return (
        <textarea
          value={block.text ?? ""}
          onChange={(e) => onChange({ type: "text", text: e.target.value, dim: block.dim })}
          rows={3}
          placeholder="Write something for the crew…"
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
        />
      );

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
    case "teams":
      // Not editable in PR2 — shown so an edited post keeps these blocks.
      return (
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-bt-text-dim)", lineHeight: 1.45 }}>
          {block.type === "crew"
            ? `${block.people.length} ${block.people.length === 1 ? "person" : "people"} tagged. `
            : `${block.teams.length} ${block.teams.length === 1 ? "team" : "teams"} from the draw. `}
          Editing this block type is coming soon — it&rsquo;s kept as-is when you save.
        </p>
      );

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
