import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import JobOverlay from './JobOverlay.jsx'
import { jobActivity, activeJobCount } from '../jobs.js'
import { supabase, ROLE_LABELS } from '../supabase.js'

// Menu w kolejności pracy. Kolejne moduły (fakty, frazy, szablony, weryfikacja, publikacja, eMAG) dochodzą etapami.
const GROUPS = [
  { label: 'Start', items: [{ to: '/', label: 'Dashboard', end: true }] },
  { label: 'Produkty', items: [{ to: '/katalog', label: 'Katalog Baselinkera' }, { to: '/produkty', label: 'Produkty w aplikacji' }] },
  { label: 'Przygotowanie treści', items: [{ to: '/fakty', label: 'Fakty', badge: 'facts' }] },
  { label: 'Konfiguracja', admin: true, items: [{ to: '/uzytkownicy', label: 'Użytkownicy' }] },
]

export default function Layout({ profile }) {
  const [working, setWorking] = useState(activeJobCount())
  const loc = useLocation()
  // licznik faktów czekających na akceptację (odświeżany przy zmianie ekranu)
  const [pending, setPending] = useState(0)
  useEffect(() => { supabase.from('kb_facts').select('id', { count: 'exact', head: true }).eq('status', 'do_akceptacji').then(r => setPending(r.count || 0)) }, [loc.pathname, loc.search])
  useEffect(() => { const f = e => setWorking(e.detail); jobActivity.addEventListener('change', f); return () => jobActivity.removeEventListener('change', f) }, [])
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className={working ? 'brand-mark flowing' : 'brand-mark'} aria-hidden="true"><i /><i /><i /><i /><i /></span>
          <span className="sr-only" role="status">{working ? 'Trwa zadanie' : ''}</span>
          <span title={working ? `Trwa zadanie (${working})` : undefined}>ContentAI</span>
        </div>
        <nav aria-label="Główna nawigacja">
          {GROUPS.filter(g => !g.admin || profile?.role === 'admin').map(g => (
            <div key={g.label} className="nav-group">
              <span className="nav-group-label">{g.label}</span>
              {g.items.map(n => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>{n.label}{n.badge === 'facts' && pending > 0 && <span className="nav-badge" aria-label={`${pending} faktów czeka na akceptację`}>{pending}</span>}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/konto" className="me">
            <span className="me-name">{profile?.full_name || profile?.email || '…'}</span>
            <span className="me-role">{ROLE_LABELS[profile?.role] || ''}</span>
          </NavLink>
          <button className="link-btn" onClick={() => supabase.auth.signOut()}>Wyloguj</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
      <JobOverlay />
    </div>
  )
}
