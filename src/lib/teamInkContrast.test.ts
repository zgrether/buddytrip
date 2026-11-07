import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEAM_COLORS } from "./teamColors";
import { teamInk } from "./teamTextColor";

/**
 * The team TEXT ink clears 4.5 : 1 for every team colour on every surface team
 * text sits on, in both themes (#1703). Read from globals.css itself rather than
 * restated, so loosening a token, or adding a team colour the token cannot carry,
 * fails here. color-mix(in srgb) interpolates the encoded channels, as this does.
 */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const block = (start: string) => {
  const at = css.indexOf(`${start} {`);
  return css.slice(at, css.indexOf("\n}", at));
};
const THEMES = { light: block(":root"), dark: block(".dark") };
const token = (theme: string, name: string) => {
  const m = THEMES[theme as keyof typeof THEMES].match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`${theme} has no --${name}`);
  return m[1].trim();
};

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (s: string) => s.match(/[\d.]+/g)!.map(Number);
const mix = (a: number[], b: number[], pa: number) => a.map((v, i) => v * pa + b[i] * (1 - pa));
const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const POLES: Record<string, number[]> = { black: [0, 0, 0], white: [255, 255, 255] };

/** The surfaces team text sits on, from the theme's own tokens. */
function surfaces(theme: string): Record<string, number[]> {
  const card = hex(token(theme, "color-bt-card"));
  const [r, g, b, a] = rgba(token(theme, "color-bt-accent-faint"));
  const heroStops = token(theme, "color-bt-hero-neutral").match(/#[0-9a-f]{6}/gi)!.map(hex);
  return {
    card,
    raised: hex(token(theme, "color-bt-card-raised")),
    viewerRow: mix([r, g, b], card, a),
    ...Object.fromEntries(heroStops.map((s, i) => [`hero${i}`, s])),
  };
}

function ink(theme: string, color: string): number[] {
  const keep = parseFloat(token(theme, "color-bt-team-ink")) / 100;
  return mix(hex(color), POLES[token(theme, "color-bt-team-ink-toward")], keep);
}

describe.each(["light", "dark"])("the team text ink, %s", (theme) => {
  it("every team colour clears 4.5 : 1 on every surface team text sits on", () => {
    const misses: string[] = [];
    for (const { color, label } of TEAM_COLORS) {
      for (const [name, s] of Object.entries(surfaces(theme))) {
        const c = contrast(ink(theme, color), s);
        if (c < 4.5) misses.push(`${label} on ${name}: ${c.toFixed(2)}`);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe("the ratified values (Zach, #1703)", () => {
  it("light keeps 63% toward black; dark keeps 77% toward white", () => {
    expect([token("light", "color-bt-team-ink"), token("light", "color-bt-team-ink-toward")]).toEqual(["63%", "black"]);
    expect([token("dark", "color-bt-team-ink"), token("dark", "color-bt-team-ink-toward")]).toEqual(["77%", "white"]);
  });
  it("teamInk mixes toward the theme's pole, not a fixed black", () => {
    expect(teamInk("#3b82f6")).toBe("color-mix(in srgb, #3b82f6 var(--color-bt-team-ink), var(--color-bt-team-ink-toward))");
  });
  it("CONTROL: the old dark value, the colour untouched, fails the 4.5 check", () => {
    const misses = TEAM_COLORS.filter(({ color }) => Object.values(surfaces("dark")).some((s) => contrast(hex(color), s) < 4.5)).map((t) => t.label);
    expect(misses).toEqual(expect.arrayContaining(["Blue", "Red", "Purple", "Pink"]));
  });
});
