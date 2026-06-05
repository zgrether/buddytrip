// explorations-atoms.jsx — shared helpers for explorations.html

// ── Inline lucide-style icons (stroke 1.75) ─────────────────────────────
const EX_ICON = {
  'map-pin': <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
  'calendar': <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
  'users': <><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></>,
  'user-plus': <><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M19 8v6M22 11h-6"/></>,
  'plus': <path d="M12 5v14M5 12h14"/>,
  'send': <path d="M22 2 11 13M22 2 15 22l-4-9-9-4z"/>,
  'check': <path d="M20 6 9 17l-5-5"/>,
  'sparkles': <><path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4Z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z"/></>,
  'home': <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/></>,
  'bell': <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>,
  'chevron-right': <path d="m9 6 6 6-6 6"/>,
  'arrow-left': <path d="M19 12H5M12 19l-7-7 7-7"/>,
  'compass': <><circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/></>,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6"/>,
  'mail': <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
  'rotate-ccw': <><path d="M3 12a9 9 0 1 0 2.6-6.3L3 8"/><path d="M3 3v5h5"/></>,
  'x': <path d="M18 6 6 18M6 6l12 12"/>,
  'help-circle': <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
  'flag': <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></>,
  'trophy': <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></>,
  'chevron-up': <path d="m18 15-6-6-6 6"/>,
  'chevron-down': <path d="m6 9 6 6 6-6"/>,
  'building': <><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/></>,
  'dollar-sign': <><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
  'settings': <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></>,
  'grid': <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></>,
  'message-circle': <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>,
  'maximize': <><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></>,
  'clock': <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
  'utensils': <><path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2M5 11v11M11 2v20M21 15V2a5 5 0 0 0-3 4.5V11a2 2 0 0 0 2 2h1z"/></>,
  'pin': <><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></>,
  'megaphone': <><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></>,
  'sticky-note': <><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2z"/><path d="M15 21v-4a2 2 0 0 1 2-2h4"/></>,
  'newspaper': <><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/></>,
  'pinned-note': <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v3"/><path d="M10.5 10.5a1.5 1.5 0 0 0 .9 1.4l-.4.6h2l-.4-.6a1.5 1.5 0 0 0 .9-1.4z"/></>,
  'clipboard-list': <><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/></>,
  'bulletin': <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h6"/><circle cx="16.5" cy="14.5" r="1.5"/></>,
  'play': <path d="M6 3v18l15-9z" fill="currentColor" stroke="none"/>,
  'wifi': <><path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></>,
  'key-round': <><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></>,
  'lock': <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  'hash': <><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></>,
  'pencil': <><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></>,
  'more-horizontal': <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>,
  'eye-off': <><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></>,
  'copy': <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  'door': <><path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.562z"/></>,
  'image': <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></>,
  'list-ordered': <><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></>,
  'type': <><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></>,
  'plane': <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>,
  'car': <><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></>,
  'alert-triangle': <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
  'trash': <><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></>,
  'bug': <><path d="m8 2 1.88 1.88M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Z"/><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/></>,
  'lightbulb': <><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/></>,
  'heart': <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z"/>,
  'info': <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></>,
  'external-link': <><path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
  'shield': <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>,
  'tag': <><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></>,
  'paperclip': <path d="m16 6-8.5 8.5a2.12 2.12 0 1 0 3 3L20 7a4.24 4.24 0 1 0-6-6L4.5 10.5"/>,
  'megaphone-off': <><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></>,
  'maximize2': <><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></>,
  'bold': <><path d="M14 12a4 4 0 0 0 0-8H6v8"/><path d="M15 20a4 4 0 0 0 0-8H6v8Z"/></>,
  'italic': <><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></>,
  'link': <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
  'at-sign': <><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></>,
  'grip-vertical': <><circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/></>,
  'dice': <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/></>,
};
function ExIcon({ name, size = 16, color = "currentColor", strokeWidth = 1.75, style }) {
  const p = EX_ICON[name];
  if (!p) return <span style={{ width: size, height: size, display: 'inline-block', ...style }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>{p}</svg>
  );
}

