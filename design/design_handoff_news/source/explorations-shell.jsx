// explorations-shell.jsx — shared BuddyTrip app chrome used by the Agenda
// rebuild and the Crew/Travel mockups. One container-query root (bt-screen)
// drives ALL responsive behavior: the tab bar collapses to icons, and the
// content's own container queries fire off the same width.

(function injectShellCss() {
  if (typeof document === 'undefined' || document.getElementById('btShellCss')) return;
  const css = `
  .bt-screen { container-type: inline-size; height:100%; overflow-y:auto; overflow-x:hidden;
    background: var(--color-bt-base); color: var(--color-bt-text); font-family: var(--font-sans); }

  /* App nav */
  .bt-appnav { position: sticky; top:0; z-index:6; height:56px; display:flex; align-items:center;
    justify-content:space-between; padding:0 20px; background: var(--color-bt-nav-bg);
    backdrop-filter: blur(14px); border-bottom:1px solid var(--color-bt-subtle-border); }
  .bt-logo { display:inline-flex; align-items:center; gap:8px; font-size:17px; font-weight:600;
    letter-spacing:0.06em; color: var(--color-bt-text); }
  .bt-navicons { display:inline-flex; align-items:center; gap:16px; color: var(--color-bt-text-dim); }
  .bt-avatar { width:28px; height:28px; border-radius:50%; background: var(--color-bt-card-raised);
    color: var(--color-bt-accent); display:inline-flex; align-items:center; justify-content:center;
    border:1.5px solid var(--color-bt-border); }

  /* Page wrapper */
  .bt-page { max-width: 1080px; margin:0 auto; padding: 16px 20px 56px; }
  @container (max-width: 600px) { .bt-page { padding: 12px 14px 56px; } }

  /* Trip header */
  .bt-trip { border-radius:16px; overflow:hidden; border:1px solid var(--color-bt-border); }
  .bt-trip-main { position:relative; padding:18px 20px;
    background: linear-gradient(135deg, #0e2940 0%, #15324c 55%, #123a3a 100%); }
  .bt-trip-id { display:flex; align-items:center; gap:10px; }
  .bt-owner { font-size:10px; font-weight:600; letter-spacing:0.04em; color: var(--color-bt-owner);
    border:1px solid var(--color-bt-owner); border-radius:5px; padding:2px 7px; }
  .bt-tripname { font-size:22px; font-weight:700; color:#fff; letter-spacing:-0.01em; }
  .bt-trip-line { display:flex; align-items:center; gap:7px; font-size:13px; color: rgba(255,255,255,0.72); margin-top:6px; }
  .bt-gear { position:absolute; top:16px; right:16px; width:32px; height:32px; border-radius:9px;
    background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); border:none; cursor:pointer;
    display:inline-flex; align-items:center; justify-content:center; }
  .bt-live { text-align:center; padding:9px; font-size:13px; font-weight:600; color: var(--color-bt-accent);
    background: var(--color-bt-accent-faint); }
  .bt-livedot { display:inline-block; width:7px; height:7px; border-radius:50%; background: var(--color-bt-accent);
    margin-right:7px; vertical-align:middle; animation: btPulse 1.4s ease-in-out infinite; }

  /* Tab bar */
  .bt-tabs { display:flex; border-bottom:1px solid var(--color-bt-subtle-border); margin-bottom:4px; }
  .bt-tab { flex:1; display:flex; flex-direction:column; align-items:center; gap:5px; padding:12px 4px;
    font-size:10px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase;
    color: var(--color-bt-text-dim); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px;
    background:none; }
  .bt-tab.active { color: var(--color-bt-accent); border-bottom-color: var(--color-bt-accent); }
  .bt-tab-ico { position:relative; display:inline-flex; }
  .bt-dot { position:absolute; top:-3px; right:-6px; width:7px; height:7px; border-radius:50%;
    border:1.5px solid var(--color-bt-base); }
  .bt-dot.amber { background: var(--color-bt-owner); }
  .bt-dot.teal { background: var(--color-bt-accent); }
  @container (max-width: 560px) { .bt-tab-label { display:none; } .bt-tab { padding:14px 4px; } }

  /* Shared section bits reused by content */
  .bt-eyebrow { font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color: var(--color-bt-accent); }
  .bt-h1 { margin:6px 0 8px; font-size:30px; font-weight:700; letter-spacing:-0.01em; color: var(--color-bt-text); }
  @container (max-width: 600px) { .bt-h1 { font-size:24px; } }
  .bt-sub { font-size:14px; line-height:1.5; color: var(--color-bt-text-dim); max-width:560px; }
  .bt-seclabel { display:flex; align-items:center; gap:7px; font-size:11px; font-weight:700;
    letter-spacing:0.12em; text-transform:uppercase; color: var(--color-bt-text-dim); }
  .bt-sechint { font-size:12px; font-style:italic; color: var(--color-bt-text-dim); margin:4px 0 10px; line-height:1.4; }
  `;
  const s = document.createElement('style');
  s.id = 'btShellCss';
  s.textContent = css;
  document.head.appendChild(s);
})();

