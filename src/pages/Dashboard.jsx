import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, plError, fmtDate } from '../supabase.js'
import { runJob } from '../jobs.js'
import { indexStatus } from '../catalog.js'
import DrainLoader from '../components/DrainLoader.jsx'

export default function Dashboard({ profile }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [ping, setPing] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const [idx, prod, bundles, flagged, ch, fp, fa] = await Promise.all([
          indexStatus(),
          supabase.from('products').select('id', { count: 'exact', head: true }),
          supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_bundle', true),
          supabase.from('products').select('id', { count: 'exact', head: true }).neq('import_flags', '[]'),
          supabase.from('channels').select('code, marketplace, language, baselinker_source_id, active'),
          supabase.from('kb_facts').select('id', { count: 'exact', head: true }).eq('status', 'do_akceptacji'),
          supabase.from('kb_facts').select('id', { count: 'exact', head: true }).eq('status', 'zatwierdzony'),
        ])
        const err = [prod, bundles, flagged, ch, fp, fa].find(x => x.error)?.error
        if (err) throw err
        setData({ idx, products: prod.count || 0, bundles: bundles.count || 0, flagged: flagged.count || 0, channels: ch.data || [], factsPending: fp.count || 0, factsApproved: fa.count || 0 })
      } catch (e) { setError(plError(e.message)) }
    })()
  }, [])

  async function testN8n() {
    setPing({ busy: true })
    try { const r = await runJob('ping', {}, { timeoutSec: 30 }); setPing({ ok: `Połączenie działa · n8n odpowiedział ${fmtDate(r?.n8n_time)}` }) }
    catch (e) { setPing({ error: e.message }) }
  }

  if (error) return <section className="page"><h1>Dashboard</h1><p className="error">{error}</p></section>
  if (!data) return <section className="page"><DrainLoader /></section>

  const { idx } = data
  return (
    <section className="page">
      <h1>Dashboard</h1>
      <p className="muted lead">Witaj{profile?.full_name ? `, ${profile.full_name}` : ''}. Etap 2: import z Baselinkera i fakty z opisów.</p>

      <div className="grid">
        <div className="panel">
          <h2>Katalog Baselinkera</h2>
          <dl className="facts">
            <dt>Produkty w indeksie</dt><dd>{idx.total.toLocaleString('pl-PL')}</dd>
            <dt>Z kategorią i producentem</dt><dd>{idx.enriched.toLocaleString('pl-PL')}</dd>
            <dt>Ostatnia synchronizacja</dt><dd>{fmtDate(idx.syncedAt)}</dd>
          </dl>
          <Link className="link-dark" to="/katalog">{idx.total ? 'Wybierz produkty do importu →' : 'Zbuduj indeks katalogu →'}</Link>
        </div>
        <div className="panel">
          <h2>Produkty w aplikacji</h2>
          <dl className="facts">
            <dt>Zaimportowane</dt><dd>{data.products.toLocaleString('pl-PL')}</dd>
            <dt>w tym zestawy (bundle)</dt><dd>{data.bundles.toLocaleString('pl-PL')}</dd>
            <dt>Z uwagami do danych</dt><dd>{data.flagged.toLocaleString('pl-PL')}</dd>
          </dl>
          <Link className="link-dark" to="/produkty">Przejdź do produktów →</Link>
        </div>
      </div>

      <div className="panel">
        <h2>Fakty</h2>
        <dl className="facts">
          <dt>Do akceptacji</dt><dd>{data.factsPending.toLocaleString('pl-PL')}</dd>
          <dt>Zatwierdzone</dt><dd>{data.factsApproved.toLocaleString('pl-PL')}</dd>
        </dl>
        <Link className="link-dark" to="/fakty">{data.factsPending ? 'Przejdź do akceptacji →' : 'Przejdź do faktów →'}</Link>
      </div>

      <div className="panel">
        <h2>Kanały</h2>
        <ul className="plain">
          {data.channels.map(c => (
            <li key={c.code}><strong>{c.marketplace} {c.language.toUpperCase()}</strong> · {c.active ? 'aktywny' : 'wyłączony'} · integracja BL: {c.baselinker_source_id || <span className="hint-inline">nieustawiona (potrzebna przy publikacji)</span>}</li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h2>Połączenie z n8n</h2>
        <p className="muted">Test pełnego obiegu: aplikacja → n8n → baza.</p>
        <button className="btn ghost" disabled={ping?.busy} onClick={testN8n}>{ping?.busy ? 'Sprawdzanie…' : 'Sprawdź połączenie'}</button>
        {ping?.ok && <p className="ok" role="status">{ping.ok}</p>}
        {ping?.error && <p className="error" role="alert">{ping.error}</p>}
      </div>
    </section>
  )
}
