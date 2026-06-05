// explorations-pinned.jsx — News (the Trip Board, finished) + composer
// ─────────────────────────────────────────────────────────────────────────
// News and Chat are SEPARATE panels that BEHAVE the same way (docked right
// rail on desktop w/ drag-resize; draggable bottom sheet on mobile). News =
// owner/organizer posts. Chat = rooms (Crew · Organizers · Bet). No unified
// toggle — each is its own surface, opened from its own title-bar button.
//
// Posts are built from SIX no-markdown blocks: Text · @Crew · Teams · Media ·
// Steps · Callout. The composer stacks them; text emphasis is a toolbar
// (bold/italic/list/link/@), never typed syntax, and there is NO free text
// color — the only colored "panel" is Callout (preset amber). The post
// author can edit their own post (⋯ → Edit) → same composer, prefilled.
//
// PIN = stick to top. Most posts are chronological; a pinned post sorts above
// the rest and is the ONLY one that shows the amber "Pinned" tag.
//
// Panels render at natural height here (no internal scroll) so nothing clips.
// .post/.blk-* CSS is from explorations-board.jsx; .rc-/.cmp-/.cx-/.blk-crew
// are injected below.

(function injectNewsCss() {
  if (typeof document === 'undefined' || document.getElementById('btNewsCss')) return;
  const css = `
  /* Panel card (standalone presentation of the rail/sheet) */
  .rc { display:flex; flex-direction:column; background:var(--color-bt-card);
    border:1px solid var(--color-bt-border); border-radius:14px; box-shadow:var(--shadow-floating); overflow:hidden; }
  .rc-head { flex-shrink:0; padding:9px 11px; border-bottom:1px solid var(--color-bt-subtle-border); display:flex; align-items:center; gap:9px; }
  .rc-title { display:inline-flex; align-items:center; gap:8px; font-size:15px; font-weight:700; color:var(--color-bt-text); }
  .rc-body { padding:14px; display:flex; flex-direction:column; gap:13px; }
  .rc-foot { flex-shrink:0; border-top:1px solid var(--color-bt-subtle-border); padding:10px 12px; display:flex; gap:9px; align-items:center; }
  .rc-tool { all:unset; cursor:pointer; width:30px; height:30px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; color:var(--color-bt-text-dim); }
  .rc-tool:hover { background:var(--color-bt-hover); }
  .rc-newbtn { display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:9px; border:none; cursor:pointer;
    background:var(--color-bt-accent); color:#0d1f1a; font-size:12.5px; font-weight:600; }

  /* News compose affordance (owner) */
  .nx-compose { display:flex; align-items:center; gap:10px; padding:11px 13px; border-radius:11px;
    border:1px dashed var(--color-bt-accent-border); background:var(--color-bt-accent-faint); cursor:pointer; }
  .nx-compose .pl { flex:1; font-size:13px; color:var(--color-bt-text-dim); }
  .nx-compose .go { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--color-bt-accent); }

  /* @Crew mention */
  .blk-crew { display:inline-flex; align-items:center; gap:5px; padding:1px 8px 1px 2px; border-radius:9999px;
    background:var(--color-bt-accent-faint); border:1px solid var(--color-bt-accent-border);
    font-weight:600; color:var(--color-bt-accent); font-size:12.5px; line-height:1; vertical-align:-3px; }
  .blk-crew .av { width:17px; height:17px; border-radius:50%; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:8.5px; font-weight:700; }
  .blk-crewrow { display:flex; flex-wrap:wrap; align-items:center; gap:7px; }
  .blk-crewrow .lab { font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--color-bt-text-dim); margin-right:1px; }
  .blk-photo { border:1px solid var(--color-bt-border); border-radius:11px; aspect-ratio:16/10; overflow:hidden; position:relative;
    background:repeating-linear-gradient(135deg, var(--color-bt-card-raised) 0 12px, rgba(148,163,184,0.05) 12px 24px); display:flex; align-items:center; justify-content:center; }
  .blk-photo .ph { font-family:var(--font-mono); font-size:11px; color:var(--color-bt-text-dim); }

  /* Chat */
  .cx-tabs { display:flex; gap:6px; }
  .cx-tab { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; padding:5px 10px; border-radius:7px; border:1px solid transparent; background:transparent; color:var(--color-bt-text-dim); cursor:pointer; }
  .cx-tab.on { color:var(--color-bt-planning); background:var(--color-bt-blue-bg); border-color:var(--color-bt-planning-border); }
  .cx-row { display:flex; gap:9px; align-items:flex-end; }
  .cx-row.me { flex-direction:row-reverse; }
  .cx-bub { max-width:74%; padding:8px 11px; border-radius:13px; font-size:13px; line-height:1.45; color:var(--color-bt-text); background:var(--color-bt-card-raised); }
  .cx-row.me .cx-bub { background:var(--color-bt-accent); color:#0d1f1a; }
  .cx-nm { font-size:10.5px; color:var(--color-bt-text-dim); margin:0 0 3px 2px; }
  .cx-input { flex:1; background:var(--color-bt-card-raised); border:1px solid var(--color-bt-border); border-radius:9999px; padding:9px 14px; font-size:13px; color:var(--color-bt-text); outline:none; }
  .cx-send { all:unset; cursor:pointer; width:34px; height:34px; border-radius:50%; flex-shrink:0; background:var(--color-bt-accent); color:#0d1f1a; display:inline-flex; align-items:center; justify-content:center; }

  /* Composer */
  .cmp-blk { position:relative; border:1px solid var(--color-bt-border); border-radius:11px; background:var(--color-bt-card-raised); padding:10px 34px 12px 30px; }
  .cmp-grip { position:absolute; left:7px; top:10px; color:var(--color-bt-text-dim); cursor:grab; display:inline-flex; }
  .cmp-rm { position:absolute; right:7px; top:8px; all:unset; cursor:pointer; width:24px; height:24px; border-radius:7px; display:inline-flex; align-items:center; justify-content:center; color:var(--color-bt-text-dim); }
  .cmp-rm:hover { background:var(--color-bt-hover); color:var(--color-bt-danger); }
  .cmp-kind { font-size:9.5px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--color-bt-text-dim); margin-bottom:7px; display:flex; align-items:center; gap:5px; }
  .cmp-toolbar { display:flex; gap:3px; margin-bottom:7px; }
  .cmp-tb { width:28px; height:28px; border-radius:7px; border:1px solid var(--color-bt-border); background:var(--color-bt-card); color:var(--color-bt-text-dim); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
  .cmp-tb:hover { color:var(--color-bt-text); background:var(--color-bt-hover); }
  .cmp-tb.sep { width:1px; border:none; background:var(--color-bt-border); margin:4px 3px; border-radius:0; pointer-events:none; }
  .cmp-input, .cmp-area { width:100%; box-sizing:border-box; background:var(--color-bt-card); border:1px solid var(--color-bt-border); border-radius:8px; padding:9px 10px; font:var(--type-body); color:var(--color-bt-text); outline:none; }
  .cmp-area { resize:none; line-height:1.5; }
  .cmp-add { display:flex; flex-wrap:wrap; gap:6px; }
  .cmp-addbtn { display:inline-flex; align-items:center; gap:6px; padding:8px 11px; border-radius:9px; border:1px dashed var(--color-bt-border); background:transparent; color:var(--color-bt-text); font-size:12.5px; font-weight:500; cursor:pointer; }
  .cmp-addbtn:hover { border-color:var(--color-bt-accent-border); background:var(--color-bt-accent-faint); color:var(--color-bt-accent); }
  .cmp-addlabel { font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--color-bt-text-dim); margin-bottom:8px; }
  .cmp-stepedit { display:flex; gap:7px; align-items:center; margin-bottom:6px; }
  .cmp-stepn { flex-shrink:0; width:22px; height:22px; border-radius:50%; border:1px solid var(--color-bt-accent-border); color:var(--color-bt-accent); font-size:11px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; }
  /* mobile add-block scroller */
  .cmp-mscroll { display:flex; gap:7px; overflow-x:auto; padding-bottom:2px; }
  .cmp-mscroll .cmp-addbtn { flex-shrink:0; }
  `;
  const s = document.createElement('style'); s.id = 'btNewsCss'; s.textContent = css; document.head.appendChild(s);
})();

