import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase, plError, plN, fetchAll } from '../supabase.js'
import { loadDicts } from '../catalog.js'
import { runJob } from '../jobs.js'
import { TOKENS, SEPARATORS, DEFAULT_TOKENS, assembleTitle, patternFor, presetParts, tokenLabel, tokenAi, aiTokens, validTokens, newCustomKey } from '../titles.js'
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
      <div className="token-list">{tokens.map((x, i) => {
        const upd = p => setTokens(tokens.map((y, j) => j === i ? { ...y, ...p } : y))
        const move = d => { const a = [...tokens]; [a[i + d], a[i]] = [a[i], a[i + d]]; a[0] = { ...a[0], sep: '' }; if (a[1] && !a[1].sep) a[1] = { ...a[1], sep: ' ' }; setTokens(a) }
        return (
          <div key={x.key} className="token-row">
            {x.custom ? <label style={{ margin: 0 }}><span className="small muted">Własny element – nazwa</span><input value={x.label || ''} onChange={e => upd({ label: e.target.value })} placeholder="np. Seria, Kolekcja" /></label>
              : <span><strong>{tokenLabel(x)}</strong><span className="muted small" style={{ display: 'block' }}>{TOKENS[x.key]?.ai}</span></span>}
            <label style={{ margin: 0 }}><span className="small muted">Separator przed</span><select value={x.sep} disabled={i === 0} onChange={e => upd({ sep: e.target.value })}>{Object.entries(SEPARATORS).filter(([k]) => i === 0 || k).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label style={{ margin: 0 }}><span className="small muted">Stała wartość (puste = AI)</span><input value={x.value || ''} onChange={e => upd({ value: e.target.value })} placeholder={x.key === 'marka' ? 'np. Aqua 4 You' : ''} /></label>
            <label className="check small" style={{ margin: 0 }}><input type="checkbox" checked={!!x.required} onChange={e => upd({ required: e.target.checked })} /> obowiązkowy</label>
            <span className="row-form" style={{ gap: 4 }}>
              <button className="link-dark" disabled={i === 0} aria-label="Wyżej" onClick={() => move(-1)}>↑</button>
              <button className="link-dark" disabled={i === tokens.length - 1} aria-label="Niżej" onClick={() => move(1)}>↓</button>
              <button className="link-dark danger" onClick={() => setTokens(tokens.filter((_, j) => j !== i).map((y, j) => j === 0 ? { ...y, sep: '' } : y))}>Usuń</button>
            </span>
            {x.custom && !x.value && <label className="token-ai" style={{ margin: 0 }}><span className="small muted">Co AI ma tu wpisać (instrukcja)</span><input value={x.ai || ''} onChange={e => upd({ ai: e.target.value })} placeholder="np. nazwa kolekcji z faktów, 1–2 słowa" /></label>}
          </div>
        )
      })}</div>
      <div className="row-form" style={{ marginTop: 8 }}>
        {unused.length > 0 && <label style={{ maxWidth: 320 }}>Dodaj element<select value="" onChange={e => e.target.value && setTokens([...tokens, { key: e.target.value, sep: tokens.length ? ', ' : '', required: false }])}><option value="">—</option>{unused.map(k => <option key={k} value={k}>{TOKENS[k].label}</option>)}</select></label>}
        <button className="btn ghost" onClick={() => setTokens([...tokens, { key: newCustomKey(tokens), custom: true, label: '', ai: '', value: '', sep: tokens.length ? ' ' : '', required: false }])}>+ Własny element</button>
      </div>
      <label>Dodatkowe zasady dla AI (opcjonalnie)<textarea rows={2} value={t.instructions || ''} onChange={e => setT({ ...t, instructions: e.target.value })} placeholder="np. typ produktu zawsze w liczbie pojedynczej; dla brodzików podawaj wysokość" /></label>
      <p className="muted small">Za długi tytuł aplikacja skraca, usuwając elementy nieobowiązkowe od końca wzoru. Elementy puste są pomijane.</p>
      {preview && <div className="preview-title"><span className="muted small">Podgląd ({sample.sku}):</span> <strong>{preview.title || '—'}</strong> <span className={preview.over ? 'hint-inline small' : 'muted small'}>{preview.length}/{t.max_len} zn.{preview.dropped.length ? ` · skrócono: ${preview.dropped.map(k => tokenLabel(tokens.find(x => x.key === k))).join(', ')}` : ''}</span>{sample.parts?._pl && <span className="title-pl">PL: {assembleTitle({ ...t, tokens }, sample.parts, 'pl').title}</span>}</div>}
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
  const [partsFor, setPartsFor] = useState(null)   // { id, hu: {}, pl: {} }

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

  // tytuł HU + tłumaczenie PL z elementów wg wzoru, z uwagami o skróceniu i brakach
  function titleRow(pat, parts, baseNotes = []) {
    const a = assembleTitle(pat, parts), pl = assembleTitle(pat, parts, 'pl')
    const lbl = k => tokenLabel(validTokens(pat).find(t => t.key === k))
    const notes = [...baseNotes, ...(a.dropped.length ? [`skrócono: ${a.dropped.map(lbl).join(', ')}`] : []), ...(a.missing.length ? [`brak elementów obowiązkowych: ${a.missing.map(lbl).join(', ')}`] : []), ...(a.over ? [`tytuł dłuższy niż ${pat.max_len} zn.`] : [])]
    return { parts, title: a.title, title_pl: Object.keys(parts?._pl || {}).length ? pl.title : null, notes }
  }

  async function saveParts(p, edited) {
    const t = data.titles.get(p.id), pat = patOf(p)
    const base = t?.parts || presetParts(p, { brand: brandOf(p) }).parts
    const parts = { ...base, _pl: { ...(base._pl || {}) }, _edited: [...new Set([...(base._edited || []), ...Object.keys(edited.hu), ...Object.keys(edited.pl)])] }
    for (const [k, v] of Object.entries(edited.hu)) parts[k] = v
    for (const [k, v] of Object.entries(edited.pl)) parts._pl[k] = v
    const row = { product_id: p.id, channel_id: data.channel.id, pattern_id: pat.id || null, source: 'ai', status: 'propozycja', ...titleRow(pat, parts, (t?.notes || []).filter(n => !/^(skrócono|brak elementów|tytuł dłuższy)/.test(n))) }
    const { error } = await supabase.from('product_titles').upsert(row, { onConflict: 'product_id,channel_id' })
    if (error) { setJob({ error: plError(error.message) }); return }
    setPartsFor(null); load()
  }

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
        const ai = aiTokens(pat)
        if (!ai.length) throw new Error('Wszystkie elementy wzoru mają stałe wartości – nie ma czego generować')
        const r = await runJob('generate_titles', { market: `${data.channel.marketplace} ${data.channel.language.toUpperCase()}`, pattern: { tokens: ai, instructions: pat.instructions || '' },
          token_defs: Object.fromEntries(ai.map(t => [t.key, tokenAi(t)])), products: items.map(payloadOf) }, { timeoutSec: 600, progress: `paczka ${i + 1} z ${chunks.length}` })
        const rows = (r?.items || []).map(it => {
          const parts = { ...it.parts, _pl: it.parts_pl || {} }
          return { product_id: it.product_id, channel_id: data.channel.id, pattern_id: pat.id || null, source: 'ai', status: 'propozycja', ...titleRow(pat, parts, it.notes || []) }
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
      const t = data.titles.get(p.id), pat = patOf(p), x = titleRow(pat, t.parts, (t.notes || []).filter(n => !/^(skrócono|brak elementów|tytuł dłuższy)/.test(n)))
      return { id: t.id, product_id: p.id, channel_id: data.channel.id, pattern_id: pat.id || null, source: 'ai', ...x, status: x.title === t.title ? t.status : 'propozycja' }
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
    const row = { product_id: p.id, channel_id: data.channel.id, pattern_id: t?.pattern_id || patOf(p).id || null, parts: t?.parts || {}, title: value, title_pl: null, source: 'ręcznie', status: 'propozycja', notes: ['tytuł wpisany ręcznie – bez tłumaczenia PL; aby wrócić do elementów, użyj „Elementy”'] }
    const { error } = await supabase.from('product_titles').upsert(row, { onConflict: 'product_id,channel_id' })
    if (error) setJob({ error: plError(error.message) }); load()
  }

  const chName = id => data.dicts.catById.get(id)?.path || 'domyślny'
  return (
    <section className="page wide">
      <h1>Tytuły eMAG</h1>
      <p className="muted lead">Tytuł (nazwa produktu w eMAG) składa się z elementów w kolejności ustalonej we wzorze kategorii. AI ustala elementy po węgiersku (z tłumaczeniem na polski) z danych Baselinkera i faktów; element może mieć stałą wartość we wzorze (np. marka) albo zostać poprawiony w produkcie („Elementy”). Do pliku eMAG trafia zatwierdzony tytuł.</p>

      {edit ? <PatternEditor pat={edit} dicts={data.dicts} sample={sample ? { sku: sample.sku, parts: partsOf(sample) } : null} canEdit={canApprove} onClose={() => setEdit(null)} onSaved={x => { setEdit(x); load() }} /> : (
        <div className="panel">
          <div className="panel-head"><h2 style={{ margin: 0 }}>Wzory tytułów</h2>
            {canApprove && <button className="btn ghost" onClick={() => setEdit({ id: null, channel_id: data.channel.id, bl_category_id: null, name: 'Nowy wzór', tokens: (data.patterns.find(p => !p.bl_category_id)?.tokens) || DEFAULT_TOKENS, max_len: 150, instructions: '' })}>+ Wzór dla kategorii</button>}</div>
          <table className="compact resp">
            <thead><tr><th>Wzór</th><th>Kategoria</th><th>Kolejność elementów</th><th className="num">Maks.</th></tr></thead>
            <tbody>{data.patterns.map(p => (
              <tr key={p.id}><td><button className="row-toggle" onClick={() => setEdit(p)}>{p.name}</button></td><td className="path">{chName(p.bl_category_id)}</td>
                <td className="small">{(p.tokens || []).map(t => tokenLabel(t) + (t.value ? ` („${t.value}”)` : '') + (t.required ? '*' : '')).join(' · ')}</td><td className="num">{p.max_len}</td></tr>))}</tbody>
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
          <table className="compact resp">
            <thead><tr><th className="check" /><th>SKU</th><th>Nazwa w BL</th><th>Tytuł eMAG (HU) i tłumaczenie</th><th className="num">Znaki</th><th>Status</th></tr></thead>
            <tbody>{list.slice(0, 500).map(p => {
              const t = data.titles.get(p.id), pat = patOf(p)
              const len = (t?.title || '').length
              const parts = t?.parts || presetParts(p, { brand: brandOf(p) }).parts
              return (
                <Fragment key={p.id}>
                <tr>
                  <td className="check"><input type="checkbox" checked={sel.has(p.id)} aria-label={`Zaznacz ${p.sku}`} onChange={() => setSel(s => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })} /></td>
                  <td className="mono" data-label="SKU">{p.sku}{p.is_bundle && <span className="tag info" style={{ marginLeft: 4 }}>zestaw</span>}</td>
                  <td className="name small" data-label="Nazwa w BL">{p.name}</td>
                  <td data-label="Tytuł eMAG">
                    {editing?.id === p.id
                      ? <input autoFocus value={editing.value} onChange={e => setEditing({ id: p.id, value: e.target.value })} onBlur={() => saveManual(p)} onKeyDown={e => { if (e.key === 'Enter') saveManual(p); if (e.key === 'Escape') setEditing(null) }} style={{ margin: 0 }} aria-label={`Tytuł ${p.sku}`} />
                      : <button className="row-toggle" title="Kliknij, aby wpisać cały tytuł ręcznie" onClick={() => setEditing({ id: p.id, value: t?.title || '' })}>{t?.title || <span className="muted">— brak (kliknij, aby wpisać)</span>}</button>}
                    {t?.title_pl && <span className="title-pl">PL: {t.title_pl}</span>}
                    {(t?.notes || []).length > 0 && <span className="hint-inline small" style={{ display: 'block' }}>{t.notes.join(' · ')}</span>}
                    <button className="link-dark small" onClick={() => setPartsFor(partsFor?.id === p.id ? null : { id: p.id, hu: {}, pl: {} })}>{partsFor?.id === p.id ? 'Zwiń elementy' : 'Elementy (marka, model…)'}</button>
                  </td>
                  <td className={'num' + (len > pat.max_len ? ' hint-inline' : '')} data-label="Znaki">{len ? `${len}/${pat.max_len}` : ''}</td>
                  <td data-label="Status">{t ? <span className={`tag ${t.status === 'zatwierdzony' ? 'okt' : 'warn'}`}>{STATUS[t.status]}</span> : <span className="muted small">{STATUS.brak}</span>}</td>
                </tr>
                {partsFor?.id === p.id && (
                  <tr className="detail-row"><td colSpan={6}>
                    <p className="muted small" style={{ margin: '4px 0' }}>Elementy tytułu wg wzoru „{pat.name}”. Zmienione tu wartości mają pierwszeństwo przed stałymi wartościami wzoru i AI (np. inna marka dla tego produktu).</p>
                    <div className="parts-grid">{validTokens(pat).map(tk => {
                      const huVal = partsFor.hu[tk.key] ?? ((parts._edited || []).includes(tk.key) ? parts[tk.key] : (tk.value || parts[tk.key])) ?? ''
                      const plVal = partsFor.pl[tk.key] ?? ((parts._edited || []).includes(tk.key) ? parts._pl?.[tk.key] : (tk.value || parts._pl?.[tk.key])) ?? ''
                      return (
                        <div key={tk.key}>
                          <label>{tokenLabel(tk)} (HU)<input value={huVal || ''} onChange={e => setPartsFor(f => ({ ...f, hu: { ...f.hu, [tk.key]: e.target.value } }))} /></label>
                          <label>tłumaczenie PL<input value={plVal || ''} onChange={e => setPartsFor(f => ({ ...f, pl: { ...f.pl, [tk.key]: e.target.value } }))} /></label>
                        </div>)
                    })}</div>
                    {(() => { const prev = { ...parts, _pl: { ...(parts._pl || {}), ...partsFor.pl }, ...partsFor.hu, _edited: [...new Set([...(parts._edited || []), ...Object.keys(partsFor.hu), ...Object.keys(partsFor.pl)])] }
                      return <p className="small" style={{ margin: '4px 0 8px' }}>Podgląd: <strong>{assembleTitle(pat, prev).title || '—'}</strong><span className="title-pl">PL: {assembleTitle(pat, prev, 'pl').title || '—'}</span></p> })()}
                    <span className="row-form"><button className="btn" disabled={!Object.keys(partsFor.hu).length && !Object.keys(partsFor.pl).length} onClick={() => saveParts(p, partsFor)}>Zapisz elementy</button><button className="link-dark" onClick={() => setPartsFor(null)}>Anuluj</button></span>
                  </td></tr>
                )}
                </Fragment>)
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
