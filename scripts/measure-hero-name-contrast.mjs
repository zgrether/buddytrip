// Head-to-head hero team names: contrast against the pixels actually behind them (#1703).
//
// The names sit across the trophy art, so their contrast cannot be computed from the
// tokens: it has to be measured on a rendered page. This loads each cup page at 390px,
// makes each name's glyphs transparent (its halo stays, since the halo is what sits
// behind the glyph), photographs the name's box, and takes WCAG contrast at every pixel
// between the name's ink and that pixel. The bar is the 10th percentile (Zach, #1704):
// the worst single pixel can fall where neither glyph nor halo reaches.
//
// Needs a running app on :3000 and the e2e owner's login (e2e/.auth/owner.json, from
// `npx playwright test --project=setup`). Pass head-to-head cup pages that owner can see.
//
//   node scripts/measure-hero-name-contrast.mjs [--theme dark|light|both] [--as-before] <cup path>...
//   e.g. node scripts/measure-hero-name-contrast.mjs --theme both "/trips/<id>?view=cup"
//
// Exits 1 if any name's 10th percentile is under 4.5. `--as-before` paints the names
// as they were before #1703 (the card ink, no halo), which fails on a shared Final:
// run it once to see the check can go red.
import { chromium } from "@playwright/test";

const BAR = 4.5;
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const flag = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const themeArg = opt("--theme") ?? "both";
const asBefore = flag("--as-before");
const paths = args;
if (paths.length === 0) { console.error("Pass at least one head-to-head cup path."); process.exit(2); }
const themes = themeArg === "both" ? ["dark", "light"] : [themeArg];

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "e2e/.auth/owner.json", viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
let failed = false;

for (const path of paths) {
  for (const theme of themes) {
    await page.goto("http://localhost:3000" + path);
    await page.waitForSelector('[data-testid="hero-team-name-a"]', { timeout: 60000 });
    await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
    await page.addStyleTag({ content: ".cup-spark{display:none!important}" });
    if (asBefore) {
      // The card ink is teamInk(raw colour); the name carries its raw team colour.
      await page.evaluate(() => {
        for (const side of ["a", "b"]) {
          const n = document.querySelector(`[data-testid="hero-team-name-${side}"]`);
          const raw = n?.dataset.teamColor;
          if (!n || !raw) continue;
          n.style.textShadow = "none";
          n.style.color = `color-mix(in srgb, ${raw} var(--color-bt-team-ink), var(--color-bt-team-ink-toward))`;
        }
      });
    }
    await page.waitForTimeout(1500);
    await page.locator('[data-testid="competition-hero"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const names = await page.$$eval('[data-testid^="hero-team-name-"]', (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.dataset.testid, text: e.textContent, color: getComputedStyle(e).color, box: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } };
      })
    );
    const hide = await page.addStyleTag({ content: '[data-testid^="hero-team-name-"]{color:transparent!important}' });
    await page.waitForTimeout(200);
    for (const n of names) {
      const png = await page.screenshot({ clip: n.box });
      const m = n.color.match(/[\d.]+/g).map(Number);
      const ink = n.color.startsWith("color(") ? m.slice(0, 3).map((v) => v * 255) : m.slice(0, 3);
      const p10 = await page.evaluate(async ({ b64, ink }) => {
        const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
        const Lt = L(ink);
        const all = [];
        for (let i = 0; i < d.length; i += 4) { const Lb = L([d[i], d[i + 1], d[i + 2]]); all.push((Math.max(Lt, Lb) + 0.05) / (Math.min(Lt, Lb) + 0.05)); }
        all.sort((a, b) => a - b);
        return all[Math.floor(all.length * 0.1)];
      }, { b64: png.toString("base64"), ink });
      const ok = p10 >= BAR;
      if (!ok) failed = true;
      console.log(`${ok ? "pass" : "FAIL"}  ${theme.padEnd(5)}  ${n.text.padEnd(24)}  p10 ${p10.toFixed(2)}  (${path})`);
    }
    await hide.evaluate((el) => el.remove());
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