// ── Mention atoms ───────────────────────────────────────────────────────
function Mention({ p }) {
  return <span className="blk-crew"><span className="av" style={{ background: p.color }}>{p.initials}</span>@{p.name}</span>;
}
function RichText({ segments, dim }) {
  return <p className={`blk-p${dim ? ' dim' : ''}`}>{segments.map((s, i) => typeof s === 'string' ? <React.Fragment key={i}>{s}</React.Fragment> : <Mention key={i} p={s.mention} />)}</p>;
}

// ── Block renderer ──────────────────────────────────────────────────────
function NB({ b }) {
  switch (b.type) {
    case 'text': return b.segments ? <RichText segments={b.segments} dim={b.dim} /> : <p className={`blk-p${b.dim ? ' dim' : ''}`}>{b.text}</p>;
    case 'crew': return <div className="blk-crewrow">{b.label && <span className="lab">{b.label}</span>}{b.people.map((p, i) => <Mention key={i} p={p} />)}</div>;
    case 'teams': return <div className="blk-teams">{b.teams.map(t => <div className="team-card" key={t.name} style={{ borderLeftColor: t.color }}><div className="team-name">{t.name}</div><div className="team-roster">{t.players.join(' · ')}</div></div>)}</div>;
    case 'media':
      if (b.kind === 'photo') return <div className="blk-photo"><span className="ph">{b.ph || 'photo'}</span></div>;
      return <div className="blk-video"><span className="blk-play"><ExIcon name="play" size={22} color="currentColor" /></span><div className="blk-vmeta"><div className="blk-vtitle">{b.title}</div><div className="blk-vsub">{b.meta}</div></div></div>;
    case 'steps': return <div className="blk-steps">{b.steps.map((s, i) => <div className="step" key={i}><span className="step-n">{i + 1}</span><span className="step-tx"><b>{s.label}</b> — {s.body}</span></div>)}</div>;
    case 'callout': return <div className="blk-callout"><span className="ic"><ExIcon name="pin" size={16} color="currentColor" /></span><span className="tx">{b.text}</span></div>;
    default: return null;
  }
}

