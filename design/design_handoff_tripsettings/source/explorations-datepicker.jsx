// explorations-datepicker.jsx — ONE reusable calendar picker, two modes:
//   • range  — start→end in a single calendar (trip dates, lodging stay)
//   • single — one day (agenda item, receipt, travel arrival)
// Replaces paired native date inputs everywhere. Interactive: click to select,
// nav months, quick presets. Domain-tintable via the `accent` prop so e.g.
// lodging's picker reads blue, travel's reads rose.

(function injectDpxCss() {
  if (typeof document === 'undefined' || document.getElementById('btDpxCss')) return;
  const css = `
  .dpx-wrap { font-family: var(--font-sans); }
  .dpx-flabel { font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color: var(--color-bt-text-dim); margin-bottom:6px; }
  /* the trigger field (replaces the native input) */
  .dpx-field { display:flex; align-items:center; gap:10px; padding:11px 13px; border-radius:10px; background: var(--color-bt-card-raised); border:1px solid var(--color-bt-border); cursor:pointer; }
  .dpx-field.open { border-color: var(--dpx-accent); box-shadow:0 0 0 3px var(--dpx-accent-faint); }
  .dpx-field .ic { color: var(--dpx-accent); display:inline-flex; flex-shrink:0; }
  .dpx-field .val { flex:1; min-width:0; font-size:13.5px; font-weight:600; color: var(--color-bt-text); }
  .dpx-field .val.empty { color: var(--color-bt-text-dim); font-weight:500; }
  .dpx-field .nights { font-size:11px; font-family: var(--font-mono); color: var(--color-bt-text-dim); }

  .dpx-cal { margin-top:8px; width:300px; max-width:100%; border:1px solid var(--color-bt-border); border-radius:13px; background: var(--color-bt-card-float); box-shadow:0 16px 44px rgba(0,0,0,0.35); overflow:hidden; }
  .dpx-presets { display:flex; gap:6px; padding:11px 12px 0; flex-wrap:wrap; }
  .dpx-preset { font-size:11.5px; font-weight:600; padding:5px 10px; border-radius:9999px; cursor:pointer; background: var(--color-bt-card-raised); border:1px solid var(--color-bt-border); color: var(--color-bt-text); }
  .dpx-preset:hover { border-color: var(--dpx-accent); color: var(--dpx-accent); }
  .dpx-mh { display:flex; align-items:center; justify-content:space-between; padding:12px 14px 8px; }
  .dpx-mname { font-size:14px; font-weight:700; color: var(--color-bt-text); }
  .dpx-nav { display:flex; gap:4px; }
  .dpx-nav button { all:unset; cursor:pointer; width:28px; height:28px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; color: var(--color-bt-text-dim); }
  .dpx-nav button:hover { background: var(--color-bt-hover); color: var(--color-bt-text); }
  .dpx-wd { display:grid; grid-template-columns: repeat(7,1fr); padding:0 12px; }
  .dpx-wd span { text-align:center; font-size:10px; font-weight:700; color: var(--color-bt-text-dim); padding-bottom:4px; }
  .dpx-grid { display:grid; grid-template-columns: repeat(7,1fr); padding:2px 12px 8px; }
  .dpx-day { position:relative; aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:13px; color: var(--color-bt-text); cursor:pointer; z-index:0; }
  .dpx-day.muted { color:transparent; pointer-events:none; }
  .dpx-day:hover:not(.cap):not(.muted)::after { content:''; position:absolute; inset:3px; border-radius:8px; border:1px solid var(--dpx-accent); z-index:-1; }
  .dpx-day.in { background: var(--dpx-accent-faint); }
  .dpx-day.in.start { border-top-left-radius:9px; border-bottom-left-radius:9px; }
  .dpx-day.in.end { border-top-right-radius:9px; border-bottom-right-radius:9px; }
  .dpx-day.cap { color:#0d1f1a; font-weight:700; }
  .dpx-day.cap::before { content:''; position:absolute; inset:2px; border-radius:9px; background: var(--dpx-accent); z-index:-1; }
  .dpx-day.today:not(.cap)::before { content:''; position:absolute; left:50%; bottom:5px; width:4px; height:4px; margin-left:-2px; border-radius:50%; background: var(--dpx-accent); }
  .dpx-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border-top:1px solid var(--color-bt-subtle-border); }
  .dpx-summary { font-size:12px; color: var(--color-bt-text-dim); }
  .dpx-summary b { color: var(--color-bt-text); font-weight:600; }
  .dpx-apply { display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border-radius:9px; background: var(--dpx-accent); color:#0d1f1a; font-size:12.5px; font-weight:700; cursor:pointer; border:none; }
  .dpx-apply:disabled { opacity:0.4; cursor:default; }
  `;
  const s = document.createElement('style');
  s.id = 'btDpxCss';
  s.textContent = css;
  document.head.appendChild(s);
})();

