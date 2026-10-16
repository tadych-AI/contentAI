import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, plError, plN, fmtDate, fetchAll } from '../supabase.js'
import { loadDicts, indexStatus, searchCatalog, refreshIndex, importProducts, hasFilter, MAX_RESULTS } from '../catalog.js'
import Picker from '../components/Picker.jsx'
import DrainLoader from '../components/DrainLoader.jsx'

const PAGE = 100
const EMPTY = { brands: [], keywords: '', exclude: '', categoryIds: [], kind: 'all' }
const KINDS = { all: 'wszystkie', single: 'pojedyncze (bez wariantów BL)', variant: 'warianty BL (mają produkt nadrzędny)', bundle: 'zestawy (bundle)' }

// Marka w pickerze: „m:<id>” = producent z BL, zwykły tekst = marka wpisana ręcznie (szukana tylko w nazwie)
const brandsFromPicker = (vals, manById) => vals.map(v => String(v).startsWith('m:')
  ? { id: Number(String(v).slice(2)), name: manById.get(Number(String(v).slice(2)))?.name || '' }
  : { id: null, name: String(v) })
const pickerFromBrands = brands => (brands || []).map(b => b.id ? `m:${b.id}` : b.name)

export default function Catalog({ profile }) {
  const canSync = ['akceptujacy', 'admin'].includes(profile?.role)
  const [dicts, setDicts] = useState(null)
  const [status, setStatus] = useState(null)
  const [imported, setImported] = useState(new Set())
  const [sets, setSets] = useState([])
  const [error, setError] = useState('')

  const [brandVals, setBrandVals] = useState([])
  const [f, setF] = useState(EMPTY)
  const [setId, setSetId] = useState('')
  const [res, setRes] = useState(null)
  const [searching, setSearching] = useState(false)
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState(new Set())

  const [sync, setSync] = useState(null)        // { busy, progress, ok, error }
  const [imp, setImp] = useState(null)          // { busy, progress, result, error }

  async function loadAll() {
    try {
      const [d, s, prods, sl] = await Promise.all([
        loadDicts(), indexStatus(),
        fetchAll('products', 'baselinker_product_id'),
        supabase.from('import_selections').select('*').order('name'),
      ])
      if (sl.error) throw sl.error
      setDicts(d); setStatus(s); setImported(new Set(prods.map(p => p.baselinker_product_id))); setSets(sl.data || [])
    } catch (e) { setError(plError(e.message)) }
  }
  useEffect(() => { loadAll() }, [])

  const filters = useMemo(() => dicts ? { ...f, brands: brandsFromPicker(brandVals, dicts.manById) } : f, [f, brandVals, dicts])

  async function search() {
    setSearching(true); setError(''); setPage(0); setSel(new Set()); setImp(null)
    try { setRes(await searchCatalog(filters, dicts.categories)) }
    catch (e) { setError(plError(e.message)) }
    setSearching(false)
  }

  async function doSync(full) {
    setSync({ busy: true, progress: 'Start…' })
    try {
      const r = await refreshIndex({ full, onProgress: p => setSync(s => ({ ...s, progress: p })) })
      setSync({ ok: `Indeks odświeżony: ${plN(r.list.count, 'produkt', 'produkty', 'produktów')} w katalogu, ${plN(r.list.categories, 'kategoria', 'kategorie', 'kategorii')}, ${plN(r.list.manufacturers, 'producent', 'producentów', 'producentów')}; dociągnięto dane dla ${plN(r.enriched, 'produktu', 'produktów', 'produktów')}.${r.list.removed ? ` Usunięto z indeksu ${r.list.removed} (nie ma ich już w BL).` : ''}`, warnings: r.list.warnings || [] })
      await loadAll()
    } catch (e) { setSync({ error: e.message }) }
  }

  async function doImport() {
    const ids = [...sel]
    setImp({ busy: true, progress: 'Start…' })
    try {
      const result = await importProducts(ids, { onProgress: p => setImp(s => ({ ...s, progress: p })) })
      setImp({ result })
      if (setId) await supabase.from('import_selections').update({ last_run_at: new Date().toISOString() }).eq('id', setId)
      setImported(new Set([...imported, ...ids]))
      setSel(new Set())
    } catch (e) { setImp({ error: e.message }) }
  }

  function loadSet(id) {
    setSetId(id)
    const s = sets.find(x => x.id === id)
    if (!s) return
    const fl = { ...EMPTY, ...(s.filters || {}) }
    setBrandVals(pickerFromBrands(fl.brands)); setF({ ...fl, brands: [] }); setRes(null)
  }
  async function saveSet() {
    const current = sets.find(x => x.id === setId)
    const name = (prompt('Nazwa zestawu (np. „Besco – wanny”):', current?.name || '') || '').trim()
    if (!name) return
    const row = { name, filters: { ...filters } }
    const q = current && current.name === name ? supabase.from('import_selections').update(row).eq('id', current.id).select().single()
      : supabase.from('import_selections').insert({ ...row, created_by: profile?.id }).select().single()
    const { data, error } = await q
    if (error) { setError(plError(error.message)); return }
    setSets(s => [...s.filter(x => x.id !== data.id), data].sort((a, b) => a.name.localeCompare(b.name, 'pl'))); setSetId(data.id)
  }

  if (error && !dicts) return <section className="page"><h1>Katalog Baselinkera</h1><p className="error">{error}</p></section>
  if (!dicts) return <section className="page"><DrainLoader /></section>

  const manOptions = dicts.manufacturers.map(m => ({ value: `m:${m.bl_manufacturer_id}`, label: m.name }))
  const catOptions = dicts.categories.map(c => ({ value: c.bl_category_id, label: c.path || c.name }))
  const rows = res?.rows || []
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.ceil(rows.length / PAGE)
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allOnPage = pageRows.length > 0 && pageRows.every(r => sel.has(r.bl_id))
  const newCount = rows.filter(r => !imported.has(r.bl_id)).length
  const enrichedPct = status.total ? Math.round(100 * status.enriched / status.total) : 0

  return (
    <section className="page">
      <h1>Katalog Baselinkera</h1>
      <p className="muted lead">Wybierz, które produkty z katalogu trafią do aplikacji. Filtr działa na lekkim indeksie całego katalogu; pełne dane (opis, parametry, zdjęcia) pobierane są tylko dla importowanych produktów.</p>

      <div className="panel">
        <h2>Indeks katalogu</h2>
        <div className="status-row">
          <span className="stat">W indeksie: <strong>{status.total.toLocaleString('pl-PL')}</strong></span>
          <span className="stat">Z kategorią i producentem: <strong>{status.enriched.toLocaleString('pl-PL')}</strong> ({enrichedPct}%)</span>
          <span className="stat">Ostatnia synchronizacja: <strong>{fmtDate(status.syncedAt)}</strong></span>
        </div>
        {canSync ? (
          <div className="filter-actions">
            <button className="btn" disabled={sync?.busy} onClick={() => doSync(false)}>{status.total ? 'Odśwież indeks' : 'Zbuduj indeks'}</button>
            {status.total > 0 && <button className="btn ghost" disabled={sync?.busy} onClick={() => confirm('Pełne odświeżenie pobiera kategorię i producenta dla wszystkich produktów (kilka minut). Kontynuować?') && doSync(true)}>Pełne odświeżenie</button>}
            <span className="muted small">„Odśwież” dociąga kategorię i producenta tylko dla nowych produktów. „Pełne” – dla wszystkich (gdy w BL zmieniano kategorie lub producentów).</span>
          </div>
        ) : <p className="muted small">Indeks odświeża akceptujący lub admin.</p>}
        {sync?.busy && <p className="progress-line" role="status">{sync.progress}</p>}
        {sync?.ok && <p className="ok" role="status">{sync.ok}</p>}
        {sync?.warnings?.map(w => <p key={w} className="hint">{w}</p>)}
        {sync?.error && <p className="error" role="alert">{sync.error}</p>}
        {status.total > 0 && status.enriched < status.total && !sync?.busy && <p className="hint">Część produktów nie ma jeszcze kategorii i producenta – filtr marki działa dla nich tylko po nazwie, a filtr kategorii ich nie obejmie.</p>}
      </div>

      {status.total > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Wybór produktów</h2>
            <span className="row-form">
              <select value={setId} onChange={e => loadSet(e.target.value)} aria-label="Zapisane zestawy">
                <option value="">— zapisane zestawy —</option>
                {sets.map(s => <option key={s.id} value={s.id}>{s.name}{s.last_run_at ? ` · import ${fmtDate(s.last_run_at)}` : ''}</option>)}
              </select>
            </span>
          </div>
          <div className="filter-grid">
            <Picker label="Marka" help="Producent w Baselinkerze lub marka w nazwie produktu. Możesz wpisać markę spoza listy." options={manOptions} value={brandVals} onChange={setBrandVals} placeholder="np. Besco" allowFree freeLabel={v => `Szukaj „${v}” w nazwie`} />
            <Picker label="Kategoria Baselinkera" help="Razem z podkategoriami." options={catOptions} value={f.categoryIds} onChange={v => setF({ ...f, categoryIds: v.map(Number) })} placeholder="np. Wanny" />
            <label>Słowa kluczowe w nazwie<span className="field-help">Wszystkie muszą wystąpić; oddziel przecinkami, np. „wanna, wolnostojąca”.</span>
              <input value={f.keywords} onChange={e => setF({ ...f, keywords: e.target.value })} onKeyDown={e => e.key === 'Enter' && hasFilter(filters) && search()} />
            </label>
            <label>Wyklucz słowa<span className="field-help">Produkty z tymi słowami w nazwie odpadną, np. „obudowa, nóżki”.</span>
              <input value={f.exclude} onChange={e => setF({ ...f, exclude: e.target.value })} onKeyDown={e => e.key === 'Enter' && hasFilter(filters) && search()} />
            </label>
            <label>Rodzaj produktu
              <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <div className="filter-actions">
            <button className="btn" disabled={searching || !hasFilter(filters)} onClick={search}>{searching ? 'Szukanie…' : 'Pokaż produkty'}</button>
            <button className="btn ghost" disabled={!hasFilter(filters)} onClick={saveSet}>Zapisz jako zestaw</button>
            <button className="link-dark" onClick={() => { setF(EMPTY); setBrandVals([]); setSetId(''); setRes(null); setSel(new Set()) }}>Wyczyść</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}

      {res && (
        <div className="panel">
          {res.tooMany ? (
            <p className="hint">Filtr pasuje do {res.total.toLocaleString('pl-PL')} produktów – limit podglądu to {MAX_RESULTS.toLocaleString('pl-PL')}. Dodaj markę, kategorię albo słowo kluczowe.</p>
          ) : rows.length === 0 ? (
            <p className="muted">Brak produktów dla tego filtra.</p>
          ) : (<>
            <div className="result-head">
              <span className="summary"><strong>{plN(rows.length, 'produkt', 'produkty', 'produktów')}</strong> · {plN(newCount, 'nowy', 'nowe', 'nowych')} · {plN(rows.length - newCount, 'już w aplikacji', 'już w aplikacji', 'już w aplikacji')}</span>
              <span className="row-form">
                <button className="link-dark" onClick={() => setSel(new Set(rows.map(r => r.bl_id)))}>Zaznacz wszystkie ({rows.length})</button>
                {newCount > 0 && newCount < rows.length && <button className="link-dark" onClick={() => setSel(new Set(rows.filter(r => !imported.has(r.bl_id)).map(r => r.bl_id)))}>Tylko nowe ({newCount})</button>}
                {sel.size > 0 && <button className="link-dark" onClick={() => setSel(new Set())}>Odznacz</button>}
              </span>
            </div>
            <div className="table-wrap">
              <table className="compact">
                <thead><tr>
                  <th className="check"><input type="checkbox" checked={allOnPage} aria-label="Zaznacz produkty na tej stronie" onChange={() => setSel(s => { const n = new Set(s); pageRows.forEach(r => allOnPage ? n.delete(r.bl_id) : n.add(r.bl_id)); return n })} /></th>
                  <th>SKU</th><th>Nazwa</th><th>Kategoria</th><th>Producent</th><th>Typ</th><th>W aplikacji</th>
                </tr></thead>
                <tbody>
                  {pageRows.map(r => {
                    const cat = dicts.catById.get(r.bl_category_id), man = dicts.manById.get(r.bl_manufacturer_id)
                    return (
                      <tr key={r.bl_id} className={imported.has(r.bl_id) ? 'in-app' : ''}>
                        <td className="check"><input type="checkbox" checked={sel.has(r.bl_id)} onChange={() => toggle(r.bl_id)} aria-label={`Zaznacz ${r.sku || r.bl_id}`} /></td>
                        <td className="mono">{r.sku || <span className="hint-inline">brak SKU</span>}</td>
                        <td className="name">{r.name}</td>
                        <td className="path">{cat ? (cat.path || cat.name) : '—'}</td>
                        <td>{man?.name || '—'}</td>
                        <td>{r.is_bundle ? <span className="tag info">zestaw</span> : r.parent_id ? <span className="tag">wariant</span> : ''}</td>
                        <td>{imported.has(r.bl_id) ? <span className="tag okt">tak</span> : ''}</td>
                      </tr>
                    )
                  })}
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
          </>)}
        </div>
      )}

      {(sel.size > 0 || imp) && (
        <div className="import-bar" role="region" aria-label="Import">
          <div>
            {imp?.busy ? <span className="progress-line" role="status">Import: {imp.progress}</span>
              : imp?.result ? (
                <div className="import-result" role="status">
                  <span className="ok">Zaimportowano {plN(imp.result.imported, 'produkt', 'produkty', 'produktów')} ({imp.result.created} nowych, {imp.result.updated} zaktualizowanych).</span> <Link to="/produkty" className="link-dark">Zobacz w aplikacji →</Link>
                  {imp.result.skipped.length > 0 && <ul>{imp.result.skipped.slice(0, 20).map((s, i) => <li key={i} className="hint">{s.sku || s.bl_id}: {s.reason}</li>)}{imp.result.skipped.length > 20 && <li className="muted">…i {imp.result.skipped.length - 20} więcej</li>}</ul>}
                </div>
              ) : imp?.error ? <span className="error" role="alert">{imp.error}</span>
              : <span><strong>Zaznaczono {plN(sel.size, 'produkt', 'produkty', 'produktów')}</strong>{[...sel].some(id => imported.has(id)) && <span className="muted small"> · produkty już zaimportowane zostaną odświeżone danymi z BL</span>}</span>}
          </div>
          {sel.size > 0 && !imp?.busy && <button className="btn" onClick={doImport}>Importuj zaznaczone ({sel.size})</button>}
        </div>
      )}
    </section>
  )
}
