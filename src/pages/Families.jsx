import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, plError, plN, fetchAll } from '../supabase.js'
import { loadDicts } from '../catalog.js'
import { proposeFamilies, variantAttrs, descLen, familyFactState, extractFamilyFacts } from '../families.js'
import { generateBase } from '../gen.js'
import { useNavigate } from 'react-router-dom'
import DrainLoader from '../components/DrainLoader.jsx'

const PAGE = 100
const ATTR_LABEL = { wymiar: 'wymiar', kolor: 'kolor', strona: 'strona' }
const STATUS = { propozycja: 'propozycja', zatwierdzone: 'zatwierdzona', odrzucone: 'odrzucona' }
const DSTATUS = { generowanie: 'w trakcie', do_weryfikacji: 'do weryfikacji', poprawki: 'poprawiony', zaakceptowany: 'zaakceptowany', opublikowany: 'opublikowany', blad: 'błąd' }
const FACT_FILTERS = { all: 'wszystkie', brak: 'fakty nie wyciągnięte', do_akceptacji: 'fakty do akceptacji', nieaktualne: 'dane w BL się zmieniły', gotowe: 'fakty zatwierdzone' }
const PCOLS = 'id, sku, name, brand_id, bl_category_id, bl_parent_id, baselinker_product_id, is_bundle, family_id, source_hash'
const FCOLS = 'id, name, brand_id, bl_category_id, lead_product_id, status, grouping, varying_attributes, facts_extracted_at, facts_source_hash, created_at'
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const attrsCell = p => { const a = variantAttrs(p.name); return [a.wymiar, a.kolor, a.kolor_akcesoriow && `akcesoria: ${a.kolor_akcesoriow}`, a.strona].filter(Boolean).join(' · ') || '—' }

