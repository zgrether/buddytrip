// explorations-tripsettings.jsx — Trip settings modal redesigned from an
// inline-accordion (every row expands in place, pushing content down and
// ballooning the modal) to a DRILL-IN (master → detail) pattern:
//   • Master list stays a stable height; rows with options drill in.
//   • Tapping a row slides to a focused detail screen with a back arrow +
//     title in the header. One thing on screen at a time, no page jumps.
//   • Danger-zone actions drill into a destructive CONFIRM screen.
// Same settings/content as the current modal — just calmer navigation.

(function injectTsCss() {
  if (typeof document === 'undefined' || document.getElementById('btTsCss')) return;
  const css = `
  .ts-stage { background: var(--color-bt-base); padding:24px; display:flex; gap:22px; flex-wrap:wrap; justify-content:center; align-items:flex-start; }
  .ts-scrim { background: var(--color-bt-overlay); border-radius:16px; padding:22px; display:flex; align-items:flex-start; justify-content:center; }
  .ts { width:400px; max-width:100%; background: var(--color-bt-card-float); border:1px solid var(--color-bt-border); border-radius:16px; box-shadow:0 24px 60px rgba(0,0,0,0.45); overflow:visible; display:flex; flex-direction:column; min-height:300px; }

  /* header — title in menu, back+title in detail */
  .ts-head { display:flex; align-items:center; gap:10px; padding:16px 16px 14px; border-bottom:1px solid var(--color-bt-subtle-border); }
  .ts-back { all:unset; cursor:pointer; width:30px; height:30px; border-radius:9px; display:inline-flex; align-items:center; justify-content:center; color: var(--color-bt-text); background: var(--color-bt-card-raised); flex-shrink:0; }
  .ts-back:hover { background: var(--color-bt-hover); }
  .ts-htitle { flex:1; min-width:0; font-size:16px; font-weight:700; color: var(--color-bt-text); }
  .ts-x { all:unset; cursor:pointer; width:30px; height:30px; border-radius:9px; display:inline-flex; align-items:center; justify-content:center; color: var(--color-bt-text-dim); background: var(--color-bt-card-raised); flex-shrink:0; }

  /* sliding viewport */
  .ts-view { position:relative; overflow:hidden; flex:1; border-radius:0 0 16px 16px; }
  .ts-pane { padding:16px; }
  .ts-pane.in-right { animation: tsInRight .26s cubic-bezier(.4,.1,.2,1); }
  .ts-pane.in-left { animation: tsInLeft .26s cubic-bezier(.4,.1,.2,1); }
  @keyframes tsInRight { from { transform:translateX(28px); opacity:0; } to { transform:none; opacity:1; } }
  @keyframes tsInLeft { from { transform:translateX(-28px); opacity:0; } to { transform:none; opacity:1; } }

  .ts-section { margin-bottom:16px; }
  .ts-section:last-child { margin-bottom:0; }
  .ts-slabel { font-size:10px; font-weight:700; letter-spacing:0.09em; text-transform:uppercase; color: var(--color-bt-text-dim); margin:0 2px 8px; }
  .ts-slabel.danger { color: var(--color-bt-danger); }

  /* a drill row */
  .ts-row { width:100%; box-sizing:border-box; display:flex; align-items:center; gap:12px; padding:12px 13px; border-radius:11px; background: var(--color-bt-card); border:1px solid var(--color-bt-border); cursor:pointer; text-align:left; margin-bottom:8px; }
  .ts-row:last-child { margin-bottom:0; }
  .ts-row:hover { background: var(--color-bt-hover); }
  .ts-row-ic { width:34px; height:34px; border-radius:9px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; background: var(--color-bt-accent-faint); color: var(--color-bt-accent); }
  .ts-row-tx { flex:1; min-width:0; }
  .ts-row-t { font-size:14px; font-weight:600; color: var(--color-bt-text); }
  .ts-row-s { font-size:12px; color: var(--color-bt-text-dim); margin-top:1px; }
  .ts-row-chev { color: var(--color-bt-text-dim); flex-shrink:0; }
  .ts-row.danger .ts-row-ic { background: rgba(239,68,68,0.12); color: var(--color-bt-danger); }
  .ts-row.danger .ts-row-t { color: var(--color-bt-danger); }

  /* rename field inline at top of menu */
  .ts-name { margin-bottom:16px; }
  .ts-input { width:100%; box-sizing:border-box; background: var(--color-bt-base); border:1px solid var(--color-bt-border); border-radius:10px; padding:11px 13px; font-size:14px; color: var(--color-bt-text); outline:none; }
  .ts-input:focus { border-color: var(--color-bt-accent); box-shadow:0 0 0 3px var(--color-bt-accent-faint); }
  .ts-input.mono { font-family: var(--font-mono); }

  /* detail bits */
  .ts-warn { display:flex; gap:9px; align-items:flex-start; padding:11px 12px; border-radius:10px; background: var(--color-bt-warning-faint); border:1px solid var(--color-bt-warning-border); margin-bottom:14px; }
  .ts-warn .ic { color: var(--color-bt-owner); flex-shrink:0; }
  .ts-warn .tx { font-size:12px; line-height:1.45; color: var(--color-bt-text); }
  .ts-flabel { font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color: var(--color-bt-text-dim); margin-bottom:6px; }
  .ts-datechip { display:flex; align-items:center; gap:10px; padding:11px 13px; border-radius:10px; background: var(--color-bt-base); border:1px solid var(--color-bt-border); margin-bottom:14px; }
  .ts-datechip .dt { flex:1; font-size:14px; font-weight:600; color: var(--color-bt-text); }
  .ts-nights { font-size:11px; font-family: var(--font-mono); color: var(--color-bt-accent); background: var(--color-bt-accent-faint); border-radius:9999px; padding:2px 8px; }

  .ts-btn { width:100%; box-sizing:border-box; padding:11px; border-radius:10px; font-size:13.5px; font-weight:700; cursor:pointer; border:none; margin-bottom:8px; }
  .ts-btn:last-child { margin-bottom:0; }
  .ts-btn.primary { background: var(--color-bt-accent); color:#0d1f1a; }
  .ts-btn.ghost { background:transparent; border:1px solid var(--color-bt-border); color: var(--color-bt-text); }
  .ts-btn.link { background:transparent; border:none; color: var(--color-bt-accent); font-weight:600; }
  .ts-btn.danger { background:transparent; border:1px solid var(--color-bt-danger-border, rgba(239,68,68,0.4)); color: var(--color-bt-danger); }
  .ts-btn.danger-solid { background: var(--color-bt-danger); color:#fff; }

  /* transfer list */
  .ts-person { display:flex; align-items:center; gap:11px; padding:10px 12px; border-radius:10px; border:1px solid var(--color-bt-border); background: var(--color-bt-card); cursor:pointer; margin-bottom:8px; }
  .ts-person.sel { border-color: var(--color-bt-accent); background: var(--color-bt-accent-faint); }
  .ts-person-nm { flex:1; font-size:13.5px; font-weight:600; color: var(--color-bt-text); }
  .ts-radio { width:18px; height:18px; border-radius:50%; border:2px solid var(--color-bt-border); flex-shrink:0; position:relative; }
  .ts-person.sel .ts-radio { border-color: var(--color-bt-accent); }
  .ts-person.sel .ts-radio::after { content:''; position:absolute; inset:3px; border-radius:50%; background: var(--color-bt-accent); }

  .ts-confirm-ic { width:48px; height:48px; border-radius:13px; margin:4px auto 14px; display:flex; align-items:center; justify-content:center; background: rgba(239,68,68,0.12); color: var(--color-bt-danger); }
  .ts-confirm-t { font-size:16px; font-weight:700; color: var(--color-bt-text); text-align:center; }
  .ts-confirm-s { font-size:13px; color: var(--color-bt-text-dim); text-align:center; line-height:1.5; margin:7px 0 18px; }
  `;
  const s = document.createElement('style');
  s.id = 'btTsCss';
  s.textContent = css;
  document.head.appendChild(s);
})();

