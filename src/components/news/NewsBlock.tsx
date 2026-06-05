"use client";

import { Pin, Play } from "lucide-react";
import type {
  NewsBlock,
  NewsPerson,
  NewsSegment,
} from "@/lib/news";

// ── News block renderer (read-only) ────────────────────────────────────────
//
// Renders the six closed block types. Token-first inline styles, faithful to
// the design reference (design/design_handoff_news, .post/.blk-* CSS).
// The composer (PR2) reuses these same renderers for its live preview.

// ── @Crew mention pill ──────────────────────────────────────────────────
function MiniAvatar({ person, size = 17 }: { person: NewsPerson; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: person.color,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.5),
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {person.initials}
    </span>
  );
}

function Mention({ person }: { person: NewsPerson }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "1px 8px 1px 2px",
        borderRadius: 9999,
        background: "var(--color-bt-accent-faint)",
        border: "1px solid var(--color-bt-accent-border)",
        fontWeight: 600,
        color: "var(--color-bt-accent)",
        fontSize: 12.5,
        lineHeight: 1,
        verticalAlign: "-3px",
      }}
    >
      <MiniAvatar person={person} />@{person.name}
    </span>
  );
}

function RichText({ segments, dim }: { segments: NewsSegment[]; dim?: boolean }) {
  return (
    <p style={paragraphStyle(dim)}>
      {segments.map((seg, i) =>
        typeof seg === "string" ? (
          <span key={i}>{seg}</span>
        ) : (
          <Mention key={i} person={seg.mention} />
        )
      )}
    </p>
  );
}

function paragraphStyle(dim?: boolean): React.CSSProperties {
  return {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: dim ? "var(--color-bt-text-dim)" : "var(--color-bt-text)",
    margin: 0,
  };
}

// ── One block ──────────────────────────────────────────────────────────────
export function NewsBlockView({ block }: { block: NewsBlock }) {
  switch (block.type) {
    case "text":
      return block.segments ? (
        <RichText segments={block.segments} dim={block.dim} />
      ) : (
        <p style={paragraphStyle(block.dim)}>{block.text}</p>
      );

    case "crew":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
          {block.label && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-bt-text-dim)",
                marginRight: 1,
              }}
            >
              {block.label}
            </span>
          )}
          {block.people.map((p, i) => (
            <Mention key={i} person={p} />
          ))}
        </div>
      );

    case "teams":
      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 9,
          }}
        >
          {block.teams.map((t) => (
            <div
              key={t.name}
              style={{
                border: "1px solid var(--color-bt-border)",
                borderLeft: `3px solid ${t.color}`,
                borderRadius: 9,
                padding: "10px 12px",
                background: "var(--color-bt-card-raised)",
              }}
            >
              <div
                style={{
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontStyle: "italic",
                  fontWeight: 700,
                  fontSize: 13.5,
                  color: "var(--color-bt-text)",
                }}
              >
                {t.name}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--color-bt-text-dim)", marginTop: 3 }}>
                {t.players.join(" · ")}
              </div>
            </div>
          ))}
        </div>
      );

    case "media":
      if (block.kind === "photo") {
        return (
          <div
            style={{
              border: "1px solid var(--color-bt-border)",
              borderRadius: 11,
              aspectRatio: "16 / 10",
              overflow: "hidden",
              position: "relative",
              background:
                "repeating-linear-gradient(135deg, var(--color-bt-card-raised) 0 12px, rgba(148,163,184,0.05) 12px 24px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-bt-text-dim)",
              }}
            >
              {block.ph || "photo"}
            </span>
          </div>
        );
      }
      return (
        <a
          href={block.src ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            border: "1px solid var(--color-bt-border)",
            borderRadius: 11,
            aspectRatio: "16 / 9",
            background:
              "radial-gradient(120% 120% at 50% 40%, rgba(16,185,129,0.10), transparent 60%), var(--color-bt-card-raised)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            textDecoration: "none",
            cursor: block.src ? "pointer" : "default",
          }}
        >
          <span
            style={{
              width: 58,
              height: 58,
              borderRadius: "50%",
              background: "var(--color-bt-accent-faint)",
              border: "1px solid var(--color-bt-accent-border)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-bt-accent)",
            }}
          >
            <Play size={22} />
          </span>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-text)" }}>
              {block.title}
            </div>
            {block.meta && (
              <div style={{ fontSize: 11, color: "var(--color-bt-text-dim)", marginTop: 2 }}>
                {block.meta}
              </div>
            )}
          </div>
        </a>
      );

    case "steps":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {block.steps.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 11,
                padding: "11px 12px",
                borderRadius: 9,
                background: "var(--color-bt-card-raised)",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: "1px solid var(--color-bt-accent-border)",
                  color: "var(--color-bt-accent)",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-bt-text)" }}>
                <b style={{ color: "var(--color-bt-accent)", fontWeight: 600 }}>{s.label}</b>
                {s.body ? <> — {s.body}</> : null}
              </span>
            </div>
          ))}
        </div>
      );

    case "callout":
      return (
        <div
          style={{
            display: "flex",
            gap: 11,
            padding: "12px 13px",
            borderRadius: 10,
            background: "var(--color-bt-warning-faint)",
            border: "1px solid var(--color-bt-warning-border)",
          }}
        >
          <span style={{ color: "var(--color-bt-owner)", flexShrink: 0, lineHeight: 0, marginTop: 1 }}>
            <Pin size={16} />
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-bt-text)" }}>
            {block.text}
          </span>
        </div>
      );

    default:
      return null;
  }
}

// ── A post's full block stack ───────────────────────────────────────────
export function NewsBlocks({ blocks }: { blocks: NewsBlock[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {blocks.map((b, i) => (
        <NewsBlockView key={i} block={b} />
      ))}
    </div>
  );
}