const DPX_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dpxKey = (d) => d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : '';
const dpxFmt = (d) => d ? `${DPX_MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}` : '';
const dpxSameDay = (a, b) => a && b && dpxKey(a) === dpxKey(b);
const dpxNextDow = (from, dow) => { const d = new Date(from); d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7)); return d; };
const TODAY = new Date();

function BTCalendar({ mode, accent, accentFaint, value, onChange }) {
  const seed = (mode === 'range' ? (value && value.start) : value) || new Date(2026, 4, 1);
  const [view, setView] = React.useState({ y: seed.getFullYear(), m: seed.getMonth() });
  const [sel, setSel] = React.useState(value || (mode === 'range' ? { start: null, end: null } : null));

  const move = (delta) => {
    let m = view.m + delta, y = view.y;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setView({ y, m });
  };
  const pick = (day) => {
    if (mode === 'single') { setSel(day); onChange && onChange(day); return; }
    const { start, end } = sel;
    if (!start || end) setSel({ start: day, end: null });
    else if (day < start) setSel({ start: day, end: null });
    else setSel({ start, end: day });
  };
  const applyPreset = (p) => {
    const fri = dpxNextDow(TODAY, 5);
    if (p === 'wknd') setSel({ start: fri, end: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 2) });
    if (p === 'long') setSel({ start: fri, end: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 3) });
    if (p === 'week') setSel({ start: fri, end: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 7) });
    const ns = p ? fri : null; if (ns) setView({ y: ns.getFullYear(), m: ns.getMonth() });
    if (p === 'today') { setSel(TODAY); setView({ y: TODAY.getFullYear(), m: TODAY.getMonth() }); }
  };

  const first = new Date(view.y, view.m, 1);
  const startDow = first.getDay();
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(<span className="dpx-day muted" key={'b' + i}>0</span>);
  for (let d = 1; d <= daysIn; d++) {
    const day = new Date(view.y, view.m, d);
    let cls = 'dpx-day';
    if (mode === 'range') {
      const { start, end } = sel;
      const isStart = dpxSameDay(day, start), isEnd = dpxSameDay(day, end);
      const between = start && end && day > start && day < end;
      if (isStart || isEnd) cls += ' cap';
      if (between || (isStart && end) || (isEnd)) cls += ' in';
      if (isStart) cls += ' start'; if (isEnd) cls += ' end';
    } else if (dpxSameDay(day, sel)) cls += ' cap';
    if (dpxSameDay(day, TODAY)) cls += ' today';
    cells.push(<span className={cls} key={d} onClick={() => pick(day)}>{d}</span>);
  }

  const range = mode === 'range';
  const nights = range && sel.start && sel.end ? Math.round((sel.end - sel.start) / 86400000) : 0;
  const ready = range ? (sel.start && sel.end) : !!sel;
  const summary = range
    ? (sel.start ? <><b>{dpxFmt(sel.start)}</b>{sel.end ? <> – <b>{dpxFmt(sel.end)}</b> · {nights} night{nights !== 1 ? 's' : ''}</> : <> → pick end</>}</> : 'Pick a start date')
    : (sel ? <b>{dpxFmt(sel)}</b> : 'Pick a date');

  return (
    <div className="dpx-cal" style={{ '--dpx-accent': accent, '--dpx-accent-faint': accentFaint }}>
      <div className="dpx-presets">
        {range
          ? <><span className="dpx-preset" onClick={() => applyPreset('wknd')}>This weekend</span><span className="dpx-preset" onClick={() => applyPreset('long')}>Long weekend</span><span className="dpx-preset" onClick={() => applyPreset('week')}>A week</span></>
          : <span className="dpx-preset" onClick={() => applyPreset('today')}>Today</span>}
      </div>
      <div className="dpx-mh">
        <span className="dpx-mname">{DPX_MONTHS[view.m]} {view.y}</span>
        <span className="dpx-nav">
          <button onClick={() => move(-1)} aria-label="Previous month"><ExIcon name="chevron-up" size={15} color="currentColor" /></button>
          <button onClick={() => move(1)} aria-label="Next month"><ExIcon name="chevron-down" size={15} color="currentColor" /></button>
        </span>
      </div>
      <div className="dpx-wd">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <span key={i}>{w}</span>)}</div>
      <div className="dpx-grid">{cells}</div>
      <div className="dpx-foot">
        <span className="dpx-summary">{summary}</span>
        <button className="dpx-apply" disabled={!ready}>{range ? 'Set dates' : 'Set date'}</button>
      </div>
    </div>
  );
}

