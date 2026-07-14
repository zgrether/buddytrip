"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import type { CSSProperties } from "react";

/**
 * LegalDoc — renders a first-party Markdown document (our committed /privacy and
 * /terms files) as styled, readable long-form HTML. Content in, no editing: this
 * is pure rendering plumbing. Styled with STYLE_GUIDE tokens (no hardcoded hex),
 * constrained to a comfortable reading measure, mobile-first.
 *
 * react-markdown renders to React elements (no dangerouslySetInnerHTML); the input
 * is our own committed Markdown, not user input.
 */

const heading = (fontSize: number, marginTop: number): CSSProperties => ({
  fontSize,
  fontWeight: 700,
  color: "var(--color-bt-text)",
  lineHeight: 1.25,
  letterSpacing: "-0.01em",
  marginTop,
  marginBottom: 10,
});
const bodyText: CSSProperties = { fontSize: 15, lineHeight: 1.7, color: "var(--color-bt-text)" };

const components: Components = {
  h1: ({ children }) => <h1 style={heading(28, 0)}>{children}</h1>,
  h2: ({ children }) => <h2 style={heading(20, 30)}>{children}</h2>,
  h3: ({ children }) => <h3 style={heading(16, 22)}>{children}</h3>,
  p: ({ children }) => <p style={{ ...bodyText, margin: "0 0 14px" }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: "0 0 14px", paddingLeft: 22, listStyleType: "disc" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0 0 14px", paddingLeft: 22, listStyleType: "decimal" }}>{children}</ol>,
  li: ({ children }) => <li style={{ ...bodyText, marginBottom: 5 }}>{children}</li>,
  a: ({ href, children }) => (
    <a href={href} style={{ color: "var(--color-bt-accent)", textDecoration: "underline" }}>
      {children}
    </a>
  ),
  strong: ({ children }) => <strong style={{ fontWeight: 700, color: "var(--color-bt-text)" }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
  hr: () => <hr style={{ border: 0, borderTop: "1px solid var(--color-bt-border)", margin: "24px 0" }} />,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "3px solid var(--color-bt-border)",
        paddingLeft: 14,
        margin: "0 0 14px",
        color: "var(--color-bt-text-dim)",
      }}
    >
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code style={{ fontSize: 13.5, background: "var(--color-bt-card-raised)", padding: "1px 5px", borderRadius: 4 }}>
      {children}
    </code>
  ),
};

export function LegalDoc({ content }: { content: string }) {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 72px" }}>
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  );
}
