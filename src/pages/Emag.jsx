import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, plError, plN, fmtDate, fetchAll } from '../supabase.js'
import { runJob } from '../jobs.js'
import { parseTemplate, fillTemplate, FILE_TYPE_LABEL } from '../emagXlsx.js'
import { presetCharacteristics, chooseFamilyType, characteristicIssues, buildRow, rowProblems, NUMERIC_COLUMNS, matchAllowed } from '../emag.js'
import { factsFor } from '../gen.js'
import DrainLoader from '../components/DrainLoader.jsx'

const PCOLS = 'id, sku, ean, name, family_id, brand_id, bl_category_id, baselinker_product_id, features, extra_fields, images, weight, description_pl'
const OK_DESC = ['zaakceptowany', 'opublikowany']
const CSTATUS = { do_weryfikacji: 'do weryfikacji', zaakceptowany: 'zatwierdzone', do_generacji: 'do uzupełnienia' }

const toB64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0))
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---------- szablony ----------
function TemplatesPanel({ channel, templates, canEdit, onChanged }) {
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  async function upload(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const buf = await file.arrayBuffer()
      const t = await parseTemplate(buf)
      if (!['create', 'update', 'family'].includes(t.file_type)) throw new Error(`Nieobsługiwany rodzaj pliku eMAG (${t.file_type}).`)
      const { columns, characteristics, family_types, languages, has_families } = t
      const row = { channel_id: channel.id, file_type: t.file_type, category_id: t.category_id, template_id: t.template_id, category_name: t.category_name, file_name: file.name,
        file_b64: toB64(buf), structure: { columns, characteristics, family_types, languages, has_families }, uploaded_at: new Date().toISOString() }
      const { error } = await supabase.from('emag_templates').upsert(row, { onConflict: 'channel_id,category_id,file_type' })
      if (error) throw error
      setMsg({ type: 'ok', text: `Wczytano: ${FILE_TYPE_LABEL[t.file_type]} · kategoria ${t.category_id} (${t.category_name || '—'}) · ${characteristics.length} charakterystyk · ${family_types.length} typów rodzin.` })
      onChanged()
    } catch (err) { setMsg({ type: 'error', text: plError(err.message) }) }
    setBusy(false)
  }
  return (
    <div className="panel">
      <div className="panel-head"><h2 style={{ margin: 0 }}>Szablony importu eMAG</h2>
        {canEdit && <label className="btn ghost upload" style={{ margin: 0 }}>{busy ? 'Wczytywanie…' : 'Wgraj szablon (.xlsx)'}<input type="file" accept=".xlsx" hidden onChange={upload} disabled={busy} /></label>}
      </div>
      <p className="muted small">Pliki pobrane z eMAG Marketplace → Produkty → Kategorie (create-product, update-product, update-product-family). eMAG przyjmuje tylko własne pliki – aplikacja wypełnia oryginalny szablon. Każda kategoria eMAG ma swoje pliki.</p>
      {templates.length === 0 ? <p className="hint">Brak szablonów. Wgraj co najmniej plik create-product dla kategorii.</p> : (
        <table className="compact"><thead><tr><th>Rodzaj</th><th>Kategoria eMAG</th><th className="num">Charakterystyki</th><th className="num">Typy rodzin</th><th>Plik</th><th>Wgrano</th></tr></thead>
          <tbody>{templates.map(t => (
            <tr key={t.id}><td>{FILE_TYPE_LABEL[t.file_type]}</td><td>{t.category_id} · {t.category_name || '—'}</td><td className="num">{t.structure?.characteristics?.length || 0}</td>
              <td className="num">{t.structure?.family_types?.length || 0}</td><td className="small mono">{t.file_name}</td><td className="small">{fmtDate(t.uploaded_at)}</td></tr>))}</tbody></table>
      )}
      {msg && <p className={msg.type} role="status">{msg.text}</p>}
    </div>
  )
}

