"use client";

/**
 * ── The trophy SLOT ─────────────────────────────────────────────────────────
 *
 * The hero's centrepiece, extracted from `CompetitionHero` so it is a single
 * component behind a stable contract rather than a path woven through the
 * celebration. Custom artwork is expected to replace it; swapping is a one-line
 * change at the call site:
 *
 *     <CompetitionHero trophy={MyNewArtwork} />
 *
 * Nothing in the animation touches the geometry. `ClinchCelebration` positions,
 * animates and lights the SLOT; the slot decides only what shape appears and how
 * it takes a tint. A replacement need only honour `TrophySlotProps`.
 */

export interface TrophySlotProps {
  /**
   * 0.17 at rest (the long-standing watermark) → ~1 when lit for a finished
   * cup. The consumer picks the value; the slot just applies it, so a
   * replacement doesn't have to know why.
   */
  opacity: number;
  /**
   * The winning team's colour, or null for the default gold. A slot is free to
   * ignore this (a mono artwork legitimately might) — the celebration's radial
   * wash carries the team colour regardless, so nothing breaks if it does.
   */
  tint: string | null;
}

/** Any component that can occupy the hero's centre. */
export type TrophySlot = React.ComponentType<TrophySlotProps>;

/**
 * Bill mid-follow-through -- the golfer logo, verbatim from the supplied
 * `bill-swing.svg` (viewBox 0 0 1188 1870, evenodd fill rule so the gap
 * between arm and body stays open). He is engraved into the bowl in place of
 * the star, scaled and centred by the transform on his `<g>` below.
 */
