// explorations-mobile-modals.jsx — Add modals for Lodging, Agenda, Receipts.
// On desktop the right rail handles "add" inline (matches Crew). On mobile
// there's no rail, so a + button in the header opens one of these modals.

function ModalShell({ title, subtitle, children, primary, secondary = 'Cancel', onClose }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      <div style={{
        width: '100%',
        background: 'var(--color-bt-card-float)',
        borderRadius: '20px 20px 0 0',
        padding: '14px 18px 22px',
        boxShadow: '0 -20px 40px rgba(0,0,0,0.35)',
      }}>
        {/* Grab handle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <span style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--color-bt-border)' }}/>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-bt-text)' }}>{title}</h3>
            {subtitle && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-bt-text-dim)', lineHeight: 1.4 }}>{subtitle}</p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            all: 'unset', cursor: 'pointer', width: 28, height: 28, borderRadius: 9999,
            background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-text-dim)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ExIcon name="x" size={14}/>
          </button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
          {children}
        </div>

        {/* Footer */}
        <button style={{
          all: 'unset', cursor: 'pointer', width: '100%', boxSizing: 'border-box',
          textAlign: 'center', padding: '12px 0', borderRadius: 12,
          background: 'var(--color-bt-accent)', color: '#0a0e1a',
          fontSize: 14, fontWeight: 600,
        }}>{primary}</button>
        <button style={{
          all: 'unset', cursor: 'pointer', width: '100%', boxSizing: 'border-box',
          textAlign: 'center', padding: '10px 0', marginTop: 6,
          color: 'var(--color-bt-text-dim)', fontSize: 13, fontWeight: 500,
        }}>{secondary}</button>
      </div>
    </div>
  );
}

function mobileInput(extra) {
  return {
    background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
    borderRadius: 10, padding: '11px 12px', fontSize: 14, color: 'var(--color-bt-text)',
    outline: 'none', fontFamily: 'var(--font-sans)', width: '100%', boxSizing: 'border-box',
    ...extra,
  };
}

function ModalFieldLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>{children}</div>
  );
}

