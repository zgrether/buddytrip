// explorations-edit-drawers.jsx — desktop edit drawers (Property / Agenda / Receipt).
// All three follow the same pattern as MemberEditor in explorations-crew-edit.jsx:
// right-anchored 420px drawer, dim backdrop, sticky footer with Cancel + Save.

// ── Shared drawer shell ─────────────────────────────────────────────────
function EditDrawer({ title, eyebrow, children, primaryLabel = 'Save changes', secondaryLabel = 'Cancel', destructive, onClose }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'var(--color-bt-card-float)',
      borderLeft: '1px solid var(--color-bt-border)',
      display: 'flex', flexDirection: 'column',
      boxShadow: '-20px 0 40px rgba(0,0,0,0.35)',
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--color-bt-subtle-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          {eyebrow && (
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginBottom: 4 }}>{eyebrow}</div>
          )}
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-bt-text)' }}>{title}</h3>
        </div>
        <button aria-label="Close" onClick={onClose} style={{
          all: 'unset', cursor: 'pointer', width: 28, height: 28, borderRadius: 9999,
          background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-text-dim)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><ExIcon name="x" size={14}/></button>
      </div>

      <div style={{ flex: 1, padding: 18, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
        {destructive && (
          <div style={{ marginTop: 'auto' }}>
            <button style={{
              all: 'unset', cursor: 'pointer', textAlign: 'center', boxSizing: 'border-box',
              padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              width: '100%',
              background: 'transparent', color: 'var(--color-bt-danger)',
              border: '0.5px solid var(--color-bt-danger-border)',
            }}>{destructive}</button>
          </div>
        )}
      </div>

      <div style={{
        display: 'flex', gap: 8, padding: 14,
        borderTop: '1px solid var(--color-bt-subtle-border)',
      }}>
        <button style={drawerGhostBtn()}>{secondaryLabel}</button>
        <button style={drawerPrimaryBtn()}>{primaryLabel}</button>
      </div>
    </div>
  );
}

function drawerInput(extra) {
  return {
    background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
    borderRadius: 10, padding: '9px 12px', fontSize: 14, color: 'var(--color-bt-text)',
    outline: 'none', fontFamily: 'var(--font-sans)', width: '100%', boxSizing: 'border-box',
    ...extra,
  };
}
function drawerLabel(label, hint) {
  return (
    <>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>{label}{hint && <span style={{ marginLeft: 6, textTransform: 'none', fontWeight: 400, letterSpacing: 0, color: 'var(--color-bt-text-dim)' }}>{hint}</span>}</span>
    </>
  );
}
function drawerPrimaryBtn() {
  return { all: 'unset', cursor: 'pointer', textAlign: 'center', boxSizing: 'border-box',
    padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, flex: 1,
    background: 'var(--color-bt-accent)', color: '#0d1f1a' };
}
function drawerGhostBtn() {
  return { all: 'unset', cursor: 'pointer', textAlign: 'center', boxSizing: 'border-box',
    padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500,
    background: 'transparent', color: 'var(--color-bt-text-dim)',
    border: '0.5px solid var(--color-bt-border)' };
}

// ════════════════════════════════════════════════════════════════════════
// PROPERTY EDIT DRAWER
// ════════════════════════════════════════════════════════════════════════
function PropertyEditDrawer() {
  return (
    <EditDrawer
      eyebrow="Lodging"
      title="Sea Ranch Cottages"
      destructive="Remove property"
    >
      {/* Photo */}
      <div style={{
        height: 130, borderRadius: 12,
        background: 'linear-gradient(135deg, #0d2c3a, #14385a)',
        position: 'relative', overflow: 'hidden',
      }}>
        <button style={{
          position: 'absolute', right: 10, top: 10,
          all: 'unset', cursor: 'pointer',
          background: 'rgba(0,0,0,0.5)', color: '#fff', backdropFilter: 'blur(8px)',
          padding: '5px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <ExIcon name="plus" size={11} color="currentColor"/> Replace photo
        </button>
        <span style={{
          position: 'absolute', left: 10, bottom: 10,
          background: 'var(--color-bt-accent)', color: '#0d1f1a',
          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          Confirmed
        </span>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {drawerLabel('Title')}
        <input defaultValue="Sea Ranch Cottages" style={drawerInput()}/>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {drawerLabel('Link', '(opens externally)')}
        <input defaultValue="https://vrbo.com/12345-sea-ranch-pinehurst" style={drawerInput({ fontFamily: 'var(--font-mono)', color: 'var(--color-bt-text-dim)' })}/>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {drawerLabel('Sleeps')}
          <input defaultValue="6" type="number" style={drawerInput({ fontFamily: 'var(--font-mono)', textAlign: 'right' })}/>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {drawerLabel('Cost')}
          <input defaultValue="$2,400" style={drawerInput({ fontFamily: 'var(--font-mono)', textAlign: 'right' })}/>
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {drawerLabel('Check-in')}
          <input defaultValue="Sep 12" style={drawerInput()}/>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {drawerLabel('Check-out')}
          <input defaultValue="Sep 15" style={drawerInput()}/>
        </label>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {drawerLabel('Notes', '(optional)')}
        <textarea rows={3} defaultValue="Door code: 4821#. Hot tub on the deck. Buddy + Mike in the master, others bunked downstairs." style={drawerInput({ resize: 'vertical', minHeight: 70 })}/>
      </label>
    </EditDrawer>
  );
}

// ════════════════════════════════════════════════════════════════════════
// AGENDA EDIT DRAWER (Activity + Golf Round tabs)
// ════════════════════════════════════════════════════════════════════════
function AgendaEditDrawer({ initialTab = 'activity' }) {
  const [tab, setTab] = React.useState(initialTab);

  return (
    <EditDrawer
      eyebrow="Agenda"
      title={tab === 'golf' ? 'Round 1 — Scramble' : 'Steak dinner + open bar'}
      destructive="Remove from agenda"
    >
      {/* Type tabs — matches the existing modal's "Activity / Golf Round" pattern */}
      <div style={{
        display: 'inline-flex', alignSelf: 'flex-start',
        background: 'var(--color-bt-card-raised)', border: '1px solid var(--color-bt-border)',
        borderRadius: 10, padding: 3, gap: 3,
      }}>
        {[{ id: 'activity', label: 'Activity' }, { id: 'golf', label: 'Golf Round' }].map(t => (
          <span key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
            background: tab === t.id ? 'var(--color-bt-card)' : 'transparent',
            color: tab === t.id ? 'var(--color-bt-text)' : 'var(--color-bt-text-dim)',
            fontWeight: tab === t.id ? 600 : 500,
          }}>{t.label}</span>
        ))}
      </div>

      {tab === 'activity' ? <ActivityFields /> : <GolfRoundFields />}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {drawerLabel('Date')}
          <select defaultValue="Sat" style={drawerInput()}>
            <option>Thu, Sep 12</option><option>Fri, Sep 13</option><option>Sat, Sep 14</option><option>Sun, Sep 15</option>
          </select>
        </label>
        {tab === 'activity' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {drawerLabel('Time', '(optional)')}
            <input defaultValue="7:00p" style={drawerInput({ fontFamily: 'var(--font-mono)' })}/>
          </label>
        )}
      </div>
    </EditDrawer>
  );
}

function ActivityFields() {
  return (
    <>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {drawerLabel('Title')}
        <input defaultValue="Steak dinner + open bar" placeholder="e.g. Dinner at The Pit BBQ" style={drawerInput()}/>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {drawerLabel('Detail', '(optional)')}
        <textarea rows={2} defaultValue="Reservation under Banks · open bar on Zach's tab" style={drawerInput({ resize: 'vertical', minHeight: 56 })}/>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {drawerLabel('Location', '(optional)')}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-bt-text-dim)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </span>
          <input defaultValue="Pinehurst Resort Steakhouse" style={drawerInput({ paddingLeft: 32 })}/>
        </div>
      </label>
    </>
  );
}

function GolfRoundFields() {
  return (
    <>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {drawerLabel('Golf course')}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-bt-text-dim)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </span>
          <input defaultValue="Pinehurst No. 2" style={drawerInput({ paddingLeft: 32 })}/>
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-accent)', background: 'var(--color-bt-accent-faint)', padding: '2px 6px', borderRadius: 4 }}>Verified</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)' }}>72 par · 7,565 yds · 4 reviews from BT users</div>
      </label>

      <div>
        {drawerLabel('Tee times')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {['7:30 AM', '7:38 AM', '7:46 AM'].map((time, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
              borderRadius: 10, padding: '8px 10px',
            }}>
              <span style={{ color: 'var(--color-bt-text-dim)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </span>
              <input defaultValue={time} style={drawerInput({ flex: 1, padding: '6px 10px', fontFamily: 'var(--font-mono)' })}/>
              <span style={{ cursor: 'pointer', color: 'var(--color-bt-text-dim)' }}><ExIcon name="x" size={14}/></span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-bt-text-dim)', lineHeight: 1.4 }}>
          Reserve the times. Pairings get set later from the competition tab.
        </div>
        <button style={{
          all: 'unset', cursor: 'pointer', marginTop: 8,
          color: 'var(--color-bt-accent)', fontSize: 12, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>+ Add tee time</button>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--color-bt-text)' }}>
        <span style={{
          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
          background: 'var(--color-bt-card-raised)',
          border: '1.5px solid var(--color-bt-border)',
        }}/>
        Walk-on — no specific tee time
      </label>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// RECEIPT EDIT DRAWER (progressive disclosure for custom split)
// ════════════════════════════════════════════════════════════════════════
function ReceiptEditDrawer({ initialCustom = false }) {
  const [custom, setCustom] = React.useState(initialCustom);
  const crew = [
    { initials: 'ZG', name: 'Zach Grether',  color: '#a855f7', share: '$15.00', override: '15', overridden: true, selected: true,  isYou: true },
    { initials: 'LL', name: 'Llama (Jason)', color: '#3b82f6', share: '$17.50', override: '—',  overridden: false, selected: true },
    { initials: 'BB', name: 'Buddy Banks',   color: '#22c55e', share: '$17.50', override: '—',  overridden: false, selected: true },
    { initials: 'MK', name: 'Mike Kosko',    color: '#06b6d4', share: '$0.00',  selected: false },
  ];
  const selectedCount = crew.filter(c => c.selected).length;
  const even = '$12.50';

  return (
    <EditDrawer
      eyebrow="Receipt"
      title="Dinner"
      destructive="Delete receipt"
    >
      {/* Basics — always visible */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {drawerLabel('Title')}
          <input defaultValue="Dinner" placeholder="e.g. Dinner at The Pit BBQ" style={drawerInput()}/>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {drawerLabel('Cost')}
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-bt-text-dim)', fontFamily: 'var(--font-mono)' }}>$</span>
            <input defaultValue="50.00" style={drawerInput({ paddingLeft: 22, fontFamily: 'var(--font-mono)', textAlign: 'right' })}/>
          </div>
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {drawerLabel('Paid by')}
          <select defaultValue="Zach" style={drawerInput()}>
            <option>Zach (you)</option><option>Llama</option><option>Buddy</option><option>Mike</option><option>Ryan</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {drawerLabel('Date', '(optional)')}
          <input type="text" defaultValue="May 13" style={drawerInput({ fontFamily: 'var(--font-mono)' })}/>
        </label>
      </div>

      {/* Split mode — progressive disclosure */}
      <div style={{
        background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
        borderRadius: 12, padding: 12,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>Split</div>
            {!custom ? (
              <div style={{ marginTop: 4, fontSize: 14, color: 'var(--color-bt-text)' }}>
                <strong style={{ color: 'var(--color-bt-accent)', fontWeight: 600 }}>Even split</strong> · {even} each · 4 crew
              </div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 14, color: 'var(--color-bt-text)' }}>
                <strong style={{ color: 'var(--color-bt-accent)', fontWeight: 600 }}>Custom split</strong> · {selectedCount} of 4 selected
              </div>
            )}
          </div>
          <button onClick={() => setCustom(c => !c)} style={{
            all: 'unset', cursor: 'pointer',
            padding: '5px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 600,
            background: custom ? 'var(--color-bt-accent-faint)' : 'transparent',
            color: 'var(--color-bt-accent)',
            border: '1px solid var(--color-bt-accent-border)',
          }}>{custom ? 'Use even split' : 'Customize…'}</button>
        </div>

        {custom && (
          <div className="bt-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 60px 80px', gap: 8, padding: '0 4px', fontSize: 10, color: 'var(--color-bt-text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 }}>
              <span></span><span></span><span style={{ textAlign: 'right' }}>Share</span><span style={{ textAlign: 'center' }}>Override</span>
            </div>
            {crew.map((p, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: 'auto 1fr 60px 80px', gap: 8, alignItems: 'center',
                padding: '6px 4px',
                borderTop: i === 0 ? 'none' : '1px solid var(--color-bt-subtle-border)',
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                  background: p.selected ? 'var(--color-bt-accent)' : 'var(--color-bt-card-raised)',
                  border: p.selected ? 'none' : '1.5px solid var(--color-bt-border)',
                  color: '#0d1f1a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {p.selected && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>}
                </span>
                <span style={{ fontSize: 13, color: p.selected ? 'var(--color-bt-text)' : 'var(--color-bt-text-dim)', fontWeight: p.isYou ? 600 : 500 }}>
                  {p.name}{p.isYou && <span style={{ color: 'var(--color-bt-text-dim)', fontWeight: 400 }}> (you)</span>}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: p.overridden ? 'var(--color-bt-text-dim)' : 'var(--color-bt-text)', textAlign: 'right', textDecoration: p.overridden ? 'line-through' : 'none' }}>{p.share}</span>
                <input defaultValue={p.override}
                  disabled={!p.selected}
                  style={drawerInput({
                    padding: '5px 8px', fontSize: 12, fontFamily: 'var(--font-mono)',
                    textAlign: 'center',
                    color: p.overridden ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)',
                    borderColor: p.overridden ? 'var(--color-bt-accent)' : 'var(--color-bt-border)',
                    opacity: p.selected ? 1 : 0.4,
                  })}/>
              </div>
            ))}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-bt-text-dim)', lineHeight: 1.4 }}>
              Tap a row to include/exclude. Enter a custom dollar amount in <strong style={{ color: 'var(--color-bt-text)', fontWeight: 600 }}>Override</strong> — remaining cost splits evenly across the others.
            </div>
          </div>
        )}
      </div>
    </EditDrawer>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Wrappers — drawer over its desktop tab page
// ────────────────────────────────────────────────────────────────────────
function PropertyDesktopWithDrawer() {
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <LodgingAfter />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 440 }}>
        <PropertyEditDrawer />
      </div>
    </div>
  );
}

function AgendaDesktopWithDrawer({ initialTab }) {
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <AgendaAfter />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 440 }}>
        <AgendaEditDrawer initialTab={initialTab}/>
      </div>
    </div>
  );
}

function ReceiptsDesktopWithDrawer({ initialCustom }) {
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <ReceiptsAfter />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 440 }}>
        <ReceiptEditDrawer initialCustom={initialCustom}/>
      </div>
    </div>
  );
}

Object.assign(window, {
  PropertyEditDrawer, AgendaEditDrawer, ReceiptEditDrawer,
  PropertyDesktopWithDrawer, AgendaDesktopWithDrawer, ReceiptsDesktopWithDrawer,
});