// Demo wrapper: shows the trigger FIELD (replaces native input) + the open calendar.
function DatePickerDemo({ label, mode, accent, accentFaint, icon, initial }) {
  const [val, setVal] = React.useState(initial);
  const range = mode === 'range';
  let fieldText, empty = false, nights = 0;
  if (range) {
    if (initial && initial.start && initial.end) { fieldText = `${dpxFmt(initial.start)} – ${dpxFmt(initial.end)}`; nights = Math.round((initial.end - initial.start) / 86400000); }
    else { fieldText = 'Select dates'; empty = true; }
  } else {
    fieldText = initial ? dpxFmt(initial) : 'Select date'; empty = !initial;
  }
  return (
    <div className="dpx-wrap" style={{ '--dpx-accent': accent, '--dpx-accent-faint': accentFaint }}>
      <div className="dpx-flabel">{label}</div>
      <div className="dpx-field open">
        <span className="ic"><ExIcon name={icon} size={16} color="currentColor" /></span>
        <span className={`val${empty ? ' empty' : ''}`}>{fieldText}</span>
        {range && nights > 0 && <span className="nights">{nights} night{nights !== 1 ? 's' : ''}</span>}
        <ExIcon name="calendar" size={15} color="var(--color-bt-text-dim)" />
      </div>
      <BTCalendar mode={mode} accent={accent} accentFaint={accentFaint} value={initial} onChange={setVal} />
    </div>
  );
}

const TEAL = ['#2dd4bf', 'rgba(45,212,191,0.16)'];
const BLUE = ['#3b82f6', 'rgba(59,130,246,0.16)'];
const AMBER = ['#fbbf24', 'rgba(251,191,36,0.16)'];
const GREEN = ['#22c55e', 'rgba(34,197,94,0.16)'];
const ROSE = ['#fb7185', 'rgba(251,113,133,0.16)'];

function DpTrip()    { return <DatePickerDemo label="Trip dates" mode="range" icon="calendar" accent={TEAL[0]} accentFaint={TEAL[1]} initial={{ start: new Date(2026, 4, 22), end: new Date(2026, 4, 26) }} />; }
function DpLodging() { return <DatePickerDemo label="Check-in → check-out" mode="range" icon="building" accent={BLUE[0]} accentFaint={BLUE[1]} initial={{ start: new Date(2026, 4, 22), end: new Date(2026, 4, 26) }} />; }
function DpAgenda()  { return <DatePickerDemo label="Day" mode="single" icon="flag" accent={AMBER[0]} accentFaint={AMBER[1]} initial={new Date(2026, 4, 24)} />; }
function DpReceipt() { return <DatePickerDemo label="Date" mode="single" icon="dollar-sign" accent={GREEN[0]} accentFaint={GREEN[1]} initial={new Date(2026, 4, 25)} />; }
function DpTravel()  { return <DatePickerDemo label="Arrival date" mode="single" icon="plane" accent={ROSE[0]} accentFaint={ROSE[1]} initial={new Date(2026, 4, 22)} />; }

function DatePickerShowcase() {
  return (
    <div style={{ background: 'var(--color-bt-base)', padding: 24, display: 'grid', gridTemplateColumns: 'repeat(3, max-content)', gap: '28px 32px', justifyContent: 'center' }}>
      <DpTrip /><DpLodging /><DpAgenda />
      <DpReceipt /><DpTravel />
    </div>
  );
}

Object.assign(window, { BTCalendar, DatePickerDemo, DatePickerShowcase, DpTrip, DpLodging, DpAgenda, DpReceipt, DpTravel });
