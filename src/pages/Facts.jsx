import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, plError, plN, fetchAll } from '../supabase.js'
import { LEVEL_LABEL, STATUS_LABEL } from '../facts.js'
import DrainLoader from '../components/DrainLoader.jsx'

const PAGE = 50
const COLS = 'id, content, level, status, flags, source, source_excerpt, confirmed_by, product_id, brand_id, created_at, approved_at, products(sku, name, brand_id), brands(name)'
const isFlagged = f => (f.flags || []).length > 0

function FactCard({ f, brandName, canApprove, selected, onSelect, onChange }) {
  const [text, setText] = useState(f.content)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => setText(f.content), [f.content])
  const dirty = text.trim() !== f.content

  async function patch(values) {
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('kb_facts').update(values).eq('id', f.id).select(COLS).single()
    setBusy(false)
    if (error) { setErr(plError(error.message)); return }
    onChange(data)
  }
  const save = extra => patch({ ...(dirty ? { content: text.trim() } : {}), ...extra })
  const toBrand = () => confirm('Przenieść fakt na poziom marki? Trafi do wszystkich produktów tej marki.') && patch({ level: 'marka', brand_id: f.brand_id || f.products?.brand_id, product_id: null })

  return (
    <article className="fact">
      <div>
        <label className="check" style={{ marginBottom: 6 }}><input type="checkbox" checked={selected} onChange={onSelect} /> <span className="muted small">zaznacz</span></label>
        <textarea value={text} rows={Math.max(2, Math.ceil(text.length / 90))} onChange={e => setText(e.target.value)} aria-label="Treść faktu" />
        <div className="fact-meta">
          <span className="tag">{LEVEL_LABEL[f.level]}</span>
          {f.level === 'produkt' && f.products && <Link to={`/fakty?produkt=${f.product_id}`} className="link-dark">{f.products.sku} · {f.products.name}</Link>}
          {f.level === 'marka' && <span><strong>{f.brands?.name || brandName(f.brand_id)}</strong>{f.confirmed_by > 1 && <span className="muted"> · potwierdzony w {plN(f.confirmed_by, 'produkcie', 'produktach', 'produktach')}</span>}</span>}
        </div>
        {isFlagged(f) && <ul className="notes">{f.flags.map((x, i) => <li key={i} className="tag warn">{x}</li>)}</ul>}
        {f.source_excerpt && <details style={{ marginTop: 8 }}><summary className="muted small">Fragment opisu z Baselinkera</summary><p className="small" style={{ margin: '4px 0 0' }}>„{f.source_excerpt}”</p></details>}
        {err && <p className="error">{err}</p>}
      </div>
      <div className="fact-side">
        <p className="small muted" style={{ margin: 0 }}>Status: <strong>{STATUS_LABEL[f.status]}</strong></p>
        <div className="fact-actions" style={{ flexWrap: 'wrap' }}>
          {f.status !== 'zatwierdzony' && <button className="btn" disabled={busy || !canApprove || !text.trim()} onClick={() => save({ status: 'zatwierdzony' })}>{dirty ? 'Zapisz i zatwierdź' : 'Zatwierdź'}</button>}
          {f.status !== 'odrzucony' && <button className="btn ghost danger" disabled={busy || !canApprove} onClick={() => save({ status: 'odrzucony' })}>Odrzuć</button>}
          {f.status !== 'do_akceptacji' && <button className="btn ghost" disabled={busy || !canApprove} onClick={() => save({ status: 'do_akceptacji' })}>Cofnij do akceptacji</button>}
        </div>
        {dirty && <button className="link-dark" disabled={busy || !text.trim()} onClick={() => save({})}>Zapisz zmianę treści</button>}
        {f.level === 'produkt' && f.products?.brand_id && <button className="link-dark" disabled={busy} onClick={toBrand}>To fakt o całej marce →</button>}
        {!canApprove && <p className="muted small" style={{ marginTop: 10 }}>Zatwierdza akceptujący lub admin. Możesz poprawić treść.</p>}
      </div>
    </article>
  )
}

