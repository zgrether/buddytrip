// explorations-timeconcepts.jsx — interweaving TIME MARKERS (instants) and
// DURATION BLOCKS (spans of fuzzy length). Deliberately NOT the current
// stacked-card design — exploring new visual languages.
//
//   A · Pins & capsules   — one time field: instants are pins ON the spine,
//        durations are capsules in a parallel lane; unknown length fades out.
//   B · Anchors & flows   — instants are hard ANCHORS; the soft activity
//        between two anchors is a "flow" band that fills the gap (no clock).
//   C · Clock vs. agenda  — split the day: a precise timed rail on the left,
//        an ordered "takes a while" stack on the right.

(function injectTCss() {
  if (typeof document === 'undefined' || document.getElementById('btTCCss')) return;
  const css = `
  .tc { background:var(--color-bt-base); height:100%; overflow:auto; color:var(--color-bt-text); container-type:inline-size; }
  .tc-wrap { padding:22px 24px 50px; }
  .tc-daylabel { font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--color-bt-accent); margin-bottom:18px; }
  .tc-legend { display:flex; gap:16px; margin-bottom:18px; flex-wrap:wrap; }
  .tc-lg { display:inline-flex; align-items:center; gap:7px; font-size:11.5px; color:var(--color-bt-text-dim); }
  .tc-lgmark { width:11px; height:11px; transform:rotate(45deg); background:var(--color-bt-text); }
  .tc-lgblock { width:16px; height:11px; border-radius:4px; background:linear-gradient(var(--color-bt-card-raised), transparent); border:1px solid var(--color-bt-border); }

  /* category color var */
  .c-travel { --c:var(--color-bt-accent); }
  .c-lodging { --c:var(--color-bt-planning); }
  .c-events { --c:var(--color-bt-ready); }
  .c-golf { --c:#22c55e; }

  /* ── A · Pins & capsules ──────────────────────────────────────────── */
  .pc { position:relative; }
  .pc-hour { position:absolute; left:0; right:0; height:0; border-top:1px solid var(--color-bt-subtle-border); }
  .pc-hlabel { position:absolute; left:0; font-size:10px; color:var(--color-bt-text-dim); transform:translateY(-50%); font-variant-numeric:tabular-nums; }
  .pc-spine { position:absolute; left:52px; top:0; bottom:0; width:2px; background:var(--color-bt-border); }
  .pc-pin { position:absolute; left:46px; width:14px; height:14px; transform:rotate(45deg) translateY(-50%); transform-origin:center; background:var(--c); border:2px solid var(--color-bt-base); border-radius:3px; z-index:3; }
  .pc-marker { position:absolute; left:74px; right:8px; transform:translateY(-50%); z-index:2; display:flex; align-items:center; gap:9px; }
  .pc-mtime { font-size:11px; font-weight:700; color:var(--color-bt-text); font-variant-numeric:tabular-nums; flex-shrink:0; }
  .pc-micon { width:24px; height:24px; border-radius:7px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; color:var(--c); background:color-mix(in srgb, var(--c) 14%, transparent); }
  .pc-mtitle { font-size:13px; font-weight:600; color:var(--color-bt-text); }
  /* capsule lane sits right of the markers */
  .pc-cap { position:absolute; left:210px; right:10px; border-radius:12px; padding:10px 13px; overflow:hidden;
    background:color-mix(in srgb, var(--c) 12%, var(--color-bt-card)); border:1px solid color-mix(in srgb, var(--c) 30%, transparent); border-left:3px solid var(--c); z-index:1; }
  .pc-captitle { font-size:13px; font-weight:600; color:var(--color-bt-text); }
  .pc-capmeta { font-size:11px; color:var(--color-bt-text-dim); margin-top:2px; }
  .pc-capfade { position:absolute; left:0; right:0; bottom:0; height:38px; background:linear-gradient(transparent, var(--color-bt-base)); }
  .pc-capopen { position:absolute; left:0; right:0; bottom:6px; text-align:center; font-size:10px; color:var(--color-bt-text-dim); }

  /* ── B · Anchors & flows ──────────────────────────────────────────── */
  .af { position:relative; padding-left:96px; }
  .af-spine { position:absolute; left:78px; top:10px; bottom:10px; width:2px; background:var(--color-bt-subtle-border); }
  .af-dayhead { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:var(--color-bt-text-dim); margin:20px 0 11px; }
  .af-dayhead.first { margin-top:0; }
  .af-anchor { position:relative; display:flex; align-items:center; gap:11px; padding:7px 0; }
  .af-time { position:absolute; left:-96px; width:64px; text-align:right; font-size:12px; font-weight:700; color:var(--color-bt-text); font-variant-numeric:tabular-nums; }
  .af-notime { position:absolute; left:-96px; width:64px; text-align:right; font-size:10px; color:var(--color-bt-text-dim); opacity:0.55; }
  .af-dot { position:absolute; left:-22px; width:13px; height:13px; border-radius:50%; background:var(--c); border:3px solid var(--color-bt-base); z-index:2; }
  .af-dot.hollow { background:var(--color-bt-base); border:2px solid color-mix(in srgb, var(--c) 60%, var(--color-bt-border)); width:11px; height:11px; left:-21px; }
  .af-aicon { width:28px; height:28px; border-radius:8px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; color:var(--c); background:color-mix(in srgb, var(--c) 14%, transparent); }
  .af-atitle { font-size:13.5px; font-weight:600; color:var(--color-bt-text); }
  .af-flow { position:relative; margin:5px 0; padding:10px 34px 10px 13px; border-radius:11px;
    background:var(--color-bt-card); border:1px solid var(--color-bt-border); border-left:3px solid color-mix(in srgb, var(--c) 55%, var(--color-bt-border)); }
  .af-ftitle { font-size:12.5px; font-weight:600; color:var(--color-bt-text); display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .af-fmeta { font-size:11px; color:var(--color-bt-text-dim); margin-top:2px; }
  .af-durchip { font-size:10px; font-weight:600; color:var(--c); background:color-mix(in srgb, var(--c) 14%, transparent); border-radius:9999px; padding:2px 8px; flex-shrink:0; }
  /* group (stacked arrivals / tee-time array from one agenda item) */
  .af-ghead { position:relative; display:flex; align-items:center; gap:11px; padding:7px 0; }
  .af-stack { display:flex; margin-left:4px; }
  .af-stack .a { width:22px; height:22px; border-radius:50%; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:9px; font-weight:600; border:2px solid var(--color-bt-base); }
  .af-gtag { font-size:10.5px; color:var(--color-bt-text-dim); margin:0 0 7px 39px; }
  .af-sub { position:relative; display:flex; align-items:center; gap:9px; padding:4px 0; }
  .af-subtime { position:absolute; left:-96px; width:64px; text-align:right; font-size:11px; font-weight:600; color:var(--color-bt-text); font-variant-numeric:tabular-nums; }
  .af-subdot { position:absolute; left:-19px; width:9px; height:9px; border-radius:50%; background:var(--c); border:2px solid var(--color-bt-base); z-index:2; }
  .af-subtitle { font-size:12px; color:var(--color-bt-text-dim); }
  /* mode breakdown (flying / driving) under an arrivals group */
  .af-mode { position:relative; display:flex; align-items:center; gap:9px; padding:6px 0 6px 0; }
  .af-mode .ml { display:inline-flex; align-items:center; gap:6px; width:74px; flex-shrink:0; font-size:11px; font-weight:600; color:var(--c); }
  .af-mode .mr { font-size:10.5px; color:var(--color-bt-text-dim); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .af-walk { margin:2px 0 0 39px; font-size:11px; color:var(--color-bt-text-dim); display:inline-flex; align-items:center; gap:6px; }
  .af-ooo { font-size:9.5px; font-weight:600; color:var(--color-bt-warning); background:var(--color-bt-warning-faint); border:1px solid var(--color-bt-warning-border); border-radius:9999px; padding:1px 7px 1px 6px; display:inline-flex; align-items:center; gap:3px; flex-shrink:0; }
  .af-lock { margin-left:auto; color:var(--color-bt-text-dim); opacity:0.6; flex-shrink:0; display:inline-flex; }
  .af-grip { position:absolute; right:11px; top:12px; color:var(--color-bt-text-dim); opacity:0.55; cursor:grab; }

  /* ── D · Elegant read view ────────────────────────────────────────────
     Soft pastel-filled cards (no left-border accent, no thin-line-on-dark),
     larger + legible type, consecutive untimed items bracketed under ONE
     "Anytime" label. This is the Home itinerary (read-only). */
  .el { position:relative; padding-left:84px; }
  .el-day { font-size:12px; font-weight:700; letter-spacing:0.09em; text-transform:uppercase; color:var(--color-bt-text-dim); margin:26px 0 14px; }
  .el-day.first { margin-top:0; }
  .el-day .dd { color:var(--color-bt-text); }
  .el-spine { position:absolute; left:69px; top:6px; bottom:6px; width:2px; background:var(--color-bt-subtle-border); border-radius:2px; }
  /* timed item */
  .el-row { position:relative; margin:9px 0; }
  .el-time { position:absolute; left:-84px; width:58px; text-align:right; top:18px; font-size:13.5px; font-weight:700; color:var(--color-bt-text); font-variant-numeric:tabular-nums; line-height:1.1; }
  .el-ampm { display:block; font-size:10px; font-weight:600; color:var(--color-bt-text-dim); letter-spacing:0.04em; }
  .el-dot { position:absolute; left:-20px; top:21px; width:14px; height:14px; border-radius:50%; background:var(--c); border:3px solid var(--color-bt-base); box-shadow:0 0 0 1px color-mix(in srgb, var(--c) 40%, transparent); z-index:2; }
  .el-card { display:flex; align-items:flex-start; gap:14px; padding:15px 17px; border-radius:16px;
    background:color-mix(in srgb, var(--c) 14%, var(--color-bt-card)); border:1px solid color-mix(in srgb, var(--c) 22%, transparent); }
  .el-icn { width:40px; height:40px; border-radius:12px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center;
    color:var(--c); background:color-mix(in srgb, var(--c) 28%, var(--color-bt-card)); }
  .el-body { flex:1; min-width:0; }
  .el-ttl { font-size:15.5px; font-weight:600; color:var(--color-bt-text); line-height:1.25; }
  .el-sub { font-size:13px; color:var(--color-bt-text-dim); margin-top:2px; line-height:1.35; }
  .el-chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:9px; }
  .el-chip { font-size:12px; font-weight:600; color:var(--color-bt-text); background:var(--color-bt-card-raised); border:1px solid var(--color-bt-subtle-border); border-radius:9999px; padding:4px 11px; font-variant-numeric:tabular-nums; }
  .el-stack { display:flex; margin-left:auto; flex-shrink:0; }
  .el-stack .a { width:30px; height:30px; border-radius:50%; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; border:2.5px solid color-mix(in srgb, var(--c) 14%, var(--color-bt-card)); }
  /* directions / map link — consistent on any card with a location */
  .el-map { flex-shrink:0; align-self:center; display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:600; color:var(--color-bt-text);
    background:color-mix(in srgb, var(--c) 22%, var(--color-bt-card)); border:1px solid color-mix(in srgb, var(--c) 30%, transparent); border-radius:10px; padding:8px 12px; cursor:pointer; white-space:nowrap; }
  /* ── narrow (mobile): icon-only directions, tighter time gutter ──── */
  @container (max-width: 470px) {
    .el { padding-left:52px; }
    .el-time { left:-52px; width:38px; font-size:12px; top:15px; }
    .el-ampm { font-size:9px; }
    .el-dot { left:-15px; top:18px; }
    .el-any-label { left:-52px; width:38px; font-size:9.5px; }
    .el-brace { left:-14px; }
    .el-map { padding:9px; align-self:flex-start; }
    .el-map .lbl { display:none; }
    .el-icn { width:36px; height:36px; }
    .lodge-dir .lbl { display:none; }
    .lodge-dir { padding:9px; }
    .el-mode { flex-wrap:wrap; row-gap:5px; }
    .el-stack .a { width:26px; height:26px; font-size:10px; }
    .el-stack .a:not(:first-child) { margin-left:-9px; }
  }
  /* mode breakdown rows inside an arrivals card */
  .el-modes { display:flex; flex-direction:column; gap:9px; width:100%; margin-top:11px; }
  .el-mode { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .el-mode .ml { display:inline-flex; align-items:center; gap:6px; min-width:56px; flex-shrink:0; font-size:12.5px; font-weight:600; color:var(--color-bt-text); }
  .el-mode .mr { font-size:12px; color:var(--color-bt-text-dim); font-variant-numeric:tabular-nums; white-space:nowrap; }
  /* untimed bracket group */
  .el-any { position:relative; margin:9px 0; }
  .el-any-label { position:absolute; left:-84px; width:58px; text-align:right; top:0; font-size:11.5px; font-weight:600; color:var(--color-bt-text-dim); }
  .el-brace { position:absolute; left:-20px; top:4px; bottom:4px; width:6px; border-radius:4px; background:var(--color-bt-card-raised); }
  .el-any-items { display:flex; flex-direction:column; gap:9px; }
  .el-anycard { display:flex; align-items:flex-start; gap:14px; padding:14px 17px; border-radius:16px; background:color-mix(in srgb, var(--c) 14%, var(--color-bt-card)); border:1px solid color-mix(in srgb, var(--c) 22%, transparent); }
  .el-anycard .el-icn { background:color-mix(in srgb, var(--c) 28%, var(--color-bt-card)); }

  /* ── Home: lodging strip + scroll-under-fade + past-day dimming ─────── */
  .eh { position:relative; height:100%; display:flex; flex-direction:column; background:var(--color-bt-base); overflow:hidden; }
  .eh-top { flex-shrink:0; padding:16px 22px 10px; background:var(--color-bt-base); position:relative; z-index:3; }
  .eh-lodge { flex-shrink:0; padding:0 22px 12px; background:var(--color-bt-base); position:relative; z-index:3; }
  .eh-eyebrow { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:var(--color-bt-text-dim); }
  .eh-h1 { font-size:22px; font-weight:700; color:var(--color-bt-text); margin:3px 0 0; }
  .eh-scroll { flex:1; overflow-y:auto; padding:0 22px 40px; container-type:inline-size; -webkit-mask-image:linear-gradient(to bottom, transparent 0, #000 26px); mask-image:linear-gradient(to bottom, transparent 0, #000 26px); }
  .eh-scroll::-webkit-scrollbar { width:8px; }
  .eh-scroll::-webkit-scrollbar-thumb { background:var(--color-bt-border); border-radius:4px; }

  /* lodging strip — compact bar, pinned above the scrolling itinerary */
  .lodge { display:flex; gap:10px; overflow-x:auto; padding:2px 0 2px; }
  .lodge-chip { display:flex; align-items:center; gap:12px; padding:11px 13px; background:var(--color-bt-card); border:1px solid var(--color-bt-subtle-border); border-radius:14px; flex:1 1 0; min-width:230px; }
  .lodge-ic { width:40px; height:40px; border-radius:11px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; color:var(--color-bt-planning); background:color-mix(in srgb, var(--color-bt-planning) 18%, var(--color-bt-card)); overflow:hidden; }
  .lodge-ic img { width:100%; height:100%; object-fit:cover; }
  .lodge-info { min-width:0; flex:1; }
  .lodge-name { font-size:14.5px; font-weight:600; color:var(--color-bt-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lodge-meta { font-size:12px; color:var(--color-bt-text-dim); margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lodge-dir { flex-shrink:0; display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:600; color:var(--color-bt-planning);
    background:color-mix(in srgb, var(--color-bt-planning) 13%, var(--color-bt-card)); border:1px solid color-mix(in srgb, var(--color-bt-planning) 24%, transparent); border-radius:10px; padding:7px 11px; cursor:pointer; }

  /* day states */
  .el-day.today { color:var(--color-bt-accent); }
  .el-day .nowpill { font-size:10px; font-weight:700; letter-spacing:0.04em; color:#0d1f1a; background:var(--color-bt-accent); border-radius:9999px; padding:2px 8px; margin-left:8px; vertical-align:1px; }
  .el-pastday { opacity:0.5; }
  .el-pastrow { display:flex; align-items:center; gap:10px; padding:11px 15px; border-radius:14px; background:var(--color-bt-card); margin:9px 0; }
  .el-pastrow .pc { font-size:13px; color:var(--color-bt-text-dim); }
  .el-pastrow .chk { color:var(--color-bt-accent); display:inline-flex; }
  .el-pastrow .exp { margin-left:auto; font-size:11.5px; color:var(--color-bt-text-dim); display:inline-flex; align-items:center; gap:4px; }

  /* ── C · Clock vs. agenda ─────────────────────────────────────────── */
  .cv { display:grid; grid-template-columns:148px 1fr; gap:18px; }
  .cv-col-h { font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--color-bt-text-dim); margin-bottom:11px; display:flex; align-items:center; gap:6px; }
  .cv-clock { position:relative; }
  .cv-citem { display:flex; gap:9px; align-items:flex-start; padding:9px 0; border-top:1px solid var(--color-bt-subtle-border); }
  .cv-citem:first-of-type { border-top:none; }
  .cv-ctime { font-size:12px; font-weight:700; color:var(--color-bt-text); font-variant-numeric:tabular-nums; width:50px; flex-shrink:0; }
  .cv-cmark { display:flex; flex-direction:column; align-items:center; }
  .cv-ctitle { font-size:12.5px; font-weight:600; color:var(--color-bt-text); }
  .cv-csub { font-size:10.5px; color:var(--color-bt-text-dim); }
  .cv-agenda { display:flex; flex-direction:column; gap:9px; }
  .cv-acard { display:flex; align-items:center; gap:11px; padding:13px 14px; border-radius:12px; background:var(--color-bt-card); border:1px solid var(--color-bt-border); border-left:3px solid var(--c); }
  .cv-aicon { width:32px; height:32px; border-radius:9px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; color:var(--c); background:color-mix(in srgb, var(--c) 14%, transparent); }
  .cv-atitle { font-size:13.5px; font-weight:600; color:var(--color-bt-text); }
  .cv-ameta { font-size:11.5px; color:var(--color-bt-text-dim); margin-top:1px; display:flex; align-items:center; gap:6px; }
  .cv-dur { font-size:10px; font-weight:600; color:var(--c); background:color-mix(in srgb, var(--c) 13%, transparent); border-radius:9999px; padding:2px 8px; }
  .cv-grip { margin-left:auto; color:var(--color-bt-text-dim); opacity:0.5; flex-shrink:0; }

  /* ── Full Home page chrome (matches the live app) ─────────────────── */
  .hf { height:100%; overflow-y:auto; background:var(--color-bt-base); }
  .hf-nav { display:flex; align-items:center; gap:14px; padding:13px 20px; border-bottom:1px solid var(--color-bt-subtle-border); }
  .hf-logo { display:flex; align-items:center; gap:7px; font-size:15px; font-weight:700; color:var(--color-bt-text); }
  .hf-switch { display:inline-flex; align-items:center; gap:7px; padding:6px 12px; border-radius:9px; border:1px solid var(--color-bt-border); background:var(--color-bt-card); font-size:13px; font-weight:600; color:var(--color-bt-text); }
  .hf-navr { margin-left:auto; display:flex; align-items:center; gap:16px; }
  .hf-navitem { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--color-bt-text-dim); cursor:pointer; }
  .hf-navitem.fb { color:var(--color-bt-text); background:var(--color-bt-card); border:1px solid var(--color-bt-border); padding:6px 11px; border-radius:9px; }
  .hf-av { width:30px; height:30px; border-radius:50%; background:var(--color-bt-accent); color:#0d1f1a; display:inline-flex; align-items:center; justify-content:center; }
  .hf-scroll { padding:12px 20px 40px; container-type:inline-size; }
  .hf-head { padding:16px 20px 8px; container-type:inline-size; }
  /* trip header card */
  .hf-card { border-radius:16px; border:1px solid var(--color-bt-subtle-border); overflow:hidden; margin-bottom:16px;
    background:linear-gradient(135deg, color-mix(in srgb, var(--color-bt-accent) 16%, var(--color-bt-card)), var(--color-bt-card)); }
  .hf-cardtop { display:flex; align-items:flex-start; padding:16px 18px 14px; }
  .hf-ownerpill { font-size:10px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--color-bt-owner); border:1px solid var(--color-bt-owner); border-radius:5px; padding:2px 8px; margin-right:11px; }
  .hf-tripname { font-size:21px; font-weight:700; color:var(--color-bt-text); }
  .hf-tripmeta { margin-left:auto; text-align:right; font-size:12.5px; color:var(--color-bt-text-dim); line-height:1.5; }
  .hf-tripmeta .loc { color:var(--color-bt-text); font-weight:600; display:inline-flex; align-items:center; gap:5px; }
  .hf-gear { margin-left:14px; color:var(--color-bt-text-dim); align-self:flex-start; }
  .hf-cardbtm { display:flex; align-items:center; gap:14px; padding:0 18px 16px; }
  .hf-countdown { display:flex; align-items:center; gap:11px; flex-shrink:0; }
  .hf-cdnum { width:42px; height:42px; border-radius:50%; border:2px solid var(--color-bt-accent-border); display:inline-flex; align-items:center; justify-content:center; font-size:15px; font-weight:700; color:var(--color-bt-text); }
  .hf-cdtxt { font-size:13.5px; font-weight:600; color:var(--color-bt-text); }
  .hf-quickadd { flex:1; display:flex; align-items:center; justify-content:center; gap:8px; padding:13px; border-radius:11px; border:1px dashed var(--color-bt-border); color:var(--color-bt-text-dim); font-size:13px; cursor:pointer; }
  /* tab bar */
  .hf-tabs { display:flex; border-bottom:1px solid var(--color-bt-subtle-border); margin-bottom:18px; }
  .hf-tab { flex:1; display:flex; flex-direction:column; align-items:center; gap:5px; padding:11px 4px; font-size:10px; font-weight:600; letter-spacing:0.07em; text-transform:uppercase; color:var(--color-bt-text-dim); border-bottom:2px solid transparent; margin-bottom:-1px; cursor:pointer; }
  .hf-tab.on { color:var(--color-bt-accent); border-bottom-color:var(--color-bt-accent); }
  /* itinerary header + chips */
  .hf-ihead { display:flex; align-items:center; margin-bottom:13px; }
  .hf-ieyebrow { font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--color-bt-accent); }
  .hf-setup { margin-left:auto; display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; color:var(--color-bt-accent); cursor:pointer; }
  .hf-chips { display:flex; gap:9px; margin-bottom:4px; flex-wrap:wrap; }
  /* pinned lodging strip inside the head */
  .hf-lodgelab { display:flex; align-items:center; gap:7px; font-size:10px; font-weight:700; letter-spacing:0.09em; text-transform:uppercase; color:var(--color-bt-text-dim); margin:4px 0 8px; }
  /* arrivals panel — grouped by mode, styled like lodging; people ordered by time */
  .hf-arr { background:var(--color-bt-card); border:1px solid var(--color-bt-subtle-border); border-radius:14px; overflow:hidden; }
  .arr-row { display:flex; align-items:center; gap:11px; padding:10px 13px; }
  .arr-row + .arr-row { border-top:1px solid var(--color-bt-subtle-border); }
  .arr-lab { display:inline-flex; align-items:center; gap:6px; width:78px; flex-shrink:0; font-size:12px; font-weight:600; color:var(--color-bt-accent); }
  .arr-people { display:flex; gap:7px; flex-wrap:wrap; flex:1; align-items:center; }
  .arr-chip { display:inline-flex; align-items:center; gap:6px; padding:3px 10px 3px 3px; border-radius:9999px; background:var(--color-bt-card-raised); border:1px solid var(--color-bt-border); }
  .arr-chip .av { width:22px; height:22px; border-radius:50%; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:9px; font-weight:700; flex-shrink:0; }
  .arr-chip .nm { font-size:11.5px; font-weight:600; color:var(--color-bt-text); }
  .arr-chip .tm { font-size:10.5px; color:var(--color-bt-text-dim); font-variant-numeric:tabular-nums; }
  .arr-sep { width:1px; align-self:stretch; background:var(--color-bt-subtle-border); margin:0 2px; }
  .arr-chip.untimed { border-style:dashed; }
  .arr-chip.untimed .tm { font-style:italic; }

  /* ── Hybrid itinerary: pinned lodging + spine + tap-to-expand rows ──── */
  .hy { height:100%; display:flex; flex-direction:column; background:var(--color-bt-base); overflow:hidden; }
  .hy-lodge { flex-shrink:0; padding:16px 20px 13px; border-bottom:1px solid var(--color-bt-subtle-border); }
  .hy-lablrow { display:flex; align-items:center; gap:7px; font-size:10px; font-weight:700; letter-spacing:0.09em; text-transform:uppercase; color:var(--color-bt-text-dim); margin-bottom:9px; }
  .hy-props { display:flex; flex-wrap:wrap; gap:10px; }
  .hy-prop { flex:1 1 240px; min-width:0; display:flex; align-items:center; gap:12px; padding:11px 13px; border-radius:12px; background:var(--color-bt-card); border:1px solid var(--color-bt-subtle-border); }
  .hy-prop .ic { width:36px; height:36px; border-radius:10px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; color:var(--color-bt-planning); background:color-mix(in srgb, var(--color-bt-planning) 18%, var(--color-bt-card)); }
  .hy-prop .nm { font-size:14px; font-weight:600; color:var(--color-bt-text); }
  .hy-prop .dt { font-size:12px; color:var(--color-bt-text-dim); margin-top:1px; }
  .hy-prop .map { flex-shrink:0; display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:600; color:var(--color-bt-planning); background:color-mix(in srgb, var(--color-bt-planning) 13%, var(--color-bt-card)); border:1px solid color-mix(in srgb, var(--color-bt-planning) 24%, transparent); border-radius:10px; padding:7px 11px; cursor:pointer; }
  .hy-scroll { flex:1; overflow-y:auto; padding:14px 20px 40px; container-type:inline-size; -webkit-mask-image:linear-gradient(to bottom, transparent 0, #000 22px); mask-image:linear-gradient(to bottom, transparent 0, #000 22px); }
  /* row */
  .hy-row { flex:1; min-width:0; }
  .hy-rowhead { display:flex; align-items:center; gap:10px; cursor:pointer; padding:9px 0; }
  .hy-title { font-size:14.5px; font-weight:500; color:var(--color-bt-text); }
  .hy-title .cnt { color:var(--color-bt-text-dim); font-weight:400; font-size:13px; }
  .hy-chev { margin-left:auto; color:var(--color-bt-text-dim); display:inline-flex; flex-shrink:0; transition:transform .15s; }
  .hy-chev.open { transform:rotate(180deg); }
  .hy-detail { padding:2px 0 13px 0; display:flex; flex-direction:column; gap:9px; }
  .hy-dtext { font-size:12.5px; color:var(--color-bt-text-dim); line-height:1.5; }
  .hy-maplink { align-self:flex-start; display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; color:var(--color-bt-planning); background:color-mix(in srgb, var(--color-bt-planning) 13%, var(--color-bt-card)); border:1px solid color-mix(in srgb, var(--color-bt-planning) 24%, transparent); border-radius:10px; padding:7px 12px; cursor:pointer; }
  .hy-tees { display:flex; flex-wrap:wrap; gap:7px; }
  .hy-tee { font-size:12px; font-weight:600; color:var(--color-bt-text); background:var(--color-bt-card-raised); border:1px solid var(--color-bt-subtle-border); border-radius:9999px; padding:4px 11px; font-variant-numeric:tabular-nums; }
  /* arrivals (expanded) */
  .hy-arr { display:flex; flex-direction:column; gap:11px; }
  .hy-arrmode { display:flex; gap:10px; align-items:flex-start; }
  .hy-arrlab { display:inline-flex; align-items:center; gap:6px; width:72px; flex-shrink:0; font-size:12px; font-weight:600; color:var(--color-bt-text); padding-top:4px; }
  .hy-arrpeople { display:flex; flex-wrap:wrap; gap:7px; flex:1; }
  .hy-person { display:inline-flex; align-items:center; gap:7px; padding:3px 11px 3px 3px; border-radius:9999px; background:var(--color-bt-card-raised); border:1px solid var(--color-bt-border); }
  .hy-person .nm { font-size:12px; font-weight:600; color:var(--color-bt-text); }
  .hy-person .tm { font-size:11px; color:var(--color-bt-text-dim); font-variant-numeric:tabular-nums; }
  .hy-person.tbd { border-style:dashed; }
  .hy-person.tbd .tm { font-style:italic; }

  /* ── Hybrid v2: clean rows (no spine), Map only where it matters ────── */
  .hy2-day { font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--color-bt-text-dim); margin:18px 0 4px; }
  .hy2-day.first { margin-top:2px; }
  .hy2-row { padding:3px 0; border-radius:10px; }
  .hy2-head { display:flex; align-items:center; gap:13px; padding:8px 6px; border-radius:10px; cursor:pointer; }
  .hy2-head:hover { background:var(--color-bt-hover); }
  .hy2-time { width:52px; flex-shrink:0; font-size:12.5px; color:var(--color-bt-text-dim); font-variant-numeric:tabular-nums; text-align:right; }
  .hy2-time.none { font-size:11px; font-style:italic; opacity:0.7; }
  .hy2-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; background:var(--c); }
  .hy2-dot.hollow { background:transparent; border:1.5px solid color-mix(in srgb, var(--c) 70%, var(--color-bt-border)); }
  .hy2-title { font-size:14px; color:var(--color-bt-text); font-weight:500; }
  .hy2-title .cnt { color:var(--color-bt-text-dim); font-weight:400; }
  .hy2-map { margin-left:auto; flex-shrink:0; display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; color:var(--color-bt-planning);
    background:color-mix(in srgb, var(--color-bt-planning) 12%, var(--color-bt-card)); border:1px solid color-mix(in srgb, var(--color-bt-planning) 24%, transparent); border-radius:9px; padding:6px 11px; cursor:pointer; }
  .hy2-detail { padding:2px 6px 11px 65px; display:flex; flex-direction:column; gap:9px; }
  @container (max-width: 470px) { .hy2-detail { padding-left:24px; } }

  /* ── "As it lands" — existing left-border card style + 4 additions ──── */
  .re-day { font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--color-bt-text-dim); margin:18px 0 9px; }
  .re-day.first { margin-top:2px; }
  .re-day .dd { color:var(--color-bt-text); }
  .re-card { display:flex; align-items:center; gap:14px; padding:13px 16px; margin-bottom:9px; border-radius:12px;
    background:var(--color-bt-card); border:1px solid var(--color-bt-subtle-border); border-left:3px solid var(--c); }
  .re-ico { width:36px; height:36px; border-radius:10px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; color:var(--c); background:color-mix(in srgb, var(--c) 16%, var(--color-bt-card)); }
  .re-body { flex:1; min-width:0; }
  .re-time { font-size:12px; color:var(--color-bt-text-dim); font-variant-numeric:tabular-nums; }
  .re-title { font-size:15px; font-weight:600; color:var(--color-bt-text); margin-top:1px; }
  .re-sub { font-size:12.5px; color:var(--color-bt-text-dim); margin-top:2px; }
  .re-map { flex-shrink:0; display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:600; color:var(--color-bt-planning); cursor:pointer; }
  /* arrivals card (per day, expandable) */
  .re-arr { cursor:pointer; }
  .re-arrhead { display:flex; align-items:center; gap:14px; }
  .re-chev { margin-left:auto; color:var(--color-bt-text-dim); display:inline-flex; transition:transform .15s; }
  .re-chev.open { transform:rotate(180deg); }
  .re-arrdetail { margin-top:11px; padding-top:11px; border-top:1px solid var(--color-bt-subtle-border); }
  /* collapsed empty-day band */
  .re-run { display:flex; align-items:center; gap:11px; padding:12px 16px; margin-bottom:9px; border-radius:12px; cursor:pointer;
    background:var(--color-bt-card); border:1px dashed var(--color-bt-subtle-border); color:var(--color-bt-text-dim); }
  .re-run:hover { border-color:var(--color-bt-border); }
  .re-run .rtxt { font-size:12.5px; } .re-run .rtxt b { color:var(--color-bt-text); font-weight:600; }
  .re-run .rexp { margin-left:auto; display:inline-flex; align-items:center; gap:4px; font-size:11.5px; font-weight:600; color:var(--color-bt-accent); }
  .re-emptyone { font-size:12.5px; font-style:italic; color:var(--color-bt-text-dim); opacity:0.7; margin:0 0 9px 2px; }
  .re-runclose { font-size:11.5px; font-weight:600; color:var(--color-bt-accent); cursor:pointer; padding:4px 0 9px 2px; display:inline-flex; align-items:center; gap:4px; }
  /* past days — collapsed "Earlier" line; expanded = dimmed + shrunk */
  .re-todaypill { font-size:9.5px; font-weight:700; letter-spacing:0.04em; color:#0d1f1a; background:var(--color-bt-accent); border-radius:9999px; padding:2px 8px; margin-left:8px; vertical-align:1px; }
  .re-pastwrap { opacity:0.5; }
  .re-pastwrap .re-card { padding:9px 14px; margin-bottom:7px; }
  .re-pastwrap .re-day { margin:12px 0 6px; }
  .re-pasthide { font-size:11.5px; font-weight:600; color:var(--color-bt-accent); cursor:pointer; padding:2px 0 11px 2px; display:inline-flex; align-items:center; gap:4px; }

  /* ── Setup guide ⇄ itinerary transition ────────────────────────────── */
  .sg-headrow { display:flex; align-items:flex-start; gap:16px; }
  .sg-thumb { width:88px; height:78px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
    background:linear-gradient(135deg, color-mix(in srgb, var(--color-bt-accent) 22%, var(--color-bt-card)), var(--color-bt-card)); color:var(--color-bt-accent); }
  .sg-eyebrow { font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--color-bt-accent); }
  .sg-h { font-size:22px; font-weight:700; color:var(--color-bt-text); margin:5px 0 6px; }
  .sg-sub { font-size:13px; line-height:1.55; color:var(--color-bt-text-dim); max-width:560px; }
  .sg-peek { display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:600; color:var(--color-bt-accent); cursor:pointer; white-space:nowrap; }
  .sg-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-top:18px; }
  .sg-card { background:var(--color-bt-card); border:1px solid var(--color-bt-subtle-border); border-radius:14px; padding:15px; display:flex; flex-direction:column; }
  .sg-vis { height:84px; border-radius:10px; background:var(--color-bt-card-raised); border:1px solid var(--color-bt-subtle-border); margin-bottom:13px; }
  .sg-ct { display:flex; align-items:center; gap:8px; font-size:14.5px; font-weight:600; color:var(--color-bt-text); }
  .sg-badge { width:18px; height:18px; border-radius:50%; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; }
  .sg-badge.done { background:var(--color-bt-accent); color:#0d1f1a; }
  .sg-badge.todo { border:1.5px solid var(--color-bt-text-dim); color:var(--color-bt-text-dim); font-size:10px; font-weight:700; }
  .sg-cdesc { font-size:12.5px; line-height:1.45; color:var(--color-bt-text-dim); margin:6px 0 13px; flex:1; }
  .sg-cbtn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:9px; border-radius:9px; font-size:12.5px; font-weight:600; cursor:pointer;
    background:var(--color-bt-card-raised); border:1px solid var(--color-bt-border); color:var(--color-bt-text); }
  .sg-cbtn.done { color:var(--color-bt-accent); background:transparent; }
  /* commit bar — "I'm good, let's go" */
  .sg-commit { display:flex; align-items:center; gap:14px; margin-top:18px; padding:15px 17px; border-radius:14px;
    background:var(--color-bt-accent-faint); border:1px solid var(--color-bt-accent-border); }
  .sg-commit .ct { font-size:14px; font-weight:600; color:var(--color-bt-text); }
  .sg-commit .cd { font-size:12px; color:var(--color-bt-text-dim); margin-top:2px; }
  .sg-commit .go { margin-left:auto; flex-shrink:0; display:inline-flex; align-items:center; gap:6px; padding:9px 15px; border-radius:10px; border:none; cursor:pointer; background:var(--color-bt-accent); color:#0d1f1a; font-size:13px; font-weight:700; }
  /* the Setup-guide link pulled LEFT next to ITINERARY — distinct from teal */
  .hf-setupL { display:inline-flex; align-items:center; gap:6px; margin-left:11px; font-size:12px; font-weight:600; color:var(--color-bt-text-dim); cursor:pointer; padding:5px 11px; border-radius:9999px; border:1px solid var(--color-bt-border); background:var(--color-bt-card); white-space:nowrap; }
  .hf-setupL:hover { color:var(--color-bt-text); border-color:var(--color-bt-text-dim); }
  .hf-setupL .ndot { width:6px; height:6px; border-radius:50%; background:var(--color-bt-warning); flex-shrink:0; }
  .hf-setupL .nleft { color:var(--color-bt-warning); }
  /* mobile filter dropdown */
  .hf-fdd { position:relative; margin-left:auto; }
  .hf-fddbtn { display:inline-flex; align-items:center; gap:7px; padding:6px 12px; border-radius:9999px; border:1px solid var(--color-bt-border); background:var(--color-bt-card); font-size:12.5px; font-weight:600; color:var(--color-bt-text); cursor:pointer; }
  .hf-fddbtn .cdot { width:7px; height:7px; border-radius:50%; }
  .hf-fddmenu { position:absolute; right:0; top:calc(100% + 6px); z-index:6; background:var(--color-bt-card-float); border:1px solid var(--color-bt-border); border-radius:11px; box-shadow:var(--shadow-floating); padding:5px; min-width:148px; display:flex; flex-direction:column; gap:2px; }
  .hf-fddopt { display:flex; align-items:center; gap:9px; padding:8px 11px; border-radius:8px; font-size:13px; color:var(--color-bt-text); cursor:pointer; }
  .hf-fddopt:hover { background:var(--color-bt-hover); }
  .hf-fddopt.on { color:var(--color-bt-accent); font-weight:600; }
  .hf-fddopt .cdot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  .hf-chip { display:inline-flex; align-items:center; gap:7px; padding:6px 13px; border-radius:9999px; border:1px solid var(--color-bt-border); background:var(--color-bt-card); font-size:12.5px; font-weight:600; color:var(--color-bt-text-dim); cursor:pointer; }
  .hf-chip.on { color:var(--color-bt-accent); border-color:var(--color-bt-accent-border); background:var(--color-bt-accent-faint); }
  .hf-chip .cdot { width:7px; height:7px; border-radius:50%; }
  .el-empty { font-size:12.5px; font-style:italic; color:var(--color-bt-text-dim); opacity:0.7; padding:2px 0 2px 0; margin:2px 0; }
  /* thin MARKER row — point-in-time logistics (check-in/out, lone arrival).
     Visually lighter than full block cards, which differentiates instants
     from things that take a block of time. */
  .el-marker { display:flex; align-items:center; gap:11px; padding:10px 15px; border-radius:12px;
    background:color-mix(in srgb, var(--c) 9%, var(--color-bt-card)); border:1px solid color-mix(in srgb, var(--c) 17%, transparent); }
  .el-marker .mk-ic { color:var(--c); display:inline-flex; flex-shrink:0; }
  .el-marker .mk-ttl { font-size:13.5px; font-weight:600; color:var(--color-bt-text); }
  .el-marker .mk-sub { font-size:12px; color:var(--color-bt-text-dim); margin-left:auto; white-space:nowrap; }
  /* collapsed run of neighboring empty days */
  .el-run { position:relative; margin:9px 0; }
  .el-run .el-rdot { position:absolute; left:-19px; top:18px; width:10px; height:10px; border-radius:50%; background:var(--color-bt-base); border:2px solid var(--color-bt-border); z-index:2; }
  .el-runrow { display:flex; align-items:center; gap:10px; padding:11px 15px; border-radius:12px; cursor:pointer;
    background:var(--color-bt-card); border:1px dashed var(--color-bt-subtle-border); color:var(--color-bt-text-dim); }
  .el-runrow:hover { border-color:var(--color-bt-border); }
  .el-runrow .rtxt { font-size:12.5px; }
  .el-runrow .rtxt b { color:var(--color-bt-text); font-weight:600; }
  .el-runrow .rexp { margin-left:auto; display:inline-flex; align-items:center; gap:4px; font-size:11.5px; font-weight:600; color:var(--color-bt-accent); }
  .el-runclose { font-size:11.5px; font-weight:600; color:var(--color-bt-accent); cursor:pointer; padding:6px 0 2px 2px; display:inline-flex; align-items:center; gap:4px; }
  `;
  const s = document.createElement('style'); s.id = 'btTCCss'; s.textContent = css; document.head.appendChild(s);
})();

