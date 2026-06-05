// explorations-board.jsx — Title-bar reorg + the "Trip Board" (repurposed
// notification slot) + Quick-info tiles.
//
//  • New title bar: left = identity/scope (logo + trip switcher breadcrumb),
//    right = me + global tools (Board, Chat, avatar). Notifications removed.
//  • Trip Board: a right slide-over of owner/organizer posts, newest first,
//    built from a small set of modular block types (text / teams / media /
//    steps / callout). Authoring is gated to owner + organizers; everyone
//    else gets a clean read-only panel.
//  • Quick-info tiles: door codes / wifi / house numbers stay glanceable at
//    the top of Home (reference data you grab repeatedly — not a feed).

(function injectBoardCss() {
  if (typeof document === 'undefined' || document.getElementById('btBoardCss')) return;
  const css = `
  /* ── New title bar ───────────────────────────────────────── */
  .tb { height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px;
    padding:0 16px; background: var(--color-bt-nav-bg); backdrop-filter: blur(14px);
    border-bottom:1px solid var(--color-bt-subtle-border); }
  .tb-left { display:flex; align-items:center; gap:10px; min-width:0; }
  .tb-logo { display:inline-flex; align-items:center; gap:7px; font-size:16px; font-weight:600;
    letter-spacing:0.04em; color: var(--color-bt-text); flex-shrink:0; }
  .tb-slash { color: var(--color-bt-text-dim); opacity:0.5; font-size:18px; font-weight:300; }
  .tb-switch { display:inline-flex; align-items:center; gap:8px; padding:5px 9px 5px 7px;
    border-radius:9px; background: var(--color-bt-card-raised); border:1px solid var(--color-bt-border);
    cursor:pointer; min-width:0; }
  .tb-switch:hover { background: var(--color-bt-hover); }
  .tb-switch .nm { font-size:14px; font-weight:600; color: var(--color-bt-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tb-switch .ow { font-size:9px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color: var(--color-bt-owner); border:1px solid var(--color-bt-owner); border-radius:4px; padding:1px 5px; }
  .tb-right { display:flex; align-items:center; gap:6px; flex-shrink:0; }
  .tb-board { display:inline-flex; align-items:center; gap:7px; padding:7px 12px 7px 10px; border-radius:9px;
    background: var(--color-bt-accent-faint); border:1px solid var(--color-bt-accent-border);
    color: var(--color-bt-accent); font-size:13px; font-weight:600; cursor:pointer; }
  .tb-board .ct { font-family: var(--font-mono); font-size:11px; background: var(--color-bt-accent); color:#0d1f1a; border-radius:9999px; padding:0 6px; line-height:16px; min-width:16px; text-align:center; }
  .tb-ico { width:36px; height:36px; border-radius:9px; display:inline-flex; align-items:center; justify-content:center;
    color: var(--color-bt-text-dim); cursor:pointer; position:relative; background:transparent; border:none; }
  .tb-ico:hover { background: var(--color-bt-hover); }
  .tb-newdot { position:absolute; top:7px; right:8px; width:7px; height:7px; border-radius:50%; background: var(--color-bt-accent); border:1.5px solid var(--color-bt-nav-bg); }
  .tb-av { width:30px; height:30px; border-radius:50%; background: var(--color-bt-accent); color:#0d1f1a;
    display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; cursor:pointer; }

  /* ── Quick-info tiles ────────────────────────────────────── */
  .qi { display:grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap:10px; }
  .qi-tile { display:flex; align-items:center; gap:11px; padding:12px 13px; border-radius:12px;
    background: var(--color-bt-card); border:1px solid var(--color-bt-border); position:relative; }
  .qi-ic { width:34px; height:34px; border-radius:9px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center;
    background: var(--color-bt-accent-faint); color: var(--color-bt-accent); }
  .qi-main { min-width:0; flex:1; }
  .qi-label { font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color: var(--color-bt-text-dim); }
  .qi-val { font-family: var(--font-mono); font-size:16px; font-weight:600; color: var(--color-bt-text); margin-top:2px; letter-spacing:0.02em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .qi-copy { all:unset; cursor:pointer; width:28px; height:28px; border-radius:7px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; color: var(--color-bt-text-dim); }
  .qi-copy:hover { background: var(--color-bt-hover); color: var(--color-bt-text); }

  /* ── Board slide-over ────────────────────────────────────── */
  .bd-scrim { position:absolute; inset:0; background: var(--color-bt-overlay); z-index:20; }
  .bd-panel { position:absolute; top:0; right:0; bottom:0; width:min(660px, 92%); z-index:21;
    background: var(--color-bt-base); border-left:1px solid var(--color-bt-border);
    box-shadow: -24px 0 60px rgba(0,0,0,0.35); display:flex; flex-direction:column; }
  .bd-head { flex-shrink:0; padding:16px 18px; border-bottom:1px solid var(--color-bt-subtle-border);
    display:flex; align-items:flex-start; gap:12px; }
  .bd-htitle { display:flex; align-items:center; gap:9px; font-size:17px; font-weight:700; color: var(--color-bt-text); }
  .bd-hsub { font-size:12px; color: var(--color-bt-text-dim); margin-top:3px; line-height:1.4; display:flex; align-items:center; gap:6px; }
  .bd-x { all:unset; cursor:pointer; width:30px; height:30px; border-radius:9px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; color: var(--color-bt-text-dim); background: var(--color-bt-card-raised); }
  .bd-compose { margin:14px 18px 0; display:flex; align-items:center; gap:10px; padding:11px 13px; border-radius:11px;
    border:1px dashed var(--color-bt-accent-border); background: var(--color-bt-accent-faint); cursor:pointer; }
  .bd-compose .pl { flex:1; font-size:13px; color: var(--color-bt-text-dim); }
  .bd-compose .go { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color: var(--color-bt-accent); }
  .bd-scroll { flex:1; overflow-y:auto; padding:16px 18px 28px; display:flex; flex-direction:column; gap:14px; }

  .post { border:1px solid var(--color-bt-border); border-radius:14px; background: var(--color-bt-card); overflow:hidden; }
  .post-h { display:flex; align-items:center; gap:11px; padding:14px 16px 0; }
  .post-id { flex:1; min-width:0; }
  .post-nm { font-size:14px; font-weight:700; color: var(--color-bt-text); }
  .post-role { font-size:11px; font-weight:600; margin-top:1px; }
  .post-meta { display:flex; align-items:center; gap:8px; flex-shrink:0; }
  .post-time { font-size:11px; color: var(--color-bt-text-dim); font-family: var(--font-mono); }
  .post-pin { display:inline-flex; align-items:center; gap:4px; font-size:9px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase;
    color: var(--color-bt-owner); background: var(--color-bt-warning-faint); border:1px solid var(--color-bt-warning-border); border-radius:5px; padding:2px 6px; }
  .post-more { all:unset; cursor:pointer; width:26px; height:26px; border-radius:7px; display:inline-flex; align-items:center; justify-content:center; color: var(--color-bt-text-dim); }
  .post-more:hover { background: var(--color-bt-hover); }
  .post-body { padding:12px 16px 16px; display:flex; flex-direction:column; gap:12px; }

  .blk-p { font-size:13.5px; line-height:1.6; color: var(--color-bt-text); margin:0; }
  .blk-p.dim { color: var(--color-bt-text-dim); }

  .blk-teams { display:grid; grid-template-columns: repeat(2, 1fr); gap:9px; }
  @container (max-width: 520px) { .blk-teams { grid-template-columns:1fr; } }
  .team-card { border:1px solid var(--color-bt-border); border-left-width:3px; border-radius:9px; padding:10px 12px; background: var(--color-bt-card-raised); }
  .team-name { font-family: Georgia, 'Times New Roman', serif; font-style:italic; font-weight:700; font-size:13.5px; color: var(--color-bt-text); }
  .team-roster { font-size:11.5px; color: var(--color-bt-text-dim); margin-top:3px; }

  .blk-video { border:1px solid var(--color-bt-border); border-radius:11px; aspect-ratio:16/9; background:
    radial-gradient(120% 120% at 50% 40%, rgba(16,185,129,0.10), transparent 60%), var(--color-bt-card-raised);
    display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; }
  .blk-play { width:58px; height:58px; border-radius:50%; background: var(--color-bt-accent-faint); border:1px solid var(--color-bt-accent-border);
    display:inline-flex; align-items:center; justify-content:center; color: var(--color-bt-accent); }
  .blk-vmeta { text-align:center; }
  .blk-vtitle { font-size:13px; font-weight:600; color: var(--color-bt-text); }
  .blk-vsub { font-size:11px; color: var(--color-bt-text-dim); margin-top:2px; }

  .blk-steps { display:flex; flex-direction:column; gap:8px; }
  .step { display:flex; align-items:flex-start; gap:11px; padding:11px 12px; border-radius:9px; background: var(--color-bt-card-raised); }
  .step-n { flex-shrink:0; width:22px; height:22px; border-radius:50%; border:1px solid var(--color-bt-accent-border);
    color: var(--color-bt-accent); font-size:11px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; }
  .step-tx { font-size:13px; line-height:1.5; color: var(--color-bt-text); }
  .step-tx b { color: var(--color-bt-accent); font-weight:600; }

  .blk-callout { display:flex; gap:11px; padding:12px 13px; border-radius:10px; background: var(--color-bt-warning-faint); border:1px solid var(--color-bt-warning-border); }
  .blk-callout .ic { color: var(--color-bt-owner); flex-shrink:0; }
  .blk-callout .tx { font-size:13px; line-height:1.5; color: var(--color-bt-text); }

  /* composer block palette (owner authoring affordance) */
  .bd-palette { display:flex; flex-wrap:wrap; gap:6px; }
  .bd-chip { display:inline-flex; align-items:center; gap:5px; padding:5px 10px; border-radius:8px; font-size:11px; font-weight:600;
    color: var(--color-bt-text-dim); background: var(--color-bt-card-raised); border:1px solid var(--color-bt-border); }
  `;
  const s = document.createElement('style');
  s.id = 'btBoardCss';
  s.textContent = css;
  document.head.appendChild(s);
})();