const BILL_SWING_PATH =
  "M258 12.2C249.8 12.4 244.3 13.5 237 16.5C229.7 19.5 220 25.1 214 30.2C208 35.3 204.4 39.7 201 47C197.6 54.3 197.5 67.4 193.6 73.7C189.7 80.1 180 80.7 177.4 85.2C174.9 89.6 175.1 96.8 178.3 100.6C181.5 104.3 192.9 105.7 196.4 107.8C200 109.9 199.1 109.7 199.6 113.1C200.1 116.5 200.7 119.7 199.3 128C197.9 136.3 208.2 143.3 191.2 162.8C174.2 182.3 119.9 223.2 97.4 245C74.9 266.9 70.4 275.5 56.2 294C42.1 312.5 18.9 342.4 12.4 356C5.9 369.6 14.7 370.1 17.3 375.6C19.9 381.2 23.7 385 28.1 389.3C32.6 393.5 21.9 396 44 401.1C66.2 406.2 140.4 416.1 161 419.8C181.5 423.6 165.6 420.8 167.3 423.6C169.1 426.5 169.8 433.9 171.3 436.8C172.8 439.8 167.1 440.6 176.2 441.5C185.3 442.4 216.9 441.8 225.9 442.4C234.9 442.9 229.4 443.6 230.4 444.9C231.4 446.1 235.6 435.7 231.8 450C228 464.4 218.9 501.8 207.6 531C196.2 560.2 173.9 604 163.7 625C153.5 646 156.6 640.7 146.3 657C135.9 673.3 112.9 704.3 101.5 723C90 741.7 83.7 756 77.7 769C71.7 782 70.6 791.3 65.6 801C60.6 810.7 50.9 818.7 47.7 827C44.5 835.3 47.8 843.5 46.7 851C45.6 858.5 40 866.6 41 871.8C42 877.1 50.5 879.6 52.8 882.6C55.1 885.6 54.7 834.9 54.9 890C55.2 945.1 53.7 1157.7 54.2 1213C54.6 1268.3 55.2 1219.7 57.7 1222.1C60.2 1224.5 53.2 1225.1 69 1227.6C84.8 1230 137.8 1234 152.4 1236.8C167 1239.5 154.9 1237.5 156.6 1244C158.4 1250.6 161.5 1262.8 162.8 1276C164.1 1289.2 165.6 1307.3 164.4 1323C163.2 1338.7 161.1 1347.8 155.7 1370C150.3 1392.2 136.9 1433.5 131.9 1456C126.8 1478.5 126.3 1491.5 125.2 1505C124.1 1518.5 122.2 1506 125.5 1537C128.7 1568 141.5 1658.8 144.7 1691C148 1723.2 145.4 1717.5 145 1730C144.5 1742.5 145 1756.8 142.1 1766C139.3 1775.1 131.9 1773 127.8 1785C123.8 1797 119.2 1827.7 117.8 1838C116.3 1848.3 117.5 1844.5 118.9 1846.6C120.3 1848.7 114.7 1849.2 126 1850.7C137.4 1852.2 173.2 1856.4 187 1855.3C200.8 1854.3 199.5 1844.1 209 1844.2C218.5 1844.3 214.5 1853.8 244 1855.8C273.5 1857.9 360.1 1857 386 1856.6C411.9 1856.1 395.6 1855.9 399.5 1853.3C403.3 1850.6 404.2 1842.3 409.1 1840.7C414.1 1839 414 1843.9 429 1843.3C444 1842.6 482.8 1840.1 499 1836.9C515.2 1833.8 520.3 1828 525.9 1824.5C531.6 1821 532 1818.4 532.7 1816.1C533.5 1813.8 532.6 1812.3 530.5 1810.5C528.3 1808.8 531.9 1808.8 520 1805.5C508.1 1802.2 475.7 1797 459.1 1790.8C442.5 1784.7 431.9 1776.3 420.5 1768.5C409 1760.8 398.1 1751.9 390.1 1744.3C382.1 1736.7 375.9 1728.6 372.6 1722.9C369.3 1717.2 368.6 1719.3 370.4 1710C372.2 1700.7 378.9 1679.3 383.3 1667C387.7 1654.7 379.1 1669.8 396.6 1636C414.1 1602.2 464.4 1507.2 488.2 1464C512.1 1420.8 530 1395 539.8 1377C549.5 1359 545.5 1363 546.7 1356C547.9 1349 550.7 1349.5 547 1335C543.3 1320.5 534.9 1313 524.5 1269C514.1 1225 494.3 1110.2 484.8 1071C475.3 1031.8 470.2 1044.4 467.5 1033.9C464.9 1023.4 469.4 1016.5 468.8 1008C468.3 999.5 463.5 992.8 464.3 983C465.1 973.2 471.6 971.3 473.6 949C475.7 926.7 470.3 880.8 476.7 849C483.1 817.2 502.4 779.3 512.1 758C521.9 736.7 527 730.7 535.3 721.2C543.6 711.7 551.9 709.9 562 700.9C572 692 586.2 677.6 595.4 667.7C604.6 657.7 610.1 647.7 617 641.2C623.9 634.6 629.3 636.2 637.1 628.5C644.9 620.8 656.1 603.6 663.6 595C671.1 586.4 673.4 589 682.1 577C690.8 565 709.6 534.7 716 523C722.5 511.3 720.1 514.5 720.8 507C721.4 499.5 721.9 486.7 720.1 478C718.3 469.3 714.5 462.3 710.1 455C705.7 447.7 696 439.3 693.6 434C691.2 428.7 691.7 428.1 695.4 423C699.2 417.9 711.4 409 716.1 403.4C720.8 397.8 716.5 394.6 723.8 389.3C731.1 384 752.4 374.3 760 371.8C767.6 369.3 764.5 369.8 769.2 374.5C773.9 379.2 783.9 395.4 788.1 399.8C792.4 404.2 792.9 401.5 794.7 400.8C796.5 400.2 798.8 399.5 798.9 395.9C799 392.3 799.4 389.3 795.2 379C790.9 368.7 775.1 351.5 773.4 334C771.6 316.5 783.6 290.3 784.8 274C786 257.7 782.7 245.2 780.4 236C778 226.8 776.6 226.8 770.5 219C764.3 211.2 752.4 196.6 743.3 189.4C734.1 182.3 720.5 179.6 715.5 176.2C710.5 172.7 712.6 170.4 713.2 168.8C713.8 167.1 656.1 157.8 719.1 166.4C782 175 1028.1 210.1 1090.7 220.4C1153.3 230.6 1095.4 222.7 1094.8 228C1094.1 233.3 1087.8 246.9 1086.5 252.2C1085.2 257.5 1083.1 249.4 1087 259.6C1090.9 269.9 1103.5 302.4 1110 313.5C1116.5 324.6 1120.9 324.3 1126.1 326.2C1131.2 328 1136.9 326.3 1140.9 324.8C1145 323.2 1148 320.8 1150.3 316.8C1152.7 312.7 1151.6 306.5 1155.1 300.5C1158.6 294.5 1168.1 286.3 1171.3 280.7C1174.5 275.1 1175.1 273.3 1174.4 267C1173.7 260.7 1172 251.7 1167.1 243C1162.2 234.3 1149.4 223.4 1145.1 214.8C1140.9 206.2 1144.6 196.3 1141.7 191.6C1138.8 186.8 1130.8 188.3 1127.8 186.3C1124.7 184.3 1124.5 180.2 1123.3 179.6C1122.1 179.1 1120.6 179.5 1120.5 183.2C1120.4 186.9 1122.9 197.8 1122.8 201.9C1122.8 206.1 1129.7 206.9 1120.2 207.9C1110.8 208.8 1168.5 221.9 1066 207.6C963.5 193.4 602 137.6 505 122.4C408 107.2 507.5 120.2 484 116.5C460.5 112.8 385.2 103.6 364 100.3C342.8 96.9 359.1 99.5 356.7 96.4C354.3 93.2 353.6 85.4 349.7 81.4C345.8 77.5 337.6 78.6 333.3 72.6C329 66.5 328 52.5 323.9 45C319.9 37.5 315.3 32.5 309 27.5C302.7 22.6 294.5 17.9 286 15.3C277.5 12.8 266.2 12 258 12.2ZM365.9 1287.5C376.1 1286.9 369.6 1288.6 372.1 1292.2C374.5 1295.8 376.7 1298.9 380.6 1309C384.5 1319.1 393.2 1342 395.5 1353C397.8 1364 402.3 1361.2 394.4 1375C386.6 1388.8 360.3 1418 348.5 1436C336.8 1454 330.4 1467.5 324.1 1483C317.9 1498.5 314.4 1506.3 311 1529C307.5 1551.7 307.1 1593.5 303.5 1619C299.9 1644.5 295 1664.2 289.4 1682C283.9 1699.8 276.1 1716 270.2 1725.9C264.3 1735.9 257.9 1738.8 253.7 1741.7C249.6 1744.6 248.3 1745.4 245.2 1743.4C242.1 1741.5 238 1736.1 235.3 1730C232.6 1723.9 230.7 1722.5 229 1707C227.3 1691.5 224.2 1660.7 225.1 1637C226 1613.3 228.1 1603.8 234.3 1565C240.6 1526.2 255.1 1440.2 262.6 1404C270.1 1367.8 272.9 1365.2 279.3 1348C285.7 1330.8 295.9 1309.3 301.2 1300.6C306.5 1292 300.2 1298.2 311 1296.1C321.8 1293.9 355.7 1288.2 365.9 1287.5ZM288.5 182.1C285.2 175.3 286.6 178.5 292.3 175.6C298.1 172.7 312.7 171.9 323 164.5C333.3 157.1 344.9 138.2 354.2 131.2C363.5 124.1 356.5 122 379 122.1C401.5 122.2 442.3 126 489 131.9C535.7 137.8 629.4 152.3 659 157.5C688.5 162.6 665.6 161.3 666.4 163C667.1 164.7 667.9 165.4 663.5 167.4C659.1 169.4 650.9 169.9 640 174.9C629.1 179.9 607.6 191.1 598.3 197.4C589 203.8 587.5 207.2 584.3 213C581.1 218.8 583.9 228.1 578.9 232.4C573.8 236.7 561.3 232.7 554.1 238.9C547 245.2 538.4 259 536 270C533.6 281 540.3 297.4 539.7 305C539.1 312.6 535 313.1 532.6 315.4C530.1 317.6 530.4 319.6 525 318.6C519.6 317.6 509.7 310.4 500 309.4C490.3 308.3 475.4 314.2 467.1 312.3C458.7 310.4 466.4 304.3 450 298.1C433.5 292 386.2 283.1 368.3 275.4C350.5 267.7 352.2 261.7 342.9 251.9C333.6 242.1 321.5 228.2 312.4 216.5C303.4 204.9 291.9 188.9 288.5 182.1Z";