// ── Add a property ──────────────────────────────────────────────────────
function AddPropertyModal() {
  return (
    <ModalShell
      title="Add a property"
      subtitle={<>Paste a listing link, or <a style={{ color: 'var(--color-bt-accent)' }}>enter manually</a>.</>}
      primary="Add property"
    >
      <div>
        <ModalFieldLabel>Link</ModalFieldLabel>
        <div style={{ position: 'relative', marginTop: 6 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-bt-text-dim)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.5.4l3-3a5 5 0 0 0-7-7L11.6 5"/>
              <path d="M14 11a5 5 0 0 0-7.5-.4l-3 3a5 5 0 0 0 7 7L12.4 19"/>
            </svg>
          </span>
          <input placeholder="https://airbnb.com/rooms/…" style={mobileInput({ paddingLeft: 32, fontFamily: 'var(--font-mono)', color: 'var(--color-bt-text-dim)' })}/>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Add to agenda ──────────────────────────────────────────────────────
function AddAgendaModal({ initialTab = 'activity' } = {}) {
  const [tab, setTab] = React.useState(initialTab);
  return (
    <ModalShell
      title="Add to agenda"
      subtitle="Pick a type, then fill in the basics."
      primary="Add"
    >
      {/* Activity / Golf Round tabs — same as desktop edit drawer */}
      <div style={{
        display: 'inline-flex', alignSelf: 'flex-start',
        background: 'var(--color-bt-card-raised)', border: '1px solid var(--color-bt-border)',
        borderRadius: 10, padding: 3, gap: 3,
      }}>
        {[{ id: 'activity', label: 'Activity' }, { id: 'golf', label: 'Golf Round' }].map(t => (
          <span key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
            background: tab === t.id ? 'var(--color-bt-card)' : 'transparent',
            color: tab === t.id ? 'var(--color-bt-text)' : 'var(--color-bt-text-dim)',
            fontWeight: tab === t.id ? 600 : 500,
          }}>{t.label}</span>
        ))}
      </div>

      {tab === 'activity' ? (
        <>
          <div>
            <ModalFieldLabel>Title</ModalFieldLabel>
            <input placeholder="e.g. Dinner at The Pit BBQ" style={{ ...mobileInput(), marginTop: 6 }}/>
          </div>
          <div>
            <ModalFieldLabel>Location (optional)</ModalFieldLabel>
            <input placeholder="Search for a venue…" style={{ ...mobileInput(), marginTop: 6 }}/>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 2 }}>
              <ModalFieldLabel>Date</ModalFieldLabel>
              <select style={{ ...mobileInput(), marginTop: 6, appearance: 'none' }}>
                <option>Thu, Sep 12</option><option>Fri, Sep 13</option><option>Sat, Sep 14</option><option>Sun, Sep 15</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <ModalFieldLabel>Time (optional)</ModalFieldLabel>
              <input placeholder="7:30a" style={{ ...mobileInput({ fontFamily: 'var(--font-mono)' }), marginTop: 6 }}/>
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <ModalFieldLabel>Golf course</ModalFieldLabel>
            <input placeholder="Search golf courses…" style={{ ...mobileInput(), marginTop: 6 }}/>
          </div>
          <div>
            <ModalFieldLabel>Tee times</ModalFieldLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {['7:30 AM', '7:38 AM'].map((time, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
                  borderRadius: 10, padding: '6px 10px',
                }}>
                  <input defaultValue={time} style={mobileInput({ fontFamily: 'var(--font-mono)', padding: '4px 6px', flex: 1, border: 'none', background: 'transparent' })}/>
                  <span style={{ cursor: 'pointer', color: 'var(--color-bt-text-dim)' }}><ExIcon name="x" size={14}/></span>
                </div>
              ))}
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
          <div>
            <ModalFieldLabel>Date</ModalFieldLabel>
            <select style={{ ...mobileInput(), marginTop: 6, appearance: 'none' }}>
              <option>Thu, Sep 12</option><option>Fri, Sep 13</option><option>Sat, Sep 14</option><option>Sun, Sep 15</option>
            </select>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ── Add a receipt ──────────────────────────────────────────────────────
function AddReceiptModal() {
  return (
    <ModalShell
      title="Add a receipt"
      subtitle="Basics now — customize the split from the receipt after saving."
      primary="Add receipt"
    >
      <div>
        <ModalFieldLabel>Title</ModalFieldLabel>
        <input placeholder="e.g. Steak dinner" style={{ ...mobileInput(), marginTop: 6 }}/>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <ModalFieldLabel>Cost</ModalFieldLabel>
          <div style={{ position: 'relative', marginTop: 6 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-bt-text-dim)', fontFamily: 'var(--font-mono)' }}>$</span>
            <input placeholder="0.00" style={mobileInput({ fontFamily: 'var(--font-mono)', textAlign: 'right', paddingLeft: 22 })}/>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <ModalFieldLabel>Paid by</ModalFieldLabel>
          <select style={{ ...mobileInput(), marginTop: 6, appearance: 'none' }}>
            <option>Zach (you)</option><option>Llama</option><option>Buddy</option><option>Mike</option><option>Ryan</option>
          </select>
        </div>
      </div>
      <div>
        <ModalFieldLabel>Date (optional)</ModalFieldLabel>
        <input placeholder="mm/dd/yyyy" style={{ ...mobileInput({ fontFamily: 'var(--font-mono)' }), marginTop: 6 }}/>
      </div>

      {/* Even split is the default. Customize happens from the receipt drawer after save. */}
      <div style={{
        background: 'var(--color-bt-card)', border: '1px solid var(--color-bt-border)',
        borderRadius: 10, padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
          background: 'var(--color-bt-accent-faint)', color: 'var(--color-bt-accent)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><ExIcon name="users" size={14} color="currentColor"/></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-bt-text)' }}>Even split across the crew</div>
          <div style={{ fontSize: 10, color: 'var(--color-bt-text-dim)', marginTop: 2 }}>Customize after saving — tap the receipt to adjust shares.</div>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Add to crew (already exists as drawer/sheet — included here for parity) ──
function AddCrewModal() {
  return (
    <ModalShell
      title="Add to crew"
      subtitle="Name and/or email — either is enough. Email enables app access."
      primary="Add to crew"
    >
      <div>
        <ModalFieldLabel>Name</ModalFieldLabel>
        <input placeholder="e.g. Llama" style={{ ...mobileInput(), marginTop: 6 }}/>
      </div>
      <div>
        <ModalFieldLabel>Email</ModalFieldLabel>
        <input placeholder="jason@doherty.dev" style={{ ...mobileInput({ fontFamily: 'var(--font-mono)' }), marginTop: 6 }}/>
      </div>
    </ModalShell>
  );
}

// ── Modal-over-tab wrappers (so we can render the modal on its real page) ──
function LodgingMobileWithModal() {
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden', background: 'var(--color-bt-base)' }}>
      <MobileLodgingShell />
      <AddPropertyModal />
    </div>
  );
}
function AgendaMobileWithModal() {
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden', background: 'var(--color-bt-base)' }}>
      <MobileAgendaShell />
      <AddAgendaModal />
    </div>
  );
}
function ReceiptsMobileWithModal() {
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden', background: 'var(--color-bt-base)' }}>
      <MobileReceiptsShell />
      <AddReceiptModal />
    </div>
  );
}
function CrewMobileWithAddModal() {
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden', background: 'var(--color-bt-base)' }}>
      <CrewMobile />
      <AddCrewModal />
    </div>
  );
}

