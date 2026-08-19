import { describe, it, expect } from "vitest";
import { joinNoticeText, joinWelcomeText, systemLineForViewer } from "./joinMessage";

/**
 * One row, two readings. The BRANCH is tested here, not just the strings: it is
 * the part that would otherwise live as an `if` inside a render function, and
 * it is the part that decides whether someone is greeted or told about a
 * stranger. Getting it backwards shows every member a message addressed to
 * someone else — which is exactly the failure writing two rows would have made
 * permanent.
 */

describe("the two wordings", () => {
  it("third person for everyone else", () => {
    expect(joinNoticeText("Antman")).toBe("Antman has now joined the chat");
  });

  it("a welcome for the person who joined, addressed by first name", () => {
    expect(joinWelcomeText("Antman")).toBe(
      "Hey Antman, welcome to the chat, feel free to introduce yourself."
    );
    expect(joinWelcomeText("Zach Grether")).toBe(
      "Hey Zach, welcome to the chat, feel free to introduce yourself."
    );
  });

  it("drops the address rather than greeting a name it doesn't have", () => {
    for (const missing of [null, undefined, "", "   "]) {
      expect(joinWelcomeText(missing)).toBe(
        "Welcome to the chat, feel free to introduce yourself."
      );
    }
  });

  it("says nothing about missing history — the claim would often be false", () => {
    // On a trip that just went live there IS no prior conversation, so
    // "earlier messages aren't shown" invents a mystery that doesn't exist.
    const all = [joinNoticeText("Antman"), joinWelcomeText("Antman"), joinWelcomeText(null)];
    for (const line of all) {
      expect(line).not.toMatch(/earlier|previous|prior|history|hidden|before you/i);
    }
  });
});

describe("systemLineForViewer — who reads which", () => {
  const row = { text: "Antman has now joined the chat", subjectUserId: "u-antman" };

  it("the subject reads the welcome", () => {
    expect(
      systemLineForViewer({ ...row, viewerId: "u-antman", subjectName: "Antman" })
    ).toBe("Hey Antman, welcome to the chat, feel free to introduce yourself.");
  });

  it("everyone else reads the stored third-person line", () => {
    expect(
      systemLineForViewer({ ...row, viewerId: "u-someone-else", subjectName: "Antman" })
    ).toBe("Antman has now joined the chat");
  });

  it("a system line about no one in particular is left alone", () => {
    // Promotions, go-live notices — lifecycle lines about the trip, not a
    // person. They carry no subject and must render exactly as stored.
    expect(
      systemLineForViewer({
        text: "Dates are locked",
        subjectUserId: null,
        viewerId: "u-antman",
        subjectName: null,
      })
    ).toBe("Dates are locked");
  });

  it("falls back to the stored line before auth has resolved a viewer", () => {
    expect(
      systemLineForViewer({ ...row, viewerId: undefined, subjectName: "Antman" })
    ).toBe("Antman has now joined the chat");
  });

  it("greets the subject even when their name can't be resolved from the roster", () => {
    expect(
      systemLineForViewer({ ...row, viewerId: "u-antman", subjectName: undefined })
    ).toBe("Welcome to the chat, feel free to introduce yourself.");
  });
});