const TS_CREW = ['Zach Grether', 'Brad Giesler', 'Charlie Piper', 'JD Stevens'];

function TripSettings({ start = 'menu' }) {
  const [view, setView] = React.useState(start);
  const [dir, setDir] = React.useState('right');
  const [pick, setPick] = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const go = (v) => { setDir('right'); setView(v); };
  const back = () => { setDir('left'); setView('menu'); setPick(null); setDirty(false); };

  const TITLES = {
    menu: 'Trip settings', details: 'Trip details', dates: 'Trip dates',
    transfer: 'Transfer ownership',
    'clear-crew': 'Clear crew chat', 'clear-org': 'Clear organizer chat', delete: 'Delete trip',
  };
  const isMenu = view === 'menu';

  return (
    <div className="ts">
      <div className="ts-head">
        {!isMenu && <button className="ts-back" onClick={back} aria-label="Back"><ExIcon name="arrow-left" size={16} color="currentColor" /></button>}
        <span className="ts-htitle">{TITLES[view]}</span>
        <button className="ts-x" aria-label="Close"><ExIcon name="x" size={15} color="currentColor" /></button>
      </div>

      <div className="ts-view">
        <div className={`ts-pane in-${dir}`} key={view}>
          {view === 'menu' && (
            <>
              <div className="ts-section">
                <div className="ts-slabel">Trip plan</div>
                <button className="ts-row" onClick={() => go('details')}>
                  <span className="ts-row-ic"><ExIcon name="map-pin" size={17} color="currentColor" /></span>
                  <span className="ts-row-tx"><span className="ts-row-t">Trip details</span><span className="ts-row-s">BBMI 2026 · Pinehurst, NC · May 26 – Jun 14</span></span>
                  <span className="ts-row-chev"><ExIcon name="chevron-right" size={17} color="currentColor" /></span>
                </button>
              </div>
              <div className="ts-section">
                <div className="ts-slabel">Trip management</div>
                <button className="ts-row" onClick={() => go('transfer')}>
                  <span className="ts-row-ic"><ExIcon name="user-plus" size={17} color="currentColor" /></span>
                  <span className="ts-row-tx"><span className="ts-row-t">Transfer ownership</span><span className="ts-row-s">Pass owner role to a crew member</span></span>
                  <span className="ts-row-chev"><ExIcon name="chevron-right" size={17} color="currentColor" /></span>
                </button>
              </div>
              <div className="ts-section">
                <div className="ts-slabel danger">Danger zone</div>
                <button className="ts-row danger" onClick={() => go('clear-crew')}>
                  <span className="ts-row-ic"><ExIcon name="message-circle" size={16} color="currentColor" /></span>
                  <span className="ts-row-tx"><span className="ts-row-t">Clear crew chat</span><span className="ts-row-s">Deletes all Crew messages</span></span>
                  <span className="ts-row-chev"><ExIcon name="chevron-right" size={17} color="currentColor" /></span>
                </button>
                <button className="ts-row danger" onClick={() => go('clear-org')}>
                  <span className="ts-row-ic"><ExIcon name="message-circle" size={16} color="currentColor" /></span>
                  <span className="ts-row-tx"><span className="ts-row-t">Clear organizer chat</span><span className="ts-row-s">Deletes all Organizer messages</span></span>
                  <span className="ts-row-chev"><ExIcon name="chevron-right" size={17} color="currentColor" /></span>
                </button>
                <button className="ts-row danger" onClick={() => go('delete')}>
                  <span className="ts-row-ic"><ExIcon name="trash" size={16} color="currentColor" /></span>
                  <span className="ts-row-tx"><span className="ts-row-t">Delete trip</span><span className="ts-row-s">Removes all data for everyone</span></span>
                  <span className="ts-row-chev"><ExIcon name="chevron-right" size={17} color="currentColor" /></span>
                </button>
              </div>
            </>
          )}

          {view === 'dates' && (
            <>
              <BTCalendar
                mode="range"
                accent="#2dd4bf"
                accentFaint="rgba(45,212,191,0.16)"
                value={{ start: new Date(2026, 4, 26), end: new Date(2026, 5, 14) }}
                onChange={() => setDirty(true)}
              />
              <div style={{ height: 12 }} />
              <button className="ts-btn primary">Set dates</button>
              <button className="ts-btn ghost" onClick={back}>Cancel</button>
            </>
          )}

          {view === 'details' && (
            <>
              <div className="ts-flabel">Trip name</div>
              <input className="ts-input" defaultValue="BBMI 2026" onChange={() => setDirty(true)} />
              <div style={{ height: 14 }} />
              <div className="ts-flabel">Destination</div>
              <input className="ts-input" defaultValue="Pinehurst, NC" onChange={() => setDirty(true)} />
              <div style={{ height: 14 }} />
              <div className="ts-flabel">Dates</div>
              <button className="ts-datechip" style={{ width: '100%', cursor: 'pointer' }} onClick={() => { setDirty(true); go('dates'); }}>
                <ExIcon name="calendar" size={15} color="var(--color-bt-accent)" /><span className="dt">May 26 – Jun 14</span><span className="ts-nights">19 nights</span><ExIcon name="chevron-right" size={15} color="var(--color-bt-text-dim)" />
              </button>
              {dirty && <div className="ts-warn" style={{ marginTop: 14, marginBottom: 0 }}><span className="ic"><ExIcon name="alert-triangle" size={16} color="currentColor" /></span><span className="tx">Changing the destination or dates will reset any date-poll responses.</span></div>}
              <div style={{ height: 16 }} />
              <button className="ts-btn primary" style={!dirty ? { opacity: 0.4 } : undefined}>Save changes</button>
              <button className="ts-btn ghost" onClick={back}>Cancel</button>
            </>
          )}

          {view === 'transfer' && (
            <>
              <div className="ts-flabel">Choose the new owner</div>
              {TS_CREW.map(n => (
                <div key={n} className={`ts-person${pick === n ? ' sel' : ''}`} onClick={() => setPick(n)}>
                  <CrewAvatar member={{ name: n, status: 'active', team: '#2dd4bf' }} size={32} />
                  <span className="ts-person-nm">{n}</span>
                  <span className="ts-radio" />
                </div>
              ))}
              <div style={{ height: 6 }} />
              <button className="ts-btn primary" style={!pick ? { opacity: 0.4 } : undefined}>Transfer ownership</button>
              <button className="ts-btn ghost" onClick={back}>Cancel</button>
            </>
          )}

          {(view === 'clear-crew' || view === 'clear-org' || view === 'delete') && (
            <>
              <div className="ts-confirm-ic"><ExIcon name={view === 'delete' ? 'trash' : 'message-circle'} size={22} color="currentColor" /></div>
              <div className="ts-confirm-t">
                {view === 'delete' ? 'Delete this trip?' : view === 'clear-crew' ? 'Clear crew chat?' : 'Clear organizer chat?'}
              </div>
              <div className="ts-confirm-s">
                {view === 'delete'
                  ? 'This removes all data for everyone — itinerary, lodging, receipts, chat. This can’t be undone.'
                  : `This permanently deletes all ${view === 'clear-crew' ? 'Crew' : 'Organizer'} messages for everyone. This can’t be undone.`}
              </div>
              <button className="ts-btn danger-solid">{view === 'delete' ? 'Delete trip' : 'Clear chat'}</button>
              <button className="ts-btn ghost" onClick={back}>Cancel</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TsMenu()        { return <div className="ts-stage"><TripSettings start="menu" /></div>; }
function TsDetails()     { return <div className="ts-stage"><TripSettings start="details" /></div>; }
function TsTransfer()    { return <div className="ts-stage"><TripSettings start="transfer" /></div>; }
function TsDelete()      { return <div className="ts-stage"><TripSettings start="delete" /></div>; }
function TsInteractive() { return <div className="ts-stage"><TripSettings start="menu" /></div>; }

Object.assign(window, { TripSettings, TsMenu, TsDetails, TsTransfer, TsDelete, TsInteractive });