// ---------- edytor charakterystyk rodziny ----------
function FamilyEditor({ fam, members, chars, familyTypes, saved, canApprove, onSaved }) {
  const [vals, setVals] = useState(() => Object.fromEntries(members.map(p => [p.id, { ...(saved.get(p.id)?.values || {}) }])))
  const [name, setName] = useState(fam.emag_family_name || '')
  const [type, setType] = useState(fam.emag_family_type || '')
  const [all, setAll] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const auto = useMemo(() => chooseFamilyType(familyTypes, chars, members.map(p => ({ values: vals[p.id] }))), [vals])
  const shown = chars.filter(c => all || c.level === 'mandatory' || members.some(p => vals[p.id]?.[c.key]?.value))
  const set = (pid, key, value) => setVals(v => ({ ...v, [pid]: { ...v[pid], [key]: value ? { value, origin: 'ręcznie' } : undefined } }))

  async function save(approve) {
    setBusy(true); setMsg(null)
    try {
      const rows = members.map(p => {
        const values = Object.fromEntries(Object.entries(vals[p.id] || {}).filter(([, x]) => x && x.value))
        return { product_id: p.id, channel_id: fam._channel, marketplace_category_id: fam._category, values,
          missing_mandatory: characteristicIssues(chars, values).missing, status: approve ? 'zaakceptowany' : 'do_weryfikacji' }
      })
      const r1 = await supabase.from('product_characteristics').upsert(rows, { onConflict: 'product_id,channel_id' }); if (r1.error) throw r1.error
      const r2 = await supabase.from('product_families').update({ emag_family_name: name.trim() || null, emag_family_type: type || null }).eq('id', fam.id); if (r2.error) throw r2.error
      setMsg({ type: 'ok', text: approve ? 'Zapisano i zatwierdzono charakterystyki.' : 'Zapisano.' }); onSaved()
    } catch (e) { setMsg({ type: 'error', text: plError(e.message) }) }
    setBusy(false)
  }

  return (
    <div style={{ padding: '8px 0 14px' }}>
      <div className="filter-grid">
        <label>Nazwa rodziny w eMAG (HU, bez wymiarów i koloru)<input value={name} onChange={e => setName(e.target.value)} placeholder={fam.name} /></label>
        <label>Typ rodziny eMAG<select value={type} onChange={e => setType(e.target.value)}>
          <option value="">{auto.type ? `automatycznie: ${auto.type}` : 'brak – produkty osobno'}</option>
          {familyTypes.map(t => <option key={t.id} value={t.label}>{t.label}</option>)}
        </select>{!auto.type && members.length > 1 && <span className="field-help hint-inline">{auto.why}</span>}</label>
      </div>
      <div className="row-form" style={{ margin: '10px 0' }}><label className="check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> pokaż wszystkie charakterystyki ({chars.length})</label></div>
      <div className="variant-cards">
        {members.map(p => (
          <div key={p.id} className="variant-card">
            <div className="variant-card-head"><span className="mono">{p.sku}</span><span className="muted small">{p.name}</span></div>
            <div className="char-fields">
              {shown.map(c => {
                const cur = vals[p.id]?.[c.key]?.value || '', origin = vals[p.id]?.[c.key]?.origin || ''
                const bad = c.restrictive && cur && !matchAllowed(cur, c.values)
                return (
                  <label key={c.key} className={'char-field' + (bad ? ' tr-miss' : !cur && c.level === 'mandatory' ? ' empty-cell' : '')} title={origin ? `źródło: ${origin}` : c.key}>
                    <span className="char-name">{c.name}{c.level === 'mandatory' && <span className="req"> *</span>}</span>
                    {c.restrictive
                      ? <select value={matchAllowed(cur, c.values) || ''} onChange={e => set(p.id, c.key, e.target.value)}><option value="">—</option>{c.values.map(v => <option key={v} value={v}>{v}</option>)}</select>
                      : <input value={cur} list={`dl-${c.id}`} onChange={e => set(p.id, c.key, e.target.value)} />}
                    <span className="char-meta">{origin && <span className="muted">{origin}</span>}
                      {members.length > 1 && cur && <button type="button" className="link-dark" onClick={e => { e.preventDefault(); setVals(v => Object.fromEntries(Object.entries(v).map(([pid, x]) => [pid, { ...x, [c.key]: { value: cur, origin: 'ręcznie' } }]))) }}>do wszystkich</button>}</span>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
        {shown.filter(c => !c.restrictive).map(c => <datalist key={c.id} id={`dl-${c.id}`}>{c.values.slice(0, 200).map(v => <option key={v} value={v} />)}</datalist>)}
      </div>
      <div className="row-form" style={{ marginTop: 10 }}>
        <button className="btn ghost" disabled={busy} onClick={() => save(false)}>Zapisz</button>
        {canApprove && <button className="btn" disabled={busy} onClick={() => save(true)}>Zapisz i zatwierdź</button>}
        <span className="muted small">* obowiązkowe · listy rozwijane = słownik eMAG · pod polem źródło wartości (BL, AI, ręcznie) · „do wszystkich” kopiuje wartość do pozostałych wariantów</span>
      </div>
      {msg && <p className={msg.type} role="status">{msg.text}</p>}
    </div>
  )
}

export default function Emag({ profile }) {
  const canEdit = ['akceptujacy', 'admin'].includes(profile?.role)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [catId, setCatId] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [job, setJob] = useState(null)
  const [fileType, setFileType] = useState('create')
  const [includeIncomplete, setIncludeIncomplete] = useState(false)

  async function load() {
    try {
      const { data: chs } = await supabase.from('channels').select('*').eq('active', true).order('code')
      const channel = (chs || []).find(c => c.code === 'emag_hu') || (chs || [])[0]
      if (!channel) throw new Error('Brak aktywnego kanału.')
      const [tpls, fams, prods, chars, descs, facts, titlesRows, brands, cats, exports] = await Promise.all([
        supabase.from('emag_templates').select('id, channel_id, file_type, category_id, template_id, category_name, file_name, structure, uploaded_at').eq('channel_id', channel.id).order('category_id'),
        fetchAll('product_families', 'id, name, brand_id, bl_category_id, lead_product_id, status, emag_family_id, emag_family_name, emag_family_type', x => x.eq('status', 'zatwierdzone').order('name')),
        fetchAll('products', PCOLS, x => x.not('family_id', 'is', null)),
        fetchAll('product_characteristics', 'product_id, channel_id, marketplace_category_id, values, missing_mandatory, status', x => x.eq('channel_id', channel.id)),
        fetchAll('descriptions', 'id, product_id, version, status, fields, html', x => x.eq('channel_id', channel.id).in('status', OK_DESC).order('version', { ascending: false })),
        fetchAll('kb_facts', 'id, content, level, family_id, brand_id, variant_ids', x => x.eq('status', 'zatwierdzony')),
        fetchAll('product_titles', 'product_id, title, status', x => x.eq('channel_id', channel.id)),
        fetchAll('brands', 'id, name'), fetchAll('bl_categories', 'bl_category_id, path'),
        supabase.from('emag_exports').select('id, file_type, category_id, product_count, created_at').order('created_at', { ascending: false }).limit(5),
      ])
      if (tpls.error) throw tpls.error
      const members = new Map(); prods.forEach(p => { if (!members.has(p.family_id)) members.set(p.family_id, []); members.get(p.family_id).push(p) })
      members.forEach(list => list.sort((a, b) => a.sku.localeCompare(b.sku)))
      const desc = new Map(); descs.forEach(d => { if (!desc.has(d.product_id)) desc.set(d.product_id, d) })
      const saved = new Map(chars.map(c => [c.product_id, c]))
      setData({ channel, templates: tpls.data || [], families: fams, members, desc, saved, facts, titles: new Map(titlesRows.map(t => [t.product_id, t])), brands: new Map(brands.map(b => [b.id, b.name])), cats: new Map(cats.map(c => [c.bl_category_id, c.path])), exports: exports.data || [] })
      if (!catId && (tpls.data || []).length) setCatId(String(tpls.data.find(t => t.file_type === 'create')?.category_id || tpls.data[0].category_id))
    } catch (e) { setError(plError(e.message)) }
  }
  useEffect(() => { load() }, [])

  const base = data?.templates.find(t => String(t.category_id) === catId && t.file_type === 'create') || data?.templates.find(t => String(t.category_id) === catId)
  const chars = base?.structure?.characteristics || []
  const familyTypes = base?.structure?.family_types || []
  const list = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.families.filter(f => (data.members.get(f.id) || []).length && (!s || f.name.toLowerCase().includes(s) || (data.members.get(f.id) || []).some(p => p.sku.toLowerCase().includes(s))))
  }, [data, q])

  const famState = f => {
    const m = data.members.get(f.id) || []
    const descOk = m.filter(p => data.desc.has(p.id)).length
    const ch = m.map(p => data.saved.get(p.id)).filter(x => x && String(x.marketplace_category_id) === catId)
    const missing = ch.filter(x => (x.missing_mandatory || []).length).length
    const approved = ch.length === m.length && ch.every(x => x.status === 'zaakceptowany')
    return { m, descOk, filled: ch.length, missing, approved }
  }

  async function fillCharacteristics() {
    const fams = data.families.filter(f => sel.has(f.id))
    const failed = []; let done = 0
    for (let i = 0; i < fams.length; i++) {
      const f = fams[i], m = data.members.get(f.id) || []
      setJob({ busy: true, progress: `Charakterystyki: rodzina ${i + 1} z ${fams.length} (${f.name})` })
      const famFacts = data.facts.filter(x => x.family_id === f.id || (x.level === 'marka' && x.brand_id === f.brand_id))
      const variants = m.map(p => { const pre = presetCharacteristics(chars, p, { categoryPath: data.cats.get(p.bl_category_id) || '' })
        return { product_id: p.id, sku: p.sku, name: p.name, params: p.features || {}, facts: factsFor(famFacts, p.id).map(x => x.content), title: (data.titles.get(p.id)?.status === 'zatwierdzony' && data.titles.get(p.id).title) || data.desc.get(p.id)?.fields?.TITLE || '', preset: pre.values, notes: pre.notes } })
      try {
        await runJob('emag_characteristics', { family_id: f.id, channel_id: data.channel.id, category_id: base.category_id, category_name: base.category_name,
          family: { name: f.name, brand: data.brands.get(f.brand_id) || '', category: data.cats.get(f.bl_category_id) || '' },
          characteristics: chars.map(c => ({ key: c.key, name: c.name, level: c.level, restrictive: c.restrictive, values: c.restrictive ? c.values : c.values.slice(0, 25) })), variants }, { timeoutSec: 600, progress: f.name })
        done++
      } catch (e) { failed.push(`${f.name}: ${e.message}`); if (failed.length >= 2 && !done) break }
    }
    setJob(failed.length ? { error: `Uzupełniono ${done} z ${fams.length}. ${failed.join(' · ')}` } : { ok: `Uzupełniono charakterystyki ${plN(done, 'rodziny', 'rodzin', 'rodzin')} – sprawdź je i zatwierdź.` })
    load()
  }

  async function exportFile() {
    const tpl = data.templates.find(t => String(t.category_id) === catId && t.file_type === fileType)
    if (!tpl) { setJob({ error: `Brak wgranego szablonu „${FILE_TYPE_LABEL[fileType]}” dla kategorii ${catId}.` }); return }
    setJob({ busy: true, progress: 'Przygotowanie pliku…' })
    try {
      const { data: full, error } = await supabase.from('emag_templates').select('file_b64, structure').eq('id', tpl.id).single()
      if (error) throw error
      const structure = { ...full.structure, characteristics: full.structure.characteristics || chars }
      const rows = [], skipped = [], famIds = []
      for (const f of data.families.filter(x => sel.has(x.id))) {
        const m = data.members.get(f.id) || []
        const vals = m.map(p => ({ values: data.saved.get(p.id)?.values || {} }))
        const type = f.emag_family_type || chooseFamilyType(structure.family_types, structure.characteristics, vals).type
        const family = { id: f.emag_family_id, name: f.emag_family_name || f.name, type, size: m.length }
        famIds.push(f.id)
        for (const p of m) {
          const tt = data.titles.get(p.id)
          const row = buildRow(fileType, { product: p, description: data.desc.get(p.id), title: tt?.status === 'zatwierdzony' ? tt.title : '', brand: data.channel.limits?.export_brand || data.brands.get(p.brand_id) || data.brands.get(f.brand_id) || '', values: data.saved.get(p.id)?.values || {}, family, template: structure })
          const probs = rowProblems(fileType, row, structure.characteristics)
          if (tt?.status !== 'zatwierdzony' && row.name) probs.push(`tytuł z opisu – brak zatwierdzonego tytułu w module Tytuły eMAG`)
          if (m.length > 1 && !type) probs.push('rodzina bez typu eMAG – produkt trafi jako osobny')
          if (probs.length && !includeIncomplete && probs.some(x => !x.startsWith('rodzina bez typu') && !x.startsWith('tytuł z opisu'))) skipped.push({ sku: p.sku, problems: probs })
          else { rows.push(row); if (probs.length) skipped.push({ sku: p.sku, problems: probs, included: true }) }
        }
      }
      if (!rows.length) { setJob({ error: 'Żaden produkt nie spełnia wymagań eksportu.', skipped }); return }
      const bytes = await fillTemplate(fromB64(full.file_b64), rows, { numeric: NUMERIC_COLUMNS })
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
      download(bytes, `emag-${fileType}-${tpl.category_id}-${stamp}.xlsx`)
      const { data: { session } } = await supabase.auth.getSession()
      await supabase.from('emag_exports').insert({ channel_id: data.channel.id, emag_template_id: tpl.id, file_type: fileType, category_id: tpl.category_id, family_ids: famIds, product_count: rows.length, skipped, created_by: session.user.id })
      setJob({ ok: `Wygenerowano plik z ${plN(rows.length, 'produktem', 'produktami', 'produktami')}. Wgraj go w eMAG Marketplace → Import XLS.`, skipped })
      load()
    } catch (e) { setJob({ error: plError(e.message) }) }
  }

  if (error) return <section className="page"><h1>eMAG</h1><p className="error">{error}</p></section>
  if (!data) return <section className="page"><DrainLoader /></section>
  const catIds = [...new Set(data.templates.map(t => String(t.category_id)))]

  return (
    <section className="page wide">
      <h1>Eksport do eMAG</h1>
      <p className="muted lead">Charakterystyki produktów (z danych Baselinkera dopasowanych do słowników eMAG i uzupełnione przez AI), rodziny eMAG i generowanie pliku importu. Do pliku trafiają zaakceptowane opisy HU i zatwierdzone tytuły (ekran Tytuły eMAG); marka w pliku: {data.channel.limits?.export_brand || 'z Baselinkera'}. Stan: 1 szt., czas wysyłki: 2 dni, gwarancja z Baselinkera; ceny, VAT i dane GPSR na razie puste.</p>
      <TemplatesPanel channel={data.channel} templates={data.templates} canEdit={canEdit} onChanged={load} />

      {base && (<>
        <div className="panel">
          <div className="filter-grid">
            <label>Kategoria eMAG<select value={catId} onChange={e => { setCatId(e.target.value); setSel(new Set()) }}>{catIds.map(id => <option key={id} value={id}>{id} · {data.templates.find(t => String(t.category_id) === id)?.category_name}</option>)}</select></label>
            <label>Szukaj rodziny lub SKU<input value={q} onChange={e => setQ(e.target.value)} /></label>
          </div>
          <p className="muted small" style={{ margin: '8px 0 0' }}>Rodziny zatwierdzone na ekranie <Link to="/rodziny">Rodziny produktów</Link>. Charakterystyki: {chars.filter(c => c.level === 'mandatory').map(c => c.name).join(', ')} – obowiązkowe; pozostałe {chars.length - chars.filter(c => c.level === 'mandatory').length} zalecane (filtry na eMAG).</p>
        </div>
        <div className="panel">
          <div className="result-head">
            <span className="summary"><strong>{plN(list.length, 'rodzina', 'rodziny', 'rodzin')}</strong></span>
            <span className="row-form"><button className="link-dark" onClick={() => setSel(new Set(list.map(f => f.id)))}>Zaznacz wszystkie ({list.length})</button>{sel.size > 0 && <button className="link-dark" onClick={() => setSel(new Set())}>Odznacz</button>}</span>
          </div>
          <div className="table-wrap">
            <table className="compact resp">
              <thead><tr><th className="check" /><th>Rodzina</th><th className="num">Warianty</th><th>Opisy HU</th><th>Charakterystyki</th><th>Typ rodziny eMAG</th><th className="num">ID rodziny</th></tr></thead>
              <tbody>{list.map(f => { const st = famState(f)
                const auto = st.filled ? chooseFamilyType(familyTypes, chars, st.m.map(p => ({ values: data.saved.get(p.id)?.values || {} }))) : null
                return (
                  <Fragment key={f.id}>
                    <tr>
                      <td className="check"><input type="checkbox" checked={sel.has(f.id)} aria-label={`Zaznacz ${f.name}`} onChange={() => setSel(s => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })} /></td>
                      <td className="name"><button className="row-toggle" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>{f.name}</button>{f.emag_family_name && <span className="muted small"> · {f.emag_family_name}</span>}</td>
                      <td className="num" data-label="Warianty">{st.m.length}</td>
                      <td data-label="Opisy HU">{st.descOk === st.m.length ? <span className="tag okt">{st.descOk}/{st.m.length}</span> : <span className="tag warn">{st.descOk}/{st.m.length} zaakceptowanych</span>}</td>
                      <td data-label="Charakterystyki">{!st.filled ? <span className="muted small">nie uzupełniono</span> : st.approved ? <span className="tag okt">zatwierdzone</span> : st.missing ? <span className="tag warn">braki obowiązkowe: {st.missing}</span> : <span className="tag info">{st.filled}/{st.m.length} do weryfikacji</span>}</td>
                      <td className="small" data-label="Typ rodziny eMAG">{st.m.length < 2 ? <span className="muted">—</span> : f.emag_family_type || (auto?.type ? <span title="dobrany automatycznie">{auto.type}</span> : <span className="hint-inline">{st.filled ? 'brak pasującego typu' : '—'}</span>)}</td>
                      <td className="num mono" data-label="ID rodziny">{f.emag_family_id}</td>
                    </tr>
                    {open === f.id && <tr className="detail-row"><td colSpan={7}>
                      <FamilyEditor key={`${f.id}-${catId}-${st.filled}`} fam={{ ...f, _channel: data.channel.id, _category: base.category_id }} members={st.m} chars={chars} familyTypes={familyTypes} saved={data.saved} canApprove={canEdit} onSaved={load} />
                    </td></tr>}
                  </Fragment>
                ) })}</tbody>
            </table>
          </div>
        </div>
      </>)}

      {data.exports.length > 0 && <p className="muted small">Ostatnie pliki: {data.exports.map(x => `${fmtDate(x.created_at)} ${x.file_type} (${x.product_count})`).join(' · ')}</p>}

      {(sel.size > 0 || job) && base && (
        <div className="import-bar" role="region" aria-label="Akcje eMAG">
          <div style={{ flex: 1 }}>
            {job?.busy ? <span className="progress-line" role="status">{job.progress}</span>
              : job?.error ? <span className="error" role="alert">{job.error}</span>
              : job?.ok ? <span className="ok" role="status">{job.ok}</span>
              : <strong>Zaznaczono {plN(sel.size, 'rodzinę', 'rodziny', 'rodzin')}</strong>}
            {job?.skipped?.length > 0 && <details style={{ marginTop: 6 }}><summary className="small">Produkty z uwagami ({job.skipped.length})</summary>
              <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{job.skipped.slice(0, 60).map((s, i) => <li key={i} className={s.included ? 'hint' : 'error'}>{s.sku}{s.included ? ' (w pliku)' : ' (pominięty)'}: {s.problems.join('; ')}</li>)}</ul></details>}
          </div>
          {sel.size > 0 && !job?.busy && (
            <span className="row-form">
              <button className="btn ghost" onClick={fillCharacteristics}>Uzupełnij charakterystyki (BL + AI)</button>
              <select value={fileType} onChange={e => setFileType(e.target.value)} aria-label="Rodzaj pliku">{['create', 'update', 'family'].filter(t => data.templates.some(x => String(x.category_id) === catId && x.file_type === t)).map(t => <option key={t} value={t}>{FILE_TYPE_LABEL[t]}</option>)}</select>
              <label className="check small"><input type="checkbox" checked={includeIncomplete} onChange={e => setIncludeIncomplete(e.target.checked)} /> także niekompletne</label>
              <button className="btn" onClick={exportFile}>Generuj plik eMAG</button>
            </span>
          )}
          {job && !job.busy && <button className="link-dark" onClick={() => setJob(null)}>Zamknij</button>}
        </div>
      )}
    </section>
  )
}