// Quick mobile shells for the three tabs — just the header + tabs + a faint
// stub of content, so the modal has something realistic to sit over.
function MobileTabHeader({ active, eyebrow, title, sub, ctaLabel = '+ Add' }) {
  const tabs = ['Home','Crew','Lodging','Agenda','Receipts','Compete'];
  return (
    <>
      <ExTopNav title="BBMI 2026" />
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-bt-border)' }}>
        {tabs.map(t => {
          const a = t.toLowerCase() === active;
          return (
            <div key={t} style={{
              flex: 1, padding: '10px 0', textAlign: 'center',
              color: a ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)',
              borderBottom: a ? '2px solid var(--color-bt-accent)' : '2px solid transparent',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>{t}</div>
          );
        })}
      </div>
      <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-accent)' }}>{eyebrow}</div>
          <h2 style={{ margin: '4px 0 4px', fontSize: 18, fontWeight: 700 }}>{title}</h2>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-bt-text-dim)', lineHeight: 1.4, maxWidth: 280 }}>{sub}</p>
        </div>
        <button style={{ all: 'unset', cursor: 'pointer', padding: '6px 12px', borderRadius: 9999, background: 'var(--color-bt-accent)', color: '#0a0e1a', fontSize: 12, fontWeight: 600 }}>{ctaLabel}</button>
      </div>
    </>
  );
}

function MobileLodgingShell() {
  return <><MobileTabHeader active="lodging" eyebrow="LODGING" title="Where everyone's staying" sub="Drop in places to compare." ctaLabel="+ Property" /></>;
}
function MobileAgendaShell() {
  return <><MobileTabHeader active="agenda" eyebrow="AGENDA" title="What you're doing" sub="Tee times, dinners, side games." /></>;
}
function MobileReceiptsShell() {
  return <><MobileTabHeader active="receipts" eyebrow="RECEIPTS" title="Track who paid" sub="We square balances at the end." ctaLabel="+ Receipt" /></>;
}

Object.assign(window, {
  AddPropertyModal, AddAgendaModal, AddReceiptModal, AddCrewModal,
  LodgingMobileWithModal, AgendaMobileWithModal, ReceiptsMobileWithModal, CrewMobileWithAddModal,
});