// ── Posts ───────────────────────────────────────────────────────────────
const SAMPLE_POST = {
  author: 'Brad Giesler', role: 'Commish · Owner', roleColor: 'var(--color-bt-owner)', initials: 'BG', team: '#3b82f6', time: '2d', pinned: true,
  blocks: [
    { type: 'callout', text: 'Read this before you pack. Yes, all of it.' },
    { type: 'text', text: 'Gentlemen. Year 19. Some of you weren’t legally allowed to drink at year one. Let that sink in.' },
    { type: 'text', segments: ['Everything lives in the app now — scores, schedule, trash talk. ', { mention: { name: 'Zach', initials: 'ZG', color: 'var(--color-bt-accent)' } }, ' built it, so route the bug reports to him, not me.'] },
    { type: 'crew', label: 'Captains', people: [{ name: 'Brad', initials: 'BG', color: '#3b82f6' }, { name: 'Buddy', initials: 'BB', color: '#2dd4bf' }, { name: 'Zach', initials: 'ZG', color: '#a855f7' }, { name: 'Mike', initials: 'MS', color: '#d97706' }] },
    { type: 'text', text: 'Without further whining from me, here’s the draw:' },
    { type: 'teams', teams: [
      { name: 'The Usual Suspects', color: '#3b82f6', players: ['Brad G', 'Tyler L', 'JD S', 'Rob D'] },
      { name: 'Buddy’s Last Stand', color: '#2dd4bf', players: ['Buddy B', 'Bill G', 'Charlie P', 'BJ D'] },
      { name: 'Not Golfing, Just Vibing', color: '#a855f7', players: ['Zach G', 'John R', 'Jeremy M', 'Marcus T'] },
      { name: 'Former Breeders II', color: '#d97706', players: ['Mike S', 'Dave K', 'Chris W', 'Pat O'] },
    ] },
    { type: 'steps', steps: [
      { label: 'Scores', body: 'enter your own after each hole. Forget, and your captain does it. Publicly.' },
      { label: 'Leaderboard', body: 'live all week — tap the trophy from anywhere.' },
      { label: 'Schedule', body: 'tee times and dinners are in Agenda. Don’t ask me when dinner is.' },
    ] },
    { type: 'media', kind: 'video', title: 'BBMI 2024 — The Annual Recap', meta: 'Charlie Piper · 8 min · YouTube' },
    { type: 'text', dim: true, text: 'May the best team win. May the worst team engrave something.' },
  ],
};
const SECOND_POST = {
  author: 'Charlie Piper', role: 'Historian', roleColor: 'var(--color-bt-accent)', initials: 'CP', team: '#a855f7', time: '5h', pinned: false,
  blocks: [
    { type: 'text', text: 'Recap’s rendering now — should be up tonight. The back nine is… something.' },
    { type: 'media', kind: 'photo', ph: '18th green · 2024' },
  ],
};