// ---------- propozycje dla produktów bez rodziny ----------
function Proposals({ dicts, brands, canApprove, profile, onSaved, onClose }) {
  const [props, setProps] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [onlyMulti, setOnlyMulti] = useState(true)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const rows = await fetchAll('products', PCOLS + ', description_pl', q => q.is('family_id', null))
        const list = proposeFamilies(rows.map(({ description_pl, ...p }) => ({ ...p, desc_len: descLen(description_pl) })),
          { brandName: id => brands.get(id) || '', catPath: id => dicts.catById.get(id)?.path || '' })
        setProps(list); setSel(new Set(list.filter(p => p.items.length > 1).map(p => p.key)))
      } catch (e) { setErr(plError(e.message)) }
    })()
  }, [])

  const update = (key, fn) => setProps(ps => ps.map(p => p.key === key ? fn(p) : p))
  const recompute = p => ({ ...p, varying: ['wymiar', 'kolor', 'strona'].filter(a => new Set(p.items.map(i => i.attrs[a] || '')).size > 1), lead_id: p.items.some(i => i.id === p.lead_id) ? p.lead_id : p.items[0]?.id })
  function detach(key, item) {
    setProps(ps => {
      const out = ps.map(p => p.key === key ? recompute({ ...p, items: p.items.filter(i => i.id !== item.id) }) : p).filter(p => p.items.length)
      return [...out, { key: `solo:${item.id}`, name: item.name, brand_id: item.brand_id, bl_category_id: item.bl_category_id, items: [item], lead_id: item.id, varying: [], signals: { rule: 'recznie' } }]
    })
  }
  function merge() {
    const keys = props.filter(p => sel.has(p.key)).map(p => p.key)
    if (keys.length < 2) return
    setProps(ps => {
      const parts = ps.filter(p => keys.includes(p.key))
      const target = recompute({ ...parts[0], items: parts.flatMap(p => p.items), signals: { ...parts[0].signals, rule: 'recznie', merged: parts.map(p => p.name) } })
      return [target, ...ps.filter(p => !keys.includes(p.key))]
    })
    setSel(new Set([keys[0]]))
  }

  async function save() {
    const chosen = props.filter(p => sel.has(p.key))
    setBusy('Zapisywanie…'); setErr('')
    try {
      let done = 0
      for (const part of chunks(chosen, 50)) {
        const rows = part.map(p => ({ name: p.name.trim() || p.items[0].name, brand_id: p.brand_id || null, bl_category_id: p.bl_category_id || null, lead_product_id: p.lead_id,
          status: canApprove ? 'zatwierdzone' : 'propozycja', grouping: { ...p.signals, key: p.key }, varying_attributes: p.varying, created_by: profile?.id || null }))
        const { data, error } = await supabase.from('product_families').insert(rows).select('id, lead_product_id')
        if (error) throw error
        const idByLead = new Map(data.map(d => [d.lead_product_id, d.id]))
        await Promise.all(part.map(async p => {
          const { error: e2 } = await supabase.from('products').update({ family_id: idByLead.get(p.lead_id) }).in('id', p.items.map(i => i.id))
          if (e2) throw e2
        }))
        done += part.length
        setBusy(`Zapisano ${done} z ${chosen.length}…`)
      }
      onSaved(`Zapisano ${plN(chosen.length, 'rodzinę', 'rodziny', 'rodzin')}${canApprove ? ' (zatwierdzone)' : ' jako propozycje – zatwierdza akceptujący'}.`)
    } catch (e) { setErr(plError(e.message)); setBusy(null) }
  }

  if (err && !props) return <div className="panel"><p className="error">{err}</p></div>
  if (!props) return <div className="panel"><DrainLoader label="Analiza nazw produktów…" /></div>
  if (!props.length) return <div className="panel"><p className="muted">Wszystkie produkty mają już rodzinę.</p><button className="link-dark" onClick={onClose}>Zamknij</button></div>
  const multi = props.filter(p => p.items.length > 1), solo = props.length - multi.length
  const shown = onlyMulti ? multi : props
  return (
    <div className="panel">
      <div className="panel-head"><h2 style={{ margin: 0 }}>Propozycje rodzin</h2><button className="link-dark" onClick={onClose}>Zamknij</button></div>
      <p className="muted small">{plN(props.reduce((s, p) => s + p.items.length, 0), 'produkt', 'produkty', 'produktów')} bez rodziny → {plN(multi.length, 'rodzina wielowariantowa', 'rodziny wielowariantowe', 'rodzin wielowariantowych')} i {plN(solo, 'produkt pojedynczy', 'produkty pojedyncze', 'produktów pojedynczych')} (każdy jako rodzina jednoproduktowa). Grupowanie: marka + kategoria + nazwa modelu bez wymiarów, kolorów i strony; warianty z BL łączone zawsze.</p>
      <div className="result-head">
        <label className="check"><input type="checkbox" checked={onlyMulti} onChange={e => setOnlyMulti(e.target.checked)} /> Pokaż tylko rodziny wielowariantowe</label>
        <span className="row-form">
          <button className="link-dark" onClick={() => setSel(new Set(props.map(p => p.key)))}>Zaznacz wszystkie ({props.length})</button>
          <button className="link-dark" onClick={() => setSel(new Set(multi.map(p => p.key)))}>Tylko wielowariantowe ({multi.length})</button>
          {sel.size > 0 && <button className="link-dark" onClick={() => setSel(new Set())}>Odznacz</button>}
        </span>
      </div>
      {shown.map(p => (
        <div key={p.key} className={'proposal' + (sel.has(p.key) ? ' on' : '')}>
          <div className="proposal-head">
            <input type="checkbox" checked={sel.has(p.key)} aria-label={`Zaznacz ${p.name}`} onChange={() => setSel(s => { const n = new Set(s); n.has(p.key) ? n.delete(p.key) : n.add(p.key); return n })} />
            <input className="name-input" value={p.name} aria-label="Nazwa rodziny" onChange={e => update(p.key, x => ({ ...x, name: e.target.value }))} />
            <span className="muted small">{brands.get(p.brand_id) || '—'} · {dicts.catById.get(p.bl_category_id)?.path || '—'} · {plN(p.items.length, 'wariant', 'warianty', 'wariantów')}{p.varying.length ? ` · różnice: ${p.varying.map(a => ATTR_LABEL[a]).join(', ')}` : ''}{p.signals.bl_parent ? ' · warianty w BL' : ''}</span>
          </div>
          {p.items.length > 1 && (
            <table className="compact"><tbody>
              {p.items.map(i => (
                <tr key={i.id}>
                  <td className="check"><input type="radio" name={`lead-${p.key}`} checked={p.lead_id === i.id} onChange={() => update(p.key, x => ({ ...x, lead_id: i.id }))} aria-label="Wariant wiodący" title="Wariant wiodący" /></td>
                  <td className="mono">{i.sku}</td><td className="name">{i.name}</td><td>{[i.attrs.wymiar, i.attrs.kolor, i.attrs.kolor_akcesoriow && `akcesoria: ${i.attrs.kolor_akcesoriow}`, i.attrs.strona].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="actions"><button className="link-dark" onClick={() => detach(p.key, i)}>Wyłącz</button></td>
                </tr>
              ))}
            </tbody></table>
          )}
          {p.items.length === 1 && <p className="small muted" style={{ margin: '4px 0 0 28px' }}>{p.items[0].sku} · {p.items[0].name}</p>}
        </div>
      ))}
      <div className="import-bar">
        <div>{busy ? <span className="progress-line">{busy}</span> : err ? <span className="error">{err}</span> : <span><strong>Zaznaczono {plN(sel.size, 'rodzinę', 'rodziny', 'rodzin')}</strong> <span className="muted small">· promień = wariant wiodący (jego opis jest bazą dla rodziny)</span></span>}</div>
        <span className="row-form">
          {sel.size >= 2 && <button className="btn ghost" disabled={!!busy} onClick={merge}>Połącz zaznaczone</button>}
          <button className="btn" disabled={!!busy || !sel.size} onClick={save}>Zapisz zaznaczone ({sel.size})</button>
        </span>
      </div>
    </div>
  )
}

