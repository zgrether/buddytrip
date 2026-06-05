"use client";

import { Pin, Play } from "lucide-react";
import { Avatar } from "@/components/Avatar";
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

// Derive a YouTube thumbnail straight from the pasted link — no storage, no
// API. Matches watch / youtu.be / embed / shorts URLs. Other providers
// (Vimeo, etc.) have no zero-cost URL→thumbnail, so they fall back to the
// gradient card; a real fix there would need an oEmbed fetch.
function youTubeThumb(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}

// A directly-renderable image/GIF URL — a file with an image extension, or a
// known GIF CDN (Giphy/Tenor "media" hosts). Lets a pasted GIF/photo link
// render inline with no upload pipeline. Share-PAGE links (giphy.com/gifs/…)
// aren't direct media and return null (they'd need the provider's API).
function imageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (/\.(gif|png|jpe?g|webp|avif)(\?.*)?$/i.test(u)) return u;
  if (/^https?:\/\/(?:media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\//i.test(u)) {
    return u;
  }
  return null;
}

// ── @Crew person chip ─────────────────────────────────────────────────────
// Renders like the app's member chips (TeamMemberChip): the person's real
// Avatar (their Tabler icon, or initials) backed by their team color, plus
// their plain name — no "@". The chip is tinted by the same color so a team
// captain's pill reads as their team's.
function Mention({ person }: { person: NewsPerson }) {
  // A color only when the member is actually on a competition team — otherwise
  // the standard avatar + a neutral chip (no fake team color).
  const team = person.color || null;
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        padding: "2px 9px 2px 2px",
        borderRadius: 9999,
        background: team
          ? `color-mix(in srgb, ${team} 12%, var(--color-bt-card-raised))`
          : "var(--color-bt-card-raised)",
        border: team
          ? `1px solid color-mix(in srgb, ${team} 40%, var(--color-bt-border))`
          : "1px solid var(--color-bt-border)",
        fontSize: 12.5,
        fontWeight: 600,
        color: "var(--color-bt-text)",
        lineHeight: 1,
        verticalAlign: "-5px",
      }}
    >
      <Avatar
        name={person.name}
        avatarIcon={person.avatarIcon ?? null}
        teamColor={team ?? undefined}
        muted={!!person.placeholder}
        sizePx={18}
      />
      {person.name}
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
        // A pasted image/GIF link renders inline at its natural aspect (GIFs
        // animate); only when there's no renderable URL do we show the
        // captioned placeholder.
        const img = imageUrl(block.src);
        if (img) {
          return (
            <figure
              style={{
                margin: 0,
                border: "1px solid var(--color-bt-border)",
                borderRadius: 11,
                overflow: "hidden",
                background: "var(--color-bt-card-raised)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img}
                alt={block.ph || "Image"}
                loading="lazy"
                decoding="async"
                style={{ display: "block", width: "100%", height: "auto", maxHeight: 480, objectFit: "contain" }}
              />
              {block.ph && (
                <figcaption
                  style={{
                    padding: "8px 12px",
                    fontSize: 11.5,
                    color: "var(--color-bt-text-dim)",
                  }}
                >
                  {block.ph}
                </figcaption>
              )}
            </figure>
          );
        }
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
      {
        const thumb = youTubeThumb(block.src);
        // With a real thumbnail: the image fills the card, a scrim keeps the
        // play button + title legible, and the title/meta sit on the image.
        if (thumb) {
          return (
            <a
              href={block.src ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                position: "relative",
                display: "block",
                border: "1px solid var(--color-bt-border)",
                borderRadius: 11,
                aspectRatio: "16 / 9",
                overflow: "hidden",
                textDecoration: "none",
                background: "var(--color-bt-card-raised)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumb}
                alt={block.title || "Video thumbnail"}
                loading="lazy"
                decoding="async"
                style={{ position: "absolute", inset: 0, height: "100%", width: "100%", objectFit: "cover" }}
              />
              {/* Scrim — darkens for the play glyph + bottom caption legibility. */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.25))",
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 54,
                  height: 54,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.55)",
                  border: "1px solid rgba(255,255,255,0.55)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                }}
              >
                <Play size={22} fill="#fff" />
              </span>
              {(block.title || block.meta) && (
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 12px" }}>
                  {block.title && (
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{block.title}</div>
                  )}
                  {block.meta && (
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 2 }}>
                      {block.meta}
                    </div>
                  )}
                </div>
              )}
            </a>
          );
        }
      }
      // No derivable thumbnail (non-YouTube link, or no link yet) → gradient card.
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
