import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PointsHeroTiers, type PointsHeroUnit } from "./PointsHeroTiers";
import { CompetitionHero } from "./CompetitionHero";
import { ClinchCelebration } from "./ClinchCelebration";
import type { ClinchWatch } from "@/lib/pointsClinch";
import { teamInk } from "@/lib/teamTextColor";
import type { LBTeam } from "./CompetitionLeaderboard";

/**
 * The points hero as it renders (spec §3). The lines are `pointsHeroStory`'s
 * tests; these pin what only the markup holds: the track's geometry, what a
 * projection may draw, and the paint that separates an out contender and the
 * trophy's three states.
 */

const teams: PointsHeroUnit[] = [
  { id: "he", name: "Hot Eagles Cold Beers", shortName: "HECB", color: "#3b82f6" },
  { id: "ba", name: "Bogey Army", shortName: "BA", color: "#22c55e" },
  { id: "hs", name: "Hack Squad", shortName: "HS", color: "#ef4444" },
];

const watch = (over: Partial<ClinchWatch> = {}): ClinchWatch => ({
  bankedGames: 3,
  gamesLeft: 3,
  clincherId: null,
  place: 1,
  leaderIds: ["he"],
  chaserId: "ba",
  lead: 4.5,
  swing: 9,
  projectedLead: null,
  liveSwing: 0,
  segments: [{ gameId: "a", swing: 4 }, { gameId: "b", swing: 3 }, { gameId: "c", swing: 2 }],
  field: [{ id: "he", out: false }, { id: "ba", out: false }, { id: "hs", out: true }],
  alive: 2,
  wins: { wins: null, sets: [], anySet: false },
  winGameNames: [],
  clinchesIfHolds: null,
  newlyOutIds: [],
  ...over,
});

const render = (w: ClinchWatch, final = false, units = teams, totals: Record<string, number> = { he: 18.5, ba: 14, hs: 10 }) =>
  renderToStaticMarkup(<PointsHeroTiers watch={w} units={units} totals={totals} final={final} />);