function NewsPost({ post, canManage }) {
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
      <div className="post-body">{post.blocks.map((b, i) => <NB b={b} key={i} />)}</div>
    </div>
  );
}

// ── News panel (own surface) ────────────────────────────────────────────
function NewsHeader({ canPost }) {
  return (
    <div className="rc-head">
      <span className="rc-title"><ExIcon name="pin" size={17} color="var(--color-bt-accent)" /> News</span>
      {canPost && <button className="rc-newbtn" style={{ marginLeft: 'auto' }}><ExIcon name="pencil" size={12} color="#0d1f1a" /> New post</button>}
      <button className="rc-tool" title="Resize" aria-label="Resize" style={{ marginLeft: canPost ? 0 : 'auto' }}><ExIcon name="maximize2" size={15} color="currentColor" /></button>
      <button className="rc-tool" aria-label="Close"><ExIcon name="x" size={16} color="currentColor" /></button>
    </div>
  );
}
function NewsPanelCard({ canPost = true, empty = false, width = 440 }) {
  return (
    <div className="rc" style={{ width }}>
      <NewsHeader canPost={canPost} />
      <div className="rc-body">
        {empty
          ? <NewsEmptyInner canPost={canPost} />
          : (<>
              <NewsPost post={SAMPLE_POST} canManage={canPost} />
              <NewsPost post={SECOND_POST} canManage={canPost} />
            </>)}
      </div>
    </div>
  );
}
function NewsEmptyInner({ canPost }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 8px' }}>
      <div style={{ maxWidth: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13 }}>
        <span style={{ width: 56, height: 56, borderRadius: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: canPost ? 'var(--color-bt-accent-faint)' : 'rgba(148,163,184,0.06)', border: `1px solid ${canPost ? 'var(--color-bt-accent-border)' : 'var(--color-bt-border)'}` }}>
          <ExIcon name="pin" size={24} color={canPost ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)'} />
        </span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-bt-text)' }}>Nothing posted yet</div>
          <p style={{ margin: '7px 0 0', font: 'var(--type-body-sm)', color: 'var(--color-bt-text-dim)', textWrap: 'pretty' }}>
            {canPost ? 'Post the first update — a welcome, the team draw, the schedule. It lands here for the whole crew, newest first.' : 'When the owner or an organizer posts an update, it shows up here. Nothing to do but wait.'}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Chat panel (own surface; rooms = Crew · Organizers · Bet) ───────────
const CHAT_MSGS = [
  { who: 'Tyler', initials: 'TL', color: '#3b82f6', text: 'We still teeing at 8 tomorrow?', time: '9:14a' },
  { me: true, text: 'Pushed to 8:10. Vans leave the house 7:30.', time: '9:15a' },
  { who: 'Buddy', initials: 'BB', color: '#2dd4bf', text: 'First van or I’m not golfing. No in-between.', time: '9:18a' },
];
function ChatPanelCard({ width = 440 }) {
  const [tab, setTab] = React.useState('crew');
  return (
    <div className="rc" style={{ width }}>
      <div className="rc-head">
        <div className="cx-tabs">
          <button className={`cx-tab${tab === 'crew' ? ' on' : ''}`} onClick={() => setTab('crew')}><ExIcon name="users" size={12} color="currentColor" /> Crew</button>
          <button className={`cx-tab${tab === 'org' ? ' on' : ''}`} onClick={() => setTab('org')}>Organizers</button>
          <button className={`cx-tab${tab === 'bet' ? ' on' : ''}`} onClick={() => setTab('bet')}><ExIcon name="dice" size={12} color="currentColor" /> Bet</button>
        </div>
        <button className="rc-tool" aria-label="Close" style={{ marginLeft: 'auto' }}><ExIcon name="x" size={16} color="currentColor" /></button>
      </div>
      <div className="rc-body" style={{ gap: 12, minHeight: 220 }}>
        {tab === 'bet' && <div className="blk-callout" style={{ marginBottom: 2 }}><span className="ic"><ExIcon name="dice" size={15} color="currentColor" /></span><span className="tx">Side bets live here — keep the books honest. Settle up in Receipts.</span></div>}
        {CHAT_MSGS.map((m, i) => (
          <div className={`cx-row${m.me ? ' me' : ''}`} key={i}>
            {!m.me && <CrewAvatar member={{ name: m.who, status: 'active', team: m.color }} size={26} />}
            <div>{!m.me && <div className="cx-nm">{m.who}</div>}<div className="cx-bub">{tab === 'bet' && !m.me ? 'I’ve got Buddy’s team minus 4.' : m.text}</div></div>
          </div>
        ))}
      </div>
      <div className="rc-foot"><input className="cx-input" placeholder="Say something…" /><button className="cx-send"><ExIcon name="send" size={15} color="#0d1f1a" /></button></div>
    </div>
  );
}