// ── Plate scaffolding for the mark cards ────────────────────────────────
function MarkPlate({ children }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'var(--color-bt-card)',
      border: '1px solid var(--color-bt-border)',
      borderRadius: 14,
      padding: '20px 18px 16px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      boxShadow: 'var(--shadow-card)',
    }}>{children}</div>
  );
}
function Lockup({ mark }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      fontSize: 18, fontWeight: 600, letterSpacing: '0.06em',
      color: 'var(--color-bt-text)',
    }}>
      {mark}
      BuddyTrip
    </div>
  );
}
function Note({ children }) {
  return (
    <div style={{
      marginTop: 'auto', textAlign: 'center', fontSize: 11,
      color: 'var(--color-bt-text-dim)', lineHeight: 1.4,
    }}>{children}</div>
  );
}

// ── Phone & window shells (for screen-level explorations) ───────────────
function PhoneShell({ children }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#0a0e1a', borderRadius: 28,
      border: '6px solid #1a2233',
      overflow: 'hidden', position: 'relative',
      boxShadow: '0 30px 60px -20px rgba(0,0,0,0.5)',
    }}>
      <div style={{ height: 24, background: '#0a0e1a' }} />
      <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 90, height: 22, background: '#000', borderRadius: 14 }} />
      <div style={{ background: 'var(--color-bt-base)', color: 'var(--color-bt-text)', height: 'calc(100% - 24px)' }}>{children}</div>
    </div>
  );
}
function WindowShell({ children, wide = false, url = 'buddytrip-app.vercel.app/trips/bbmi-26/crew' }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#0a0e1a', borderRadius: 12,
      border: '1px solid var(--color-bt-border)',
      overflow: 'hidden', boxShadow: '0 30px 60px -20px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        height: 32, background: 'rgba(0,0,0,0.3)',
        borderBottom: '1px solid var(--color-bt-subtle-border)',
        display: 'flex', alignItems: 'center', padding: '0 12px', gap: 6,
      }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }}/>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }}/>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }}/>
        <span style={{ marginLeft: 'auto', marginRight: 'auto', fontSize: 11, color: 'var(--color-bt-text-dim)', fontFamily: 'var(--font-mono)' }}>
          {url}
        </span>
      </div>
      <div style={{ background: 'var(--color-bt-base)', color: 'var(--color-bt-text)', height: 'calc(100% - 32px)' }}>{children}</div>
    </div>
  );
}

// ── Small UI building blocks reused across screens ──────────────────────
function ExTopNav({ title = 'BuddyTrip', wide = false }) {
  return (
    <header style={{
      height: 52, padding: '0 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'var(--color-bt-nav-bg)', backdropFilter: 'blur(14px)',
      borderBottom: '1px solid var(--color-bt-subtle-border)',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 16, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--color-bt-text)' }}>
        <svg width="16" height="16" viewBox="0 0 100 100"><path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="var(--color-bt-accent)"/></svg>
        {title}
      </span>
      {wide && (
        <nav style={{ display: 'flex', gap: 22, fontSize: 13, color: 'var(--color-bt-text-dim)' }}>
          <span>Home</span><span style={{ color: 'var(--color-bt-accent)' }}>Crew</span><span>Lodging</span><span>Agenda</span><span>Receipts</span><span>Compete</span>
        </nav>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-bt-text-dim)' }}>
        <ExIcon name="bell" size={16} />
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-bt-card-raised)', color: 'var(--color-bt-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, border: '1.5px solid var(--color-bt-border)' }}>ZG</span>
      </span>
    </header>
  );
}

function StatChip({ label, value, accent }) {
  return (
    <div style={{
      flex: 1, padding: '10px 12px', borderRadius: 10,
      background: 'rgba(148,163,184,0.04)',
      border: '1px solid rgba(148,163,184,0.08)',
    }}>
      <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-bt-text-dim)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: accent || 'var(--color-bt-text)' }}>{value}</div>
    </div>
  );
}

Object.assign(window, { ExIcon, MarkPlate, Lockup, Note, PhoneShell, WindowShell, ExTopNav, StatChip });