// ---------- zapisane rodziny ----------
export default function Families({ profile }) {
  const canApprove = ['akceptujacy', 'admin'].includes(profile?.role)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [proposing, setProposing] = useState(false)
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [status, setStatus] = useState('')
  const [factF, setFactF] = useState('all')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [job, setJob] = useState(null)   // { busy, progress, result, error, ok }
  const nav = useNavigate()

  async function load() {
    try {
      const [families, products, brandRows, dicts, facts, chs, descs] = await Promise.all([
        fetchAll('product_families', FCOLS, x => x.order('name')), fetchAll('products', PCOLS), fetchAll('brands', 'id, name'), loadDicts(),
        fetchAll('kb_facts', 'family_id, status', x => x.not('family_id', 'is', null)),
        supabase.from('channels').select('id, code, marketplace, language, active').eq('active', true).order('code'),
        fetchAll('descriptions', 'id, family_id, channel_id, product_id, is_base, version, status', x => x.order('version', { ascending: false })),
      ])
      const channel = (chs.data || [])[0] || null
      // najnowszy opis bazowy rodziny w kanale + stan opisów wariantów
      const bases = new Map(), variants = new Map()
      for (const d of descs) {
        if (!channel || d.channel_id !== channel.id || !d.family_id) continue
        if (d.is_base) { if (!bases.has(d.family_id)) bases.set(d.family_id, d) }
        else { const m = variants.get(d.family_id) || new Map(); if (!m.has(d.product_id)) m.set(d.product_id, d); variants.set(d.family_id, m) }
      }
      const members = new Map()
      products.forEach(p => { if (p.family_id) { if (!members.has(p.family_id)) members.set(p.family_id, []); members.get(p.family_id).push(p) } })
      const counts = new Map()
      facts.forEach(f => { const c = counts.get(f.family_id) || { do_akceptacji: 0, zatwierdzony: 0, odrzucony: 0 }; c[f.status]++; counts.set(f.family_id, c) })
      setData({ families, members, counts, channel, bases, variants, unassigned: products.filter(p => !p.family_id).length, brands: new Map(brandRows.map(b => [b.id, b.name])), dicts })
    } catch (e) { setError(plError(e.message)) }
  }
  useEffect(() => { load() }, [])

  const list = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.families.filter(f => {
      const m = data.members.get(f.id) || []
      return (!s || f.name.toLowerCase().includes(s) || m.some(p => p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s))) &&
        (!brand || f.brand_id === brand) && (!status || f.status === status) &&
        (factF === 'all' || familyFactState(f, m, data.counts).key === factF)
    })
  }, [data, q, brand, status, factF])
  useEffect(() => { setPage(0) }, [q, brand, status, factF])

  async function patch(id, values) {
    const { error } = await supabase.from('product_families').update(values).eq('id', id)
    if (error) setError(plError(error.message)); else load()
  }
  async function detach(f, p) {
    if (!confirm(`Wyłączyć ${p.sku} z rodziny „${f.name}”? Produkt wróci do puli bez rodziny.`)) return
    const { error } = await supabase.from('products').update({ family_id: null }).eq('id', p.id)
    if (error) { setError(plError(error.message)); return }
    if (f.lead_product_id === p.id) { const next = (data.members.get(f.id) || []).find(x => x.id !== p.id); await supabase.from('product_families').update({ lead_product_id: next?.id || null }).eq('id', f.id) }
    load()
  }

  const chosen = () => data.families.filter(f => sel.has(f.id))
  async function bulkApprove() {
    setJob({ busy: true, progress: 'Zatwierdzanie…' })
    const { error } = await supabase.from('product_families').update({ status: 'zatwierdzone' }).in('id', [...sel])
    setJob(error ? { error: plError(error.message) } : { ok: `Zatwierdzono ${plN(sel.size, 'rodzinę', 'rodziny', 'rodzin')}.` }); load()
  }
  async function bulkMerge() {
    const fs = chosen(), target = fs[0]
    if (!confirm(`Połączyć ${fs.length} rodziny w „${target.name}”? Fakty rodzin dołączanych zostaną usunięte – wyciągnij je ponownie dla połączonej rodziny.`)) return
    setJob({ busy: true, progress: 'Łączenie…' })
    try {
      const others = fs.slice(1).map(f => f.id)
      let r = await supabase.from('products').update({ family_id: target.id }).in('family_id', others); if (r.error) throw r.error
      r = await supabase.from('descriptions').update({ family_id: target.id }).in('family_id', others); if (r.error) throw r.error
      r = await supabase.from('product_families').delete().in('id', others); if (r.error) throw r.error
      r = await supabase.from('product_families').update({ grouping: { ...(target.grouping || {}), rule: 'recznie', merged: fs.map(f => f.name) } }).eq('id', target.id); if (r.error) throw r.error
      setJob({ ok: `Połączono w „${target.name}”.` }); setSel(new Set()); load()
    } catch (e) { setJob({ error: plError(e.message) }) }
  }
  async function bulkDissolve() {
    if (!confirm(`Rozwiązać ${plN(sel.size, 'rodzinę', 'rodziny', 'rodzin')}? Produkty wrócą do puli bez rodziny, fakty rodzin (poza faktami marki) zostaną usunięte. Opisy zostają przy produktach – po utworzeniu nowej rodziny wygenerujesz nowy opis bazowy.`)) return
    setJob({ busy: true, progress: 'Rozwiązywanie…' })
    const r = await supabase.from('product_families').delete().in('id', [...sel])
    setJob(r.error ? { error: plError(r.error.message) } : { ok: `Rozwiązano ${plN(sel.size, 'rodzinę', 'rodziny', 'rodzin')}.` }); setSel(new Set()); load()
  }
  async function bulkFacts() {
    const fs = chosen().filter(f => f.status === 'zatwierdzone')
    setJob({ busy: true, progress: 'Start…' })
    try {
      const result = await extractFamilyFacts(fs, { onProgress: progress => setJob(s => ({ ...s, progress })) })
      setJob({ result }); setSel(new Set()); load()
    } catch (e) { setJob({ error: e.message }) }
  }

  async function genOne(f) {
    setJob({ busy: true, progress: `Opis bazowy: ${f.name} (1–3 min)` })
    try { await generateBase(f.id, data.channel.id, id => nav(`/opisy/${id}`)) }
    catch (e) { setJob({ error: e.message }); load() }
  }
  async function bulkDescriptions() {
    const fs = chosen().filter(f => f.status === 'zatwierdzone')
    const failed = []; let done = 0
    for (let i = 0; i < fs.length; i++) {
      setJob({ busy: true, progress: `Opisy bazowe: rodzina ${i + 1} z ${fs.length} (${fs[i].name})` })
      try { await generateBase(fs[i].id, data.channel.id); done++ } catch (e) { failed.push(`${fs[i].name}: ${e.message}`) }
    }
    setJob(failed.length ? { error: `Wygenerowano ${done} z ${fs.length}. Błędy: ${failed.join(' · ')}` } : { ok: `Wygenerowano ${plN(done, 'opis bazowy', 'opisy bazowe', 'opisów bazowych')} – sprawdź je na ekranie Opisy.` })
    setSel(new Set()); load()
  }

  if (error && !data) return <section className="page"><h1>Rodziny produktów</h1><p className="error">{error}</p></section>
  if (!data) return <section className="page"><DrainLoader /></section>

  const pageRows = list.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.ceil(list.length / PAGE)
  const selFams = data.families.filter(f => sel.has(f.id))
  const selApproved = selFams.filter(f => f.status === 'zatwierdzone').length
  const usedBrands = [...new Set(data.families.map(f => f.brand_id).filter(Boolean))].map(id => [id, data.brands.get(id) || '?']).sort((a, b) => a[1].localeCompare(b[1], 'pl'))

  return (
    <section className="page">
      <h1>Rodziny produktów</h1>
      <p className="muted lead">Rodzina = model z wariantami (rozmiary, kolory, strona). Fakty wyciągamy i opisy generujemy dla rodziny: opis bazowy z wariantu wiodącego, warianty dostają adaptację.</p>
      {msg && <p className="ok" role="status">{msg}</p>}

      {proposing ? (
        <Proposals dicts={data.dicts} brands={data.brands} canApprove={canApprove} profile={profile} onClose={() => setProposing(false)} onSaved={m => { setProposing(false); setMsg(m); load() }} />
      ) : (
        <div className="panel">
          <div className="status-row">
            <span className="stat">Rodzin: <strong>{data.families.length.toLocaleString('pl-PL')}</strong></span>
            <span className="stat">Zatwierdzonych: <strong>{data.families.filter(f => f.status === 'zatwierdzone').length.toLocaleString('pl-PL')}</strong></span>
            <span className="stat">Produkty bez rodziny: <strong>{data.unassigned.toLocaleString('pl-PL')}</strong></span>
            {data.unassigned > 0 && <button className="btn" onClick={() => { setProposing(true); setMsg('') }}>Zaproponuj rodziny</button>}
            <Link className="btn ghost" to="/produkty" title="Zaznacz produkty na liście i kliknij „Utwórz rodzinę z zaznaczonych” albo „Dodaj do istniejącej rodziny”">Utwórz rodzinę ręcznie</Link>
          </div>
        </div>
      )}

      {data.families.length > 0 && (<>
        <div className="panel">
          <div className="filter-grid">
            <label>Szukaj (rodzina, SKU, nazwa)<input value={q} onChange={e => setQ(e.target.value)} /></label>
            <label>Marka<select value={brand} onChange={e => setBrand(e.target.value)}><option value="">wszystkie</option>{usedBrands.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
            <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">wszystkie</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Fakty<select value={factF} onChange={e => setFactF(e.target.value)}>{Object.entries(FACT_FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
        </div>
        <div className="panel">
          <div className="result-head">
            <span className="summary"><strong>{plN(list.length, 'rodzina', 'rodziny', 'rodzin')}</strong></span>
            <span className="row-form">
              <button className="link-dark" onClick={() => setSel(new Set(list.map(f => f.id)))}>Zaznacz wszystkie z listy ({list.length})</button>
              {sel.size > 0 && <button className="link-dark" onClick={() => setSel(new Set())}>Odznacz</button>}
            </span>
          </div>
          <div className="table-wrap">
            <table className="compact">
              <thead><tr><th className="check"><input type="checkbox" aria-label="Zaznacz rodziny na tej stronie" checked={pageRows.length > 0 && pageRows.every(f => sel.has(f.id))} onChange={e => setSel(s => { const n = new Set(s); pageRows.forEach(f => e.target.checked ? n.add(f.id) : n.delete(f.id)); return n })} /></th>
                <th>Rodzina</th><th>Marka</th><th className="num">Warianty</th><th>Różnice</th><th>Wariant wiodący</th><th>Status</th><th>Fakty</th><th>Opis {data.channel ? `${data.channel.marketplace} ${data.channel.language.toUpperCase()}` : ''}</th></tr></thead>
              <tbody>
                {pageRows.map(f => {
                  const m = (data.members.get(f.id) || []).slice().sort((a, b) => a.sku.localeCompare(b.sku))
                  const st = familyFactState(f, m, data.counts)
                  return (
                    <Fragment key={f.id}>
                      <tr>
                        <td className="check"><input type="checkbox" checked={sel.has(f.id)} aria-label={`Zaznacz ${f.name}`} onChange={() => setSel(s => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })} /></td>
                        <td className="name"><button className="row-toggle" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>{f.name}</button></td>
                        <td>{data.brands.get(f.brand_id) || '—'}</td>
                        <td className="num">{m.length}</td>
                        <td>{(f.varying_attributes || []).map(a => ATTR_LABEL[a] || a).join(', ') || '—'}</td>
                        <td>
                          {m.length > 1 ? (
                            <select value={f.lead_product_id || ''} onChange={e => patch(f.id, { lead_product_id: e.target.value || null })} aria-label={`Wariant wiodący ${f.name}`}>
                              <option value="">— wybierz —</option>
                              {m.map(p => <option key={p.id} value={p.id}>{p.sku} · {attrsCell(p)}</option>)}
                            </select>
                          ) : <span className="mono small">{m[0]?.sku || '—'}</span>}
                        </td>
                        <td>{f.status === 'zatwierdzone' ? <span className="tag okt">zatwierdzona</span> : <>
                          <span className="tag">{STATUS[f.status]}</span>{canApprove && <button className="link-dark gap" onClick={() => patch(f.id, { status: 'zatwierdzone' })}>Zatwierdź</button>}</>}</td>
                        <td>{st.key === 'brak' ? <span className="muted small">{st.label}</span> : <Link to={`/fakty?rodzina=${f.id}`} className={`tag ${st.key === 'gotowe' ? 'okt' : st.key === 'nieaktualne' ? 'warn' : 'info'}`}>{st.label}</Link>}</td>
                        <td>{(() => { const b = data.bases.get(f.id); if (!b) return <span className="muted small">—</span>
                          const vs = [...(data.variants.get(f.id) || new Map()).values()]; const ok = vs.filter(x => ['zaakceptowany', 'opublikowany'].includes(x.status)).length
                          return <><Link to={`/opisy/${b.id}`} className={`tag st-${b.status}`}>v{b.version} · {DSTATUS[b.status] || b.status}</Link>{m.length > 1 && b.status === 'zaakceptowany' && <span className="muted small"> warianty {ok}/{m.length - 1}</span>}</> })()}</td>
                      </tr>
                      {open === f.id && (
                        <tr className="detail-row"><td colSpan={9}>
                          <div style={{ padding: '6px 0 12px' }}>
                            <label style={{ marginTop: 0, maxWidth: 420 }}>Nazwa rodziny<input defaultValue={f.name} onBlur={e => e.target.value.trim() && e.target.value.trim() !== f.name && patch(f.id, { name: e.target.value.trim() })} /></label>
                            <table className="compact" style={{ marginTop: 12 }}>
                              <thead><tr><th>SKU</th><th>Nazwa</th><th>Wymiar · kolor · strona</th><th></th></tr></thead>
                              <tbody>{m.map(p => (
                                <tr key={p.id} className={p.id === f.lead_product_id ? 'is-lead' : ''}>
                                  <td className="mono">{p.sku}{p.id === f.lead_product_id && <span className="tag info gap">wiodący</span>}</td><td className="name">{p.name}</td><td>{attrsCell(p)}</td>
                                  <td className="actions">{m.length > 1 && <button className="link-dark" onClick={() => detach(f, p)}>Wyłącz z rodziny</button>}</td>
                                </tr>
                              ))}</tbody>
                            </table>
                            {f.status === 'zatwierdzone' && data.channel && (
                              <div className="row-form" style={{ marginTop: 12 }}>
                                <button className="btn ghost" disabled={job?.busy} onClick={() => genOne(f)}>{data.bases.get(f.id) ? 'Generuj nowy opis bazowy' : 'Generuj opis bazowy'} ({data.channel.marketplace} {data.channel.language.toUpperCase()})</button>
                                <span className="muted small">z zatwierdzonych faktów rodziny i wariantu wiodącego; potem weryfikacja i opisy wariantów</span>
                              </div>
                            )}
                            {f.grouping?.rule && <p className="muted small" style={{ marginTop: 8 }}>Podstawa grupowania: {f.grouping.rule === 'nazwa' ? 'nazwa modelu' : f.grouping.rule === 'bl' ? 'warianty w Baselinkerze' : f.grouping.rule === 'recznie' ? 'zmiana ręczna' : f.grouping.rule}{f.grouping.sku_stems?.length ? ` · rdzenie SKU: ${f.grouping.sku_stems.join(', ')}` : ''}</p>}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
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
        </div>
      </>)}

      {(sel.size > 0 || job) && !proposing && (
        <div className="import-bar" role="region" aria-label="Akcje na rodzinach">
          <div>
            {job?.busy ? <span className="progress-line" role="status">{job.progress}</span>
              : job?.result ? (
                <div className="import-result" role="status">
                  <span className="ok">Przetworzono {plN(job.result.done, 'rodzinę', 'rodziny', 'rodzin')}: {job.result.family} faktów rodzin, {job.result.variant} faktów wariantów, {job.result.brand} nowych faktów marki{job.result.covered ? `, ${job.result.covered} potwierdzeń istniejących` : ''}{job.result.flagged ? `; ${job.result.flagged} z uwagami` : ''}.</span> <Link to="/fakty" className="link-dark">Przejdź do akceptacji →</Link>
                  {job.result.failed.length > 0 && <ul>{job.result.failed.map((f, i) => <li key={i} className="error">{f.name}: {f.error}</li>)}</ul>}
                </div>
              ) : job?.error ? <span className="error" role="alert">{job.error}</span> : job?.ok ? <span className="ok">{job.ok}</span>
              : <span><strong>Zaznaczono {plN(sel.size, 'rodzinę', 'rodziny', 'rodzin')}</strong>{selApproved < sel.size && <span className="muted small"> · fakty tylko dla zatwierdzonych ({selApproved})</span>}</span>}
          </div>
          {sel.size > 0 && !job?.busy && (
            <span className="row-form">
              <button className="btn" disabled={!selApproved} onClick={bulkFacts}>Wyciągnij fakty ({selApproved})</button>
              {data.channel && <button className="btn ghost" disabled={!selApproved} onClick={bulkDescriptions}>Generuj opisy bazowe ({selApproved})</button>}
              {canApprove && selApproved < sel.size && <button className="btn ghost" onClick={bulkApprove}>Zatwierdź</button>}
              {canApprove && sel.size >= 2 && <button className="btn ghost" onClick={bulkMerge}>Połącz</button>}
              {canApprove && <button className="btn ghost danger" onClick={bulkDissolve}>Rozwiąż</button>}
            </span>
          )}
          {job && !job.busy && <button className="link-dark" onClick={() => setJob(null)}>Zamknij</button>}
        </div>
      )}
    </section>
  )
}