// ── Composer (add / edit) ───────────────────────────────────────────────
function TextToolbar() {
  return (
    <div className="cmp-toolbar">
      <button className="cmp-tb" title="Bold"><ExIcon name="bold" size={14} color="currentColor" /></button>
      <button className="cmp-tb" title="Italic"><ExIcon name="italic" size={14} color="currentColor" /></button>
      <span className="cmp-tb sep" />
      <button className="cmp-tb" title="List"><ExIcon name="list-ordered" size={14} color="currentColor" /></button>
      <button className="cmp-tb" title="Link"><ExIcon name="link" size={14} color="currentColor" /></button>
      <span className="cmp-tb sep" />
      <button className="cmp-tb" title="Mention crew"><ExIcon name="at-sign" size={14} color="currentColor" /></button>
    </div>
  );
}
function CmpBlock({ kind, icon, children }) {
  return (
    <div className="cmp-blk">
      <span className="cmp-grip"><ExIcon name="grip-vertical" size={15} color="currentColor" /></span>
      <button className="cmp-rm" aria-label="Remove block"><ExIcon name="x" size={14} color="currentColor" /></button>
      <div className="cmp-kind"><ExIcon name={icon} size={11} color="var(--color-bt-accent)" /> {kind}</div>
      {children}
    </div>
  );
}
const ADD_BLOCKS = [['type', 'Text'], ['at-sign', '@Crew'], ['trophy', 'Teams'], ['image', 'Media'], ['list-ordered', 'Steps'], ['pin', 'Callout']];

function ComposerCard({ mode = 'add', width = 460 }) {
  const editing = mode === 'edit';
  return (
    <div className="rc" style={{ width }}>
      <div className="rc-head">
        <span className="rc-title"><ExIcon name="pencil" size={15} color="var(--color-bt-accent)" /> {editing ? 'Edit post' : 'New post'}</span>
        <button className="rc-tool" aria-label="Close" style={{ marginLeft: 'auto' }}><ExIcon name="x" size={16} color="currentColor" /></button>
      </div>
      <div className="rc-body" style={{ gap: 10 }}>
        {editing && (
          <CmpBlock kind="Callout · panel (preset amber — no color picker)" icon="pin">
            <input className="cmp-input" defaultValue="Read this before you pack. Yes, all of it." />
          </CmpBlock>
        )}
        <CmpBlock kind="Text" icon="type">
          <TextToolbar />
          <textarea className="cmp-area" rows={editing ? 2 : 3} defaultValue={editing ? 'Gentlemen. Year 19. Some of you weren’t legally allowed to drink at year one.' : ''} placeholder="Write something… type @ to tag the crew. Bold, italic, lists and links are buttons — no markdown." />
        </CmpBlock>
        {editing && (
          <CmpBlock kind="Teams · pulled from Competition" icon="trophy">
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)' }}>
              <ExIcon name="trophy" size={15} color="var(--color-bt-accent)" />
              <span style={{ fontSize: 12.5, color: 'var(--color-bt-text)' }}>The draw · 4 teams</span>
              <button style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--color-bt-accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Change</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 6 }}>Rosters stay in sync with Competition — you don’t retype them.</div>
          </CmpBlock>
        )}
        {!editing && (
          <CmpBlock kind="Steps" icon="list-ordered">
            <div className="cmp-stepedit"><span className="cmp-stepn">1</span><input className="cmp-input" defaultValue="Scores" style={{ flex: '0 0 120px' }} /><input className="cmp-input" placeholder="what to do…" /></div>
            <div className="cmp-stepedit"><span className="cmp-stepn">2</span><input className="cmp-input" defaultValue="Leaderboard" style={{ flex: '0 0 120px' }} /><input className="cmp-input" placeholder="what to do…" /></div>
            <button className="cmp-addbtn" style={{ marginTop: 2 }}><ExIcon name="plus" size={13} color="currentColor" /> Add step</button>
          </CmpBlock>
        )}

        <div>
          <div className="cmp-addlabel">Add a block</div>
          <div className="cmp-add">
            {ADD_BLOCKS.map(([ic, l]) => <button className="cmp-addbtn" key={l}><ExIcon name={ic} size={14} color="currentColor" /> {l}</button>)}
          </div>
        </div>
      </div>
      <div className="rc-foot">
        {editing
          ? <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: 'var(--color-bt-danger)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}><ExIcon name="trash" size={14} color="currentColor" /> Delete</button>
          : <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--color-bt-text-dim)', cursor: 'pointer' }}><ExIcon name="pin" size={13} color="var(--color-bt-accent)" /> Pin to top</label>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={{ background: 'transparent', border: '1px solid var(--color-bt-border)', color: 'var(--color-bt-text-dim)', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
          <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--color-bt-accent)', color: '#0d1f1a', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{editing ? 'Save changes' : 'Post'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Mobile: bottom sheet (news + chat behave the same) ──────────────────