/* ── New title bar ─────────────────────────────────────────── */
function BtTopBar({ owner = true, boardCount = 2, newOnBoard = true }) {
  return (
    <div className="tb">
      <div className="tb-left">
        <span className="tb-logo">
          <svg width="15" height="15" viewBox="0 0 100 100"><path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="var(--color-bt-accent)"/></svg>
          BuddyTrip
        </span>
        <span className="tb-slash">/</span>
        <button className="tb-switch">
          {owner && <span className="ow">Owner</span>}
          <span className="nm">BBMI</span>
          <ExIcon name="chevron-down" size={15} color="var(--color-bt-text-dim)" />
        </button>
      </div>
      <div className="tb-right">
        <button className="tb-board">
          <ExIcon name="pin" size={16} color="currentColor" />
          News <span className="ct">{boardCount}</span>
        </button>
        <button className="tb-ico" aria-label="Chat">
          <ExIcon name="message-circle" size={19} color="currentColor" />
        </button>
        <span className="tb-av">{owner ? 'ZG' : 'GR'}</span>
      </div>
    </div>
  );
}

/* ── Quick-info tiles ──────────────────────────────────────── */
const QUICK_INFO = [
  { icon: 'lock', label: 'Door code', value: '4827#' },
  { icon: 'wifi', label: 'WiFi', value: 'Pinehurst9 / golf2026' },
  { icon: 'door', label: 'House #', value: '112 Carolina Vista' },
];
function QuickInfoTiles() {
  return (
    <div className="qi">
      {QUICK_INFO.map(t => (
        <div className="qi-tile" key={t.label}>
          <span className="qi-ic"><ExIcon name={t.icon} size={17} color="currentColor" /></span>
          <div className="qi-main">
            <div className="qi-label">{t.label}</div>
            <div className="qi-val">{t.value}</div>
          </div>
          <button className="qi-copy" aria-label="Copy"><ExIcon name="copy" size={14} color="currentColor" /></button>
        </div>
      ))}
    </div>
  );
}

