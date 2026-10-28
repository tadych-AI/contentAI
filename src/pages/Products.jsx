import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, plError, plN, fmtDate, fetchAll } from '../supabase.js'
import { loadDicts, importProducts } from '../catalog.js'
import DrainLoader from '../components/DrainLoader.jsx'
import { createFamily, addToFamily, suggestName } from '../familyOps.js'

const PAGE = 100
// etykieta opisu z BL: opis dodatkowy 1–4 oraz opisy z innych kanałów i języków (np. description|de|allegro_123)
const descLabel = k => {
  const [f, lang, integ] = String(k).split('|')
  const base = /^description_extra(\d)$/.test(f) ? `Opis dodatkowy ${f.slice(-1)}` : 'Opis'
  const tail = [lang && lang.toUpperCase(), integ && integ.replace(/_\d+$/, '')].filter(Boolean).join(', ')
  return tail ? `${base} – ${tail}` : base
}
const COLS = 'id, baselinker_product_id, sku, ean, name, bl_category_id, brand_id, bl_parent_id, is_bundle, features, images, import_flags, synced_at, source_hash, family_id, bundle_items'

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
        bundle = data.bundle_items.map(b => ({ ...(cat || []).find(c => c.bl_id === b.bl_id), ...b }))
      }
      setD({ ...data, bundle })
    })()
  }, [p.id])
  const [giftMsg, setGiftMsg] = useState(null)
  async function toggleGift(blId) {
    const items = (d.bundle_items || []).map(b => b.bl_id === blId ? { ...b, gift: !b.gift, gift_source: 'ręcznie' } : b)
    const { error } = await supabase.from('products').update({ bundle_items: items }).eq('id', p.id)
    if (error) { setGiftMsg({ type: 'error', text: plError(error.message) }); return }
    setD(x => ({ ...x, bundle_items: items, bundle: x.bundle.map(b => b.bl_id === blId ? { ...b, gift: !b.gift, gift_source: 'ręcznie' } : b) }))
    setGiftMsg({ type: 'ok', text: 'Zapisano. Zmiana obejmie nowo wyciągane fakty i generowane opisy.' })
  }
  if (err) return <p className="error">{err}</p>
  if (!d) return <DrainLoader inline label="Wczytywanie…" />
  const feats = Object.entries(p.features || {})
  const extras = Object.entries(d.description_extra || {}).filter(([, v]) => String(v || '').trim())
  return (
    <div className="detail">
      <div>
        <h3>Opis z Baselinkera (tekst)</h3>
        <div className="desc">{htmlToText(d.description_pl) || <span className="hint-inline">brak opisu</span>}</div>
        {extras.map(([k, v]) => <Fragment key={k}><h3 style={{ marginTop: 14 }}>{descLabel(k)}</h3><div className="desc">{htmlToText(v)}</div></Fragment>)}
      </div>
      <div>
        {(p.images || []).length > 0 && <><h3>Zdjęcia ({p.images.length})</h3><div className="thumbs">{p.images.map(im => <a key={im.url} href={im.url} target="_blank" rel="noreferrer"><img src={im.url} alt={`Zdjęcie ${im.position}`} loading="lazy" /></a>)}</div></>}
        {d.bundle.length > 0 && <><h3>Skład zestawu</h3>
          <p className="muted small" style={{ margin: '0 0 6px' }}>Dane składników (parametry, opis) są pobierane z Baselinkera przy imporcie i trafiają do faktów oraz opisu zestawu. Gratis jest podkreślany w opisie.</p>
          <table className="kv"><tbody>{d.bundle.map(b => <tr key={b.bl_id}><td>{b.quantity} × {b.sku || b.bl_id}</td>
            <td>{b.name || <span className="muted">poza indeksem</span>}{b.description === undefined && b.features === undefined && <span className="hint-inline small"> · brak danych składnika – zaimportuj zestaw ponownie</span>}</td>
            <td><label className="check small" title={b.gift_source ? `rozpoznano: ${b.gift_source}` : ''}><input type="checkbox" checked={!!b.gift} onChange={() => toggleGift(b.bl_id)} /> gratis</label></td></tr>)}</tbody></table>
          {giftMsg && <p className={giftMsg.type + ' small'}>{giftMsg.text}</p>}</>}
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
  const [famF, setFamF] = useState('all')
  const [sync, setSync] = useState(null)   // { busy, text, type }
  const [sel, setSel] = useState(() => new Set())
  const [fam, setFam] = useState(null)      // { mode: 'new' | 'add', name, leadId, target, busy, error }
  const [famMsg, setFamMsg] = useState(null)
  const canApprove = ['akceptujacy', 'admin'].includes(profile?.role)
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // ręczne rodziny: z zaznaczonych produktów nowa rodzina albo dołożenie do istniejącej
  async function saveFamily() {
    const items = data.products.filter(p => sel.has(p.id))
    setFam(f => ({ ...f, busy: true, error: null }))
    try {
      if (fam.mode === 'new') {
        const r = await createFamily(items, { name: fam.name, leadId: fam.leadId, approve: canApprove, userId: profile?.id })
        setFamMsg({ type: 'ok', text: `Utworzono rodzinę „${fam.name.trim() || items[0].name}” (${plN(items.length, 'produkt', 'produkty', 'produktów')})${canApprove ? ' – zatwierdzona, możesz wyciągnąć fakty' : ' jako propozycję – zatwierdza akceptujący'}.${r.removed ? ` Usunięto ${plN(r.removed, 'pustą rodzinę', 'puste rodziny', 'pustych rodzin')}.` : ''}`, family: r.id })
      } else {
        if (!fam.target) throw new Error('Wybierz rodzinę')
        const r = await addToFamily(fam.target, items)
        setFamMsg({ type: 'ok', text: `Dodano ${plN(r.added, 'produkt', 'produkty', 'produktów')} do rodziny „${data.families.get(fam.target)?.name}”. Wyciągnij ponownie fakty tej rodziny.${r.removed ? ` Usunięto ${plN(r.removed, 'pustą rodzinę', 'puste rodziny', 'pustych rodzin')}.` : ''}`, family: fam.target })
      }
      setFam(null); setSel(new Set()); load()
    } catch (e) { setFam(f => ({ ...f, busy: false, error: plError(e.message) })) }
  }
  function openFamily(mode) {
    const items = data.products.filter(p => sel.has(p.id))
    setFamMsg(null)
    setFam({ mode, name: suggestName(items, id => data.brands.get(id) || ''), leadId: items[0]?.id, target: '' })
  }

  // Odświeżenie składników wszystkich zestawów z BL – gratisy rozpoznawane po słowie „gratis” w nazwie składnika
  async function refreshBundles() {
    const ids = data.products.filter(p => p.is_bundle).map(p => p.baselinker_product_id)
    if (!ids.length) return
    setSync({ busy: true, text: 'Pobieranie składników z BL…' })
    try {
      const r = await importProducts(ids, { onProgress: t => setSync({ busy: true, text: `Pobieranie składników z BL – ${t}…` }) })
      await load()
      setSync({ type: 'ok', text: `Odświeżono ${plN(r.imported || ids.length, 'zestaw', 'zestawy', 'zestawów')}. Gratisy oznaczono na podstawie słowa „gratis” w nazwie składnika (ręczne oznaczenia zostały zachowane). Aby gratis trafił do opisu, wyciągnij ponownie fakty dla tych rodzin.` })
    } catch (e) { setSync({ type: 'error', text: plError(e.message) }) }
  }

  async function load() {
    try {
      const [products, brands, dicts, fams] = await Promise.all([fetchAll('products', COLS, x => x.order('name')), fetchAll('brands', 'id, name'), loadDicts(), fetchAll('product_families', 'id, name, status, brand_id', x => x.order('name'))])
      setData({ products, brands: new Map(brands.map(b => [b.id, b.name])), dicts, families: new Map(fams.map(f => [f.id, f])) })
    } catch (e) { setError(plError(e.message)) }
  }
  useEffect(() => { load() }, [])


  const list = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.products.filter(p =>
      (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || (p.ean || '').includes(s)) &&
      (!brand || p.brand_id === brand) && (!cat || String(p.bl_category_id) === cat) &&
      (kind === 'all' || (kind === 'bundle' ? p.is_bundle : kind === 'gift' ? p.is_bundle && (p.bundle_items || []).some(b => b.gift) : kind === 'variant' ? !!p.bl_parent_id : !p.is_bundle && !p.bl_parent_id)) &&
      (!flagged || (p.import_flags || []).length > 0) &&
      (famF === 'all' || (famF === 'bez' ? !p.family_id : !!p.family_id)))
  }, [data, q, brand, cat, kind, flagged, famF])
  useEffect(() => setPage(0), [q, brand, cat, kind, flagged, famF])

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
      <p className="muted lead">Produkty pobrane z Baselinkera. Rodzinę (model z wariantami) utworzysz tutaj – zaznacz produkty i kliknij „Utwórz rodzinę z zaznaczonych” – albo automatycznie na ekranie Rodziny produktów („Zaproponuj rodziny”). Fakty i opisy powstają dla rodzin.</p>
      <div className="panel">
        <div className="filter-grid">
          <label>Szukaj (nazwa, SKU, EAN)<input value={q} onChange={e => setQ(e.target.value)} /></label>
          <label>Marka<select value={brand} onChange={e => setBrand(e.target.value)}><option value="">wszystkie</option>{usedBrands.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          <label>Kategoria<select value={cat} onChange={e => setCat(e.target.value)}><option value="">wszystkie</option>{usedCats.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          <label>Rodzaj<select value={kind} onChange={e => setKind(e.target.value)}><option value="all">wszystkie</option><option value="single">pojedyncze</option><option value="variant">warianty BL</option><option value="bundle">zestawy (bundle)</option><option value="gift">zestawy z gratisem</option></select></label>
          <label>Rodzina<select value={famF} onChange={e => setFamF(e.target.value)}><option value="all">wszystkie</option><option value="bez">bez rodziny</option><option value="z">w rodzinie</option></select></label>
          <label className="check span-2" style={{ marginTop: 14 }}><input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} /> Tylko z uwagami do danych</label>
        </div>
      </div>
      <div className="panel">
        <div className="result-head">
          <p className="summary" style={{ margin: 0 }}><strong>{plN(list.length, 'produkt', 'produkty', 'produktów')}</strong>{list.length !== data.products.length && <span className="muted"> z {data.products.length}</span>}</p>
          <span className="row-form" style={{ gap: 12 }}>
            {data.products.some(p => p.is_bundle) && <button className="link-dark" disabled={sync?.busy} onClick={refreshBundles} title="Pobiera z Baselinkera dane składników wszystkich zestawów i oznacza gratisy (składniki ze słowem „gratis” w nazwie)">{sync?.busy ? 'Pobieranie…' : 'Odśwież składniki zestawów i gratisy'}</button>}
            <Link className="link-dark" to="/rodziny">Rodziny produktów →</Link>
          </span>
        </div>
        {sync?.text && <p className={(sync.type || 'muted') + ' small'} role="status">{sync.text}</p>}
        {famMsg && <p className={famMsg.type + ' small'} role="status">{famMsg.text} {famMsg.family && <Link className="link-dark" to={`/fakty?rodzina=${famMsg.family}`}>Przejdź do rodziny →</Link>}</p>}
        {sel.size > 0 && (() => {
          const items = data.products.filter(p => sel.has(p.id))
          const inOther = items.filter(p => p.family_id && (fam?.mode !== 'add' || p.family_id !== fam?.target))
          const brandsSel = new Set(items.map(p => p.brand_id || ''))
          return (
            <div className="panel inset" style={{ margin: '10px 0' }}>
              <div className="row-form" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong>Zaznaczono {plN(items.length, 'produkt', 'produkty', 'produktów')}</strong>
                <button className="btn" onClick={() => openFamily('new')}>Utwórz rodzinę z zaznaczonych</button>
                {data.families.size > 0 && <button className="btn ghost" onClick={() => openFamily('add')}>Dodaj do istniejącej rodziny</button>}
                <button className="link-dark" onClick={() => { setSel(new Set()); setFam(null) }}>Odznacz</button>
              </div>
              {fam && (
                <div style={{ marginTop: 12 }}>
                  {fam.mode === 'new' ? (
                    <div className="filter-grid">
                      <label>Nazwa rodziny (model)<input value={fam.name} onChange={e => setFam({ ...fam, name: e.target.value })} /></label>
                      <label>Wariant wiodący (z niego powstaje opis bazowy)<select value={fam.leadId} onChange={e => setFam({ ...fam, leadId: e.target.value })}>{items.map(p => <option key={p.id} value={p.id}>{p.sku} – {p.name}</option>)}</select></label>
                    </div>
                  ) : (
                    <div className="filter-grid">
                      <label>Rodzina<select value={fam.target} onChange={e => setFam({ ...fam, target: e.target.value })}><option value="">wybierz…</option>{[...data.families.values()].map(f => <option key={f.id} value={f.id}>{f.name}{f.brand_id ? ` (${data.brands.get(f.brand_id) || '?'})` : ''}</option>)}</select></label>
                    </div>
                  )}
                  {inOther.length > 0 && <p className="warn small">{plN(inOther.length, 'zaznaczony produkt jest', 'zaznaczone produkty są', 'zaznaczonych produktów jest')} już w innej rodzinie ({[...new Set(inOther.map(p => data.families.get(p.family_id)?.name || '?'))].join(', ')}) – zostaną przeniesione; rodzina, w której nie zostanie żaden produkt, zostanie usunięta.</p>}
                  {brandsSel.size > 1 && <p className="warn small">Zaznaczone produkty mają różne marki – rodzina powinna obejmować jeden model jednej marki.</p>}
                  {fam.error && <p className="error small">{fam.error}</p>}
                  <span className="row-form" style={{ gap: 10, marginTop: 8 }}>
                    <button className="btn" disabled={fam.busy || (fam.mode === 'add' && !fam.target)} onClick={saveFamily}>{fam.busy ? 'Zapisywanie…' : fam.mode === 'new' ? 'Utwórz rodzinę' : 'Dodaj do rodziny'}</button>
                    <button className="link-dark" onClick={() => setFam(null)}>Anuluj</button>
                  </span>
                </div>
              )}
            </div>
          )
        })()}
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th className="check"><input type="checkbox" aria-label="Zaznacz produkty na stronie" checked={pageRows.length > 0 && pageRows.every(p => sel.has(p.id))} onChange={e => setSel(s => { const n = new Set(s); pageRows.forEach(p => e.target.checked ? n.add(p.id) : n.delete(p.id)); return n })} /></th><th>SKU</th><th>Nazwa</th><th>Marka</th><th>Kategoria</th><th className="num">Parametry</th><th className="num">Zdjęcia</th><th>Rodzina</th><th>Uwagi do danych</th></tr></thead>
            <tbody>
              {pageRows.map(p => (
                <Fragment key={p.id}>
                  <tr className={sel.has(p.id) ? 'selected' : ''}>
                    <td className="check"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Zaznacz ${p.sku}`} /></td>
                    <td className="mono">{p.sku}</td>
                    <td className="name"><button className="row-toggle" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>{p.name}</button>{p.is_bundle && <span className="tag info gap">zestaw</span>}{p.is_bundle && (p.bundle_items || []).filter(b => b.gift).map(b => <span key={b.bl_id} className="tag okt gap" title={b.gift_source ? `rozpoznano: ${b.gift_source}` : ''}>gratis: {b.name || b.sku}</span>)}{p.bl_parent_id && <span className="tag gap">wariant</span>}</td>
                    <td>{data.brands.get(p.brand_id) || '—'}</td>
                    <td className="path">{data.dicts.catById.get(p.bl_category_id)?.path || '—'}</td>
                    <td className="num">{Object.keys(p.features || {}).length}</td>
                    <td className="num">{(p.images || []).length}</td>
                    <td>{p.family_id ? <Link to={`/fakty?rodzina=${p.family_id}`} className="link-dark">{data.families.get(p.family_id)?.name || 'rodzina'}</Link> : <span className="muted small">bez rodziny</span>}</td>
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
    </section>
  )
}
