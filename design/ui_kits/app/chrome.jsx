// BuddyTrip UI kit — chrome.jsx
// TopNav, BottomNav (global + in-trip), TripTabBar.

function BTTopNav({ title = 'BuddyTrip', unread = 0, onBack, onSettings, switcherActive = false, onSwitcher, avatar = 'ZG' }) {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 40,
      height: 56, padding: '0 18px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'var(--color-bt-nav-bg)',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      borderBottom: '1px solid var(--color-bt-subtle-border)',
    }}>
      {onBack ? (
        <button onClick={onBack} aria-label="Back" style={{ all: 'unset', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-bt-text)', fontWeight: 500, fontSize: 14, cursor: 'pointer' }}>
          <BTIcon name="arrow-left" size={18} />
          {title}
        </button>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 18, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--color-bt-text)' }}>
          <BTFlag size={18} />
          {title}
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button aria-label="My trips" onClick={onSwitcher}
          style={{
            all: 'unset', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: switcherActive ? 8 : 8,
            background: switcherActive ? 'var(--color-bt-accent-faint)' : 'transparent',
            color: switcherActive ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)',
          }}><BTIcon name="layout-grid" size={18} strokeWidth={1.75} /></button>

        <button aria-label="Notifications"
          style={{
            all: 'unset', cursor: 'pointer', position: 'relative',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 9999, color: 'var(--color-bt-text-dim)',
          }}>
          <BTIcon name="bell" size={20} strokeWidth={1.5} />
          {unread > 0 && (
            <span style={{
              position: 'absolute', top: 4, right: 4, height: 16, minWidth: 16, padding: '0 3px',
              borderRadius: 9999, background: 'var(--color-bt-warning)', color: '#fff',
              fontSize: 10, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>{unread > 9 ? '9+' : unread}</span>
          )}
        </button>

        {onSettings && (
          <button aria-label="Settings" onClick={onSettings}
            style={{
              all: 'unset', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 9999, color: 'var(--color-bt-text-dim)',
            }}><BTIcon name="settings" size={18} /></button>
        )}

        <BTAvatar name={avatar} size={28} />
      </div>
    </header>
  );
}

// In-trip horizontal tab bar (Home / Crew / Lodging / Agenda / Receipts / Compete)
const TRIP_TABS = [
  { id: 'home',     label: 'Home',     icon: 'home' },
  { id: 'crew',     label: 'Crew',     icon: 'users' },
  { id: 'lodging',  label: 'Lodging',  icon: 'hotel' },
  { id: 'schedule', label: 'Agenda',   icon: 'calendar' },
  { id: 'expenses', label: 'Receipts', icon: 'dollar' },
  { id: 'comp',     label: 'Compete',  icon: 'trophy' },
];

function BTTripTabBar({ active, onChange, badges = {} }) {
  return (
    <div style={{
      display: 'flex', borderBottom: '1px solid var(--color-bt-border)',
      background: 'var(--color-bt-base)',
    }}>
      {TRIP_TABS.map(t => {
        const isActive = t.id === active;
        const dot = badges[t.id];
        return (
          <button key={t.id} onClick={() => onChange(t.id)}
            style={{
              all: 'unset', cursor: 'pointer', flex: 1,
              padding: '10px 0', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              color: isActive ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)',
              borderBottom: isActive ? '2px solid var(--color-bt-accent)' : '2px solid transparent',
            }}>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <BTIcon name={t.icon} size={16} strokeWidth={1.75} />
              {dot && (
                <span style={{
                  position: 'absolute', top: -3, right: -5, width: 7, height: 7, borderRadius: '50%',
                  background: dot === 'warning' ? 'var(--color-bt-warning)' : 'var(--color-bt-accent)',
                }}/>
              )}
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Global bottom nav (Dashboard / New trip / Live) — pinned, safe-area aware
function BTBottomNav({ active, onTap, kind = 'global' }) {
  const globalItems = [
    { id: 'home', label: 'Home',     icon: 'home' },
    { id: 'new',  label: 'New trip', icon: 'plus' },
    { id: 'live', label: 'Live',     icon: 'activity' },
  ];
  const tripItems = [
    { id: 'trip-home', label: 'Trip Home', icon: 'home' },
    { id: 'live',      label: 'Live',      icon: 'activity' },
  ];
  const items = kind === 'trip' ? tripItems : globalItems;
  return (
    <nav style={{
      background: 'var(--color-bt-card)', borderTop: '1px solid var(--color-bt-border)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      <div style={{ display: 'flex' }}>
        {items.map(i => {
          const a = i.id === active;
          return (
            <button key={i.id} onClick={() => onTap?.(i.id)}
              style={{
                all: 'unset', cursor: 'pointer', flex: 1,
                padding: '10px 0', textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                color: a ? 'var(--color-bt-accent)' : 'var(--color-bt-text-dim)',
              }}>
              <BTIcon name={i.icon} size={22} strokeWidth={1.75} />
              <span style={{ fontSize: 10, fontWeight: 500 }}>{i.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

Object.assign(window, { BTTopNav, BTBottomNav, BTTripTabBar, TRIP_TABS });