/* ── Block renderers ───────────────────────────────────────── */
function Block({ b }) {
  switch (b.type) {
    case 'text':
      return <p className={`blk-p${b.dim ? ' dim' : ''}`}>{b.text}</p>;
    case 'teams':
      return (
        <div className="blk-teams">
          {b.teams.map(t => (
            <div className="team-card" key={t.name} style={{ borderLeftColor: t.color }}>
              <div className="team-name">{t.name}</div>
              <div className="team-roster">{t.players.join(' · ')}</div>
            </div>
          ))}
        </div>
      );
    case 'video':
      return (
        <div className="blk-video">
          <span className="blk-play"><ExIcon name="play" size={22} color="currentColor" /></span>
          <div className="blk-vmeta">
            <div className="blk-vtitle">{b.title}</div>
            <div className="blk-vsub">{b.meta}</div>
          </div>
        </div>
      );
    case 'steps':
      return (
        <div className="blk-steps">
          {b.steps.map((s, i) => (
            <div className="step" key={i}>
              <span className="step-n">{i + 1}</span>
              <span className="step-tx"><b>{s.label}</b> — {s.body}</span>
            </div>
          ))}
        </div>
      );
    case 'callout':
      return (
        <div className="blk-callout">
          <span className="ic"><ExIcon name="pin" size={16} color="currentColor" /></span>
          <span className="tx">{b.text}</span>
        </div>
      );
    default:
      return null;
  }
}