/** Bill's own viewBox, the divisor for the engraving's scale. */
const BILL_W = 1188;
const BILL_H = 1870;

/**
 * Engraved height in trophy units, against the 54-tall star he replaces. Bill
 * is a narrow upright figure, so matching the star's height reads as a shrink;
 * 82.5 lands him ~52 wide, still clear of the bowl's walls at this height.
 */
const BILL_H_UNITS = 82.5;
const BILL_SCALE = BILL_H_UNITS / BILL_H;

/**
 * Bill's INK centroid in his own coordinates — the x his mass actually sits on,
 * computed by flattening his path and taking the signed-area centroid of the
 * outline minus its two holes.
 *
 * **Not his bounding-box centre, which is 594.** The club extends ~380 units
 * past his hands with almost no ink on it, so a bbox-centred Bill hangs his
 * body ~11 units left of the axis the eye reads the trophy on: the figure looks
 * off-centre while the geometry insists it is centred. Centring on the centroid
 * puts the BODY on the trophy's spine and lets the club overhang to the right,
 * which is what the shape is doing anyway.
 *
 * Recompute this if the artwork is ever replaced — it is a property of the
 * path, not a nudge, and it is the reason the offset survives a size change.
 */
const BILL_INK_CX = 354.2;

/** Body on the trophy's spine; vertical centre still the star's own. */
const BILL_X = 150 - BILL_INK_CX * BILL_SCALE;
const BILL_Y = 159.1 - BILL_H_UNITS / 2;