const CC = { travel: 'c-travel', lodging: 'c-lodging', events: 'c-events', golf: 'c-golf' };
const ic = { travel: 'plane', lodging: 'home', events: 'utensils', golf: 'flag' };

function Legend() {
  return (
    <div className="tc-legend">
      <span className="tc-lg"><span className="tc-lgmark" /> Time marker — a moment to hit</span>
      <span className="tc-lg"><span className="tc-lgblock" /> Duration block — takes a while</span>
    </div>
  );
}

function LegendB() {
  return (
    <div className="tc-legend">
      <span className="tc-lg"><span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--color-bt-text-dim)', flexShrink: 0 }} /> <ExIcon name="lock" size={12} color="var(--color-bt-text-dim)" /> Set time — auto-sorts, locked to order</span>
      <span className="tc-lg"><span style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--color-bt-base)', border: '2px solid var(--color-bt-text-dim)', flexShrink: 0 }} /> <ExIcon name="grip-vertical" size={12} color="var(--color-bt-text-dim)" /> No set time — drag to order</span>
    </div>
  );
}

// ── A · Pins & capsules ─────────────────────────────────────────────────
function PinsCapsules() {
  const START = 11, END = 22, PXH = 44;
  const y = t => (t - START) * PXH;
  const hours = [11, 13, 15, 17, 19, 21];
  const hlab = h => h === 12 ? 'noon' : h < 12 ? `${h}a` : `${h - 12}p`;
  const markers = [
    { t: 12, time: '12:00p', title: 'Zachary arrives', cat: 'travel' },
    { t: 16, time: '4:00p', title: 'Check in', cat: 'lodging' },
  ];
  const blocks = [
    { s: 13, e: 16, title: 'Beach & pool', cat: 'events', open: true, meta: 'whenever → check-in' },
    { s: 18.5, e: 21, title: 'Dinner — The Ocean Room', cat: 'events', meta: 'res. 6:30, ~2 hrs' },
  ];
  return (
    <div className="pc" style={{ height: y(END) + 10 }}>
      {hours.map(h => (<React.Fragment key={h}><div className="pc-hour" style={{ top: y(h) }} /><span className="pc-hlabel" style={{ top: y(h) }}>{hlab(h)}</span></React.Fragment>))}
      <div className="pc-spine" />
      {blocks.map((b, i) => (
        <div key={i} className={`pc-cap ${CC[b.cat]}`} style={{ top: y(b.s), height: y(b.e) - y(b.s) }}>
          <div className="pc-captitle">{b.title}</div>
          <div className="pc-capmeta">{b.meta}</div>
          {b.open && <><div className="pc-capfade" /><div className="pc-capopen">↕ open-ended</div></>}
        </div>
      ))}
      {markers.map((m, i) => (
        <React.Fragment key={i}>
          <span className={`pc-pin ${CC[m.cat]}`} style={{ top: y(m.t) }} />
          <div className={`pc-marker ${CC[m.cat]}`} style={{ top: y(m.t) }}>
            <span className="pc-mtime">{m.time}</span>
            <span className="pc-micon"><ExIcon name={ic[m.cat]} size={14} color="currentColor" /></span>
            <span className="pc-mtitle">{m.title}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

// ── B · Anchors & flows ─────────────────────────────────────────────────
// THE ORDERING RULE:
//   • Timed items auto-sort by time and LOCK to chronological order (a small
//     lock icon; no drag handle — you can't drag a 6p item below a 7p one).
//   • Untimed items have a drag HANDLE and order freely between the locked
//     anchors. Give one a time and it snaps to its slot and locks.
// Stacks: clustered arrivals collapse to one anchor with an avatar stack;
// a tee sheet is ONE agenda item that expands to an array of timed sub-rows.
const AF_DAYS = [
  { day: 'Day 1 · Wed, Jun 17', rows: [
    { type: 'group', cat: 'travel', icon: 'plane', title: 'Arrivals', tag: '6 people · 12:00p–9:05p', locked: true,
      people: [{ i: 'ZG', c: '#a855f7' }, { i: 'BG', c: '#3b82f6' }, { i: 'BB', c: '#2dd4bf' }, { i: 'MS', c: '#d97706' }, { i: 'TL', c: '#06b6d4' }, { i: 'CP', c: '#22c55e' }],
      modes: [
        { mode: 'flying', icon: 'plane', label: 'Flying', range: '12:00p – 9:05p', people: [{ i: 'ZG', c: '#a855f7' }, { i: 'BB', c: '#2dd4bf' }, { i: 'TL', c: '#06b6d4' }, { i: 'CP', c: '#22c55e' }] },
        { mode: 'driving', icon: 'car', label: 'Driving', range: '2:30p · 5:40p', people: [{ i: 'BG', c: '#3b82f6' }, { i: 'MS', c: '#d97706' }] },
      ] },
    { type: 'flow', cat: 'events', title: 'Beach & settle in', note: 'once everyone’s landed' },
    { type: 'anchor', time: '4:00p', title: 'Check in: Beach House', cat: 'lodging' },
    { type: 'flow', cat: 'events', title: 'Grill out at the house', dur: '~2 hrs', note: 'evening' },
    { type: 'flow', cat: 'events', title: 'Cards', note: 'till late' },
  ] },
  { day: 'Day 2 · Thu, Jun 18', rows: [
    { type: 'group', cat: 'golf', icon: 'flag', title: 'Harbour Town Golf Links', tag: 'tee sheet · 3 times', locked: true,
      subs: [{ time: '7:10a' }, { time: '7:20a' }, { time: '7:30a' }] },
    { type: 'flow', cat: 'golf', title: 'Round of golf', dur: '~5 hrs' },
    { type: 'flow', cat: 'events', title: 'Lunch at the turn', note: 'whenever' },
    { type: 'flow', cat: 'events', title: 'Pizza back at the house', note: 'after golf' },
    { type: 'anchor', time: '8:00p', title: 'Dinner — The Ocean Room', cat: 'events', sub: 'reservation' },
  ] },
  { day: 'Day 3 · Fri, Jun 19', rows: [
    { type: 'group', cat: 'golf', icon: 'flag', title: 'Pinehurst No. 2', tag: 'walk-on · no set times', walkon: true },
    { type: 'flow', cat: 'events', title: 'Drive home', note: 'whenever we’re done' },
  ] },
];

function AfStack({ people }) {
  return (
    <span className="af-stack">
      {people.slice(0, 5).map((p, i) => <span key={i} className="a" style={{ background: p.c, marginLeft: i ? -8 : 0 }}>{p.i}</span>)}
      {people.length > 5 && <span className="a" style={{ background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-text-dim)', marginLeft: -8 }}>+{people.length - 5}</span>}
    </span>
  );
}

function AnchorsFlows() {
  return (
    <div className="af">
      <div className="af-spine" />
      {AF_DAYS.map((d, di) => (
        <React.Fragment key={di}>
          <div className={`af-dayhead${di === 0 ? ' first' : ''}`}>{d.day}</div>
          {d.rows.map((r, i) => {
            if (r.type === 'group') return (
              <div className={`af-group ${CC[r.cat]}`} key={i}>
                <div className="af-ghead">
                  <span className="af-dot" />
                  <span className="af-aicon"><ExIcon name={r.icon} size={15} color="currentColor" /></span>
                  <span className="af-atitle">{r.title}</span>
                  {r.people && !r.modes && <AfStack people={r.people} />}
                  {r.locked && <span className="af-lock" title="Locked to time order"><ExIcon name="lock" size={12} color="currentColor" /></span>}
                </div>
                <div className="af-gtag">{r.tag}</div>
                {r.modes && r.modes.map((m, j) => (
                  <div className={`af-mode ${CC[r.cat]}`} key={j}>
                    <span className="ml"><ExIcon name={m.icon} size={13} color="currentColor" /> {m.label}</span>
                    <AfStack people={m.people} />
                    <span className="mr">{m.range}</span>
                  </div>
                ))}
                {r.subs && r.subs.map((s, j) => (
                  <div className={`af-sub ${CC[r.cat]}`} key={j}>
                    <span className="af-subtime">{s.time}</span>
                    <span className="af-subdot" />
                    <span className="af-subtitle">Tee time</span>
                  </div>
                ))}
                {r.walkon && <div className="af-walk"><ExIcon name="flag" size={12} color="currentColor" /> Walk-on — play when we get there</div>}
              </div>
            );
            if (r.type === 'anchor') return (
              <div className={`af-anchor ${CC[r.cat]}`} key={i}>
                <span className="af-time">{r.time}</span>
                <span className="af-dot" />
                <span className="af-aicon"><ExIcon name={ic[r.cat]} size={15} color="currentColor" /></span>
                <span className="af-atitle">{r.title}</span>
                {r.sub && <span className="af-durchip">{r.sub}</span>}
                <span className="af-lock" title="Locked to time order"><ExIcon name="lock" size={12} color="currentColor" /></span>
              </div>
            );
            return (
              <div className={`af-flow ${CC[r.cat]}`} key={i}>
                <span className={`af-dot hollow ${CC[r.cat]}`} style={{ top: 16 }} />
                <span className="af-notime">no set time</span>
                <span className="af-grip" title="Drag to reorder"><ExIcon name="grip-vertical" size={15} color="currentColor" /></span>
                <div className="af-ftitle">{r.title}{r.dur && <span className="af-durchip">{r.dur}</span>}</div>
                {r.note && <div className="af-fmeta">{r.note}</div>}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── C · Clock vs. agenda ────────────────────────────────────────────────
function ClockAgenda() {
  const clock = [
    { time: '12:00p', title: 'Zachary arrives', sub: 'On a jet plane', cat: 'travel' },
    { time: '4:00p', title: 'Check in', sub: 'Beach House', cat: 'lodging' },
    { time: '6:30p', title: 'Dinner res.', sub: 'The Ocean Room', cat: 'events' },
  ];
  const agenda = [
    { title: 'Beach & pool', dur: '~3 hrs', meta: 'after everyone lands', cat: 'events' },
    { title: 'Grocery run', dur: '~1 hr', meta: 'someone, sometime', cat: 'lodging' },
    { title: 'Poker night', dur: 'till late', meta: 'after dinner', cat: 'events' },
  ];
  return (
    <div className="cv">
      <div className="cv-clock">
        <div className="cv-col-h"><ExIcon name="clock" size={12} color="currentColor" /> On the clock</div>
        {clock.map((c, i) => (
          <div className={`cv-citem ${CC[c.cat]}`} key={i}>
            <span className="cv-ctime">{c.time}</span>
            <div><div className="cv-ctitle">{c.title}</div><div className="cv-csub">{c.sub}</div></div>
          </div>
        ))}
      </div>
      <div>
        <div className="cv-col-h"><ExIcon name="list-ordered" size={12} color="currentColor" /> Takes a while · drag to order</div>
        <div className="cv-agenda">
          {agenda.map((a, i) => (
            <div className={`cv-acard ${CC[a.cat]}`} key={i}>
              <span className="cv-aicon"><ExIcon name={ic[a.cat]} size={16} color="currentColor" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cv-atitle">{a.title}</div>
                <div className="cv-ameta"><span className="cv-dur">{a.dur}</span> {a.meta}</div>
              </div>
              <span className="cv-grip"><ExIcon name="grip-vertical" size={16} color="currentColor" /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimeConcept({ which }) {
  const Body = which === 'A' ? PinsCapsules : which === 'B' ? AnchorsFlows : ClockAgenda;
  return (
    <div className="tc">
      <div className="tc-wrap">
        {which !== 'B' && <div className="tc-daylabel">Day 1 · Wed, Jun 17</div>}
        {which === 'A' && <Legend />}
        {which === 'B' && <LegendB />}
        <Body />
      </div>
    </div>
  );
}

// ── D · Elegant read view (Home itinerary) ──────────────────────────────
// Soft pastel-filled cards, larger legible type, consecutive untimed items
// bracketed under ONE "Anytime" label. Order is whatever Agenda stored (this
// is read-only); time is shown as info, not a sort key.
const ED_DAYS = [
  { day: 'Day 1', date: 'Wed, Jun 17', rows: [
    { kind: 'arrivals', cat: 'travel', icon: 'plane', title: 'Everyone arrives', sub: '6 of the crew rolling in',
      modes: [
        { icon: 'plane', label: 'Flying', range: '12:00p – 9:05p', people: [{ i: 'ZG', c: '#a855f7' }, { i: 'BB', c: '#2dd4bf' }, { i: 'TL', c: '#06b6d4' }, { i: 'CP', c: '#22c55e' }] },
        { icon: 'car', label: 'Driving', range: '2:30p · 5:40p', people: [{ i: 'BG', c: '#3b82f6' }, { i: 'MS', c: '#d97706' }] },
      ] },
    { kind: 'timed', cat: 'lodging', icon: 'home', time: '4:00', ampm: 'PM', title: 'Check in — Beach House', loc: '142 Ocean Course Dr, Kiawah Island, SC' },
    { kind: 'untimed', cat: 'events', icon: 'utensils', title: 'Grill out at the house', sub: 'whoever’s hungry' },
    { kind: 'untimed', cat: 'events', icon: 'flag', title: 'Cards on the porch', sub: 'till someone taps out' },
  ] },
  { day: 'Day 2', date: 'Thu, Jun 18', rows: [
    { kind: 'golf', cat: 'golf', icon: 'flag', title: 'Harbour Town Golf Links', loc: '11 Lighthouse Ln, Hilton Head Island, SC', tees: ['7:10a', '7:20a', '7:30a'] },
    { kind: 'untimed', cat: 'events', icon: 'utensils', title: 'Lunch at the turn', sub: 'between nines' },
    { kind: 'untimed', cat: 'events', icon: 'flag', title: 'Pizza back at the house', sub: 'after the round' },
    { kind: 'timed', cat: 'events', icon: 'utensils', time: '8:00', ampm: 'PM', title: 'Dinner — The Ocean Room', sub: 'reservation under Giesler', loc: 'The Ocean Room, Kiawah Island, SC' },
  ] },
];

function EdStack({ people, max = 6 }) {
  return (
    <span className="el-stack">
      {people.slice(0, max).map((p, i) => <span key={i} className="a" style={{ background: p.c, marginLeft: i ? -10 : 0 }}>{p.i}</span>)}
      {people.length > max && <span className="a" style={{ background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-text-dim)', marginLeft: -10 }}>+{people.length - max}</span>}
    </span>
  );
}

function EdCard({ r }) {
  return (
    <div className="el-card">
      <span className="el-icn"><ExIcon name={r.icon} size={19} color="currentColor" /></span>
      <div className="el-body">
        <div className="el-ttl">{r.title}</div>
        {r.sub && <div className="el-sub">{r.sub}</div>}
        {r.tees && <div className="el-chips">{r.tees.map((t, i) => <span className="el-chip" key={i}>{t}</span>)}</div>}
        {r.modes && (
          <div className="el-modes">
            {r.modes.map((m, i) => (
              <div className="el-mode" key={i}>
                <span className="ml"><ExIcon name={m.icon} size={15} color="currentColor" /> {m.label}</span>
                <EdStack people={m.people} />
                <span className="mr">· {m.range}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {r.loc && <button className="el-map" title={`Open ${r.loc} in Google Maps`}><ExIcon name="map-pin" size={15} color="currentColor" /> <span className="lbl">Directions</span></button>}
    </div>
  );
}

function ElegantDay() {
  return (
    <div className="el">
      <div className="el-spine" />
      {ED_DAYS.map((d, di) => (
        <React.Fragment key={di}>
          <div className={`el-day${di === 0 ? ' first' : ''}`}>{d.day} <span className="dd">· {d.date}</span></div>
          <DayBlocks rows={d.rows} />
        </React.Fragment>
      ))}
    </div>
  );
}

// shared block renderer — groups consecutive untimed rows under one "Anytime"
function DayBlocks({ rows }) {
  const blocks = [];
  rows.forEach((r) => {
    if (r.kind === 'untimed') {
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'any') last.items.push(r);
      else blocks.push({ type: 'any', items: [r] });
    } else blocks.push({ type: 'one', row: r });
  });
  return blocks.map((b, bi) => {
    if (b.type === 'any') return (
      <div className={`el-any ${CC[b.items[0].cat]}`} key={bi}>
        <span className="el-any-label">Anytime</span>
        <span className="el-brace" />
        <div className="el-any-items">
          {b.items.map((r, ri) => (
            <div className={`el-anycard ${CC[r.cat]}`} key={ri}>
              <span className="el-icn"><ExIcon name={r.icon} size={19} color="currentColor" /></span>
              <div className="el-body">
                <div className="el-ttl">{r.title}</div>
                {r.sub && <div className="el-sub">{r.sub}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
    const r = b.row;
    return (
      <div className={`el-row ${CC[r.cat]}`} key={bi}>
        {r.time && <span className="el-time">{r.time}<span className="el-ampm">{r.ampm}</span></span>}
        <span className="el-dot" />
        {r.marker ? (
          <div className="el-marker">
            <span className="mk-ic"><ExIcon name={r.icon} size={17} color="currentColor" /></span>
            <span className="mk-ttl">{r.title}</span>
            {r.sub && <span className="mk-sub">{r.sub}</span>}
          </div>
        ) : <EdCard r={r} />}
      </div>
    );
  });
}

function ElegantView() {
  return (
    <div className="tc"><div className="tc-wrap"><ElegantDay /></div></div>
  );
}

// ── Home: lodging strip on top + scrolling itinerary that fades under the
// tabs, with past days dimmed/collapsed ─────────────────────────────────
const LODGING = [
  { name: 'Beach House', meta: 'Jun 17 – 19 · 2 nights · sleeps 8' },
];
const HOME_DAYS = [
  { day: 'Day 1', date: 'Wed, Jun 17', state: 'past', summary: '3 things · everyone arrived, checked in' },
  { day: 'Day 2', date: 'Thu, Jun 18', state: 'today', rows: [
    { kind: 'golf', cat: 'golf', icon: 'flag', title: 'Harbour Town Golf Links', loc: '11 Lighthouse Ln, Hilton Head Island, SC', tees: ['7:10a', '7:20a', '7:30a'] },
    { kind: 'untimed', cat: 'events', icon: 'utensils', title: 'Lunch at the turn', sub: 'between nines' },
    { kind: 'untimed', cat: 'events', icon: 'flag', title: 'Pizza back at the house', sub: 'after the round' },
    { kind: 'timed', cat: 'events', icon: 'utensils', time: '8:00', ampm: 'PM', title: 'Dinner — The Ocean Room', sub: 'reservation under Giesler', loc: 'The Ocean Room, Kiawah Island, SC' },
  ] },
  { day: 'Day 3', date: 'Fri, Jun 19', state: 'future', rows: [
    { kind: 'golf', cat: 'golf', icon: 'flag', title: 'Pinehurst No. 2', sub: 'walk-on · no set times', loc: 'Pinehurst No. 2, Pinehurst, NC' },
    { kind: 'untimed', cat: 'events', icon: 'plane', title: 'Drive home', sub: 'whenever we’re done' },
  ] },
];

function LodgingStrip() {
  return (
    <div className="lodge">
      {LODGING.map((l, i) => (
        <div className="lodge-chip" key={i}>
          <span className="lodge-ic">
            {l.thumb ? <img src={l.thumb} alt="" /> : <ExIcon name="home" size={19} color="currentColor" />}
          </span>
          <div className="lodge-info">
            <div className="lodge-name">{l.name}</div>
            <div className="lodge-meta">{l.meta}</div>
          </div>
          <span className="lodge-dir"><ExIcon name="map-pin" size={13} color="currentColor" /> Directions</span>
        </div>
      ))}
    </div>
  );
}

function ElegantHome() {
  return (
    <div className="eh">
      <div className="eh-top">
        <div className="eh-eyebrow">BBMI 2026 · Kiawah Island, SC</div>
        <div className="eh-h1">The trip</div>
      </div>
      <div className="eh-lodge"><LodgingStrip /></div>
      <div className="eh-scroll">
        <div className="el" style={{ marginTop: 6 }}>
          <div className="el-spine" />
          {HOME_DAYS.map((d, di) => {
            if (d.state === 'past') return (
              <div className="el-pastday" key={di}>
                <div className="el-day">{d.day} <span className="dd">· {d.date}</span></div>
                <div className="el-pastrow">
                  <span className="chk"><ExIcon name="check" size={16} color="currentColor" /></span>
                  <span className="pc">{d.summary}</span>
                  <span className="exp">Show <ExIcon name="chevron-down" size={13} color="currentColor" /></span>
                </div>
              </div>
            );
            return (
              <React.Fragment key={di}>
                <div className={`el-day${d.state === 'today' ? ' today' : ''}`}>
                  {d.day} <span className="dd">· {d.date}</span>
                  {d.state === 'today' && <span className="nowpill">TODAY</span>}
                </div>
                <DayBlocks rows={d.rows} />
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TimeConcept, ElegantView, ElegantHome });

// ── Color system (pinned) ───────────────────────────────────────────────
// The fix for orange-on-orange-on-orange was CONSISTENCY, not removing color:
// every card uses the SAME recipe — a soft category-tinted panel (14%), a
// deeper icon badge (28%), and a matching spine dot. Same hue, same
// percentages, every category. Text stays default; time chips neutral; the
// Directions link is a consistent right-side action.
const CATS = [
  { name: 'Travel', token: '--color-bt-accent', note: 'teal · brand', c: 'var(--color-bt-accent)', icon: 'plane' },
  { name: 'Lodging', token: '--color-bt-planning', note: 'blue', c: 'var(--color-bt-planning)', icon: 'home' },
  { name: 'Events · Agenda', token: '--color-bt-ready', note: 'orange', c: 'var(--color-bt-ready)', icon: 'utensils' },
  { name: 'Golf', token: '--color-bt-golf  (NEEDS TOKEN)', note: 'green · currently hardcoded #22c55e', c: '#22c55e', icon: 'flag' },
];
function ColorSystem() {
  return (
    <div style={{ background: 'var(--color-bt-base)', minHeight: '100%', padding: '22px 24px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-bt-accent)' }}>Pinned</div>
      <h2 style={{ margin: '6px 0 4px', fontSize: 20, fontWeight: 700, color: 'var(--color-bt-text)' }}>How color works on the itinerary</h2>
      <p style={{ margin: '0 0 18px', font: 'var(--type-body-sm)', color: 'var(--color-bt-text-dim)', maxWidth: 600, textWrap: 'pretty' }}>
        Colored panels stay — they give the page life. The fix is <strong style={{ color: 'var(--color-bt-text)' }}>one consistent recipe</strong> on every card: a soft category-tinted panel (<code style={{ fontFamily: 'var(--font-mono)' }}>14%</code>), a deeper <strong style={{ color: 'var(--color-bt-text)' }}>icon badge</strong> (<code style={{ fontFamily: 'var(--font-mono)' }}>28%</code>) for contrast, and a matching <strong style={{ color: 'var(--color-bt-text)' }}>spine dot</strong> — same hue, same percentages, every category, timed and untimed alike. Titles stay default-colored; time chips neutral; a location becomes a consistent <strong style={{ color: 'var(--color-bt-text)' }}>Directions</strong> link on the right.
      </p>

      {/* before / after */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 22, maxWidth: 620 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-bt-danger)', marginBottom: 8 }}>✗ BEFORE — inconsistent (timed tinted, untimed neutral)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 17px', borderRadius: 16, background: 'var(--color-bt-card-raised)' }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-bt-ready)', background: 'color-mix(in srgb, var(--color-bt-ready) 20%, var(--color-bt-card))' }}><ExIcon name="utensils" size={19} color="currentColor" /></span>
            <div><div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-bt-text)' }}>Dinner</div><div style={{ fontSize: 13, color: 'var(--color-bt-text-dim)' }}>blah neutral panel</div></div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-bt-accent)', marginBottom: 8 }}>✓ AFTER — one tinted recipe, every card</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 17px', borderRadius: 16, background: 'color-mix(in srgb, var(--color-bt-ready) 14%, var(--color-bt-card))', border: '1px solid color-mix(in srgb, var(--color-bt-ready) 22%, transparent)' }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-bt-ready)', background: 'color-mix(in srgb, var(--color-bt-ready) 28%, var(--color-bt-card))' }}><ExIcon name="utensils" size={19} color="currentColor" /></span>
            <div><div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-bt-text)' }}>Dinner</div><div style={{ fontSize: 13, color: 'var(--color-bt-text-dim)' }}>tinted, with life</div></div>
          </div>
        </div>
      </div>

      {/* category swatches */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 620 }}>
        {CATS.map((cat, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 14px', borderRadius: 12, background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-subtle-border)' }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: cat.c, background: `color-mix(in srgb, ${cat.c} 20%, var(--color-bt-card))`, flexShrink: 0 }}><ExIcon name={cat.icon} size={17} color="currentColor" /></span>
            <span style={{ width: 13, height: 13, borderRadius: '50%', background: cat.c, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-bt-text)' }}>{cat.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--color-bt-text-dim)' }}>{cat.note}</div>
            </div>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: cat.token.includes('NEEDS') ? 'var(--color-bt-warning)' : 'var(--color-bt-text-dim)' }}>{cat.token}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { ColorSystem });

// ── Full Home page (live chrome + redesigned itinerary) ─────────────────
// Matches the shipping Home: top nav, trip header card, tab bar, ITINERARY
// eyebrow + Setup guide, filter chips — with the redesigned soft-filled
// timeline inside. Golf renders as an events/agenda item (orange) to match
// the live app (no separate golf chip). Empty days show "Nothing scheduled".
const HF_DAYS = [
  { day: 'Day 1', date: 'Wed, Jun 17', rows: [
    { kind: 'timed', marker: true, cat: 'lodging', icon: 'home', time: '4:00', ampm: 'PM', title: 'Check in: Beach House' },
  ] },
  { day: 'Day 2', date: 'Thu, Jun 18', rows: [
    { kind: 'timed', cat: 'events', icon: 'clock', time: '6:30', ampm: 'PM', title: 'Dinner', loc: 'The Ocean Room, Kiawah Island, SC' },
    { kind: 'timed', cat: 'events', icon: 'clock', time: '11:00', ampm: 'PM', title: 'Another Test', sub: 'Optional details' },
  ] },
  { day: 'Day 3', date: 'Fri, Jun 19', rows: [
    { kind: 'golf', cat: 'events', icon: 'flag', title: 'Harbour Town Golf Links', loc: '11 Lighthouse Ln, Hilton Head Island, SC', tees: ['7:10a', '7:20a'] },
    { kind: 'timed', marker: true, cat: 'lodging', icon: 'home', time: '10:00', ampm: 'AM', title: 'Check out: Beach House' },
  ] },
  { day: 'Day 4', date: 'Sat, Jun 20', rows: [] },
  { day: 'Day 5', date: 'Sun, Jun 21', rows: [] },
  { day: 'Day 6', date: 'Mon, Jun 22', rows: [] },
  { day: 'Day 7', date: 'Tue, Jun 23', rows: [] },
  { day: 'Day 8', date: 'Wed, Jun 24', rows: [] },
  { day: 'Day 9', date: 'Thu, Jun 25', rows: [] },
  { day: 'Day 10', date: 'Fri, Jun 26', rows: [] },
  { day: 'Day 11', date: 'Sat, Jun 27', rows: [] },
];
const HF_CHIPS = [
  { k: 'all', label: 'All', c: 'var(--color-bt-accent)' },
  { k: 'lodging', label: 'Lodging', c: 'var(--color-bt-planning)' },
  { k: 'travel', label: 'Travel', c: 'var(--color-bt-accent)' },
  { k: 'events', label: 'Events', c: 'var(--color-bt-ready)' },
];
// Arrivals — grouped by mode; timed people first (ordered), untimed stacked at the end.
const ARR_MODES = [
  { icon: 'plane', label: 'Flying', people: [
    { i: 'ZG', c: '#a855f7', nm: 'Zach', t: '12:00p' },
    { i: 'BB', c: '#2dd4bf', nm: 'Buddy', t: '3:15p' },
    { i: 'TL', c: '#06b6d4', nm: 'Tyler', t: '6:20p' },
    { i: 'CP', c: '#22c55e', nm: 'Charlie', t: '9:05p' },
  ] },
  { icon: 'car', label: 'Driving', people: [
    { i: 'BG', c: '#3b82f6', nm: 'Brad', t: '2:30p' },
    { i: 'MS', c: '#d97706', nm: 'Mike', t: '5:40p' },
  ] },
  { icon: 'map-pin', label: 'Other', people: [
    { i: 'JR', c: '#ef4444', nm: 'John', t: null },
  ] },
];

function ArrivalsPanel() {
  return (
    <div className="hf-arr">
      {ARR_MODES.filter(m => m.people.length).map((m, i) => {
        const timed = m.people.filter(p => p.t);
        const untimed = m.people.filter(p => !p.t);
        return (
          <div className="arr-row" key={i}>
            <span className="arr-lab"><ExIcon name={m.icon} size={14} color="currentColor" /> {m.label}</span>
            <div className="arr-people">
              {timed.map((p, j) => (
                <span className="arr-chip" key={j}><span className="av" style={{ background: p.c }}>{p.i}</span><span className="nm">{p.nm}</span><span className="tm">{p.t}</span></span>
              ))}
              {untimed.length > 0 && timed.length > 0 && <span className="arr-sep" />}
              {untimed.map((p, j) => (
                <span className="arr-chip untimed" key={j}><span className="av" style={{ background: p.c }}>{p.i}</span><span className="nm">{p.nm}</span><span className="tm">no time yet</span></span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// collapses neighboring empty days into one band (expandable)
function EmptyRun({ days }) {
  const [open, setOpen] = React.useState(false);
  if (open) return (
    <>
      {days.map((d, i) => (
        <React.Fragment key={i}>
          <div className="el-day">{d.day} <span className="dd">— {d.date}</span></div>
          <div className="el-empty">Nothing scheduled</div>
        </React.Fragment>
      ))}
      <span className="el-runclose" onClick={() => setOpen(false)}><ExIcon name="chevron-up" size={13} color="currentColor" /> Collapse open days</span>
    </>
  );
  const n0 = days[0].day.replace('Day ', ''), n1 = days[days.length - 1].day.replace('Day ', '');
  const d0 = days[0].date.split(', ')[1], d1 = days[days.length - 1].date.split(', ')[1];
  return (
    <div className="el-run">
      <span className="el-rdot" />
      <div className="el-runrow" onClick={() => setOpen(true)}>
        <ExIcon name="calendar" size={15} color="currentColor" />
        <span className="rtxt"><b>Days {n0}–{n1}</b> · {d0} – {d1} · open</span>
        <span className="rexp">Show <ExIcon name="chevron-down" size={13} color="currentColor" /></span>
      </div>
    </div>
  );
}

function HomeFull({ mobile }) {
  const [filter, setFilter] = React.useState('all');
  const days = HF_DAYS.map(d => ({
    ...d,
    rows: filter === 'all' ? d.rows : d.rows.filter(r => r.cat === filter),
  }));
  return (
    <div className="hf">
      <div className="hf-nav">
        <span className="hf-logo">
          <svg width="15" height="15" viewBox="0 0 100 100"><path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="var(--color-bt-accent)" /></svg>
          {!mobile && 'BuddyTrip'}
        </span>
        <span className="hf-switch">BBMI Idea <ExIcon name="chevron-down" size={13} color="currentColor" /></span>
        <span className="hf-navr">
          {!mobile && <><span className="hf-navitem"><ExIcon name="pin" size={15} color="currentColor" /> News</span>
          <span className="hf-navitem"><ExIcon name="message-circle" size={15} color="currentColor" /> Chat</span></>}
          <span className="hf-navitem fb"><ExIcon name="megaphone" size={15} color="currentColor" />{!mobile && ' Feedback'}</span>
          <span className="hf-av"><ExIcon name="user-plus" size={14} color="currentColor" /></span>
        </span>
      </div>

      <div className="hf-head">
        <div className="hf-card">
          <div className="hf-cardtop">
            <span className="hf-ownerpill">Owner</span>
            <span className="hf-tripname">BBMI Idea</span>
            <span className="hf-tripmeta">
              <span className="loc"><ExIcon name="map-pin" size={12} color="currentColor" /> Kiawah Island, SC</span><br />
              Jun 17–30
            </span>
            <span className="hf-gear"><ExIcon name="settings" size={16} color="currentColor" /></span>
          </div>
          <div className="hf-cardbtm">
            <span className="hf-countdown"><span className="hf-cdnum">11</span>{!mobile && <span className="hf-cdtxt">11 days to go</span>}</span>
            <span className="hf-quickadd"><ExIcon name="plus" size={14} color="currentColor" /> Add door codes, wifi…</span>
          </div>
        </div>

        <div className="hf-tabs">
          {[['home', 'Home'], ['crew', 'Crew'], ['lodging', 'Lodging'], ['agenda', 'Agenda'], ['receipts', 'Receipts'], ['competition', 'Competition']].map(([id, label]) => (
            <span key={id} className={`hf-tab${id === 'home' ? ' on' : ''}`}>
              <ExIcon name={{ home: 'home', crew: 'users', lodging: 'building', agenda: 'calendar', receipts: 'dollar-sign', competition: 'trophy' }[id]} size={19} color="currentColor" />
              {!mobile && label}
            </span>
          ))}
        </div>

        {/* pinned lodging strip — stays put while the itinerary scrolls under it */}
        <div className="hf-lodgelab"><ExIcon name="home" size={12} color="currentColor" /> Where we’re staying</div>
        <div className="lodge">
          {[{ name: 'Beach House', meta: 'Jun 17 – 19 · 2 nights · sleeps 8' }].map((l, i) => (
            <div className="lodge-chip" key={i}>
              <span className="lodge-ic"><ExIcon name="home" size={18} color="currentColor" /></span>
              <div className="lodge-info">
                <div className="lodge-name">{l.name}</div>
                <div className="lodge-meta">{l.meta}</div>
              </div>
              <span className="lodge-dir"><ExIcon name="map-pin" size={13} color="currentColor" /> <span className="lbl">Directions</span></span>
            </div>
          ))}
        </div>

        <div className="hf-ihead">
          <span className="hf-ieyebrow">Itinerary</span>
          <span className="hf-setup"><ExIcon name="list-ordered" size={14} color="currentColor" /> Setup guide</span>
        </div>
        <div className="hf-chips">
          {HF_CHIPS.map(c => (
            <span key={c.k} className={`hf-chip${filter === c.k ? ' on' : ''}`} onClick={() => setFilter(c.k)}>
              <span className="cdot" style={{ background: c.c }} /> {c.label}
            </span>
          ))}
        </div>
      </div>

      <div className="hf-scroll">
        <div className="hf-lodgelab" style={{ marginTop: 2 }}><ExIcon name="plane" size={12} color="currentColor" /> Arrivals</div>
        <ArrivalsPanel />
        <div className="el" style={{ marginTop: 20 }}>
          <div className="el-spine" />
          {(() => {
            const blocks = [];
            days.forEach(d => {
              if (!d.rows.length) {
                const last = blocks[blocks.length - 1];
                if (last && last.type === 'run') last.days.push(d);
                else blocks.push({ type: 'run', days: [d] });
              } else blocks.push({ type: 'day', d });
            });
            return blocks.map((b, bi) => {
              if (b.type === 'run') {
                if (b.days.length === 1) {
                  const d = b.days[0];
                  return (
                    <React.Fragment key={bi}>
                      <div className="el-day">{d.day} <span className="dd">— {d.date}</span></div>
                      <div className="el-empty">Nothing scheduled</div>
                    </React.Fragment>
                  );
                }
                return <EmptyRun key={bi} days={b.days} />;
              }
              const d = b.d;
              return (
                <React.Fragment key={bi}>
                  <div className={`el-day${bi === 0 ? ' first' : ''}`}>{d.day} <span className="dd">— {d.date}</span></div>
                  <DayBlocks rows={d.rows} />
                </React.Fragment>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HomeFull });

// ── Alternative: simple row itinerary (the marketing-page concept) ──────
// One card. Door code + wifi up top, then day sections of one-line rows:
// time · category dot · title · optional Map. Category = a single colored
// dot (the lightest accent). No tinted panels, no spine, no big cards.
const SI_DC = '#2dd4bf', SI_EV = 'var(--color-bt-ready)', SI_GO = '#22c55e', SI_LO = 'var(--color-bt-planning)';
const SI_DAYS = [
  { day: 'Wed · Jun 17', rows: [
    { t: '12:00p', c: SI_DC, title: 'Arrivals — 6 of the crew', map: false },
    { t: '4:00p', c: SI_LO, title: 'Check in — Beach House', map: true },
    { t: '7:00p', c: SI_EV, title: 'Dinner — The Ocean Room', map: true },
  ] },
  { day: 'Thu · Jun 18', rows: [
    { t: '7:10a', c: SI_GO, title: 'Harbour Town — Round 1', map: true },
    { t: '8:00p', c: SI_EV, title: 'Dinner + cards at the house', map: false },
  ] },
  { day: 'Fri · Jun 19', rows: [
    { t: '8:00a', c: SI_GO, title: 'Pinehurst No. 2 — walk-on', map: true },
    { t: '10:00a', c: SI_LO, title: 'Check out — Beach House', map: false },
  ] },
];
function SimpleItin() {
  return (
    <div style={{ background: 'var(--color-bt-base)', minHeight: '100%', padding: '22px 16px' }}>
      <div style={{ maxWidth: 540, margin: '0 auto', background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-subtle-border)', borderRadius: 18, padding: 20 }}>
        {/* quick info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--color-bt-subtle-border)', marginBottom: 18 }}>
          {[['door', 'VRBO door code', '4821#'], ['wifi', 'Wifi password', 'PinehurstGolf26']].map(([ic, lab, val], i) => (
            <div key={i} style={{ padding: '13px 15px', borderLeft: i ? '1px solid var(--color-bt-subtle-border)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}><ExIcon name={ic} size={12} color="currentColor" /> {lab}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--color-bt-text)', marginTop: 5 }}>{val}</div>
            </div>
          ))}
        </div>
        {/* days */}
        {SI_DAYS.map((d, i) => (
          <div key={i}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', margin: i ? '18px 0 6px' : '0 0 6px' }}>{d.day}</div>
            {d.rows.map((r, j) => (
              <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '8px 0' }}>
                <span style={{ width: 46, flexShrink: 0, fontSize: 12.5, color: 'var(--color-bt-text-dim)', fontVariantNumeric: 'tabular-nums' }}>{r.t}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.c, flexShrink: 0 }} />
                <span style={{ fontSize: 14, color: 'var(--color-bt-text)', fontWeight: 500 }}>{r.title}</span>
                {r.map && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--color-bt-planning)', background: 'color-mix(in srgb, var(--color-bt-planning) 12%, var(--color-bt-card))', border: '1px solid color-mix(in srgb, var(--color-bt-planning) 24%, transparent)', borderRadius: 8, padding: '5px 10px' }}><ExIcon name="map-pin" size={12} color="currentColor" /> Map</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { SimpleItin });

// ── Hybrid itinerary ────────────────────────────────────────────────────
// Stripped-down rows (tap to expand for map/details) on the SPINE, a pinned
// multi-property lodging block that doesn't scroll, and an "Arrivals" line
// that expands to the three travel types. Correct CrewAvatar-style avatars; "TBD".
function HAvatar({ name, team, size = 24 }) {
  const init = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return <span style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: team || 'var(--color-bt-card-raised)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 500, fontSize: Math.round(size * 0.36) }}>{init}</span>;
}

const HY_LODGING = [
  { name: 'Beach House', dates: 'Jun 17 – 19 · 2 nights' },
  { name: 'Lake Cabin', dates: 'Jun 19 – 21 · 2 nights' },
];
const HY_DAYS = [
  { day: 'Day 1', date: 'Wed · Jun 17', rows: [
    { id: 'arr1', cat: 'travel', title: 'Arrivals', arrivals: {
      flying: [{ n: 'Zach Grether', team: '#a855f7', t: '12:00p' }, { n: 'Charlie Piper', team: '#22c55e', t: '9:05p' }],
      driving: [{ n: 'Brad Giesler', team: '#3b82f6', t: '2:30p' }],
      other: [{ n: 'John Roe', team: '#ef4444', t: null }],
    } },
    { id: 'ci', time: '4:00', ampm: 'PM', cat: 'lodging', title: 'Check in — Beach House', place: true, detail: 'Door code 4821#. Park in the driveway, not the street.' },
    { id: 'din', time: '7:00', ampm: 'PM', cat: 'events', title: 'Dinner — The Pit BBQ', place: true, detail: 'Reservation under Giesler, table for 8.' },
  ] },
  { day: 'Day 2', date: 'Thu · Jun 18', rows: [
    { id: 'r1', time: '7:30', ampm: 'AM', cat: 'golf', title: 'Round 1 — Scramble', place: true, tees: ['7:30a', '7:40a', '7:50a'], detail: 'Carts booked. Range opens 6:45.' },
    { id: 'unp', cat: 'events', title: 'Steak dinner + open bar', detail: 'Someone’s gotta grill. No set time — after the round.' },
  ] },
  { day: 'Day 3', date: 'Fri · Jun 19', rows: [
    { id: 'arr2', cat: 'travel', title: 'Arrivals', arrivals: { driving: [{ n: 'Mike Smith', team: '#d97706', t: '11:00a' }] } },
    { id: 'co', time: '10:00', ampm: 'AM', cat: 'lodging', title: 'Check out — Beach House', place: true },
  ] },
];
const HY_MODES = [{ k: 'flying', icon: 'plane', label: 'Flying' }, { k: 'driving', icon: 'car', label: 'Driving' }, { k: 'other', icon: 'map-pin', label: 'Other' }];

function HyArrivals({ arrivals }) {
  return (
    <div className="hy-arr">
      {HY_MODES.filter(m => arrivals[m.k] && arrivals[m.k].length).map(m => (
        <div className="hy-arrmode" key={m.k}>
          <span className="hy-arrlab"><ExIcon name={m.icon} size={14} color="currentColor" /> {m.label}</span>
          <div className="hy-arrpeople">
            {arrivals[m.k].map((p, i) => (
              <span className={`hy-person${p.t ? '' : ' tbd'}`} key={i}>
                <HAvatar name={p.n} team={p.team} />
                <span className="nm">{p.n.split(' ')[0]}</span>
                <span className="tm">{p.t || 'TBD'}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HyRow({ r }) {
  const [open, setOpen] = React.useState(false);
  const arrCount = r.arrivals ? Object.values(r.arrivals).reduce((n, a) => n + a.length, 0) : 0;
  const expandable = !!(r.detail || r.tees || r.arrivals);
  return (
    <div className={`hy2-row ${CC[r.cat]}`}>
      <div className="hy2-head" onClick={() => expandable && setOpen(o => !o)} style={{ cursor: expandable ? 'pointer' : 'default' }}>
        {r.time
          ? <span className="hy2-time">{r.time}<span style={{ fontSize: 9, opacity: 0.8 }}>{r.ampm}</span></span>
          : <span className="hy2-time none">Anytime</span>}
        <span className={`hy2-dot${r.time ? '' : ' hollow'}`} />
        <span className="hy2-title">{r.title}{arrCount > 0 && <span className="cnt"> · {arrCount}</span>}</span>
        {r.place && <span className="hy2-map" onClick={e => e.stopPropagation()}><ExIcon name="map-pin" size={12} color="currentColor" /> Map</span>}
      </div>
      {open && (
        <div className="hy2-detail">
          {r.arrivals && <HyArrivals arrivals={r.arrivals} />}
          {r.tees && <div className="hy-tees">{r.tees.map((t, i) => <span className="hy-tee" key={i}>{t}</span>)}</div>}
          {r.detail && <div className="hy-dtext">{r.detail}</div>}
        </div>
      )}
    </div>
  );
}

function HybridItin({ mobile }) {
  return (
    <div className="hy">
      <div className="hy-lodge">
        <div className="hy-lablrow"><ExIcon name="home" size={12} color="currentColor" /> Where we’re staying</div>
        <div className="hy-props">
          {HY_LODGING.map((l, i) => (
            <div className="hy-prop" key={i}>
              <span className="ic"><ExIcon name="home" size={17} color="currentColor" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nm">{l.name}</div>
                <div className="dt">{l.dates}</div>
              </div>
              <span className="map"><ExIcon name="map-pin" size={13} color="currentColor" /> {!mobile && 'Directions'}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="hy-scroll">
        {HY_DAYS.map((d, di) => (
          <React.Fragment key={di}>
            <div className={`hy2-day${di === 0 ? ' first' : ''}`}>{d.day} <span style={{ color: 'var(--color-bt-text)' }}>— {d.date}</span></div>
            {d.rows.map(r => <HyRow r={r} key={r.id} />)}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { HybridItin });

// ── "As it lands": existing left-border card style + the 4 additions ────
const RE_DC = { travel: 'var(--color-bt-accent)', lodging: 'var(--color-bt-planning)', events: 'var(--color-bt-ready)' };
const RE_DAYS = [
  { day: 'Day 1', date: 'Wed, Jun 17', arrivals: {
      flying: [{ n: 'Zach Grether', team: '#a855f7', t: '12:00p' }, { n: 'Charlie Piper', team: '#22c55e', t: '9:05p' }],
      driving: [{ n: 'Brad Giesler', team: '#3b82f6', t: '2:30p' }, { n: 'Pat Olsen', team: '#14b8a6', t: null }],
      other: [{ n: 'John Roe', team: '#ef4444', t: null }],
    }, rows: [
    { cat: 'lodging', icon: 'home', time: '4:00 PM', title: 'Check in: Beach House' },
  ] },
  { day: 'Day 2', date: 'Thu, Jun 18', rows: [
    { cat: 'events', icon: 'clock', time: '6:30 PM', title: 'Dinner' },
    { cat: 'events', icon: 'clock', time: '11:00 PM', title: 'Another Test', sub: 'Optional details' },
  ] },
  { day: 'Day 3', date: 'Fri, Jun 19', rows: [
    { cat: 'events', icon: 'clock', time: '7:10 AM · 7:20 AM', title: 'Harbour Town Golf Links', sub: '11 Lighthouse Ln, Hilton Head Island, SC', map: true },
    { cat: 'lodging', icon: 'home', time: '10:00 AM', title: 'Check out: Beach House' },
  ] },
  { day: 'Day 4', date: 'Sat, Jun 20', rows: [] },
  { day: 'Day 5', date: 'Sun, Jun 21', rows: [] },
  { day: 'Day 6', date: 'Mon, Jun 22', rows: [] },
  { day: 'Day 7', date: 'Tue, Jun 23', rows: [] },
  { day: 'Day 8', date: 'Wed, Jun 24', rows: [] },
  { day: 'Day 9', date: 'Thu, Jun 25', arrivals: { driving: [{ n: 'Mike Smith', team: '#d97706', t: '11:00a' }] }, rows: [] },
  { day: 'Day 10', date: 'Fri, Jun 26', rows: [] },
  { day: 'Day 11', date: 'Sat, Jun 27', rows: [] },
];
const RE_LODGING = [
  { name: 'Beach House', dates: 'Jun 17 – 19 · 2 nights', sleeps: 8 },
  { name: 'Lake Cabin', dates: 'Jun 19 – 21 · 2 nights', sleeps: 6 },
];

function ReArrivals({ arrivals }) {
  const [open, setOpen] = React.useState(false);
  const n = Object.values(arrivals).reduce((a, g) => a + g.length, 0);
  return (
    <div className="re-card re-arr" style={{ '--c': RE_DC.travel, flexDirection: 'column', alignItems: 'stretch' }} onClick={() => setOpen(o => !o)}>
      <div className="re-arrhead">
        <span className="re-ico"><ExIcon name="plane" size={18} color="currentColor" /></span>
        <div className="re-body"><div className="re-title">Arrivals <span style={{ color: 'var(--color-bt-text-dim)', fontWeight: 400 }}>· {n}</span></div><div className="re-sub">Who’s getting in — tap for details</div></div>
        <span className={`re-chev${open ? ' open' : ''}`}><ExIcon name="chevron-down" size={16} color="currentColor" /></span>
      </div>
      {open && <div className="re-arrdetail" onClick={e => e.stopPropagation()}><HyArrivals arrivals={arrivals} /></div>}
    </div>
  );
}

function ReEmptyRun({ days }) {
  const [open, setOpen] = React.useState(false);
  if (open) return (
    <>
      {days.map((d, i) => (<React.Fragment key={i}><div className="re-day">{d.day} <span className="dd">— {d.date}</span></div><div className="re-emptyone">Nothing scheduled</div></React.Fragment>))}
      <span className="re-runclose" onClick={() => setOpen(false)}><ExIcon name="chevron-up" size={13} color="currentColor" /> Collapse open days</span>
    </>
  );
  const n0 = days[0].day.replace('Day ', ''), n1 = days[days.length - 1].day.replace('Day ', '');
  const d0 = days[0].date.split(', ')[1], d1 = days[days.length - 1].date.split(', ')[1];
  return (
    <div className="re-run" onClick={() => setOpen(true)}>
      <ExIcon name="calendar" size={15} color="currentColor" />
      <span className="rtxt"><b>Days {n0}–{n1}</b> · {d0} – {d1} · open</span>
      <span className="rexp">Show <ExIcon name="chevron-down" size={13} color="currentColor" /></span>
    </div>
  );
}

// mobile filter dropdown — replaces the chip row when space is tight
function FilterDropdown({ filter, setFilter }) {
  const [open, setOpen] = React.useState(false);
  const cur = HF_CHIPS.find(c => c.k === filter) || HF_CHIPS[0];
  return (
    <div className="hf-fdd">
      <button className="hf-fddbtn" onClick={() => setOpen(o => !o)}>
        <span className="cdot" style={{ background: cur.c }} /> {cur.label}
        <ExIcon name="chevron-down" size={14} color="currentColor" />
      </button>
      {open && (
        <div className="hf-fddmenu">
          {HF_CHIPS.map(c => (
            <span key={c.k} className={`hf-fddopt${filter === c.k ? ' on' : ''}`} onClick={() => { setFilter(c.k); setOpen(false); }}>
              <span className="cdot" style={{ background: c.c }} /> {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ReCard({ r }) {
  return (
    <div className="re-card" style={{ '--c': RE_DC[r.cat] }}>
      <span className="re-ico"><ExIcon name={r.icon} size={18} color="currentColor" /></span>
      <div className="re-body">
        <div className="re-time">{r.time}</div>
        <div className="re-title">{r.title}</div>
        {r.sub && <div className="re-sub">{r.sub}</div>}
      </div>
      {r.map && <span className="re-map"><ExIcon name="map-pin" size={13} color="currentColor" /> Map →</span>}
    </div>
  );
}
function ReDayContent({ d, filter }) {
  const rows = filter === 'all' ? d.rows : d.rows.filter(r => r.cat === filter);
  const showArr = d.arrivals && (filter === 'all' || filter === 'travel');
  return (<>{showArr && <ReArrivals arrivals={d.arrivals} />}{rows.map((r, j) => <ReCard r={r} key={j} />)}</>);
}
// past days collapsed into one minimized "Earlier" line; expands to dimmed + shrunk
function PastRun({ days, filter }) {
  const [open, setOpen] = React.useState(false);
  const n0 = days[0].day.replace('Day ', ''), n1 = days[days.length - 1].day.replace('Day ', '');
  const d0 = days[0].date.split(', ')[1], d1 = days[days.length - 1].date.split(', ')[1];
  if (!open) return (
    <div className="re-run" onClick={() => setOpen(true)}>
      <ExIcon name="check" size={15} color="currentColor" />
      <span className="rtxt"><b>Earlier</b> · Days {n0}–{n1} · {d0} – {d1} · done</span>
      <span className="rexp">Show <ExIcon name="chevron-down" size={13} color="currentColor" /></span>
    </div>
  );
  return (
    <>
      <div className="re-pastwrap">
        {days.map((d, i) => (
          <React.Fragment key={i}>
            <div className="re-day">{d.day} <span className="dd">— {d.date}</span></div>
            {d.rows.length || d.arrivals ? <ReDayContent d={d} filter={filter} /> : <div className="re-emptyone">Nothing scheduled</div>}
          </React.Fragment>
        ))}
      </div>
      <span className="re-pasthide" onClick={() => setOpen(false)}><ExIcon name="chevron-up" size={13} color="currentColor" /> Hide past days</span>
    </>
  );
}

function HomeReal({ mobile, setupLink, setupLeft = 0, todayIdx }) {
  const [filter, setFilter] = React.useState('all');
  const showLodging = filter === 'all' || filter === 'lodging';
  // per-day visible content under the active filter; days before today collapse into a "past" block
  const blocks = [];
  const pastDays = [];
  RE_DAYS.forEach((d, i) => {
    if (todayIdx != null && i < todayIdx) { pastDays.push(d); return; }
    const rows = filter === 'all' ? d.rows : d.rows.filter(r => r.cat === filter);
    const showArr = d.arrivals && (filter === 'all' || filter === 'travel');
    const empty = !rows.length && !showArr;
    if (empty) { const l = blocks[blocks.length - 1]; if (l && l.type === 'run') l.days.push(d); else blocks.push({ type: 'run', days: [d] }); }
    else blocks.push({ type: 'day', d, rows, showArr, today: i === todayIdx });
  });
  if (pastDays.length) blocks.unshift({ type: 'past', days: pastDays });
  return (
    <div className="hf">
      <div className="hf-nav">
        <span className="hf-logo"><svg width="15" height="15" viewBox="0 0 100 100"><path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="var(--color-bt-accent)" /></svg>{!mobile && 'BuddyTrip'}</span>
        <span className="hf-switch">BBMI Idea <ExIcon name="chevron-down" size={13} color="currentColor" /></span>
        <span className="hf-navr">
          {!mobile && <><span className="hf-navitem"><ExIcon name="pin" size={15} color="currentColor" /> News</span><span className="hf-navitem"><ExIcon name="message-circle" size={15} color="currentColor" /> Chat</span></>}
          <span className="hf-navitem fb"><ExIcon name="megaphone" size={15} color="currentColor" />{!mobile && ' Feedback'}</span>
          <span className="hf-av"><ExIcon name="user-plus" size={14} color="currentColor" /></span>
        </span>
      </div>
      <div className="hf-head">
        <div className="hf-card">
          <div className="hf-cardtop">
            <span className="hf-ownerpill">Owner</span><span className="hf-tripname">BBMI Idea</span>
            <span className="hf-tripmeta"><span className="loc"><ExIcon name="map-pin" size={12} color="currentColor" /> Kiawah Island, SC</span><br />Jun 17–30</span>
            <span className="hf-gear"><ExIcon name="settings" size={16} color="currentColor" /></span>
          </div>
          <div className="hf-cardbtm">
            <span className="hf-countdown"><span className="hf-cdnum">11</span>{!mobile && <span className="hf-cdtxt">11 days to go</span>}</span>
            <span className="hf-quickadd"><ExIcon name="plus" size={14} color="currentColor" /> Add door codes, wifi…</span>
          </div>
        </div>
        <div className="hf-tabs">
          {[['home', 'Home'], ['crew', 'Crew'], ['lodging', 'Lodging'], ['agenda', 'Agenda'], ['receipts', 'Receipts'], ['competition', 'Competition']].map(([id, label]) => (
            <span key={id} className={`hf-tab${id === 'home' ? ' on' : ''}`}><ExIcon name={{ home: 'home', crew: 'users', lodging: 'building', agenda: 'calendar', receipts: 'dollar-sign', competition: 'trophy' }[id]} size={19} color="currentColor" />{!mobile && label}</span>
          ))}
        </div>
        {/* ITINERARY + filters on one row (filters right) */}
        <div className="hf-ihead">
          <span className="hf-ieyebrow">Itinerary</span>
          {setupLink && (
            <span className="hf-setupL" onClick={setupLink}>
              <ExIcon name="list-ordered" size={13} color="currentColor" />{!mobile && ' Setup guide'}
              {setupLeft > 0 && <><span className="ndot" /><span className="nleft">{setupLeft} left</span></>}
            </span>
          )}
          {mobile
            ? <FilterDropdown filter={filter} setFilter={setFilter} />
            : <div className="hf-chips" style={{ marginLeft: 'auto', marginBottom: 0 }}>
                {HF_CHIPS.map(c => <span key={c.k} className={`hf-chip${filter === c.k ? ' on' : ''}`} onClick={() => setFilter(c.k)}><span className="cdot" style={{ background: c.c }} /> {c.label}</span>)}
              </div>}
        </div>
        {/* #1 lodging — under the filters, hidden when filtered out */}
        {showLodging && (
          <div className="hy-props" style={{ marginTop: 12 }}>
            {RE_LODGING.map((l, i) => (
              <div className="hy-prop" key={i}>
                <span className="ic"><ExIcon name="home" size={17} color="currentColor" /></span>
                <div style={{ flex: 1, minWidth: 0 }}><div className="nm">{l.name}</div><div className="dt">{l.dates}{l.sleeps ? ` · Sleeps ${l.sleeps}` : ''}</div></div>
                <span className="map"><ExIcon name="map-pin" size={13} color="currentColor" /> {!mobile && 'Directions'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* #4 scroll region (fades under fixed head) */}
      <div className="hf-scroll">
        {blocks.map((b, bi) => {
          if (b.type === 'past') return <PastRun key={bi} days={b.days} filter={filter} />;
          if (b.type === 'run') {
            if (b.days.length === 1) return (<React.Fragment key={bi}><div className="re-day">{b.days[0].day} <span className="dd">— {b.days[0].date}</span></div><div className="re-emptyone">Nothing scheduled</div></React.Fragment>);
            return <ReEmptyRun key={bi} days={b.days} />;
          }
          const { d } = b;
          return (
            <React.Fragment key={bi}>
              <div className={`re-day${bi === 0 ? ' first' : ''}`}>{d.day} <span className="dd">— {d.date}</span>{b.today && <span className="re-todaypill">TODAY</span>}</div>
              <ReDayContent d={d} filter={filter} />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { HomeReal });

// ── Setup guide ⇄ itinerary transition ──────────────────────────────────
// New trip → setup guide is primary. "View itinerary →" peeks; once there's
// enough (dates + lodging/agenda), a commit bar lets the owner switch their
// Home to the itinerary for good — after which Setup guide is just a link
// pulled left next to ITINERARY.
const SG_CARDS = [
  { n: 1, done: true, title: 'Dates set', desc: 'Jun 17–30, 14 days. These frame your whole itinerary.', btn: 'Edit dates', bicon: 'pencil' },
  { n: 2, done: true, title: 'Invite the crew', desc: 'Add everyone — they join, share travel, and split costs from their phone.', btn: '9 added', bicon: 'check' },
  { n: 3, done: true, title: 'Add lodging', desc: 'Properties and rooms. Set nightly dates now or once your trip dates land.', btn: 'Beach House', bicon: 'check' },
  { n: 4, done: false, title: 'Plan the agenda', desc: 'Tee times, dinners, side games. Slot them onto days whenever you like.', btn: 'Plan agenda', bicon: 'flag' },
];

function SetupGuide({ mobile, onView, onCommit }) {
  const ready = SG_CARDS.filter(c => c.done).length >= 2; // dates + ≥1 of lodging/agenda
  return (
    <div className="hf">
      <div className="hf-nav">
        <span className="hf-logo"><svg width="15" height="15" viewBox="0 0 100 100"><path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="var(--color-bt-accent)" /></svg>{!mobile && 'BuddyTrip'}</span>
        <span className="hf-switch">BBMI Idea <ExIcon name="chevron-down" size={13} color="currentColor" /></span>
        <span className="hf-navr">
          {!mobile && <><span className="hf-navitem"><ExIcon name="pin" size={15} color="currentColor" /> News</span><span className="hf-navitem"><ExIcon name="message-circle" size={15} color="currentColor" /> Chat</span></>}
          <span className="hf-navitem fb"><ExIcon name="megaphone" size={15} color="currentColor" />{!mobile && ' Feedback'}</span>
          <span className="hf-av"><ExIcon name="user-plus" size={14} color="currentColor" /></span>
        </span>
      </div>
      <div className="hf-head">
        <div className="hf-card">
          <div className="hf-cardtop">
            <span className="hf-ownerpill">Owner</span><span className="hf-tripname">BBMI Idea</span>
            <span className="hf-tripmeta"><span className="loc"><ExIcon name="map-pin" size={12} color="currentColor" /> Kiawah Island, SC</span><br />Jun 17–30</span>
            <span className="hf-gear"><ExIcon name="settings" size={16} color="currentColor" /></span>
          </div>
          <div className="hf-cardbtm">
            <span className="hf-countdown"><span className="hf-cdnum">11</span>{!mobile && <span className="hf-cdtxt">11 days to go</span>}</span>
            <span className="hf-quickadd"><ExIcon name="plus" size={14} color="currentColor" /> Add door codes, wifi…</span>
          </div>
        </div>
        <div className="hf-tabs">
          {[['home', 'Home'], ['crew', 'Crew'], ['lodging', 'Lodging'], ['agenda', 'Agenda'], ['receipts', 'Receipts'], ['competition', 'Competition']].map(([id, label]) => (
            <span key={id} className={`hf-tab${id === 'home' ? ' on' : ''}`}><ExIcon name={{ home: 'home', crew: 'users', lodging: 'building', agenda: 'calendar', receipts: 'dollar-sign', competition: 'trophy' }[id]} size={19} color="currentColor" />{!mobile && label}</span>
          ))}
        </div>
        <div className="hf-ihead">
          <span className="sg-eyebrow">Get set up</span>
          <span className="sg-peek" style={{ marginLeft: 'auto' }} onClick={onView}>View itinerary <ExIcon name="chevron-right" size={13} color="currentColor" /></span>
        </div>
      </div>
      <div className="hf-scroll">
        <div className="sg-headrow">
          {!mobile && <span className="sg-thumb"><ExIcon name="map-pin" size={26} color="currentColor" /></span>}
          <div>
            <div className="sg-h">Add what you’ve got</div>
            <div className="sg-sub">Add any of these in any order and they weave into one timeline. Dates frame it best — start there if you can — but nothing’s blocked until you do.</div>
          </div>
        </div>
        <div className="sg-cards">
          {SG_CARDS.map((c, i) => (
            <div className="sg-card" key={i}>
              <div className="sg-vis" />
              <div className="sg-ct">
                <span className={`sg-badge ${c.done ? 'done' : 'todo'}`}>{c.done ? <ExIcon name="check" size={12} color="currentColor" /> : c.n}</span>
                {c.title}
              </div>
              <div className="sg-cdesc">{c.desc}</div>
              <span className={`sg-cbtn${c.done && c.bicon === 'check' ? ' done' : ''}`}><ExIcon name={c.bicon} size={13} color="currentColor" /> {c.btn}</span>
            </div>
          ))}
        </div>
        {ready && (
          <div className="sg-commit">
            <div style={{ flex: 1 }}>
              <div className="ct">You’ve got enough to go</div>
              <div className="cd">Make the itinerary your Home. You can reopen Setup guide anytime — even just to track travel or lodging.</div>
            </div>
            <button className="go" onClick={onCommit}><ExIcon name="check" size={14} color="#0d1f1a" /> Switch to itinerary</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SetupHome({ mobile, start = 'setup', setupLeft = 0 }) {
  const [view, setView] = React.useState(start);
  return view === 'setup'
    ? <SetupGuide mobile={mobile} onView={() => setView('itin')} onCommit={() => setView('itin')} />
    : <HomeReal mobile={mobile} setupLink={() => setView('setup')} setupLeft={setupLeft} />;
}

Object.assign(window, { SetupHome, SetupGuide });
