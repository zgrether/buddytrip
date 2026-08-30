import { describe, it, expect } from "vitest";
import { newsPreview, type NewsBlock } from "./news";

describe("newsPreview", () => {
  it("prefers a heading's own text", () => {
    const blocks: NewsBlock[] = [
      { type: "heading", text: "Tee times are up" },
      { type: "text", text: "Check the board for your slot." },
    ];
    expect(newsPreview(blocks)).toBe("Tee times are up");
  });

  it("falls back to a text block's plain string", () => {
    const blocks: NewsBlock[] = [
      { type: "crew", people: [{ name: "Zach", initials: "Z" }] },
      { type: "text", text: "Bags out front by 7." },
    ];
    expect(newsPreview(blocks)).toBe("Bags out front by 7.");
  });

  it("joins a text block's segments back to plain runs, dropping formatting and mentions", () => {
    const blocks: NewsBlock[] = [
      {
        type: "text",
        segments: [
          "Meet at ",
          { text: "the clubhouse", bold: true },
          " — ",
          { mention: { name: "Rob", initials: "R" } },
          " has the cart keys.",
        ],
      },
    ];
    expect(newsPreview(blocks)).toBe("Meet at the clubhouse — Rob has the cart keys.");
  });

  /**
   * The one deliberate exclusion, named in the function's own comment: a
   * `callout` is a highlighted ASIDE, not necessarily the post's headline, and
   * a composer who led with a heading should have THAT be the preview.
   */
  it("skips crew, teams, media, steps and callout blocks entirely", () => {
    const blocks: NewsBlock[] = [
      { type: "callout", text: "Do not miss the tee time" },
      { type: "media", kind: "photo", src: null },
      { type: "steps", steps: [{ label: "1", body: "Show up" }] },
      { type: "teams", teams: [{ name: "Buddy", color: "#22c55e", players: ["Zach"] }] },
      { type: "crew", people: [{ name: "Zach", initials: "Z" }] },
    ];
    expect(newsPreview(blocks)).toBeNull();
  });

  it("returns null for a post with no renderable text anywhere", () => {
    expect(newsPreview([{ type: "media", kind: "photo", src: null }])).toBeNull();
  });

  it("truncates with an ellipsis past maxLength, and not before it", () => {
    const long = "x".repeat(120);
    const preview = newsPreview([{ type: "heading", text: long }], 90);
    expect(preview).toHaveLength(90);
    expect(preview?.endsWith("…")).toBe(true);
    expect(preview?.slice(0, 89)).toBe("x".repeat(89));

    const short = newsPreview([{ type: "heading", text: "x".repeat(90) }], 90);
    expect(short).toBe("x".repeat(90));
    expect(short?.includes("…")).toBe(false);
  });

  it("skips an empty or whitespace-only heading and reads on to the next block", () => {
    const blocks: NewsBlock[] = [
      { type: "heading", text: "   " },
      { type: "text", text: "The real content" },
    ];
    expect(newsPreview(blocks)).toBe("The real content");
  });
});
