import { describe, it, expect } from "vitest";
import {
  parseTime,
  toTime24,
  formatTime12,
  DAYPART_PRESETS,
  TEE_PRESETS,
  type TimeValue,
} from "./time";

describe("parseTime", () => {
  it("parses a morning time", () => {
    expect(parseTime("08:05")).toEqual({ h: 8, m: 5, period: "AM" });
  });

  it("parses an afternoon time", () => {
    expect(parseTime("15:42")).toEqual({ h: 3, m: 42, period: "PM" });
  });

  it("maps midnight to 12 AM", () => {
    expect(parseTime("00:00")).toEqual({ h: 12, m: 0, period: "AM" });
  });

  it("maps noon to 12 PM", () => {
    expect(parseTime("12:00")).toEqual({ h: 12, m: 0, period: "PM" });
  });

  it("maps 12:30 to 12:30 PM", () => {
    expect(parseTime("12:30")).toEqual({ h: 12, m: 30, period: "PM" });
  });

  it("maps 23:59 to 11:59 PM", () => {
    expect(parseTime("23:59")).toEqual({ h: 11, m: 59, period: "PM" });
  });

  it("returns null for empty / nullish input", () => {
    expect(parseTime("")).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseTime("not-a-time")).toBeNull();
    expect(parseTime("12")).toBeNull();
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("12:60")).toBeNull();
  });
});

describe("toTime24", () => {
  it("converts an AM time", () => {
    expect(toTime24({ h: 8, m: 5, period: "AM" })).toBe("08:05");
  });

  it("converts a PM time", () => {
    expect(toTime24({ h: 3, m: 42, period: "PM" })).toBe("15:42");
  });

  it("converts 12 AM to midnight", () => {
    expect(toTime24({ h: 12, m: 0, period: "AM" })).toBe("00:00");
  });

  it("converts 12 PM to noon", () => {
    expect(toTime24({ h: 12, m: 0, period: "PM" })).toBe("12:00");
  });

  it("converts 11:59 PM", () => {
    expect(toTime24({ h: 11, m: 59, period: "PM" })).toBe("23:59");
  });
});

describe("round-trip parseTime ↔ toTime24", () => {
  const samples = ["00:00", "00:30", "06:15", "11:59", "12:00", "12:45", "15:42", "23:59"];
  for (const s of samples) {
    it(`is stable for ${s}`, () => {
      const v = parseTime(s) as TimeValue;
      expect(v).not.toBeNull();
      expect(toTime24(v)).toBe(s);
    });
  }
});

describe("formatTime12", () => {
  it("formats with zero-padded minutes and un-padded hour", () => {
    expect(formatTime12({ h: 3, m: 42, period: "PM" })).toBe("3:42 PM");
    expect(formatTime12({ h: 8, m: 0, period: "AM" })).toBe("8:00 AM");
    expect(formatTime12({ h: 12, m: 5, period: "AM" })).toBe("12:05 AM");
  });
});

describe("presets", () => {
  it("daypart presets convert to expected 24h strings", () => {
    expect(DAYPART_PRESETS.map((p) => toTime24(p.value))).toEqual([
      "08:00",
      "12:00",
      "18:00",
    ]);
  });

  it("tee presets are all valid times", () => {
    for (const p of TEE_PRESETS) {
      expect(parseTime(toTime24(p.value))).toEqual(p.value);
    }
  });
});
