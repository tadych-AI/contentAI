import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, plError, plN, fmtDate, fetchAll } from '../supabase.js'
import { loadDicts } from '../catalog.js'
import { extractFacts, factCounts, factState } from '../facts.js'
import DrainLoader from '../components/DrainLoader.jsx'

const PAGE = 100
const COLS = 'id, baselinker_product_id, sku, ean, name, bl_category_id, brand_id, bl_parent_id, is_bundle, features, images, import_flags, synced_at, source_hash, facts_extracted_at, facts_source_hash'
const FACT_FILTERS = { all: 'wszystkie', brak: 'fakty nie wyciągnięte', do_akceptacji: 'fakty do akceptacji', nieaktualne: 'opis w BL się zmienił', gotowe: 'fakty zatwierdzone' }

// Opis z BL to HTML – w podglądzie pokazujemy sam tekst (bez stylów i skryptów)
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(String(html || '').replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, m => m + '\n'), 'text/html')
  doc.querySelectorAll('script, style').forEach(n => n.remove())
  return (doc.body.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim()
}

function Detail({ p, dicts }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('products').select('description_pl, description_extra, extra_fields, bundle_items, weight, dimensions').eq('id', p.id).single()
      if (error) { setErr(plError(error.message)); return }
      let bundle = []
      if (data.bundle_items?.length) {
        const ids = data.bundle_items.map(b => b.bl_id)
        const { data: cat } = await supabase.from('bl_catalog').select('bl_id, sku, name').in('bl_id', ids)
        bundle = data.bundle_items.map(b => ({ ...b, ...(cat || []).find(c => c.bl_id === b.bl_id) }))
      }
      setD({ ...data, bundle })
    })()
  }, [p.id])
  if (err) return <p className="error">{err}</p>
  if (!d) return <DrainLoader inline label="Wczytywanie…" />
  const feats = Object.entries(p.features || {})
  const extras = Object.entries(d.description_extra || {}).filter(([, v]) => String(v || '').trim())
  return (
    <div className="detail">
      <div>
        <h3>Opis z Baselinkera (tekst)</h3>
        <div className="desc">{htmlToText(d.description_pl) || <span className="hint-inline">brak opisu</span>}</div>
        {extras.map(([k, v]) => <Fragment key={k}><h3 style={{ marginTop: 14 }}>{k}</h3><div className="desc">{htmlToText(v)}</div></Fragment>)}
      </div>
      <div>
        {(p.images || []).length > 0 && <><h3>Zdjęcia ({p.images.length})</h3><div className="thumbs">{p.images.map(im => <a key={im.url} href={im.url} target="_blank" rel="noreferrer"><img src={im.url} alt={`Zdjęcie ${im.position}`} loading="lazy" /></a>)}</div></>}
        {d.bundle.length > 0 && <><h3>Skład zestawu</h3><table className="kv"><tbody>{d.bundle.map(b => <tr key={b.bl_id}><td>{b.quantity} × {b.sku || b.bl_id}</td><td>{b.name || <span className="muted">poza indeksem</span>}</td></tr>)}</tbody></table></>}
        <h3 style={{ marginTop: 14 }}>Parametry ({feats.length})</h3>
        {feats.length ? <table className="kv"><tbody>{feats.map(([k, v]) => <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>)}</tbody></table> : <p className="hint">Brak parametrów w BL.</p>}
        <table className="kv" style={{ marginTop: 10 }}><tbody>
          <tr><td>EAN</td><td>{p.ean || '—'}</td></tr>
          <tr><td>Waga</td><td>{d.weight ?? '—'}</td></tr>
          <tr><td>ID w BL</td><td className="mono">{p.baselinker_product_id}{p.bl_parent_id ? ` (nadrzędny ${p.bl_parent_id})` : ''}</td></tr>
          <tr><td>Kategoria</td><td>{dicts.catById.get(p.bl_category_id)?.path || '—'}</td></tr>
          <tr><td>Pobrano z BL</td><td>{fmtDate(p.synced_at)}</td></tr>
        </tbody></table>
      </div>
    </div>
  )
}

