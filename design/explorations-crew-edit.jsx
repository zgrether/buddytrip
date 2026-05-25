// explorations-crew-edit.jsx — the member-detail editor.
// One affordance: tap a row → opens a drawer (desktop) / sheet (mobile)
// that lets you edit name/email and change role. Status is derived,
// not chosen — the UI shows live validation feedback so it's clear
// what'll happen when you save.

// ── Shared header / row from the underlying crew page (re-used)
// We render the existing CrewDesktop / CrewMobile then overlay the
// drawer — that's how this'll really look in production.

// ── The drawer (works as right-rail on desktop, full sheet on mobile) ──
function MemberEditor({ mode = 'drawer', initial }) {
  // Render three live-validation states stacked so the user can see all
  // outcomes side-by-side. In production this is one input.
  const [name, setName] = React.useState(initial?.name ?? '');
  const [email, setEmail] = React.useState(initial?.email ?? '');

  const validation = initial?.validation ?? 'idle';
  const role = initial?.role ?? 'Member';
  const status = initial?.status ?? 'active';

  const isMobile = mode === 'sheet';

  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'var(--color-bt-card-float)',
      borderLeft: !isMobile ? '1px solid var(--color-bt-border)' : 'none',
      borderTop:  isMobile  ? '1px solid var(--color-bt-border)' : 'none',
      borderRadius: isMobile ? '16px 16px 0 0' : 0,
      display: 'flex', flexDirection: 'column',
      boxShadow: '-20px 0 40px rgba(0,0,0,0.35)',
    }}>
      {/* Mobile grab handle */}
      {isMobile && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 0' }}>
          <span style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--color-bt-border)' }}/>
        </div>
      )}

      {/* Header */}
      <div style={{
        padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--color-bt-subtle-border)',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>Edit crew member</div>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CrewAvatar member={initial ?? { name: 'New person', status: 'placeholder' }} size={36} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-bt-text)' }}>{name || 'Untitled person'}</div>
              <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)' }}>{ROLE_STATUS_DESC(role, status)}</div>
            </div>
          </div>
        </div>
        <button aria-label="Close" style={{
          all: 'unset', cursor: 'pointer', width: 28, height: 28, borderRadius: 9999,
          background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-text-dim)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><ExIcon name="x" size={14}/></button>
      </div>

      <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
        {/* Trip nickname */}
        <Field label="Trip nickname" hint={!name ? 'Required if no email is given' : "How the app refers to them in this trip — only the owner & organizers can change it."}>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle()}/>
        </Field>

        {/* Account name — read-only, only relevant for Active users */}
        {status === 'active' && initial?.accountName && (
          <Field label="Account name" hint="The name on their BuddyTrip account. They can change it in their own settings.">
            <div style={{
              ...inputStyle(),
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--color-bt-card-raised)',
              color: 'var(--color-bt-text-dim)',
              cursor: 'not-allowed',
            }}>
              <span>{initial.accountName}</span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>Read-only</span>
            </div>
          </Field>
        )}

        {/* Email + live validation */}
        <Field label="Email" hint="Adding email turns a placeholder into an Active or Invited member.">
          <input value={email} onChange={e => setEmail(e.target.value)} style={{
            ...inputStyle(),
            fontFamily: 'var(--font-mono)',
            borderColor: VALIDATION_BORDER(validation),
          }}/>
          <ValidationFeedback state={validation} email={email}/>
        </Field>

        {/* Role — single action, not a toggle. Member is the implicit default. */}
        <Field label="Permissions">
          <RoleControl role={role} status={status} />
        </Field>

        {/* Actions */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {status === 'invited' && (
            <button style={secondaryBtn()}>
              <ExIcon name="send" size={14} color="currentColor"/> Resend invite
            </button>
          )}
          <button style={dangerBtn()}>
            <ExIcon name="x" size={14} color="currentColor"/> Remove from trip
          </button>
        </div>
      </div>

      {/* Footer — Save / Cancel */}
      <div style={{
        display: 'flex', gap: 8, padding: 14,
        borderTop: '1px solid var(--color-bt-subtle-border)',
      }}>
        <button style={ghostBtn()}>Cancel</button>
        <button style={primaryBtn()}>Save changes</button>
      </div>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────
function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', lineHeight: 1.4 }}>{hint}</span>}
    </label>
  );
}

function inputStyle() {
  return {
    background: 'var(--color-bt-card)',
    border: '1px solid var(--color-bt-border)',
    borderRadius: 10, padding: '9px 12px',
    fontSize: 14, color: 'var(--color-bt-text)',
    outline: 'none', fontFamily: 'var(--font-sans)',
    width: '100%', boxSizing: 'border-box',
  };
}

