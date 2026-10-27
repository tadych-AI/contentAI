import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import JobOverlay from './JobOverlay.jsx'
import BathTub from './BathTub.jsx'
import { jobActivity, activeJobCount } from '../jobs.js'
import { supabase, ROLE_LABELS } from '../supabase.js'

// Menu w kolejności pracy. Kolejne moduły (fakty, frazy, szablony, weryfikacja, publikacja, eMAG) dochodzą etapami.
const GROUPS = [
  { label: 'Start', items: [{ to: '/', label: 'Dashboard', end: true }] },
  { label: 'Produkty', items: [{ to: '/katalog', label: 'Katalog Baselinkera' }, { to: '/produkty', label: 'Produkty w aplikacji' }, { to: '/rodziny', label: 'Rodziny produktów' }] },
  { label: 'Przygotowanie treści', items: [{ to: '/fakty', label: 'Fakty', badge: 'facts' }, { to: '/frazy', label: 'Frazy kluczowe' }, { to: '/grafiki', label: 'Grafiki' }, { to: '/szablony', label: 'Szablony opisów' }] },
  { label: 'Opisy', items: [{ to: '/opisy', label: 'Opisy', badge: 'review' }] },
  { label: 'Publikacja', items: [{ to: '/tytuly', label: 'Tytuły eMAG' }, { to: '/emag', label: 'Eksport eMAG' }] },
  { label: 'Konfiguracja', admin: true, items: [{ to: '/uzytkownicy', label: 'Użytkownicy' }] },
]

export default function Layout({ profile }) {
  const [working, setWorking] = useState(activeJobCount())
  const loc = useLocation()
  // licznik faktów czekających na akceptację (odświeżany przy zmianie ekranu)
  const [pending, setPending] = useState(0)
  const [review, setReview] = useState(0)
  useEffect(() => {
    supabase.from('kb_facts').select('id', { count: 'exact', head: true }).eq('status', 'do_akceptacji').then(r => setPending(r.count || 0))
    supabase.from('descriptions').select('id', { count: 'exact', head: true }).eq('status', 'do_weryfikacji').then(r => setReview(r.count || 0))
  }, [loc.pathname, loc.search])
  useEffect(() => { const f = e => setWorking(e.detail); jobActivity.addEventListener('change', f); return () => jobActivity.removeEventListener('change', f) }, [])
  // menu na wąskim ekranie: zwijane, zamyka się po przejściu do innego widoku
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [loc.pathname])
  // tabele: etykiety kolumn przy komórkach (na wąskim ekranie wiersz tabeli staje się kartą)
  const mainRef = useRef(null)
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const label = () => {
      for (const table of el.querySelectorAll('table:not(.no-resp)')) {
        const heads = [...(table.tHead?.rows[0]?.cells || [])].map(th => th.textContent.trim())
        for (const tr of table.tBodies[0]?.rows || []) {
          let col = 0
          for (const td of tr.cells) {
            if (td.colSpan > 1) { td.classList.add('full'); col += td.colSpan; continue }
            const h = heads[col++] || ''
            if (h && td.getAttribute('data-label') !== h) td.setAttribute('data-label', h)
          }
        }
      }
      // tabela, która nie mieści się w szerokości swojej karty, przechodzi w układ kart (wiersz = karta); sprawdzamy od najbardziej zagnieżdżonych
      const tables = [...el.querySelectorAll('table:not(.no-resp)')].reverse()
      for (const table of tables) {
        const box = table.parentElement
        if (!box) continue
        const was = table.hasAttribute('data-cards')
        if (was) table.removeAttribute('data-cards')
        const fits = table.getBoundingClientRect().width <= box.clientWidth + 1 && window.innerWidth > 640
        if (!fits) table.setAttribute('data-cards', '')
      }
    }
    label()
    let t = null
    const schedule = () => { clearTimeout(t); t = setTimeout(label, 60) }
    const mo = new MutationObserver(schedule)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => { mo.disconnect(); ro.disconnect(); clearTimeout(t) }
  }, [])
  return (
    <div className={'shell' + (menuOpen ? ' menu-open' : '')}>
      <aside className="sidebar">
        <button className="menu-toggle" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen(o => !o)}>{menuOpen ? 'Zamknij' : 'Menu'}</button>
        <div className="brand">
          <BathTub size="xs" animate={!!working} className="brand-tub" />
          <span className="sr-only" role="status">{working ? 'Trwa zadanie' : ''}</span>
          <span className="brand-text" title={working ? `Trwa zadanie (${working})` : undefined}><span className="brand-name">TadychAI</span><span className="brand-sub">ContentStudio</span></span>
        </div>
        <nav id="main-nav" aria-label="Główna nawigacja">
          {GROUPS.filter(g => !g.admin || profile?.role === 'admin').map(g => (
            <div key={g.label} className="nav-group">
              <span className="nav-group-label">{g.label}</span>
              {g.items.map(n => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>{n.label}{n.badge === 'facts' && pending > 0 && <span className="nav-badge" aria-label={`${pending} faktów czeka na akceptację`}>{pending}</span>}{n.badge === 'review' && review > 0 && <span className="nav-badge" aria-label={`${review} opisów czeka na weryfikację`}>{review}</span>}</NavLink>
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
      <main className="content" ref={mainRef}>
        <Outlet />
      </main>
      <JobOverlay />
    </div>
  )
}