/* ── Posts data (newest first) ─────────────────────────────── */
const BOARD_POSTS = [
  {
    author: 'Zach Grether', role: 'Builder', roleColor: 'var(--color-bt-accent)', initials: 'ZG', team: '#2dd4bf',
    time: '1d', pinned: false,
    blocks: [
      { type: 'text', text: 'Few things to know before we get there:' },
      { type: 'steps', steps: [
        { label: 'Scores', body: 'enter your own after each hole. Forget, and your team’s scorer can do it. Nobody has an excuse.' },
        { label: 'Leaderboard', body: 'live all week. Tap the trophy from anywhere. Yes, Buddy, there is a trophy icon.' },
        { label: 'Chat', body: 'the main thread is everyone. Your team has a private channel for actual strategy.' },
        { label: 'Schedule', body: 'tee times, dinners, all in the Agenda tab. Don’t ask Brad when dinner is.' },
      ] },
    ],
  },
  {
    author: 'Charlie Piper', role: 'Historian', roleColor: 'var(--color-bt-accent)', initials: 'CP', team: '#a855f7',
    time: '1d', pinned: false,
    blocks: [
      { type: 'text', text: 'Annual recap of BBMI 2025 is ready. This one’s particularly special — you’ll know why when you get to the back nine. Volume up.' },
      { type: 'video', title: 'BBMI 2025 — The Annual Recap', meta: 'Charlie Piper · 8 min · YouTube' },
      { type: 'text', dim: true, text: 'See you all on the first tee. Try not to embarrass yourselves before I can film it.' },
    ],
  },
  {
    author: 'Brad Giesler', role: 'Commish · Owner', roleColor: 'var(--color-bt-owner)', initials: 'BG', team: '#3b82f6',
    time: '2d', pinned: true,
    blocks: [
      { type: 'text', text: 'Gentlemen. Year 19. Let that sink in. Some of you weren’t even legally allowed to drink at year one.' },
      { type: 'text', text: 'This year everything lives in the app — scores, schedule, trash talk, all of it. Zach built it. Please don’t break it on day one.' },
      { type: 'text', text: 'Without further whining from me, here are your teams:' },
      { type: 'teams', teams: [
        { name: 'The Usual Suspects', color: '#3b82f6', players: ['Brad G', 'Tyler L', 'JD S', 'Rob D'] },
        { name: 'Buddy’s Last Stand', color: '#2dd4bf', players: ['Buddy B', 'Bill G', 'Charlie P', 'BJ D'] },
        { name: 'Not Golfing, Just Vibing', color: '#a855f7', players: ['Zach G', 'John R', 'Jeremy M', 'Marcus T'] },
        { name: 'Former Breeders II', color: '#d97706', players: ['Mike S', 'Dave K', 'Chris W', 'Pat O'] },
      ] },
      { type: 'text', text: 'May the best team win. May the worst team engrave something.' },
    ],
  },
];

function BoardPost({ post, canManage }) {
  return (
    <div className="post">
      <div className="post-h">
        <CrewAvatar member={{ name: post.author, status: 'active', team: post.team }} size={38} />
        <div className="post-id">
          <div className="post-nm">{post.author}</div>
          <div className="post-role" style={{ color: post.roleColor }}>{post.role}</div>
        </div>
        <div className="post-meta">
          {post.pinned && <span className="post-pin"><ExIcon name="pin" size={10} color="currentColor" /> Pinned</span>}
          <span className="post-time">{post.time}</span>
          {canManage && <button className="post-more" aria-label="Edit post"><ExIcon name="more-horizontal" size={16} color="currentColor" /></button>}
        </div>
      </div>
      <div className="post-body">
        {post.blocks.map((b, i) => <Block b={b} key={i} />)}
      </div>
    </div>
  );
}

