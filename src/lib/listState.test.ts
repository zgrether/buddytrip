import { describe, it, expect, vi } from "vitest";
import { listStateOf, fetchListState } from "./listState";

/**
 * #1616 — a list screen's state has ONE order: a failed read is `error`, never
 * `empty`. Fed the shapes a TanStack query really takes: on a failed FIRST load
 * `data` is `undefined` and `isError` is true; on a failed REFETCH the last
 * good `data` is kept and `isError` is also true.
 */

const q = <T,>(data: T | undefined, isError = false) => ({ data, isError, refetch: vi.fn() });

describe("listStateOf", () => {
  it("a FAILED first load is the error state, never empty", () => {
    const query = q<string[]>(undefined, true);
    const s = listStateOf(query);
    expect(s.kind).toBe("error");
    if (s.kind === "error") {
      s.retry();
      expect(query.refetch).toHaveBeenCalledTimes(1);
    }
  });

  it("a first load still in flight is loading, never empty", () => {
    expect(listStateOf(q<string[]>(undefined)).kind).toBe("loading");
  });

  it("an answered empty list is empty", () => {
    expect(listStateOf(q<string[]>([]))).toEqual({ kind: "empty", data: [] });
  });

  it("an answered list is ready", () => {
    expect(listStateOf(q(["a"]))).toEqual({ kind: "ready", data: ["a"] });
  });

  it("a failed REFETCH keeps the last good list on screen", () => {
    expect(listStateOf(q(["a"], true))).toEqual({ kind: "ready", data: ["a"] });
  });

  it("a failed refetch of an answered EMPTY list stays empty (that answer is still the last good one)", () => {
    expect(listStateOf(q<string[]>([], true)).kind).toBe("empty");
  });

  it("takes the screen's own idea of empty", () => {
    const board = { games: [] as string[], teams: ["A"] };
    expect(listStateOf(q(board), (b) => b.games.length === 0).kind).toBe("empty");
    expect(listStateOf(q({ ...board, games: ["g"] }), (b) => b.games.length === 0).kind).toBe("ready");
  });
});

describe("fetchListState (a plain fetch reporting its own outcome)", () => {
  const f = <T,>(over: Partial<{ pending: boolean; failed: boolean; data: T | undefined }>) => ({
    pending: false, failed: false, data: undefined as T | undefined, retry: vi.fn(), ...over,
  });

  it("a failed fetch is the error state, never empty", () => {
    expect(fetchListState(f<string[]>({ failed: true })).kind).toBe("error");
  });

  it("in flight is loading", () => {
    expect(fetchListState(f<string[]>({ pending: true })).kind).toBe("loading");
  });

  it("an answered empty result is empty, and an answered result is ready", () => {
    expect(fetchListState(f<string[]>({ data: [] })).kind).toBe("empty");
    expect(fetchListState(f({ data: ["x"] })).kind).toBe("ready");
  });
});