function SheetFrame({ title, icon, children, footer, top = '14%' }) {
  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      <div style={{ height: '100%', filter: 'saturate(0.9)' }}>
        <BtTopBar owner={true} boardCount={1} />
        <div className="bt-page" style={{ padding: '12px 14px' }}><BtTripHeader owner={true} /></div>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'var(--color-bt-overlay)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top, background: 'var(--color-bt-card)', borderRadius: '18px 18px 0 0', boxShadow: '0 -20px 60px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--color-bt-border)', margin: '9px auto 4px', cursor: 'row-resize' }} />
        <div className="rc-head">
          <span className="rc-title"><ExIcon name={icon} size={16} color="var(--color-bt-accent)" /> {title}</span>
          <button className="rc-tool" aria-label="Close" style={{ marginLeft: 'auto' }}><ExIcon name="x" size={16} color="currentColor" /></button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}
function NewsSheetMobile({ canPost = true }) {
  return (
    <SheetFrame title="News" icon="pin">
      <div className="rc-body" style={{ overflow: 'hidden' }}>
        {canPost && <div className="nx-compose"><CrewAvatar member={{ name: 'Z', status: 'active', team: '#2dd4bf' }} size={26} /><span className="pl">Post an update…</span><span className="go"><ExIcon name="pencil" size={12} color="currentColor" /></span></div>}
        <NewsPost post={SECOND_POST} canManage={canPost} />
      </div>
    </SheetFrame>
  );
}
function ComposerSheetMobile() {
  return (
    <SheetFrame title="New post" icon="pencil" top="9%"
      footer={<div className="rc-foot"><label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-bt-text-dim)' }}><ExIcon name="pin" size={13} color="var(--color-bt-accent)" /> Pin</label><div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}><button style={{ background: 'transparent', border: '1px solid var(--color-bt-border)', color: 'var(--color-bt-text-dim)', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 500 }}>Cancel</button><button style={{ background: 'var(--color-bt-accent)', color: '#0d1f1a', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 600 }}>Post</button></div></div>}>
      <div className="rc-body" style={{ gap: 10, overflow: 'hidden' }}>
        <CmpBlock kind="Text" icon="type">
          <TextToolbar />
          <textarea className="cmp-area" rows={3} placeholder="Write something… type @ to tag the crew." />
        </CmpBlock>
        <div>
          <div className="cmp-addlabel">Add a block · swipe</div>
          <div className="cmp-mscroll">
            {ADD_BLOCKS.map(([ic, l]) => <button className="cmp-addbtn" key={l}><ExIcon name={ic} size={14} color="currentColor" /> {l}</button>)}
          </div>
        </div>
      </div>
    </SheetFrame>
  );
}

// ── Docked-in-context demo (rail on the page, no scrim) ─────────────────
function NewsDockedContext() {
  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden', background: 'var(--color-bt-base)' }}>
      <div className="bt-screen">
        <BtTopBar owner={true} boardCount={1} newOnBoard={false} />
        <div className="bt-page"><BtTripHeader owner={true} /><BtTabBar active="home" owner={true} /><div style={{ margin: '18px 0' }}><div className="bt-eyebrow" style={{ color: 'var(--color-bt-text-dim)' }}>Quick info</div><div style={{ height: 9 }} /><QuickInfoTiles /></div></div>
      </div>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 380, background: 'var(--color-bt-card)', borderLeft: '1px solid var(--color-bt-border)', boxShadow: '-24px 0 60px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'absolute', top: 0, left: -4, bottom: 0, width: 9, cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ width: 4, height: 30, borderRadius: 3, background: 'var(--color-bt-border)' }} /></div>
        <NewsHeader canPost={true} />
        <div className="rc-body" style={{ overflow: 'hidden' }}><NewsPost post={SECOND_POST} canManage={true} /></div>
      </div>
    </div>
  );
}