/** One element's opening tag, by testid. */
function tag(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`);
  if (at < 0) return "";
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

describe("the clinch watch", () => {
  it("the label says what is being raced for, and how many games are left", () => {
    expect(render(watch())).toContain("Clinch watch</span> · 3 games left");
    expect(render(watch({ place: 2, gamesLeft: 1, clincherId: "he" }))).toContain("Clinch watch · 2nd</span> · 1 game left");
  });
  it("one segment per game left, sized by its swing", () => {
    const html = render(watch());
    expect(html.match(/data-testid="clinch-segment"/g)).toHaveLength(3);
    expect(html).toContain("flex:4");
    expect(html).toContain("flex:2");
  });
  it("the fill is the lead over the swing, in the leader's color", () => {
    const fill = tag(render(watch()), "clinch-fill");
    expect(fill).toContain("width:50%");
    expect(fill).toContain("background:#3b82f6");
  });
  it("the caption is the lead on the closest contender, in decimals", () => {
    const html = render(watch());
    expect(html).toContain(">+4.5</b> on Bogey Army");
    expect(html).toContain('aria-label="+4.5 on Bogey Army"');
  });
  it("the post sits at the end of the track, in gold", () => {
    const post = tag(render(watch()), "clinch-post");
    expect(post).toContain("width:4px");
    expect(post).toContain("height:24px");
    expect(post).toContain("var(--color-bt-warning)");
  });
  it("level at the top: no fill and no caption", () => {
    const html = render(watch({ leaderIds: ["he", "ba"], lead: 0 }));
    expect(tag(html, "clinch-fill")).toBe("");
    expect(html).not.toContain("+0");
  });
  it("an out contender fades to 28%; one still alive does not", () => {
    const html = render(watch());
    expect(tag(html, "clinch-contender-hs")).toContain("opacity:0.28");
    expect(tag(html, "clinch-contender-ba")).toContain("opacity:1");
  });
  it("hidden when final, whatever the watch says", () => {
    expect(tag(render(watch(), true), "clinch-watch")).toBe("");
  });
  it("hidden with no game left to watch, as with one reopened for a correction", () => {
    expect(tag(render(watch({ gamesLeft: 0 })), "clinch-watch")).toBe("");
  });
});

describe("what a projection may draw", () => {
  it("nothing projecting: no hatch and no dashed post, so a manual game never shows either", () => {
    const html = render(watch());
    expect(tag(html, "clinch-projected")).toBe("");
    expect(tag(html, "clinch-landing")).toBe("");
  });
  it("a hatched extension to the lead if today holds", () => {
    const tagged = tag(render(watch({ projectedLead: 7.2, liveSwing: 4 })), "clinch-projected");
    expect(tagged).toContain("left:50%");
    expect(tagged).toContain("width:30%");
    expect(tagged).toContain("repeating-linear-gradient");
  });
  it("the dashed post marks where the line lands once the live games bank", () => {
    const landing = tag(render(watch({ projectedLead: 7, liveSwing: 3 })), "clinch-landing");
    expect(landing).toContain("left:66.66");
    expect(landing).toContain("dashed");
  });
  it("a projection below the lead draws nothing backwards", () => {
    expect(tag(render(watch({ projectedLead: 2, liveSwing: 4 })), "clinch-projected")).toBe("");
  });
});

describe("the story tier", () => {
  it("the unit name in its ink, then the headline, then the dim line", () => {
    const html = render(watch());
    expect(tag(html, "points-hero-unit")).toContain("font-size:17px");
    expect(tag(html, "points-hero-unit-name-he")).toContain(`color:${teamInk("#3b82f6")}`);
    expect(tag(html, "points-hero-headline")).toContain("font-size:30px");
    expect(tag(html, "points-hero-sub")).toContain("font-size:13px");
    expect(html).toContain(">Lead by 4.5<");
  });
  it("a shared 1st: each name in its own ink, joined in plain text, and the score in plain text", () => {
    const html = render(watch({ place: null, gamesLeft: 0, leaderIds: [] }), true, teams, { he: 20, ba: 20, hs: 9 });
    expect(html).toContain(">Hot Eagles Cold Beers</span> &amp; <span");
    expect(tag(html, "points-hero-unit")).toContain("color:var(--color-bt-text)");
    expect(tag(html, "points-hero-unit-name-he")).toContain(`color:${teamInk("#3b82f6")}`);
    expect(tag(html, "points-hero-unit-name-ba")).toContain(`color:${teamInk("#22c55e")}`);
    expect(tag(html, "points-hero-headline")).toContain("color:var(--color-bt-text)");
  });
  it("a shared 1st's line is It's a tie! at 20/800, full strength, in place of the Final line", () => {
    const html = render(watch({ place: null, gamesLeft: 0, leaderIds: [] }), true, teams, { he: 20, ba: 20, hs: 9 });
    const sub = tag(html, "points-hero-sub");
    expect(sub).toContain("font-size:20px;font-weight:800;color:var(--color-bt-text)");
    expect(html).toContain(">It&#x27;s a tie!<");
    expect(html).not.toContain("Final ·");
  });
  it("one winner's line stays dim at 13", () => {
    const html = render(watch({ place: null, gamesLeft: 0, clincherId: "he", leaderIds: [] }), true);
    expect(tag(html, "points-hero-sub")).toContain("font-size:13px;color:var(--color-bt-text-dim)");
  });
  it("final: the winner's score at 74", () => {
    const html = render(watch({ place: null, gamesLeft: 0, clincherId: "he", leaderIds: [] }), true);
    expect(tag(html, "points-hero-headline")).toContain("font-size:74px");
    expect(html).toContain(">18.5<");
    expect(html).toContain("Final · Hot Eagles Cold Beers wins");
  });
});

describe("people behave like teams", () => {
  const people: PointsHeroUnit[] = [
    { id: "he", name: "Pat", shortName: null, color: null },
    { id: "ba", name: "Mo", shortName: null, color: null },
    { id: "hs", name: "Oz", shortName: null, color: null },
  ];
  it("fill and name use PERSON_COLOR, and contenders are Avatars", () => {
    const html = render(watch(), false, people);
    expect(tag(html, "clinch-fill")).toContain("background:var(--color-bt-accent)");
    expect(tag(html, "points-hero-unit-name-he")).toContain("color:var(--color-bt-accent)");
    expect(html).not.toContain("clinch-contender-he\"><span role");
    expect(html).toContain(">+4.5</b> on Mo");
  });
});

describe("the trophy's three states", () => {
  /** The trophy's own opacity: the group the art hangs from. */
  const opacity = (html: string) => html.match(/<g opacity="([\d.]+)"/)?.[1];
  const trophy = (over: Partial<React.ComponentProps<typeof ClinchCelebration>>) =>
    renderToStaticMarkup(<ClinchCelebration cupComplete={false} winnerColor={null} celebrate={false} {...over} />);

  it("open: 0.17 and untinted", () => {
    expect(opacity(trophy({}))).toBe("0.17");
  });
  it("1st clinched: 0.3, tinted with the clincher's color, and no wash", () => {
    const html = trophy({ clinched: true, winnerColor: "#3b82f6" });
    expect(opacity(html)).toBe("0.3");
    expect(html).toContain("#3b82f6");
    expect(html).not.toContain("color-mix(in srgb, #3b82f6 24%");
  });
  it("final: 0.42 and lit", () => {
    const html = trophy({ cupComplete: true, winnerColor: "#3b82f6" });
    expect(opacity(html)).toBe("0.42");
    expect(html).toContain("color-mix(in srgb, #3b82f6 24%");
  });
  it("CONTROL: match play never passes clinched, so a clincher alone leaves it resting", () => {
    expect(opacity(trophy({ winnerColor: "#3b82f6" }))).toBe("0.17");
  });
});

const pointsCup = (over: Partial<NonNullable<React.ComponentProps<typeof CompetitionHero>["pointsHero"]>> = {}) => ({
  watch: watch(),
  units: teams,
  awaitingFinish: false,
  announced: false,
  tiebreakOrder: null,
  winnerIds: [],
  ...over,
});

describe("the hero", () => {
  const lbTeams = teams.map((t) => ({ id: t.id, name: t.name, short_name: t.shortName, color: t.color })) as LBTeam[];
  const hero = (over: Partial<React.ComponentProps<typeof CompetitionHero>>) =>
    renderToStaticMarkup(
      <CompetitionHero
        cupName="BBMI"
        tagline={null}
        teams={lbTeams}
        teamTotals={{ he: 18.5, ba: 14, hs: 10 }}
        pointsAvailable={30}
        winNumber={15.5}
        clincher={null}
        gamesRemaining={3}
        scoringModel="points"
        canEdit={false}
        {...over}
      />
    );
  it("a points cup draws the story and the trophy", () => {
    const html = hero({ pointsHero: pointsCup() });
    expect(html).toContain('data-testid="points-hero-story"');
    expect(html).toContain('data-testid="hero-trophy"');
  });
  it("Final offers the winners their fireworks, and nobody else", () => {
    const final = { pointsHero: pointsCup({ winnerIds: ["he"] }), cupComplete: true };
    expect(hero({ ...final, canReplayCelebration: true })).toContain('data-testid="clinch-replay-btn"');
    expect(hero({ ...final, canReplayCelebration: false })).not.toContain("clinch-replay-btn");
  });
  it("no fireworks before Final, whoever is looking", () => {
    expect(hero({ pointsHero: pointsCup({ winnerIds: [] }), canReplayCelebration: true })).not.toContain("clinch-replay-btn");
  });
  it("the burst reaches a points cup's trophy: a first view at Final sparks", () => {
    const final = { pointsHero: pointsCup({ winnerIds: ["he"] }), cupComplete: true };
    expect(hero({ ...final, celebrateFirstView: true })).toContain('data-testid="clinch-sparks"');
    expect(hero({ ...final, celebrateFirstView: false })).not.toContain("clinch-sparks");
  });
  it("a shared 1st lights the trophy with no one colour", () => {
    const html = hero({ pointsHero: pointsCup({ winnerIds: ["he", "ba"] }), cupComplete: true });
    expect(html).toContain('data-testid="clinch-glow"');
  });
  it("a board waiting to be finished keeps the trophy at rest, even with the math clinched", () => {
    const resting = hero({ pointsHero: pointsCup({ watch: watch({ clincherId: null }) }) });
    const waiting = hero({ pointsHero: pointsCup({ watch: watch({ clincherId: "he" }), awaitingFinish: true }) });
    const announced = hero({ pointsHero: pointsCup({ watch: watch({ clincherId: "he" }), awaitingFinish: true, announced: true }) });
    const trophyOpacity = (html: string) => html.match(/<g opacity="([0-9.]+)"/)?.[1];
    expect(trophyOpacity(resting)).toBe("0.17");
    expect(trophyOpacity(waiting)).toBe("0.17");
    expect(trophyOpacity(announced), "the control: an announced clinch does tint").toBe("0.3");
  });
  it("CONTROL: a head-to-head Cup never gets either tier", () => {
    const two = lbTeams.slice(0, 2);
    const html = hero({ teams: two, teamTotals: { he: 3, ba: 2 }, scoringModel: "match_play" });
    expect(html).not.toContain("points-hero-story");
    expect(html).not.toContain("clinch-watch");
  });
});

describe("the board's points gates (source)", () => {
  const board = readFileSync(join(__dirname, "CompetitionLeaderboard.tsx"), "utf8");
  it("the more-than-half clincher is head to head only: it decides nothing on a points cup", () => {
    expect(board).toMatch(/const clincher = isMatchPlay \? teams\.find\(/);
  });
  it("a points cup is final when someone finished it, never by isCupComplete or an empty board", () => {
    expect(board).toMatch(/const cupComplete = isMatchPlay \? isCupComplete\(data\.games, !!clincher\) : data\.clinch\?\.final === true;/);
  });
  it("Finish brings the hero into view once Final has rendered, or the burst plays off screen", () => {
    const effect = board.indexOf("if (!isFinal || !finishedHere.current) return;");
    const scroll = board.indexOf("scrollIntoView({ block: \"center\" })", effect);
    expect(effect).toBeGreaterThan(-1);
    expect(scroll - effect).toBeLessThan(160);
  });
  it("the burst is for whoever holds 1st, read from the winners rather than a clincher", () => {
    expect(board).toMatch(/data\.clinch\.winnerIds\.includes\(myUnitId\)/);
  });
});
