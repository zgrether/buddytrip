"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Bold, Italic, Link as LinkIcon, AtSign } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { Avatar } from "@/components/Avatar";
import { Mention } from "@/components/news/NewsBlock";
import type { NewsBlock, NewsPerson, NewsSegment } from "@/lib/news";

// ── RichTextEditor ───────────────────────────────────────────────────────────
//
// The Text block editor: a contentEditable paragraph with a bold / italic /
// link / @ toolbar that serialises to the NewsSegment model (no markdown, no
// color — per SPEC-news.md). Lists are deferred to a later pass.
//
// contentEditable is uncontrolled: we set the DOM ONCE on mount from the block
// being edited, then read it back on input. We never re-write innerHTML from
// props (that would nuke the caret), so the parent's block state and this DOM
// stay decoupled by design.
//
// Bold/italic use the (deprecated but universally supported) execCommand — by
// far the least fragile way to toggle marks in contentEditable. We force
// styleWithCSS off so the DOM uses <b>/<i> tags, which the serialiser reads.

// ── Mention pill (raw DOM) ──────────────────────────────────────────────────
// Inserted directly into the contentEditable (so DOM API, not React), but the
// VISIBLE chip is the very same <Mention> the feed/preview render — serialised
// to static markup. That keeps the editor pill byte-identical to preview
// (same avatar, same alignment). Identity for serialisation rides on data-*.
function buildPill(person: NewsPerson): HTMLElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.mention = "1";
  span.dataset.name = person.name;
  span.dataset.initials = person.initials;
  if (person.userId) span.dataset.userId = person.userId;
  if (person.color) span.dataset.color = person.color;
  if (person.avatarIcon) span.dataset.avatarIcon = person.avatarIcon;
  if (person.placeholder) span.dataset.placeholder = "1";
  span.style.cssText = "display:inline-block;vertical-align:middle;user-select:all;";
  span.innerHTML = renderToStaticMarkup(<Mention person={person} />);
  return span;
}

function pillToPerson(el: HTMLElement): NewsPerson {
  return {
    userId: el.dataset.userId ?? null,
    name: el.dataset.name ?? "",
    initials: el.dataset.initials ?? "?",
    color: el.dataset.color ?? null,
    avatarIcon: el.dataset.avatarIcon ?? null,
    placeholder: el.dataset.placeholder === "1",
  };
}

// ── Serialise: contentEditable DOM → NewsSegment[] ──────────────────────────
function isBlockTag(tag: string): boolean {
  return tag === "div" || tag === "p";
}

function serialize(root: HTMLElement): NewsSegment[] {
  const out: NewsSegment[] = [];

  const pushText = (text: string, bold: boolean, italic: boolean) => {
    if (!text) return;
    if (!bold && !italic) {
      const last = out[out.length - 1];
      if (typeof last === "string") out[out.length - 1] = last + text;
      else out.push(text);
    } else {
      out.push({ text, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) });
    }
  };

  const walk = (node: Node, bold: boolean, italic: boolean) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        pushText(child.textContent ?? "", bold, italic);
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as HTMLElement;

      if (el.dataset.mention) {
        out.push({ mention: pillToPerson(el) });
        return;
      }

      const tag = el.tagName.toLowerCase();
      if (tag === "a") {
        const href = el.getAttribute("href") ?? "";
        const text = el.textContent ?? "";
        if (text && href) out.push({ link: href, text });
        else pushText(text, bold, italic);
        return;
      }
      if (tag === "br") {
        pushText(" ", false, false);
        return;
      }

      const fw = el.style.fontWeight;
      const styledBold = fw === "bold" || (/^\d+$/.test(fw) && Number(fw) >= 600);
      const nb = bold || tag === "b" || tag === "strong" || styledBold;
      const ni = italic || tag === "i" || tag === "em" || el.style.fontStyle === "italic";

      walk(el, nb, ni);
      // Defensive: a stray block boundary becomes a space (Enter is blocked, so
      // this is rare — pasted HTML can still introduce one).
      if (isBlockTag(tag)) pushText(" ", false, false);
    });
  };

  walk(root, false, false);
  return out;
}

/** Collapse the segments into the stored block: a single plain run keeps the
 *  simple `text` shape; anything richer stores `segments`. */
function toTextBlock(segments: NewsSegment[], dim?: boolean): NewsBlock {
  if (segments.length === 0) return { type: "text", text: "", dim };
  if (segments.length === 1 && typeof segments[0] === "string") {
    return { type: "text", text: segments[0], dim };
  }
  return { type: "text", segments, dim };
}