export default function Products({ profile }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [cat, setCat] = useState('')
  const [kind, setKind] = useState('all')
  const [flagged, setFlagged] = useState(false)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(null)
  const [factF, setFactF] = useState('all')
  const [sel, setSel] = useState(new Set())
  const [fx, setFx] = useState(null)   // { busy, progress, result, error }

  async function load() {
    try {
      const [products, brands, dicts, counts] = await Promise.all([fetchAll('products', COLS, x => x.order('name')), fetchAll('brands', 'id, name'), loadDicts(), factCounts()])
      setData({ products, brands: new Map(brands.map(b => [b.id, b.name])), dicts, counts })
    } catch (e) { setError(plError(e.message)) }
  }
  useEffect(() => { load() }, [])

  async function runFacts() {
    const list = data.products.filter(p => sel.has(p.id))
    setFx({ busy: true, progress: 'Start…' })
    try {
      const result = await extractFacts(list, { onProgress: pr => setFx(s => ({ ...s, progress: pr })) })
      setFx({ result }); setSel(new Set()); await load()
    } catch (e) { setFx({ error: e.message }) }
  }

  const list = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.products.filter(p =>
      (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || (p.ean || '').includes(s)) &&
      (!brand || p.brand_id === brand) && (!cat || String(p.bl_category_id) === cat) &&
      (kind === 'all' || (kind === 'bundle' ? p.is_bundle : kind === 'variant' ? !!p.bl_parent_id : !p.is_bundle && !p.bl_parent_id)) &&
      (!flagged || (p.import_flags || []).length > 0) &&
      (factF === 'all' || factState(p, data.counts).key === factF))
  }, [data, q, brand, cat, kind, flagged, factF])
  useEffect(() => setPage(0), [q, brand, cat, kind, flagged, factF])

  if (error) return <section className="page"><h1>Produkty w aplikacji</h1><p className="error">{error}</p></section>
  if (!data) return <section className="page"><DrainLoader /></section>
  if (!data.products.length) return (
    <section className="page">
      <h1>Produkty w aplikacji</h1>
      <div className="panel empty"><p>Nie ma jeszcze zaimportowanych produktów.</p><Link className="link-dark" to="/katalog">Wybierz produkty w katalogu Baselinkera →</Link></div>
    </section>
  )

  const usedBrands = [...new Set(data.products.map(p => p.brand_id).filter(Boolean))].map(id => [id, data.brands.get(id) || '?']).sort((a, b) => a[1].localeCompare(b[1], 'pl'))
  const usedCats = [...new Set(data.products.map(p => p.bl_category_id).filter(Boolean))].map(id => [String(id), data.dicts.catById.get(id)?.path || String(id)]).sort((a, b) => a[1].localeCompare(b[1], 'pl'))
  const pageRows = list.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.ceil(list.length / PAGE)

  return (
    <section className="page">
      <h1>Produkty w aplikacji</h1>
      <p className="muted lead">Produkty pobrane z Baselinkera. Zaznacz produkty i wyciągnij z ich opisów fakty – po akceptacji staną się jedynym źródłem treści opisów na marketplace.</p>
      <div className="panel">
        <div className="filter-grid">
          <label>Szukaj (nazwa, SKU, EAN)<input value={q} onChange={e => setQ(e.target.value)} /></label>
          <label>Marka<select value={brand} onChange={e => setBrand(e.target.value)}><option value="">wszystkie</option>{usedBrands.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          <label>Kategoria<select value={cat} onChange={e => setCat(e.target.value)}><option value="">wszystkie</option>{usedCats.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          <label>Rodzaj<select value={kind} onChange={e => setKind(e.target.value)}><option value="all">wszystkie</option><option value="single">pojedyncze</option><option value="variant">warianty BL</option><option value="bundle">zestawy (bundle)</option></select></label>
          <label>Fakty<select value={factF} onChange={e => setFactF(e.target.value)}>{Object.entries(FACT_FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="check span-2" style={{ marginTop: 14 }}><input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} /> Tylko z uwagami do danych</label>
        </div>
      </div>
      <div className="panel">
        <div className="result-head">
          <p className="summary" style={{ margin: 0 }}><strong>{plN(list.length, 'produkt', 'produkty', 'produktów')}</strong>{list.length !== data.products.length && <span className="muted"> z {data.products.length}</span>}</p>
          <span className="row-form">
            <button className="link-dark" onClick={() => setSel(new Set(list.map(p => p.id)))}>Zaznacz wszystkie z listy ({list.length})</button>
            {sel.size > 0 && <button className="link-dark" onClick={() => setSel(new Set())}>Odznacz</button>}
          </span>
        </div>
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th className="check"><input type="checkbox" aria-label="Zaznacz produkty na tej stronie" checked={pageRows.length > 0 && pageRows.every(p => sel.has(p.id))} onChange={e => setSel(s => { const n = new Set(s); pageRows.forEach(p => e.target.checked ? n.add(p.id) : n.delete(p.id)); return n })} /></th><th>SKU</th><th>Nazwa</th><th>Marka</th><th>Kategoria</th><th className="num">Parametry</th><th className="num">Zdjęcia</th><th>Fakty</th><th>Uwagi do danych</th></tr></thead>
            <tbody>
              {pageRows.map(p => (
                <Fragment key={p.id}>
                  <tr>
                    <td className="check"><input type="checkbox" checked={sel.has(p.id)} aria-label={`Zaznacz ${p.sku}`} onChange={() => setSel(s => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })} /></td>
                    <td className="mono">{p.sku}</td>
                    <td className="name"><button className="row-toggle" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>{p.name}</button>{p.is_bundle && <span className="tag info gap">zestaw</span>}{p.bl_parent_id && <span className="tag gap">wariant</span>}</td>
                    <td>{data.brands.get(p.brand_id) || '—'}</td>
                    <td className="path">{data.dicts.catById.get(p.bl_category_id)?.path || '—'}</td>
                    <td className="num">{Object.keys(p.features || {}).length}</td>
                    <td className="num">{(p.images || []).length}</td>
                    <td>{(() => { const st = factState(p, data.counts); return st.key === 'brak' ? <span className="muted small">{st.label}</span> : <Link to={`/fakty?produkt=${p.id}`} className={`tag ${st.key === 'gotowe' ? 'okt' : st.key === 'nieaktualne' ? 'warn' : 'info'}`}>{st.label}</Link> })()}</td>
                    <td className="flags">{(p.import_flags || []).join(' · ')}</td>
                  </tr>
                  {open === p.id && <tr className="detail-row"><td colSpan={9}><Detail p={p} dicts={data.dicts} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="pager">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>← Poprzednia</button>
            <span>Strona {page + 1} z {pages}</span>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Następna →</button>
          </div>
        )}
      </div>
      {(sel.size > 0 || fx) && (
        <div className="import-bar" role="region" aria-label="Fakty">
          <div>
            {fx?.busy ? <span className="progress-line" role="status">Wyciąganie faktów: {fx.progress}</span>
              : fx?.result ? (
                <div className="import-result" role="status">
                  <span className="ok">Przetworzono {plN(fx.result.done, 'produkt', 'produkty', 'produktów')}: {fx.result.facts} faktów produktu, {fx.result.brand_facts} nowych faktów marki{fx.result.covered ? `, ${fx.result.covered} potwierdzeń istniejących` : ''}{fx.result.flagged ? `; ${fx.result.flagged} z uwagami` : ''}.</span> <Link to="/fakty" className="link-dark">Przejdź do akceptacji →</Link>
                  {fx.result.failed.length > 0 && <ul>{fx.result.failed.map((f, i) => <li key={i} className="error">{f.sku}: {f.error}</li>)}</ul>}
                </div>
              ) : fx?.error ? <span className="error" role="alert">{fx.error}</span>
              : <span><strong>Zaznaczono {plN(sel.size, 'produkt', 'produkty', 'produktów')}</strong> <span className="muted small">· ok. 15–30 s na produkt; ponowne wyciągnięcie zastępuje fakty oczekujące na akceptację</span></span>}
          </div>
          {sel.size > 0 && !fx?.busy && <span className="row-form"><button className="btn" onClick={runFacts}>Wyciągnij fakty ({sel.size})</button>{fx && <button className="link-dark" onClick={() => setFx(null)}>Zamknij</button>}</span>}
          {!sel.size && fx && !fx.busy && <button className="link-dark" onClick={() => setFx(null)}>Zamknij</button>}
        </div>
      )}
    </section>
  )
}