/**
 * The dimensional gold trophy — verbatim geometry from the approved
 * `hero_trophy_reference.html` (viewBox 0 0 300 380). Open modeled mouth,
 * gradient-lit round body, slim knopped pedestal, engraved with Bill. Raw hex is the
 * sanctioned hero art (STYLE_GUIDE's hero-gradient carve-out, the same
 * exception `teamGlow` already uses). IDs are prefixed to avoid `<defs>` clashes.
 *
 * **Tinting mixes into the existing gradient stops rather than overlaying the
 * shape.** An overlay would need either a duplicate copy of every path or a
 * `mix-blend-mode` layer — and a blend layer over a transparent box tints the
 * hero card behind it, not the trophy. Mixing at the stops keeps the modeling
 * (the light-to-shadow ramp that makes it read as round) and simply moves its
 * hue toward the winner, which is what "lit in the winner's colour" means.
 * `color-mix` is already in use in this hero for the team glow.
 */
export function CupTrophy({ opacity, tint }: TrophySlotProps) {
  // Gold stays the dominant note even when tinted — a trophy that becomes a
  // flat team-coloured silhouette stops reading as metal. The mix is weighted
  // so the winner's colour is unmistakable but the modeling survives.
  const mix = (gold: string, pct: number) =>
    tint ? `color-mix(in srgb, ${tint} ${pct}%, ${gold})` : gold;

  return (
    <svg
      width="300"
      viewBox="0 0 300 380"
      aria-hidden="true"
      style={{ pointerEvents: "none", display: "block" }}
    >
      <defs>
        <linearGradient id="btHeroBowl" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={mix("#f6e0a0", 26)} />
          <stop offset="0.42" stopColor={mix("#d9b350", 38)} />
          <stop offset="1" stopColor={mix("#8a6a24", 30)} />
        </linearGradient>
        <linearGradient id="btHeroBase" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={mix("#ecd282", 26)} />
          <stop offset="1" stopColor={mix("#87682a", 30)} />
        </linearGradient>
      </defs>
      <g opacity={opacity}>
        {/* base (two tiers) + knop + narrow tall pedestal */}
        <rect x="96" y="320" width="108" height="24" rx="6" fill="url(#btHeroBase)" />
        <rect x="120" y="305" width="60" height="15" rx="4" fill="url(#btHeroBase)" />
        <ellipse cx="150" cy="298" rx="19" ry="8" fill="url(#btHeroBase)" />
        <rect x="142" y="258" width="16" height="42" fill="url(#btHeroBase)" />
        {/* slim handles (lit left / shadow right) */}
        <path d="M60,104 Q24,114 32,166 Q38,204 82,198" fill="none" stroke={mix("#cfa94e", 32)} strokeWidth="13" strokeLinecap="round" />
        <path d="M240,104 Q276,114 268,166 Q262,204 218,198" fill="none" stroke={mix("#a5822f", 32)} strokeWidth="13" strokeLinecap="round" />
        {/* bowl body: left->right gradient = round modeling */}
        <path d="M58,88 Q58,228 150,260 Q242,228 242,88 Z" fill="url(#btHeroBowl)" />
        {/* soft highlight on the lit side */}
        <ellipse cx="106" cy="152" rx="11" ry="52" fill="#fff0bf" opacity="0.5" />
        {/* engraved Bill, our golfer (darker gold = recessed) */}
        <g transform={`translate(${BILL_X} ${BILL_Y}) scale(${BILL_SCALE})`}>
          <path d={BILL_SWING_PATH} fillRule="evenodd" fill={mix("#57411a", 30)} />
        </g>
        {/* open mouth: light rim ellipse + dark inner hollow + faint far-wall shadow */}
        <ellipse cx="150" cy="86" rx="92" ry="19" fill="url(#btHeroBowl)" />
        <ellipse cx="150" cy="85" rx="75" ry="13" fill={mix("#4a3915", 26)} />
        <ellipse cx="133" cy="82" rx="38" ry="6" fill={mix("#6b5320", 26)} opacity="0.7" />
      </g>
    </svg>
  );
}
