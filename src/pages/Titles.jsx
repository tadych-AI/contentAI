import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase, plError, plN, fetchAll } from '../supabase.js'
import { loadDicts } from '../catalog.js'
import { runJob } from '../jobs.js'
import { TOKENS, SEPARATORS, DEFAULT_TOKENS, assembleTitle, patternFor, presetParts } from '../titles.js'
import { factsFor } from '../gen.js'
import Picker from '../components/Picker.jsx'
import DrainLoader from '../components/DrainLoader.jsx'

const PCOLS = 'id, sku, name, brand_id, bl_category_id, family_id, features, is_bundle, bundle_items'
const STATUS = { brak: 'bez tytułu', propozycja: 'do zatwierdzenia', zatwierdzony: 'zatwierdzony' }
const CHUNK = 15

// ---------- edytor wzoru ----------
function PatternEditor({ pat, dicts, sample, canEdit, onSaved, onClose }) {
  const [t, setT] = useState(pat)
  const [msg, setMsg] = useState(null)
  const tokens = t.tokens?.length ? t.tokens : DEFAULT_TOKENS
  const setTokens = list => setT({ ...t, tokens: list })
  const unused = Object.keys(TOKENS).filter(k => !tokens.some(x => x.key === k))
  const preview = sample ? assembleTitle({ ...t, tokens }, sample.parts) : null
  async function save() {
    setMsg(null)
    const row = { channel_id: t.channel_id, bl_category_id: t.bl_category_id || null, name: t.name.trim(), tokens, max_len: Number(t.max_len) || 150, instructions: t.instructions || '', updated_at: new Date().toISOString() }
    const q = t.id ? supabase.from('title_patterns').update(row).eq('id', t.id).select().single() : supabase.from('title_patterns').insert(row).select().single()
    const { data, error } = await q
    if (error) { setMsg({ type: 'error', text: /duplicate|unique/i.test(error.message) ? 'Ta kategoria ma już swój wzór.' : plError(error.message) }); return }
    setMsg({ type: 'ok', text: 'Zapisano wzór. Tytuły już wygenerowane przelicz przyciskiem „Przelicz wg wzoru” – bez ponownego użycia AI.' }); onSaved(data)
  }
  return (
    <div className="panel">
      <div className="panel-head"><h2 style={{ margin: 0 }}>{t.id ? 'Wzór tytułu' : 'Nowy wzór tytułu'}</h2><button className="link-dark" onClick={onClose}>Zamknij</button></div>
      <div className="filter-grid">
        <label>Nazwa<input value={t.name} onChange={e => setT({ ...t, name: e.target.value })} /></label>
        <label>Maks. długość tytułu (znaki)<input type="number" min="40" max="255" value={t.max_len} onChange={e => setT({ ...t, max_len: e.target.value })} /></label>
      </div>
      <Picker label="Kategoria Baselinkera" help="Puste = wzór domyślny. Wzór kategorii obowiązuje też w jej podkategoriach." options={dicts.categories.map(c => ({ value: c.bl_category_id, label: c.path || c.name }))}
        value={t.bl_category_id ? [t.bl_category_id] : []} onChange={v => setT({ ...t, bl_category_id: v.length ? Number(v[v.length - 1]) : null })} placeholder="np. Wanny" />
      <h3 style={{ margin: '14px 0 6px' }}>Elementy w kolejności tytułu</h3>
      <table className="compact">
        <thead><tr><th>Element</th><th>Separator przed</th><th>Obowiązkowy</th><th /></tr></thead>
        <tbody>{tokens.map((x, i) => (
          <tr key={x.key}>
            <td><strong>{TOKENS[x.key]?.label || x.key}</strong><span className="muted small" style={{ display: 'block' }}>{TOKENS[x.key]?.ai}</span></td>
            <td><select value={x.sep} disabled={i === 0} onChange={e => setTokens(tokens.map((y, j) => j === i ? { ...y, sep: e.target.value } : y))}>{Object.entries(SEPARATORS).filter(([k]) => i === 0 || k).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
            <td><label className="check"><input type="checkbox" checked={!!x.required} onChange={e => setTokens(tokens.map((y, j) => j === i ? { ...y, required: e.target.checked } : y))} /> tak</label></td>
            <td className="actions">
              <button className="link-dark" disabled={i === 0} aria-label="Wyżej" onClick={() => { const a = [...tokens]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; a[0] = { ...a[0], sep: '' }; if (a[1] && !a[1].sep) a[1] = { ...a[1], sep: ' ' }; setTokens(a) }}>↑</button>
              <button className="link-dark" disabled={i === tokens.length - 1} aria-label="Niżej" onClick={() => { const a = [...tokens]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; a[0] = { ...a[0], sep: '' }; if (!a[1].sep) a[1] = { ...a[1], sep: ' ' }; setTokens(a) }}>↓</button>
              <button className="link-dark danger" onClick={() => setTokens(tokens.filter((_, j) => j !== i).map((y, j) => j === 0 ? { ...y, sep: '' } : y))}>Usuń</button>
            </td>
          </tr>))}</tbody>
      </table>
      {unused.length > 0 && <label style={{ maxWidth: 320 }}>Dodaj element<select value="" onChange={e => e.target.value && setTokens([...tokens, { key: e.target.value, sep: tokens.length ? ', ' : '', required: false }])}><option value="">—</option>{unused.map(k => <option key={k} value={k}>{TOKENS[k].label}</option>)}</select></label>}
      <label>Dodatkowe zasady dla AI (opcjonalnie)<textarea rows={2} value={t.instructions || ''} onChange={e => setT({ ...t, instructions: e.target.value })} placeholder="np. typ produktu zawsze w liczbie pojedynczej; dla brodzików podawaj wysokość" /></label>
      <p className="muted small">Za długi tytuł aplikacja skraca, usuwając elementy nieobowiązkowe od końca wzoru. Elementy puste są pomijane.</p>
      {preview && <div className="preview-title"><span className="muted small">Podgląd ({sample.sku}):</span> <strong>{preview.title || '—'}</strong> <span className={preview.over ? 'hint-inline small' : 'muted small'}>{preview.length}/{t.max_len} zn.{preview.dropped.length ? ` · skrócono: ${preview.dropped.map(k => TOKENS[k]?.label).join(', ')}` : ''}</span></div>}
      {canEdit ? <button className="btn" disabled={!t.name.trim()} onClick={save}>Zapisz wzór</button> : <p className="muted small">Wzory zmienia akceptujący lub admin.</p>}
      {msg && <p className={msg.type} role="status">{msg.text}</p>}
    </div>
  )
}

export default function Titles({ profile }) {
  const canApprove = ['akceptujacy', 'admin'].includes(profile?.role)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [onlyFamilies, setOnlyFamilies] = useState(true)
  const [sel, setSel] = useState(new Set())
  const [job, setJob] = useState(null)
  const [editing, setEditing] = useState(null)   // { id, value }
  const [sampleId, setSampleId] = useState('')

  async function load() {
    try {
      const { data: chs } = await supabase.from('channels').select('*').eq('active', true).order('code')
      const channel = (chs || []).find(c => c.code === 'emag_hu') || (chs || [])[0]
      const [pats, prods, titles, descs, facts, brands, fams, dicts] = await Promise.all([
        supabase.from('title_patterns').select('*').eq('channel_id', channel.id).order('bl_category_id', { nullsFirst: true }),
        fetchAll('products', PCOLS, x => x.order('sku')),
        fetchAll('product_titles', '*', x => x.eq('channel_id', channel.id)),
        fetchAll('descriptions', 'product_id, version, status, fields, meta', x => x.eq('channel_id', channel.id).in('status', ['zaakceptowany', 'opublikowany', 'do_weryfikacji']).order('version', { ascending: false })),
        fetchAll('kb_facts', 'content, level, family_id, brand_id, variant_ids', x => x.eq('status', 'zatwierdzony')),
        fetchAll('brands', 'id, name'), fetchAll('product_families', 'id, name, status'), loadDicts(),
      ])
      if (pats.error) throw pats.error
      const desc = new Map(); descs.forEach(d => { if (!desc.has(d.product_id)) desc.set(d.product_id, d) })
      setData({ channel, patterns: pats.data || [], products: prods, titles: new Map(titles.map(t => [t.product_id, t])), desc, facts,
        brands: new Map(brands.map(b => [b.id, b.name])), fams: new Map(fams.map(f => [f.id, f])), dicts })
    } catch (e) { setErr(plError(e.message)) }
  }
  useEffect(() => { load() }, [])

  const list = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.products.filter(p => {
      if (onlyFamilies && data.fams.get(p.family_id)?.status !== 'zatwierdzone') return false
      const t = data.titles.get(p.id)
      if (status && (t?.status || 'brak') !== status) return false
      return !s || p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s) || (t?.title || '').toLowerCase().includes(s)
    })
  }, [data, q, status, onlyFamilies])

  if (err) return <section className="page"><h1>Tytuły eMAG</h1><p className="error">{err}</p></section>
  if (!data) return <section className="page"><DrainLoader /></section>
  const patOf = p => patternFor(data.patterns, p.bl_category_id, data.dicts.catById) || { tokens: DEFAULT_TOKENS, max_len: 150, name: 'domyślny (niezapisany)' }
  const brandOf = p => data.brands.get(p.brand_id) || ''
  const partsOf = p => data.titles.get(p.id)?.parts || presetParts(p, { brand: brandOf(p) }).parts
  const samplePool = list.length ? list : data.products
  const sample = samplePool.find(p => p.id === sampleId) || samplePool.find(p => data.titles.get(p.id)) || samplePool[0]

  function payloadOf(p) {
    const pre = presetParts(p, { brand: brandOf(p) })
    const d = data.desc.get(p.id)
    const famFacts = data.facts.filter(f => f.family_id === p.family_id || (f.level === 'marka' && f.brand_id === p.brand_id))
    return { product_id: p.id, sku: p.sku, name: p.name, category: data.dicts.catById.get(p.bl_category_id)?.path || '', brand: brandOf(p), params: p.features || {},
      preset: pre.parts, hints: pre.hints, facts: factsFor(famFacts, p.id).map(f => f.content).slice(0, 15),
      bundle: p.is_bundle ? (p.bundle_items || []).filter(b => !b.gift).map(b => `${b.quantity || 1} × ${b.name || b.sku || b.bl_id}`) : [],
      gifts: p.is_bundle ? (p.bundle_items || []).filter(b => b.gift).map(b => b.name || b.sku) : [],
      primary_keyword: d?.meta?.keyword_map?.primary_keyword || '' }
  }

  async function generate() {
    const chosen = data.products.filter(p => sel.has(p.id))
    const approved = chosen.filter(p => data.titles.get(p.id)?.status === 'zatwierdzony')
    if (approved.length && !window.confirm(`${plN(approved.length, 'produkt ma', 'produkty mają', 'produktów ma')} zatwierdzony tytuł – nowy zastąpi go jako propozycja. Kontynuować?`)) return
    const groups = new Map()
    for (const p of chosen) { const pat = patOf(p); const k = pat.id || 'default'; if (!groups.has(k)) groups.set(k, { pat, items: [] }); groups.get(k).items.push(p) }
    const chunks = [...groups.values()].flatMap(g => { const out = []; for (let i = 0; i < g.items.length; i += CHUNK) out.push({ pat: g.pat, items: g.items.slice(i, i + CHUNK) }); return out })
    let done = 0; const failed = []
    for (let i = 0; i < chunks.length; i++) {
      const { pat, items } = chunks[i]
      setJob({ busy: true, progress: `Tytuły: paczka ${i + 1} z ${chunks.length}` })
      try {
        const r = await runJob('generate_titles', { market: `${data.channel.marketplace} ${data.channel.language.toUpperCase()}`, pattern: { tokens: pat.tokens, instructions: pat.instructions || '' },
          token_defs: Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => [k, v.ai])), products: items.map(payloadOf) }, { timeoutSec: 600, progress: `paczka ${i + 1} z ${chunks.length}` })
        const rows = (r?.items || []).map(it => {
          const a = assembleTitle(pat, it.parts)
          const notes = [...(it.notes || []), ...(a.dropped.length ? [`skrócono: ${a.dropped.map(k => TOKENS[k]?.label).join(', ')}`] : []), ...(a.missing.length ? [`brak elementów obowiązkowych: ${a.missing.map(k => TOKENS[k]?.label).join(', ')}`] : []), ...(a.over ? [`tytuł dłuższy niż ${pat.max_len} zn.`] : [])]
          return { product_id: it.product_id, channel_id: data.channel.id, pattern_id: pat.id || null, parts: it.parts, title: a.title, source: 'ai', status: 'propozycja', notes }
        }).filter(x => x.title)
        if (rows.length) { const { error } = await supabase.from('product_titles').upsert(rows, { onConflict: 'product_id,channel_id' }); if (error) throw error }
        done += rows.length
        if (r?.missing?.length) failed.push(`bez odpowiedzi AI: ${r.missing.join(', ')}`)
      } catch (e) { failed.push(e.message); if (!done && failed.length >= 2) break }
    }
    setJob(failed.length ? { error: `Utworzono ${done} tytułów. ${failed.join(' · ')}` } : { ok: `Utworzono ${plN(done, 'tytuł', 'tytuły', 'tytułów')} – sprawdź i zatwierdź.` })
    load()
  }

  async function reassemble() {
    const rows = data.products.filter(p => sel.has(p.id) && data.titles.get(p.id)?.parts && data.titles.get(p.id).source === 'ai').map(p => {
      const t = data.titles.get(p.id), pat = patOf(p), a = assembleTitle(pat, t.parts)
      return { id: t.id, product_id: p.id, channel_id: data.channel.id, pattern_id: pat.id || null, parts: t.parts, title: a.title, source: 'ai', status: a.title === t.title ? t.status : 'propozycja', notes: t.notes }
    })
    if (!rows.length) { setJob({ error: 'Brak zaznaczonych tytułów z AI do przeliczenia (tytuły wpisane ręcznie zostają bez zmian).' }); return }
    const { error } = await supabase.from('product_titles').upsert(rows, { onConflict: 'product_id,channel_id' })
    setJob(error ? { error: plError(error.message) } : { ok: `Przeliczono ${plN(rows.length, 'tytuł', 'tytuły', 'tytułów')} wg aktualnych wzorów.` }); load()
  }

  async function setStatusFor(st) {
    const ids = [...sel].map(id => data.titles.get(id)?.id).filter(Boolean)
    if (!ids.length) { setJob({ error: 'Zaznaczone produkty nie mają jeszcze tytułów.' }); return }
    const { error } = await supabase.from('product_titles').update({ status: st }).in('id', ids)
    setJob(error ? { error: plError(error.message) } : { ok: st === 'zatwierdzony' ? `Zatwierdzono ${plN(ids.length, 'tytuł', 'tytuły', 'tytułów')}.` : 'Cofnięto do zatwierdzenia.' }); load()
  }

  async function saveManual(p) {
    const value = editing.value.replace(/\s+/g, ' ').trim()
    const t = data.titles.get(p.id)
    setEditing(null)
    if (!value || value === t?.title) return
    const row = { product_id: p.id, channel_id: data.channel.id, pattern_id: t?.pattern_id || patOf(p).id || null, parts: t?.parts || {}, title: value, source: 'ręcznie', status: 'propozycja', notes: [] }
    const { error } = await supabase.from('product_titles').upsert(row, { onConflict: 'product_id,channel_id' })
    if (error) setJob({ error: plError(error.message) }); load()
  }

  const chName = id => data.dicts.catById.get(id)?.path || 'domyślny'
  return (
    <section className="page wide">
      <h1>Tytuły eMAG</h1>
      <p className="muted lead">Tytuł (nazwa produktu w eMAG) składa się z elementów w kolejności ustalonej we wzorze kategorii. AI ustala elementy po węgiersku z danych Baselinkera i faktów, aplikacja układa je wg wzoru i pilnuje długości. Do pliku eMAG trafia zatwierdzony tytuł.</p>

      {edit ? <PatternEditor pat={edit} dicts={data.dicts} sample={sample ? { sku: sample.sku, parts: partsOf(sample) } : null} canEdit={canApprove} onClose={() => setEdit(null)} onSaved={x => { setEdit(x); load() }} /> : (
        <div className="panel">
          <div className="panel-head"><h2 style={{ margin: 0 }}>Wzory tytułów</h2>
            {canApprove && <button className="btn ghost" onClick={() => setEdit({ id: null, channel_id: data.channel.id, bl_category_id: null, name: 'Nowy wzór', tokens: (data.patterns.find(p => !p.bl_category_id)?.tokens) || DEFAULT_TOKENS, max_len: 150, instructions: '' })}>+ Wzór dla kategorii</button>}</div>
          <table className="compact">
            <thead><tr><th>Wzór</th><th>Kategoria</th><th>Kolejność elementów</th><th className="num">Maks.</th></tr></thead>
            <tbody>{data.patterns.map(p => (
              <tr key={p.id}><td><button className="row-toggle" onClick={() => setEdit(p)}>{p.name}</button></td><td className="path">{chName(p.bl_category_id)}</td>
                <td className="small">{(p.tokens || []).map(t => TOKENS[t.key]?.label + (t.required ? '*' : '')).join(' · ')}</td><td className="num">{p.max_len}</td></tr>))}</tbody>
          </table>
          {data.patterns.length === 0 && <p className="hint">Brak wzorów – uruchom migrację 007_tytuly_zestawy.sql.</p>}
        </div>
      )}
      {edit && (
        <label style={{ maxWidth: 520 }}>Produkt do podglądu<select style={{ width: '100%' }} value={sample?.id || ''} onChange={e => setSampleId(e.target.value)}>{samplePool.slice(0, 400).map(p => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
      )}

      <div className="panel">
        <div className="filter-grid">
          <label>Szukaj (SKU, nazwa, tytuł)<input value={q} onChange={e => setQ(e.target.value)} /></label>
          <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">wszystkie</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={onlyFamilies} onChange={e => setOnlyFamilies(e.target.checked)} /> tylko produkty z zatwierdzonych rodzin</label>
        <div className="result-head" style={{ marginTop: 10 }}>
          <span className="summary"><strong>{plN(list.length, 'produkt', 'produkty', 'produktów')}</strong> · zatwierdzone tytuły: {list.filter(p => data.titles.get(p.id)?.status === 'zatwierdzony').length}</span>
          <span className="row-form"><button className="link-dark" onClick={() => setSel(new Set(list.map(p => p.id)))}>Zaznacz wszystkie ({list.length})</button>{sel.size > 0 && <button className="link-dark" onClick={() => setSel(new Set())}>Odznacz</button>}</span>
        </div>
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th className="check" /><th>SKU</th><th>Nazwa w BL</th><th>Tytuł eMAG</th><th className="num">Znaki</th><th>Status</th></tr></thead>
            <tbody>{list.slice(0, 500).map(p => {
              const t = data.titles.get(p.id), pat = patOf(p)
              const len = (t?.title || '').length
              return (
                <tr key={p.id}>
                  <td className="check"><input type="checkbox" checked={sel.has(p.id)} aria-label={`Zaznacz ${p.sku}`} onChange={() => setSel(s => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })} /></td>
                  <td className="mono">{p.sku}{p.is_bundle && <span className="tag info" style={{ marginLeft: 4 }}>zestaw</span>}</td>
                  <td className="name small">{p.name}</td>
                  <td style={{ minWidth: 320 }}>
                    {editing?.id === p.id
                      ? <input autoFocus value={editing.value} onChange={e => setEditing({ id: p.id, value: e.target.value })} onBlur={() => saveManual(p)} onKeyDown={e => { if (e.key === 'Enter') saveManual(p); if (e.key === 'Escape') setEditing(null) }} style={{ margin: 0 }} aria-label={`Tytuł ${p.sku}`} />
                      : <button className="row-toggle" title="Kliknij, aby edytować" onClick={() => setEditing({ id: p.id, value: t?.title || '' })}>{t?.title || <span className="muted">— brak (kliknij, aby wpisać)</span>}</button>}
                    {t?.source === 'ręcznie' && <span className="muted small"> · ręcznie</span>}
                    {(t?.notes || []).length > 0 && <span className="hint-inline small" style={{ display: 'block' }}>{t.notes.join(' · ')}</span>}
                  </td>
                  <td className={'num' + (len > pat.max_len ? ' hint-inline' : '')}>{len ? `${len}/${pat.max_len}` : ''}</td>
                  <td>{t ? <span className={`tag ${t.status === 'zatwierdzony' ? 'okt' : 'warn'}`}>{STATUS[t.status]}</span> : <span className="muted small">{STATUS.brak}</span>}</td>
                </tr>)
            })}</tbody>
          </table>
          {list.length > 500 && <p className="muted small">Pokazano 500 z {list.length} – zawęź wyszukiwanie.</p>}
        </div>
      </div>

      {(sel.size > 0 || job) && (
        <div className="import-bar" role="region" aria-label="Akcje tytułów">
          <div style={{ flex: 1 }}>
            {job?.busy ? <span className="progress-line" role="status">{job.progress}</span> : job?.error ? <span className="error" role="alert">{job.error}</span> : job?.ok ? <span className="ok" role="status">{job.ok}</span> : <strong>Zaznaczono {plN(sel.size, 'produkt', 'produkty', 'produktów')}</strong>}
          </div>
          {sel.size > 0 && !job?.busy && (
            <span className="row-form">
              <button className="btn" onClick={generate}>Generuj tytuły (AI)</button>
              <button className="btn ghost" onClick={reassemble}>Przelicz wg wzoru</button>
              {canApprove && <button className="btn ghost" onClick={() => setStatusFor('zatwierdzony')}>Zatwierdź</button>}
              {canApprove && <button className="link-dark" onClick={() => setStatusFor('propozycja')}>Cofnij zatwierdzenie</button>}
            </span>
          )}
          {job && !job.busy && <button className="link-dark" onClick={() => setJob(null)}>Zamknij</button>}
        </div>
      )}
    </section>
  )
}
