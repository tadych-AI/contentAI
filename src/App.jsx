import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase, configMissing } from './supabase.js'
import Layout from './components/Layout.jsx'
import DrainLoader from './components/DrainLoader.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Catalog from './pages/Catalog.jsx'
import Products from './pages/Products.jsx'
import Facts from './pages/Facts.jsx'
import Families from './pages/Families.jsx'
import Review from './pages/Review.jsx'
import Templates from './pages/Templates.jsx'
import Keywords from './pages/Keywords.jsx'
import Emag from './pages/Emag.jsx'
import Media from './pages/Media.jsx'
import Account from './pages/Account.jsx'
import Users from './pages/Users.jsx'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (configMissing) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    supabase.from('profiles').select('id, email, full_name, role').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data))
  }, [session])

  if (configMissing) {
    return (
      <main className="center-screen">
        <div className="panel narrow">
          <h1>Brakuje konfiguracji</h1>
          <p>Strona nie zna adresu bazy. Dodaj w repozytorium GitHub zmienne <code>VITE_SUPABASE_ANON_KEY</code> i <code>VITE_N8N_WEBHOOK_URL</code> (Settings → Secrets and variables → Actions → Variables), a potem uruchom wdrożenie ponownie.</p>
        </div>
      </main>
    )
  }
  if (session === undefined) return <main className="center-screen"><DrainLoader /></main>
  if (!session) return <Login />

  const admin = profile?.role === 'admin'
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout profile={profile} />}>
          <Route index element={<Dashboard profile={profile} />} />
          <Route path="katalog" element={<Catalog profile={profile} />} />
          <Route path="produkty" element={<Products profile={profile} />} />
          <Route path="rodziny" element={<Families profile={profile} />} />
          <Route path="fakty" element={<Facts profile={profile} />} />
          <Route path="frazy" element={<Keywords profile={profile} />} />
          <Route path="grafiki" element={<Media profile={profile} />} />
          <Route path="szablony" element={<Templates profile={profile} />} />
          <Route path="opisy" element={<Review profile={profile} />} />
          <Route path="opisy/:id" element={<Review profile={profile} />} />
          <Route path="emag" element={<Emag profile={profile} />} />
          <Route path="uzytkownicy" element={!profile ? null : admin ? <Users /> : <Navigate to="/" />} />
          <Route path="konto" element={<Account profile={profile} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
