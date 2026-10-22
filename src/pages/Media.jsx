import { useEffect, useMemo, useState } from 'react'
import { supabase, plError, plN, fetchAll } from '../supabase.js'
import { uploadMedia, deleteMedia, loadMedia, usageOf, checkFile, ACCEPT, ROLE_SUGGESTIONS, baseName } from '../media.js'
import DrainLoader from '../components/DrainLoader.jsx'

const kb = n => n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`

function MediaCard({ m, brands, templates, canEdit, onChanged }) {
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ name: m.name || '', brand_id: m.brand_id || '', role: m.role || '', tags: (m.tags || []).join(', ') })
  const [msg, setMsg] = useState('')
  const used = usageOf(m, templates)
  async function save() {
    const { error } = await supabase.from('media_library').update({ name: f.name.trim() || m.name, brand_id: f.brand_id || null, scope: f.brand_id ? 'marka' : 'ogolna', role: f.role.trim(),
      tags: f.tags.split(',').map(s => s.trim()).filter(Boolean) }).eq('id', m.id)
    if (error) { setMsg(plError(error.message)); return }
    setEdit(false); onChanged()
  }
  async function remove() {
    if (!window.confirm(used.length ? `Grafika jest użyta w szablonach (${used.join(', ')}). Po usunięciu zniknie z nowych opisów i z opisów już wygenerowanych. Usunąć?` : `Usunąć grafikę „${m.name}”?`)) return
    try { await deleteMedia(m); onChanged() } catch (e) { setMsg(plError(e.message)) }
  }
  async function copy() { try { await navigator.clipboard.writeText(m.url); setMsg('Skopiowano adres.') } catch { setMsg(m.url) } }
  return (
    <div className="media-tile card">
      <a href={m.url} target="_blank" rel="noreferrer" className="media-img"><img src={m.url} alt={m.name} loading="lazy" /></a>
      {!edit ? (<>
        <span className="media-name" title={m.name}>{m.name}</span>
        <span className="muted small">{[brands.get(m.brand_id) || 'ogólna', m.role].filter(Boolean).join(' · ')}</span>
        <span className="muted small">{m.width ? `${m.width}×${m.height} px · ` : ''}{kb(m.size_bytes)}</span>
        {(m.tags || []).length > 0 && <span className="small">{m.tags.map(t => <span key={t} className="tag">{t}</span>)}</span>}
        {used.length > 0 && <span className="small okt-text" title={used.join('\n')}>w szablonach: {used.length}</span>}
        <span className="row-form small" style={{ marginTop: 4 }}>
          <button className="link-dark" onClick={copy}>Kopiuj adres</button>
          {canEdit && <button className="link-dark" onClick={() => setEdit(true)}>Edytuj</button>}
          {canEdit && <button className="link-dark danger" onClick={remove}>Usuń</button>}
        </span>
      </>) : (<>
        <label>Nazwa<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label>Marka<select value={f.brand_id} onChange={e => setF({ ...f, brand_id: e.target.value })}><option value="">ogólna (bez marki)</option>{[...brands].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
        <label>Rola w szablonie<input value={f.role} list="media-roles" onChange={e => setF({ ...f, role: e.target.value })} /></label>
        <label>Tagi (po przecinku)<input value={f.tags} onChange={e => setF({ ...f, tags: e.target.value })} /></label>
        <span className="row-form"><button className="btn" onClick={save}>Zapisz</button><button className="link-dark" onClick={() => setEdit(false)}>Anuluj</button></span>
      </>)}
      {msg && <span className="small muted" style={{ wordBreak: 'break-all' }}>{msg}</span>}
    </div>
  )
}

export default function Media({ profile }) {
  const canEdit = ['akceptujacy', 'admin'].includes(profile?.role)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [up, setUp] = useState({ brand_id: '', role: '', tags: '' })
  const [progress, setProgress] = useState(null)
  const [drag, setDrag] = useState(false)

  async function load() {
    try {
      const [media, brands, tpls] = await Promise.all([loadMedia(), fetchAll('brands', 'id, name'), supabase.from('templates').select('id, name, sections')])
      setData({ media, brands: new Map(brands.map(b => [b.id, b.name])), templates: tpls.data || [] })
    } catch (e) { setErr(plError(e.message)) }
  }
  useEffect(() => { load() }, [])

  async function uploadFiles(files) {
    files = [...files]; if (!files.length) return
    const errors = []; let ok = 0
    for (let i = 0; i < files.length; i++) {
      setProgress({ text: `Wgrywanie ${i + 1} z ${files.length}: ${files[i].name}` })
      const bad = checkFile(files[i]); if (bad) { errors.push(bad); continue }
      try {
        await uploadMedia(files[i], { name: baseName(files[i]), brandId: up.brand_id || null, brandName: data.brands.get(up.brand_id) || '', role: up.role, tags: up.tags.split(',').map(s => s.trim()).filter(Boolean) })
        ok++
      } catch (e) { errors.push(`${files[i].name}: ${plError(e.message)}`) }
    }
    setProgress({ text: `Wgrano ${plN(ok, 'grafikę', 'grafiki', 'grafik')}.`, errors })
    load()
  }

  const list = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    return data.media.filter(m => (!brand || (brand === '-' ? !m.brand_id : m.brand_id === brand))
      && (!s || [m.name, m.role, ...(m.tags || []), data.brands.get(m.brand_id)].some(x => (x || '').toLowerCase().includes(s))))
  }, [data, q, brand])

  if (err) return <section className="page"><h1>Grafiki</h1><p className="error">{err}</p></section>
  if (!data) return <section className="page"><DrainLoader /></section>
  const brandOpts = [...data.brands].sort((a, b) => a[1].localeCompare(b[1]))
  const roles = [...new Set([...ROLE_SUGGESTIONS, ...data.media.map(m => m.role).filter(Boolean)])]

  return (
    <section className="page wide">
      <h1>Grafiki</h1>
      <p className="muted lead">Biblioteka grafik do opisów (banery, ikony, grafiki technologii). Pliki leżą na serwerze aplikacji pod stałym publicznym adresem, więc można je wstawiać do szablonów opisów. W szablonie wybierasz konkretną grafikę albo „grafikę marki wg roli” – wtedy każda rodzina dostaje grafikę swojej marki o tej roli (np. „baner marki”).</p>
      <datalist id="media-roles">{roles.map(r => <option key={r} value={r} />)}</datalist>

      {canEdit && (
        <div className={'panel drop-zone' + (drag ? ' drag' : '')} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files) }}>
          <h2 style={{ marginTop: 0 }}>Wgraj grafiki</h2>
          <div className="filter-grid">
            <label>Marka<select value={up.brand_id} onChange={e => setUp({ ...up, brand_id: e.target.value })}><option value="">ogólna (bez marki)</option>{brandOpts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
            <label>Rola w szablonie (opcjonalnie)<input value={up.role} list="media-roles" onChange={e => setUp({ ...up, role: e.target.value })} placeholder="np. baner marki" /></label>
            <label>Tagi (po przecinku)<input value={up.tags} onChange={e => setUp({ ...up, tags: e.target.value })} placeholder="np. wanny, akryl" /></label>
          </div>
          <div className="row-form" style={{ marginTop: 10 }}>
            <label className="btn upload">Wybierz pliki<input type="file" multiple accept={ACCEPT.join(',')} hidden onChange={e => { uploadFiles(e.target.files); e.target.value = '' }} /></label>
            <span className="muted small">albo upuść je tutaj · JPG, PNG, WebP, GIF do 5 MB · nazwa grafiki = nazwa pliku (można zmienić)</span>
          </div>
          {progress && <p className={progress.errors?.length ? 'hint' : 'ok'} role="status">{progress.text}{progress.errors?.length ? ` Błędy: ${progress.errors.join(' · ')}` : ''}</p>}
        </div>
      )}

      <div className="panel">
        <div className="filter-grid">
          <label>Szukaj (nazwa, rola, tag)<input value={q} onChange={e => setQ(e.target.value)} /></label>
          <label>Marka<select value={brand} onChange={e => setBrand(e.target.value)}><option value="">wszystkie</option><option value="-">ogólne (bez marki)</option>{brandOpts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
        </div>
        <p className="summary" style={{ margin: '10px 0' }}><strong>{plN(list.length, 'grafika', 'grafiki', 'grafik')}</strong></p>
        {list.length === 0 ? <p className="hint">{data.media.length ? 'Brak grafik dla tego filtra.' : 'Biblioteka jest pusta.'}</p> : (
          <div className="media-grid">{list.map(m => <MediaCard key={m.id + (m.name || '') + (m.role || '') + (m.brand_id || '')} m={m} brands={data.brands} templates={data.templates} canEdit={canEdit} onChanged={load} />)}</div>
        )}
      </div>
    </section>
  )
}