function VALIDATION_BORDER(state) {
  switch (state) {
    case 'checking': return 'var(--color-bt-warning)';
    case 'match':    return 'var(--color-bt-accent)';
    case 'invite':   return 'var(--color-bt-warning)';
    case 'invalid':  return 'var(--color-bt-danger)';
    default:         return 'var(--color-bt-border)';
  }
}

function ValidationFeedback({ state, email }) {
  if (state === 'idle' || !email) return null;
  const COPY = {
    checking: { tone: 'warning', icon: null,        title: 'Checking BuddyTrip…',  body: '' },
    match:    { tone: 'accent',  icon: 'check',     title: 'Already on BuddyTrip', body: `${email} is an active account — they'll be in the trip the moment you save.` },
    invite:   { tone: 'warning', icon: 'send',      title: "We'll send an invite", body: `No account at ${email}. We'll email an invite link when you save; they become Active when they sign up.` },
    invalid:  { tone: 'danger',  icon: 'x',         title: "That email doesn't look right", body: 'Or leave it blank — they\'ll be a placeholder.' },
  };
  const c = COPY[state];
  const colorMap = {
    accent:  { fg: 'var(--color-bt-accent)',  bg: 'var(--color-bt-accent-faint)',  border: 'var(--color-bt-accent-border)' },
    warning: { fg: 'var(--color-bt-warning)', bg: 'var(--color-bt-warning-faint)', border: 'var(--color-bt-warning-border)' },
    danger:  { fg: 'var(--color-bt-danger)',  bg: 'var(--color-bt-danger-faint)',  border: 'var(--color-bt-danger-border)' },
  };
  const t = colorMap[c.tone];
  return (
    <div style={{
      marginTop: 4,
      background: t.bg, border: `1px solid ${t.border}`,
      borderRadius: 10, padding: '8px 12px',
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      {c.icon && (
        <span style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          background: t.fg, color: '#0a0e1a',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><ExIcon name={c.icon} size={12} strokeWidth={2.5} color="currentColor"/></span>
      )}
      {!c.icon && (
        <span style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${t.fg}`, borderTopColor: 'transparent',
          animation: 'btSpin 1s linear infinite',
        }}/>
      )}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: t.fg }}>{c.title}</div>
        {c.body && <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 2, lineHeight: 1.4 }}>{c.body}</div>}
      </div>
    </div>
  );
}

function RoleControl({ role, status }) {
  // For Active users: show a single button — "Make organizer" or "Remove organizer".
  // For non-Active users: show why this is currently disabled.
  // Owner is never editable here (owner is set via trip ownership, not crew row).
  if (role === 'Owner') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 10,
        background: 'rgba(217,119,6,0.08)',
        border: '1px solid rgba(251,191,36,0.20)',
      }}>
        <span style={{
          padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 500,
          border: '1px solid var(--color-bt-owner)', color: 'var(--color-bt-owner)',
        }}>Owner</span>
        <span style={{ fontSize: 12, color: 'var(--color-bt-text)' }}>
          Created the trip. Change ownership from Trip settings.
        </span>
      </div>
    );
  }

  if (status !== 'active') {
    return (
      <div style={{
        padding: '10px 12px', borderRadius: 10,
        background: 'var(--color-bt-card-raised)',
        border: '1px dashed var(--color-bt-border)',
        fontSize: 12, color: 'var(--color-bt-text-dim)', lineHeight: 1.5,
      }}>
        <strong style={{ color: 'var(--color-bt-text)', fontWeight: 600 }}>Member (default).</strong> Only Active BuddyTrip users can be promoted to Organizer — this person becomes eligible once they sign up.
      </div>
    );
  }

  if (role === 'Organizer') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', borderRadius: 10,
          background: 'var(--color-bt-accent-faint)',
          border: '1px solid var(--color-bt-accent-border)',
        }}>
          <span style={{
            width: 26, height: 26, borderRadius: 8, flexShrink: 0,
            background: 'var(--color-bt-accent)', color: '#0a0e1a',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><ExIcon name="check" size={14} strokeWidth={2.5} color="currentColor"/></span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-bt-accent)' }}>Organizer</div>
            <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', marginTop: 2, lineHeight: 1.4 }}>
              Can edit destination, dates, lodging, agenda, receipts, and the crew. Cannot delete the trip or transfer ownership.
            </div>
          </div>
        </div>
        <button style={{ ...ghostBtn(), color: 'var(--color-bt-danger)', borderColor: 'var(--color-bt-danger-border)' }}>
          Remove organizer status
        </button>
      </div>
    );
  }

  // Active Member — only show the elevate action. No "Member" label needed; they just are.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button style={{
        ...baseBtn(),
        background: 'var(--color-bt-card-raised)',
        color: 'var(--color-bt-accent)',
        border: '1px solid var(--color-bt-accent-border)',
        justifyContent: 'flex-start', padding: '10px 12px',
      }}>
        <ExIcon name="check" size={14} color="currentColor"/>
        Make organizer
      </button>
      <div style={{ fontSize: 11, color: 'var(--color-bt-text-dim)', lineHeight: 1.4 }}>
        Organizers get 95% of owner permissions — useful for delegating trip planning.
      </div>
    </div>
  );
}

function ROLE_STATUS_DESC(role, status) {
  const r = role === 'Owner' ? 'Owner · ' : role === 'Organizer' ? 'Organizer · ' : '';
  const s = status === 'active' ? 'Active' : status === 'invited' ? 'Invited' : 'Placeholder (no email)';
  return r + s;
}

// ── Button styles (inline) ─────────────────────────────────────────────
function baseBtn() {
  return {
    all: 'unset', cursor: 'pointer', textAlign: 'center', boxSizing: 'border-box',
    padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  };
}
function primaryBtn()   { return { ...baseBtn(), flex: 1, background: 'var(--color-bt-accent)', color: '#0d1f1a' }; }
function ghostBtn()     { return { ...baseBtn(), background: 'transparent', color: 'var(--color-bt-text-dim)', border: '0.5px solid var(--color-bt-border)' }; }
function secondaryBtn() { return { ...baseBtn(), background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-text)', border: '0.5px solid var(--color-bt-border)' }; }
function dangerBtn()    { return { ...baseBtn(), background: 'transparent', color: 'var(--color-bt-danger)', border: '0.5px solid var(--color-bt-danger-border)' }; }

// ════════════════════════════════════════════════════════════════════════
// DESKTOP — crew page with drawer overlay (showing live email validation)
// ════════════════════════════════════════════════════════════════════════
function CrewDesktopWithDrawer() {
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <CrewDesktop />
      {/* Dim the page behind the drawer */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', pointerEvents: 'none' }}/>
      {/* The drawer itself, anchored right */}
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 420 }}>
        <MemberEditor
          mode="drawer"
          initial={{
            name: 'Llama',                       // trip nickname the owner gave him
            accountName: 'Jason Doherty',        // his actual BT account name
            email: 'jason@doherty.dev',
            role: 'Organizer',                   // showing what an Organizer looks like in this view
            status: 'active',
            validation: 'match',
          }}
        />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// MOBILE — crew page with bottom sheet (active Member with Make-organizer affordance)
// ════════════════════════════════════════════════════════════════════════
function CrewMobileWithSheet() {
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <CrewMobile />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }}/>
      {/* Bottom sheet */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '82%' }}>
        <MemberEditor
          mode="sheet"
          initial={{
            name: 'Buddy Banks',
            accountName: 'Robert Banks',
            email: 'buddy@banks.co',
            role: 'Member',
            status: 'active',
            validation: 'match',
          }}
        />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// VALIDATION-STATES PANEL — all four email validation outcomes
// ════════════════════════════════════════════════════════════════════════
function ValidationStatesPanel() {
  const states = [
    { state: 'checking', email: 'mike@kosko.io',     role: 'Member',    status: 'invited' },
    { state: 'match',    email: 'tom@stilson.com',   role: 'Member',    status: 'active'  },
    { state: 'invite',   email: 'ryan@lynch.net',    role: 'Member',    status: 'invited' },
    { state: 'invalid',  email: 'lol@@@',            role: 'Member',    status: 'placeholder' },
  ];
  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'auto',
      background: 'var(--color-bt-card)',
      border: '1px solid var(--color-bt-border)', borderRadius: 16,
      padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-bt-accent)' }}>Live email validation</div>
        <h3 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700 }}>Four states, no hidden behavior</h3>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-bt-text-dim)', lineHeight: 1.5, maxWidth: 560 }}>
          As you type an email, the field border + helper card change to show what'll happen on save. No surprises after submit.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {states.map((s) => (
          <div key={s.state} style={{
            background: 'var(--color-bt-card-raised)', borderRadius: 12, padding: 14,
            border: '1px solid var(--color-bt-border)',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)' }}>
              {s.state}
            </div>
            <input value={s.email} readOnly style={{
              ...inputStyle(),
              fontFamily: 'var(--font-mono)',
              borderColor: VALIDATION_BORDER(s.state),
              cursor: 'default',
            }}/>
            <ValidationFeedback state={s.state} email={s.email}/>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, {
  CrewDesktopWithDrawer, CrewMobileWithSheet, ValidationStatesPanel,
});

// Add btSpin keyframe via style tag if not present
if (typeof document !== 'undefined' && !document.getElementById('btSpinKF')) {
  const s = document.createElement('style');
  s.id = 'btSpinKF';
  s.textContent = '@keyframes btSpin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
}
