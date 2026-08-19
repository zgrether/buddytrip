import { describe, it, expect } from "vitest";
import {
  DELETE_CONFIRMATION_WORD,
  normalizeDeleteConfirmationInput,
  isDeleteConfirmed,
} from "./accountDeletionConfirm";

// Regression: the confirmation input renders uppercase via CSS
// (`text-transform: uppercase`), which is display-only. Before this fix, the
// stored value was compared as-typed (`confirmText === "DELETE"`), so a
// lowercase or mixed-case type-out — what a mobile virtual keyboard produces
// by default — displayed as "DELETE" but never matched. The button never
// enabled for anyone who didn't manually shift-type all six letters.
describe("accountDeletionConfirm", () => {
  it("confirms the exact uppercase word", () => {
    expect(isDeleteConfirmed(DELETE_CONFIRMATION_WORD)).toBe(true);
  });

  it("does not confirm on the raw (unnormalized) lowercase value — this was the bug", () => {
    expect(isDeleteConfirmed("delete")).toBe(false);
  });

  it("normalizing lowercase input matches the check — this is the fix", () => {
    expect(isDeleteConfirmed(normalizeDeleteConfirmationInput("delete"))).toBe(true);
  });

  it("normalizing mixed-case input (mobile autocapitalize) matches the check", () => {
    expect(isDeleteConfirmed(normalizeDeleteConfirmationInput("Delete"))).toBe(true);
  });

  it("a trailing space (autocomplete/autocorrect) still confirms", () => {
    expect(isDeleteConfirmed(normalizeDeleteConfirmationInput("delete "))).toBe(true);
  });

  it("wrong confirmation text stays unconfirmed", () => {
    expect(isDeleteConfirmed(normalizeDeleteConfirmationInput("delet"))).toBe(false);
    expect(isDeleteConfirmed(normalizeDeleteConfirmationInput(""))).toBe(false);
    expect(isDeleteConfirmed(normalizeDeleteConfirmationInput("delete me"))).toBe(false);
  });
});