export default function Facts({ profile }) {
  const canApprove = ['akceptujacy', 'admin'].includes(profile?.role)
  const [params, setParams] = useSearchParams()
  const productId = params.get('produkt') || ''
  const [status, setStatus] = useState('do_akceptacji')
  const [level, setLevel] = useState('')
  const [brand, setBrand] = useState('')
  const [flagged, setFlagged] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [brands, setBrands] = useState(null)
  const [product, setProduct] = useState(null)
  const [res, setRes] = useState(null)
  const [counts, setCounts] = useState({})
  const [sel, setSel] = useState(new Set())
  const [bulk, setBulk] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { fetchAll('brands', 'id, name').then(b => setBrands(b.sort((x, y) => x.name.localeCompare(y.name, 'pl')))).catch(e => setError(plError(e.message))) }, [])
  useEffect(() => {
    if (!productId) { setProduct(null); return }
    supabase.from('products').select('id, sku, name, brand_id').eq('id', productId).single().then(({ data }) => setProduct(data))
  }, [productId])

  // filtr wspólny dla listy i liczników zakładek; fakty produktu = jego fakty + fakty jego marki
  const build = (qb, withStatus = true) => {
    if (withStatus) qb = qb.eq('status', status)
    if (productId) qb = product?.brand_id ? qb.or(`product_id.eq.${productId},and(level.eq.marka,brand_id.eq.${product.brand_id})`) : qb.eq('product_id', productId)
    if (level) qb = qb.eq('level', level)
    if (brand) qb = qb.eq('brand_id', brand)
    if (flagged === 'tak') qb = qb.neq('flags', '[]')
    if (flagged === 'nie') qb = qb.eq('flags', '[]')
    if (q.trim()) qb = qb.ilike('content', `%${q.trim()}%`)
    return qb
  }

  async function load() {
    if (productId && product === null) return
    setError('')
    try {
      const list = await build(supabase.from('kb_facts').select(COLS, { count: 'exact' })).order('level').order('created_at', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1)
      if (list.error) throw list.error
      const cs = await Promise.all(Object.keys(STATUS_LABEL).map(st => build(supabase.from('kb_facts').select('id', { count: 'exact', head: true }), false).eq('status', st)))
      setCounts(Object.fromEntries(Object.keys(STATUS_LABEL).map((st, i) => [st, cs[i].count || 0])))
      setRes({ rows: list.data || [], total: list.count || 0 })
    } catch (e) { setError(plError(e.message)) }
  }
  useEffect(() => { load() }, [status, level, brand, flagged, productId, product, page])
  useEffect(() => { setPage(0); setSel(new Set()) }, [status, level, brand, flagged, productId])

  const brandName = useMemo(() => id => brands?.find(b => b.id === id)?.name || '', [brands])

  async function bulkSet(newStatus, ids) {
    setBulk({ busy: true })
    const { error } = await supabase.from('kb_facts').update({ status: newStatus }).in('id', ids)
    setBulk(error ? { error: plError(error.message) } : { ok: `${STATUS_LABEL[newStatus]}: ${plN(ids.length, 'fakt', 'fakty', 'faktów')}.` })
    setSel(new Set()); load()
  }

  if (!brands) return <section className="page">{error ? <p className="error">{error}</p> : <DrainLoader />}</section>
  const rows = res?.rows || []
  const pages = Math.ceil((res?.total || 0) / PAGE)
  const cleanOnPage = rows.filter(f => !isFlagged(f)).map(f => f.id)

  return (
    <section className="page">
      <h1>Fakty</h1>
      <p className="muted lead">Fakty wyciągnięte z opisów Baselinkera. Do opisów na marketplace trafiają wyłącznie fakty zatwierdzone (plus parametry produktu). Fakty marki zatwierdzasz raz – dotyczą wszystkich produktów marki.</p>

      {product && (
        <div className="panel">
          <div className="panel-head"><h2 style={{ margin: 0 }}>{product.sku} · {product.name}</h2><button className="link-dark" onClick={() => setParams({})}>Pokaż wszystkie fakty</button></div>
          <p className="muted small" style={{ margin: '6px 0 0' }}>Fakty tego produktu i fakty jego marki.</p>
        </div>
      )}

      <div className="tabs" role="tablist">
        {Object.entries(STATUS_LABEL).map(([k, v]) => <button key={k} role="tab" aria-selected={status === k} className={'tab' + (status === k ? ' on' : '')} onClick={() => setStatus(k)}>{v}<span className="count">{(counts[k] || 0).toLocaleString('pl-PL')}</span></button>)}
      </div>

      <div className="panel">
        <div className="filter-grid">
          <label>Szukaj w treści<input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && (setPage(0), load())} placeholder="Enter, aby szukać" /></label>
          <label>Poziom<select value={level} onChange={e => setLevel(e.target.value)}><option value="">wszystkie</option><option value="marka">marka</option><option value="produkt">produkt</option></select></label>
          {!productId && <label>Marka<select value={brand} onChange={e => setBrand(e.target.value)}><option value="">wszystkie</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          <label>Uwagi AI<select value={flagged} onChange={e => setFlagged(e.target.value)}><option value="">wszystkie</option><option value="tak">tylko z uwagami</option><option value="nie">bez uwag</option></select></label>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {!res ? <DrainLoader /> : rows.length === 0 ? (
        <div className="panel empty"><p className="muted">Brak faktów w tym widoku.</p>{counts.do_akceptacji === 0 && counts.zatwierdzony === 0 && <Link className="link-dark" to="/produkty">Wyciągnij fakty z produktów →</Link>}</div>
      ) : (<>
        <div className="result-head">
          <span className="summary"><strong>{plN(res.total, 'fakt', 'fakty', 'faktów')}</strong>{pages > 1 && <span className="muted"> · strona {page + 1} z {pages}</span>}</span>
          <span className="row-form">
            <button className="link-dark" onClick={() => setSel(new Set(rows.map(f => f.id)))}>Zaznacz na stronie ({rows.length})</button>
            {cleanOnPage.length > 0 && cleanOnPage.length < rows.length && <button className="link-dark" onClick={() => setSel(new Set(cleanOnPage))}>Tylko bez uwag ({cleanOnPage.length})</button>}
            {sel.size > 0 && <button className="link-dark" onClick={() => setSel(new Set())}>Odznacz</button>}
          </span>
        </div>
        {rows.map(f => (
          <FactCard key={f.id} f={f} brandName={brandName} canApprove={canApprove} selected={sel.has(f.id)}
            onSelect={() => setSel(s => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })}
            onChange={() => load()} />
        ))}
        {pages > 1 && (
          <div className="pager">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>← Poprzednia</button>
            <span>Strona {page + 1} z {pages}</span>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Następna →</button>
          </div>
        )}
      </>)}

      {(sel.size > 0 || bulk) && (
        <div className="import-bar" role="region" aria-label="Akcje na zaznaczonych faktach">
          <div>
            {bulk?.busy ? <span className="progress-line">Zapisywanie…</span> : bulk?.ok ? <span className="ok">{bulk.ok}</span> : bulk?.error ? <span className="error">{bulk.error}</span>
              : <strong>Zaznaczono {plN(sel.size, 'fakt', 'fakty', 'faktów')}</strong>}
            {!canApprove && sel.size > 0 && <span className="muted small"> · zatwierdza akceptujący lub admin</span>}
          </div>
          <span className="row-form">
            {sel.size > 0 && status !== 'zatwierdzony' && <button className="btn" disabled={!canApprove || bulk?.busy} onClick={() => bulkSet('zatwierdzony', [...sel])}>Zatwierdź zaznaczone</button>}
            {sel.size > 0 && status !== 'odrzucony' && <button className="btn ghost danger" disabled={!canApprove || bulk?.busy} onClick={() => bulkSet('odrzucony', [...sel])}>Odrzuć zaznaczone</button>}
            {bulk && !bulk.busy && <button className="link-dark" onClick={() => setBulk(null)}>Zamknij</button>}
          </span>
        </div>
      )}
    </section>
  )
}