function BoardPanel({ canPost }) {
  return (
    <aside className="bd-panel">
      <div className="bd-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="bd-htitle"><ExIcon name="pin" size={18} color="var(--color-bt-accent)" /> News</div>
          <div className="bd-hsub">
            {canPost
              ? <>Posts from you & organizers — front and center for everyone.</>
              : <><ExIcon name="lock" size={11} color="currentColor" /> Posted by organizers · read-only</>}
          </div>
        </div>
        <button className="bd-x" aria-label="Close"><ExIcon name="x" size={15} color="currentColor" /></button>
      </div>

      {canPost && (
        <div className="bd-compose">
          <CrewAvatar member={{ name: 'Zach Grether', status: 'active', team: '#2dd4bf' }} size={30} />
          <span className="pl">Post an update to the crew…</span>
          <span className="go"><ExIcon name="pencil" size={13} color="currentColor" /> New post</span>
        </div>
      )}

      <div className="bd-scroll">
        {BOARD_POSTS.map((p, i) => <BoardPost post={p} canManage={canPost} key={i} />)}
      </div>
    </aside>
  );
}

/* ── App behind the panel (minimal Home) ───────────────────── */
function HomeBehind({ owner }) {
  return (
    <div className="bt-screen" style={{ filter: 'saturate(0.9)' }}>
      <BtTopBar owner={owner} />
      <div className="bt-page">
        <BtTripHeader owner={owner} />
        <BtTabBar active="home" owner={owner} />
        <div style={{ margin: '18px 0' }}>
          <div className="bt-eyebrow">Quick info</div>
          <div style={{ height: 8 }} />
          <QuickInfoTiles />
        </div>
      </div>
    </div>
  );
}

function BoardOwnerView() {
  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden', background: 'var(--color-bt-base)' }}>
      <HomeBehind owner={true} />
      <div className="bd-scrim" />
      <BoardPanel canPost={true} />
    </div>
  );
}
function BoardMemberView() {
  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden', background: 'var(--color-bt-base)' }}>
      <HomeBehind owner={false} />
      <div className="bd-scrim" />
      <BoardPanel canPost={false} />
    </div>
  );
}

/* ── Home tab with the new bar + quick-info tiles ──────────── */
function HomeWithTiles() {
  return (
    <div className="bt-screen">
      <BtTopBar owner={true} />
      <div className="bt-page">
        <BtTripHeader owner={true} />
        <BtTabBar active="home" owner={true} />
        <div style={{ margin: '18px 0 22px' }}>
          <div className="bt-seclabel"><ExIcon name="hash" size={13} color="currentColor" /> Quick info</div>
          <div style={{ height: 9 }} />
          <QuickInfoTiles />
        </div>
        <div style={{ marginBottom: 8 }}>
          <div className="bt-eyebrow">Home</div>
          <h1 className="bt-h1">You're driving this trip</h1>
          <p className="bt-sub">Door codes and wifi stay pinned up top — you grab those constantly. The Board lives in the title bar, one tap from anywhere.</p>
        </div>
      </div>
    </div>
  );
}

/* ── Focused title-bar showcase (annotated) ────────────────── */
function TitleBarShowcase() {
  return (
    <div style={{ background: 'var(--color-bt-base)', padding: '0 0 22px' }}>
      <BtTopBar owner={true} />
      <div style={{ padding: '22px 22px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        <div>
          <div className="bt-seclabel" style={{ color: 'var(--color-bt-accent)' }}>Left · identity & scope</div>
          <p className="bt-sub" style={{ fontSize: 13, marginTop: 8 }}>
            Logo is the dashboard anchor; the trip switcher sits beside it as a breadcrumb
            (<strong style={{ color: 'var(--color-bt-text)' }}>BuddyTrip / BBMI ▾</strong>). Switching trips is dashboard-level,
            so it reads left-to-right as “app → this trip.” Kept subordinate to the trip header card below.
          </p>
        </div>
        <div>
          <div className="bt-seclabel" style={{ color: 'var(--color-bt-accent)' }}>Right · me & global tools</div>
          <p className="bt-sub" style={{ fontSize: 13, marginTop: 8 }}>
            <strong style={{ color: 'var(--color-bt-text)' }}>Board</strong> takes the old notification slot — a megaphone with a
            count, not a bell (persistent broadcast, not a transient stream). Chat and avatar round it out. Notifications removed.
          </p>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  BtTopBar, QuickInfoTiles, BoardPanel, BoardPost,
  BoardOwnerView, BoardMemberView, HomeWithTiles, TitleBarShowcase,
});