function BtAppNav({ owner = true }) {
  return (
    <div className="bt-appnav">
      <span className="bt-logo">
        <svg width="16" height="16" viewBox="0 0 100 100"><path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="var(--color-bt-accent)"/></svg>
        BuddyTrip
      </span>
      <span className="bt-navicons">
        <ExIcon name="grid" size={18} />
        <ExIcon name="message-circle" size={18} />
        <ExIcon name="bell" size={18} />
        <span className="bt-avatar">
          {owner
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zM5 20h14"/></svg>
            : <span style={{ fontSize: 10, fontWeight: 600 }}>G</span>}
        </span>
      </span>
    </div>
  );
}

function BtTripHeader({ owner = true }) {
  return (
    <div className="bt-trip">
      <div className="bt-trip-main">
        <div className="bt-trip-id">
          {owner && <span className="bt-owner">Owner</span>}
          <span className="bt-tripname">BBMI</span>
        </div>
        <div className="bt-trip-line"><ExIcon name="map-pin" size={13} color="currentColor" /> Pinehurst, NC</div>
        <div className="bt-trip-line"><ExIcon name="calendar" size={13} color="currentColor" /> May 26, 2026 – Jun 14, 2026</div>
        {owner && <button className="bt-gear" aria-label="Trip settings"><ExIcon name="settings" size={16} color="currentColor" /></button>}
      </div>
      <div className="bt-live"><span className="bt-livedot" />Live · Day 5 of 20</div>
    </div>
  );
}

const BT_TABS_OWNER = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'crew', label: 'Crew', icon: 'users', dot: 'amber' },
  { id: 'lodging', label: 'Lodging', icon: 'building' },
  { id: 'agenda', label: 'Agenda', icon: 'calendar', dot: 'teal' },
  { id: 'receipts', label: 'Receipts', icon: 'dollar-sign' },
  { id: 'competition', label: 'Competition', icon: 'trophy', dot: 'amber' },
];
// Members see a reduced nav (matches the shipping member view).
const BT_TABS_MEMBER = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'crew', label: 'Crew', icon: 'users' },
  { id: 'receipts', label: 'Receipts', icon: 'dollar-sign' },
];

function BtTabBar({ active = 'home', owner = true, crewDot }) {
  const tabs = owner ? BT_TABS_OWNER : BT_TABS_MEMBER;
  return (
    <div className="bt-tabs">
      {tabs.map(t => {
        const dot = t.id === 'crew' && crewDot ? crewDot : t.dot;
        return (
          <button key={t.id} className={`bt-tab${t.id === active ? ' active' : ''}`}>
            <span className="bt-tab-ico">
              <ExIcon name={t.icon} size={20} color="currentColor" />
              {dot && <span className={`bt-dot ${dot}`} />}
            </span>
            <span className="bt-tab-label">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function BtScreen({ active = 'home', owner = true, crewDot, children }) {
  return (
    <div className="bt-screen">
      <BtAppNav owner={owner} />
      <div className="bt-page">
        <BtTripHeader owner={owner} />
        <BtTabBar active={active} owner={owner} crewDot={crewDot} />
        {children}
      </div>
    </div>
  );
}

Object.assign(window, { BtAppNav, BtTripHeader, BtTabBar, BtScreen });