// ── Block catalog ───────────────────────────────────────────────────────
const CATALOG = [
  { name: 'Text', icon: 'type', desc: 'A paragraph. Inline @Crew mentions allowed. Emphasis is a toolbar (bold/italic/list/link) — no typed markdown, no free text color.', demo: { type: 'text', text: 'Tee times are tight — be at the first tee 10 minutes early.' } },
  { name: '@Crew', icon: 'at-sign', desc: 'A person: avatar + name pill. Inline in Text, or a labeled row (captains, pairings). Autocompletes from the roster.', demo: { type: 'crew', label: 'Pairing', people: [{ name: 'Brad', initials: 'BG', color: '#3b82f6' }, { name: 'Buddy', initials: 'BB', color: '#2dd4bf' }] } },
  { name: 'Teams', icon: 'trophy', desc: 'The draw — team cards. Synced from Competition; never retyped.', demo: { type: 'teams', teams: [{ name: 'The Usual Suspects', color: '#3b82f6', players: ['Brad G', 'Tyler L', 'JD S'] }, { name: 'Buddy’s Last Stand', color: '#2dd4bf', players: ['Buddy B', 'Bill G', 'Charlie P'] }] } },
  { name: 'Media', icon: 'image', desc: 'A photo, or paste a video link → card. Recaps, course photos, hype clips.', demo: { type: 'media', kind: 'video', title: 'BBMI 2024 — Recap', meta: 'Charlie Piper · 8 min' } },
  { name: 'Steps', icon: 'list-ordered', desc: 'Numbered how-to. Rules, scoring, day-of logistics.', demo: { type: 'steps', steps: [{ label: 'Scores', body: 'enter your own after each hole.' }, { label: 'Leaderboard', body: 'live all week.' }] } },
  { name: 'Callout', icon: 'pin', desc: 'One highlighted line in caution-amber (a “panel”). Preset — no color choice. The must-not-miss line.', demo: { type: 'callout', text: 'Read this before you pack. Yes, all of it.' } },
];
function NewsBlockCatalog() {
  return (
    <div style={{ background: 'var(--color-bt-base)', minHeight: '100%', padding: '20px 22px' }}>
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-bt-accent)' }}>The complete set</div>
        <h2 style={{ margin: '6px 0 4px', fontSize: 20, fontWeight: 700, color: 'var(--color-bt-text)' }}>Six blocks — nothing else</h2>
        <p style={{ margin: 0, font: 'var(--type-body-sm)', color: 'var(--color-bt-text-dim)', maxWidth: 620, textWrap: 'pretty' }}>
          A post is a stack of these six. They cover every BBMI use case without an editor to learn. Don’t invent new block types.
        </p>
      </div>
      <div style={{ marginTop: 14, border: '1px solid var(--color-bt-border)', borderRadius: 12, overflow: 'hidden', background: 'var(--color-bt-card)', display: 'grid', gridTemplateColumns: '170px 1fr' }}>
        {CATALOG.map((c, i) => (
          <React.Fragment key={i}>
            <div style={{ padding: '16px 14px', borderTop: i ? '1px solid var(--color-bt-subtle-border)' : 'none' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-bt-text)', display: 'flex', alignItems: 'center', gap: 7 }}><ExIcon name={c.icon} size={15} color="var(--color-bt-accent)" /> {c.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--color-bt-text-dim)', marginTop: 5, lineHeight: 1.45 }}>{c.desc}</div>
            </div>
            <div style={{ padding: '16px', borderTop: i ? '1px solid var(--color-bt-subtle-border)' : 'none', borderLeft: '1px solid var(--color-bt-subtle-border)' }}><NB b={c.demo} /></div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, {
  NewsPanelCard, ChatPanelCard, ComposerCard, NewsSheetMobile, ComposerSheetMobile,
  NewsDockedContext, NewsBlockCatalog, NewsPost, NB, SAMPLE_POST,
});