// ── Hydrate: block → initial contentEditable DOM (mount only) ────────────────
function hydrate(root: HTMLElement, block: Extract<NewsBlock, { type: "text" }>) {
  root.replaceChildren();
  const append = (n: Node) => root.appendChild(n);

  if (block.segments && block.segments.length > 0) {
    for (const seg of block.segments) {
      if (typeof seg === "string") {
        append(document.createTextNode(seg));
      } else if ("mention" in seg) {
        append(buildPill(seg.mention));
      } else if ("link" in seg) {
        const a = document.createElement("a");
        a.href = seg.link;
        a.textContent = seg.text;
        append(a);
      } else {
        let node: Node = document.createTextNode(seg.text);
        if (seg.italic) {
          const i = document.createElement("i");
          i.appendChild(node);
          node = i;
        }
        if (seg.bold) {
          const b = document.createElement("b");
          b.appendChild(node);
          node = b;
        }
        append(node);
      }
    }
  } else if (block.text) {
    append(document.createTextNode(block.text));
  }
}

function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  return `https://${u}`;
}

interface RichTextEditorProps {
  tripId: string;
  block: Extract<NewsBlock, { type: "text" }>;
  onChange: (b: NewsBlock) => void;
}

export function RichTextEditor({ tripId, block, onChange }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Capture the initial block once — hydrate must not re-run on prop changes.
  const initialBlock = useRef(block);
  const dimRef = useRef(block.dim);
  const [isEmpty, setIsEmpty] = useState(
    !((block.segments && block.segments.length) || (block.text && block.text.length))
  );

  const { data: roster = [] } = trpc.news.roster.useQuery({ tripId });

  // ── @-mention dropdown state ──────────────────────────────────────────────
  const [mention, setMention] = useState<
    { query: string; top: number; left: number; index: number } | null
  >(null);
  // The text range [start, end) of the "@query" being replaced on select.
  const mentionRange = useRef<{ node: Node; start: number; end: number } | null>(null);

  // ── Link field state ──────────────────────────────────────────────────────
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRange = useRef<Range | null>(null);

  // Mount: paint the initial content.
  useEffect(() => {
    if (editorRef.current) hydrate(editorRef.current, initialBlock.current);
  }, []);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const segments = serialize(el);
    onChange(toTextBlock(segments, dimRef.current));
    setIsEmpty((el.textContent ?? "").trim().length === 0 && !el.querySelector("[data-mention]"));
  }, [onChange]);

  // ── Detect an in-progress "@query" before the caret ───────────────────────
  const detectMention = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      setMention(null);
      return;
    }
    const node = sel.focusNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      setMention(null);
      return;
    }
    const offset = sel.focusOffset;
    const before = (node.textContent ?? "").slice(0, offset);
    const m = before.match(/@([^\s@]{0,40})$/);
    if (!m) {
      setMention(null);
      return;
    }
    const start = offset - m[0].length;
    mentionRange.current = { node, start, end: offset };
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const wrapEl = wrapRef.current;
    const wrap = wrapEl?.getBoundingClientRect();
    // Clamp here (in the handler) so render never reads the ref.
    const wrapW = wrapEl?.clientWidth ?? 280;
    const rawLeft = rect.left - (wrap?.left ?? 0);
    setMention({
      query: m[1],
      top: rect.bottom - (wrap?.top ?? 0) + 4,
      left: Math.max(0, Math.min(rawLeft, wrapW - 220)),
      index: 0,
    });
  }, []);

  const onInput = useCallback(() => {
    emit();
    detectMention();
  }, [emit, detectMention]);

  // Single paragraph — Enter doesn't create new blocks/lines.
  const onKeyDownEditor = (e: React.KeyboardEvent) => {
    if (mention) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setMention((m) =>
          m ? { ...m, index: Math.max(0, Math.min(filtered.length - 1, m.index + (e.key === "ArrowDown" ? 1 : -1))) } : m
        );
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && filtered.length > 0) {
        e.preventDefault();
        selectMention(filtered[mention.index] ?? filtered[0]);
        return;
      }
    }
    if (e.key === "Enter") e.preventDefault();
  };

  // ── Roster filtering (mirrors CrewFields word-start match, cap 6) ──────────
  const q = (mention?.query ?? "").trim().toLowerCase();
  const filtered = mention
    ? roster
        .filter((p) => (q ? p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) : true))
        .slice(0, 6)
    : [];

  const focusEditor = () => editorRef.current?.focus();

  const selectMention = (person: NewsPerson) => {
    const r = mentionRange.current;
    const el = editorRef.current;
    if (!r || !el) return;
    const range = document.createRange();
    try {
      range.setStart(r.node, r.start);
      range.setEnd(r.node, r.end);
    } catch {
      setMention(null);
      return;
    }
    range.deleteContents();
    const pill = buildPill(person);
    range.insertNode(pill);
    // Trailing space + caret after it.
    const space = document.createTextNode(" ");
    pill.after(space);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(after);
    setMention(null);
    emit();
  };

  // ── Toolbar actions ───────────────────────────────────────────────────────
  const exec = (cmd: "bold" | "italic") => {
    focusEditor();
    try {
      document.execCommand("styleWithCSS", false, "false");
      document.execCommand(cmd);
    } catch {
      /* no-op */
    }
    emit();
  };

  const openLink = () => {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    setLinkUrl("");
    setLinkOpen(true);
  };

  const applyLink = () => {
    const href = normalizeUrl(linkUrl);
    if (!href) {
      setLinkOpen(false);
      return;
    }
    focusEditor();
    const sel = window.getSelection();
    if (savedRange.current) {
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
    }
    const collapsed = !sel || sel.isCollapsed;
    if (collapsed) {
      // No selection — insert the URL as its own linked text.
      const a = document.createElement("a");
      a.href = href;
      a.textContent = linkUrl.trim();
      const range = sel?.getRangeAt(0);
      range?.insertNode(a);
      if (range) {
        range.setStartAfter(a);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    } else {
      try {
        document.execCommand("createLink", false, href);
      } catch {
        /* no-op */
      }
    }
    setLinkOpen(false);
    emit();
  };

  const insertAt = () => {
    focusEditor();
    try {
      document.execCommand("insertText", false, "@");
    } catch {
      /* no-op */
    }
    onInput();
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {/* Toolbar */}
      <div className="mb-2 flex items-center gap-1">
        <ToolbarButton label="Bold" onClick={() => exec("bold")}>
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => exec("italic")}>
          <Italic size={14} />
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Add link" onClick={openLink}>
          <LinkIcon size={14} />
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Mention crew" onClick={insertAt}>
          <AtSign size={14} />
        </ToolbarButton>
      </div>

      {/* Inline link field */}
      {linkOpen && (
        <div className="mb-2 flex items-center gap-1.5">
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setLinkOpen(false);
              }
            }}
            placeholder="Paste or type a URL…"
            style={{
              flex: 1,
              boxSizing: "border-box",
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-border)",
              borderRadius: 8,
              padding: "7px 10px",
              fontSize: 13,
              color: "var(--color-bt-text)",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={applyLink}
            style={{
              background: "var(--color-bt-accent)",
              color: "#0d1f1a",
              border: "none",
              borderRadius: 8,
              padding: "7px 12px",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Add
          </button>
        </div>
      )}

      {/* Editable area */}
      <div style={{ position: "relative" }}>
        {isEmpty && !linkOpen && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 9,
              left: 11,
              fontSize: 14,
              color: "var(--color-bt-text-dim)",
              pointerEvents: "none",
            }}
          >
            Write something… type @ to tag the crew.
          </span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-testid="news-richtext"
          onInput={onInput}
          onKeyDown={onKeyDownEditor}
          onBlur={emit}
          style={{
            minHeight: 64,
            boxSizing: "border-box",
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            borderRadius: 8,
            padding: "9px 10px",
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--color-bt-text)",
            outline: "none",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        />
      </div>

      {/* @-mention dropdown */}
      {mention && filtered.length > 0 && (
        <div
          className="absolute z-30 flex flex-col overflow-hidden"
          style={{
            top: mention.top,
            left: mention.left,
            width: 220,
            background: "var(--color-bt-card-float)",
            border: "1px solid var(--color-bt-border)",
            borderRadius: 9,
            boxShadow: "var(--shadow-floating)",
          }}
        >
          {filtered.map((p, i) => (
            <button
              key={p.userId ?? p.name}
              type="button"
              // Use mousedown so the editor's selection isn't lost before we act.
              onMouseDown={(e) => {
                e.preventDefault();
                selectMention(p);
              }}
              className="flex items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                background: i === mention.index ? "var(--color-bt-hover)" : "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              <Avatar
                name={p.name}
                avatarIcon={p.avatarIcon ?? null}
                teamColor={p.color ?? undefined}
                muted={!!p.placeholder}
                sizePx={20}
              />
              <span style={{ fontSize: 13, color: "var(--color-bt-text)" }}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // mousedown + preventDefault so clicking the button doesn't blur the
      // editor / drop its selection before the command runs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex items-center justify-center rounded-md transition-colors hover:bg-[var(--color-bt-hover)]"
      style={{
        height: 28,
        width: 28,
        border: "1px solid var(--color-bt-border)",
        background: "var(--color-bt-card-raised)",
        color: "var(--color-bt-text)",
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" style={{ width: 1, height: 18, background: "var(--color-bt-border)", margin: "0 3px" }} />;
}
