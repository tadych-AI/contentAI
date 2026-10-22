import { useEffect, useMemo, useState } from 'react'
import { supabase, plError, fetchAll } from '../supabase.js'
import { loadDicts } from '../catalog.js'
import { renderDescription, templateFields, resolveImages, OUTPUT_PRESETS, IMAGE_SOURCES, DEFAULT_STYLES } from '../render.js'
import Picker from '../components/Picker.jsx'
import MediaPicker from '../components/MediaPicker.jsx'
import { ROLE_SUGGESTIONS } from '../media.js'
import DrainLoader from '../components/DrainLoader.jsx'

const STATUS = { aktywny: 'aktywny', szkic: 'szkic', archiwalny: 'archiwalny' }
const newKey = secs => { let i = 1; while (secs.some(s => s.key === `S${i}`)) i++; return `S${i}` }

// Przykładowa treść do podglądu (prawdziwą wygeneruje AI w języku rynku)
function sampleFields(template) {
  const f = {}
  for (const k of templateFields(template)) {
    if (k === 'HERO_H1') f[k] = 'Wanna wolnostojąca Model 160x80 – nagłówek opisu'
    else if (k === 'HERO_LEAD') f[k] = 'Lead: dwa zdania o najważniejszych cechach produktu, z frazą główną.'
    else if (/_H2$/.test(k)) f[k] = k === 'FAQ_H2' ? 'Najczęstsze pytania' : `Nagłówek sekcji ${k.split('_')[0]}`
    else if (/_P$/.test(k)) f[k] = 'Akapit sekcji – rzeczowy opis oparty wyłącznie na zatwierdzonych faktach.'
    else if (/_P_BOLD$/.test(k)) f[k] = 'Pogrubione zdanie z najmocniejszym argumentem.'
    else if (/_LI\d$/.test(k)) f[k] = `Punkt listy ${k.slice(-1)}`
    else if (/_AKCENT$/.test(k)) f[k] = 'Wyróżnik sekcji – krótkie zdanie.'
    else if (/^FAQ_Q/.test(k)) f[k] = `Pytanie kupującego ${k.slice(5)}?`
    else if (/^FAQ_A/.test(k)) f[k] = 'Krótka odpowiedź oparta na faktach.'
    else if (/_IMG_ALT$/.test(k)) f[k] = 'Opis obrazka'
  }
  return f
}

function SectionRow({ sec, idx, count, onChange, onMove, onRemove, lib }) {
  const set = p => onChange({ ...sec, ...p })
  const [picking, setPicking] = useState(false)
  const src = sec.image_source || 'none'
  const picked = sec.image_url ? lib.media.find(m => m.url === sec.image_url) : null
  const brandHits = src === 'brand' ? lib.media.filter(m => m.brand_id && (m.role || '').trim().toLowerCase() === (sec.image_role || '').trim().toLowerCase()) : []
  return (
    <div className="sec-row panel" style={{ padding: '12px 14px', marginBottom: 8 }}>
      <div className="sec-head" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="check"><input type="checkbox" checked={sec.enabled !== false} onChange={e => set({ enabled: e.target.checked })} /> <strong>{sec.type === 'hero' ? 'Nagłówek (HERO)' : sec.type === 'faq' ? 'FAQ' : `Sekcja ${sec.key}`}</strong></label>
        <span style={{ marginLeft: 'auto' }} className="row-form">
          <button className="link-dark" disabled={idx === 0} onClick={() => onMove(-1)} aria-label="Przesuń wyżej">↑</button>
          <button className="link-dark" disabled={idx === count - 1} onClick={() => onMove(1)} aria-label="Przesuń niżej">↓</button>
          {sec.type === 'content' && <button className="link-dark danger" onClick={onRemove}>Usuń</button>}
        </span>
      </div>
      {sec.type === 'content' && <label>Temat sekcji (dla AI – o czym pisać)<input value={sec.topic || ''} onChange={e => set({ topic: e.target.value })} /></label>}
      {sec.type === 'content' && (
        <div className="row-form" style={{ marginTop: 8 }}>
          <label className="check"><input type="checkbox" checked={sec.list !== false} onChange={e => set({ list: e.target.checked })} /> lista punktów</label>
          <label className="check"><input type="checkbox" checked={sec.bold !== false} onChange={e => set({ bold: e.target.checked })} /> pogrubione zdanie</label>
          <label className="check"><input type="checkbox" checked={!!sec.accent} onChange={e => set({ accent: e.target.checked })} /> wyróżnik</label>
        </div>
      )}
      {sec.type === 'faq' && <label style={{ maxWidth: 200 }}>Liczba pytań<input type="number" min="1" max="6" value={sec.max_questions || 4} onChange={e => set({ max_questions: Math.min(6, Math.max(1, Number(e.target.value) || 4)) })} /></label>}
      {sec.type !== 'faq' && (
        <div className="filter-grid" style={{ marginTop: 4 }}>
          <label>Grafika<select value={sec.image_source || 'none'} onChange={e => set({ image_source: e.target.value })}>{Object.entries(IMAGE_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {src === 'product' && <label>Pozycja zdjęcia w Baselinkerze (1–16)<input type="number" min="1" max="16" value={sec.image_position || 1} onChange={e => set({ image_position: Number(e.target.value) || 1 })} /></label>}
          {src === 'brand' && <label>Rola grafiki marki<input value={sec.image_role || ''} list="tpl-media-roles" onChange={e => set({ image_role: e.target.value })} placeholder="np. baner marki" />
            <span className="field-help">{sec.image_role ? `Marki z grafiką o tej roli: ${[...new Set(brandHits.map(m => lib.brands.get(m.brand_id)).filter(Boolean))].join(', ') || 'brak'}` : 'Każda rodzina dostanie grafikę swojej marki o tej roli (ekran Grafiki).'}</span></label>}
          {(src === 'static' || src === 'product' || src === 'brand') && <label className="span-2">{src === 'static' ? 'Adres URL grafiki' : 'Grafika zapasowa (gdy brak zdjęcia/grafiki marki) – adres URL'}<input value={sec.image_url || ''} onChange={e => set({ image_url: e.target.value.trim(), media_id: null })} placeholder="https://…" /></label>}
          {src !== 'none' && (
            <div className="span-2 row-form" style={{ alignItems: 'center' }}>
              {sec.image_url && src !== 'product' && <img src={sec.image_url} alt="" className="media-thumb" />}
              {src === 'library' && <span className="small">{picked ? picked.name : sec.image_url ? 'grafika spoza biblioteki' : <span className="hint-inline">nie wybrano grafiki</span>}</span>}
              {<button type="button" className="btn ghost" onClick={() => setPicking(!picking)}>{src === 'library' || src === 'static' ? 'Wybierz z biblioteki' : 'Wybierz zapasową z biblioteki'}</button>}
              {sec.image_url && src !== 'static' && <button type="button" className="link-dark" onClick={() => set({ image_url: '', media_id: null })}>Wyczyść</button>}
            </div>
          )}
          {picking && <div className="span-2"><MediaPicker media={lib.media} brands={lib.brands} selected={sec.image_url} canUpload={lib.canUpload} onUploaded={lib.reload}
            onPick={m => { set({ image_url: m.url, media_id: m.id }); setPicking(false) }} onClose={() => setPicking(false)} /></div>}
        </div>
      )}
    </div>
  )
}

function Editor({ tpl, dicts, sample, canEdit, onSaved, onClose, lib }) {
  const [t, setT] = useState(tpl)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setT(tpl); setMsg(null) }, [tpl.id])
  const secs = t.sections || []
  const st = { ...DEFAULT_STYLES, ...(t.styles || {}) }
  const out = { ...OUTPUT_PRESETS.standard.output, ...(t.styles?.output || {}) }
  const setSecs = s => setT({ ...t, sections: s })
  const setSt = p => setT({ ...t, styles: { ...(t.styles || {}), ...p } })
  const setOut = p => setSt({ output: { ...out, ...p } })
  const html = useMemo(() => renderDescription(sampleFields(t), t, resolveImages(t, sample || {}, { media: lib.media })), [t, sample, lib.media])

  async function save() {
    setBusy(true); setMsg(null)
    const row = { name: t.name.trim(), bl_category_id: t.bl_category_id || null, status: t.status, sections: t.sections, styles: t.styles, channel_id: t.channel_id }
    const q = t.id ? supabase.from('templates').update({ ...row, version: (t.version || 1) + 1 }).eq('id', t.id).select().single() : supabase.from('templates').insert(row).select().single()
    const { data, error } = await q
    setBusy(false)
    if (error) { setMsg({ type: 'error', text: plError(error.message) }); return }
    setMsg({ type: 'ok', text: 'Zapisano szablon.' }); onSaved(data)
  }

  return (
    <div className="tpl-grid">
      <div>
        <div className="panel">
          <div className="panel-head"><h2 style={{ margin: 0 }}>{t.id ? 'Edycja szablonu' : 'Nowy szablon'}</h2><button className="link-dark" onClick={onClose}>Zamknij</button></div>
          <label>Nazwa<input value={t.name} onChange={e => setT({ ...t, name: e.target.value })} /></label>
          <Picker label="Kategoria Baselinkera" help="Puste = szablon domyślny kanału. Szablon kategorii obowiązuje też w jej podkategoriach." options={dicts.categories.map(c => ({ value: c.bl_category_id, label: c.path || c.name }))}
            value={t.bl_category_id ? [t.bl_category_id] : []} onChange={v => setT({ ...t, bl_category_id: v.length ? Number(v[v.length - 1]) : null })} placeholder="np. Wanny" />
          <label>Status<select value={t.status} onChange={e => setT({ ...t, status: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <h2 style={{ margin: '18px 0 10px' }}>Sekcje</h2>
        <datalist id="tpl-media-roles">{[...new Set([...ROLE_SUGGESTIONS, ...lib.media.map(m => m.role).filter(Boolean)])].map(r => <option key={r} value={r} />)}</datalist>
        {secs.map((s, i) => (
          <SectionRow key={s.key} sec={s} idx={i} count={secs.length}
            onChange={n => setSecs(secs.map((x, j) => j === i ? n : x))}
            onMove={d => { const a = [...secs]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); setSecs(a) }}
            onRemove={() => setSecs(secs.filter((_, j) => j !== i))} lib={lib} />
        ))}
        <button className="btn ghost" onClick={() => { const faqAt = secs.findIndex(s => s.type === 'faq'); const n = { key: newKey(secs), type: 'content', enabled: true, topic: '', image_source: 'none', list: true, bold: false, accent: false }; const a = [...secs]; a.splice(faqAt < 0 ? a.length : faqAt, 0, n); setSecs(a) }}>+ Dodaj sekcję</button>

        <div className="panel" style={{ marginTop: 18 }}>
          <h2>Wygląd i format</h2>
          <div className="filter-grid">
            <label>Format wyjściowy<select value={out.mode === 'custom' && out.html && !out.images ? 'kaufland' : out.mode === 'custom' ? 'custom' : 'standard'} onChange={e => setSt({ output: { ...OUTPUT_PRESETS[e.target.value].output } })}>{Object.entries(OUTPUT_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            <label>Znacznik nagłówka<select value={st.hero_tag} onChange={e => setSt({ hero_tag: e.target.value })}><option value="h1">h1</option><option value="h2">h2</option></select></label>
            <label>Kolor nagłówków<input type="color" value={st.heading_color} onChange={e => setSt({ heading_color: e.target.value })} /></label>
            <label>Kolor wyróżnień<input type="color" value={st.accent_color} onChange={e => setSt({ accent_color: e.target.value })} /></label>
            <label>Kolor tekstu<input type="color" value={st.text_color} onChange={e => setSt({ text_color: e.target.value })} /></label>
            <label>Szerokość maks. (px)<input type="number" value={st.max_width} onChange={e => setSt({ max_width: Number(e.target.value) || 920 })} /></label>
            <label>Tekst (px)<input type="number" value={st.font_size} onChange={e => setSt({ font_size: Number(e.target.value) || 15 })} /></label>
            <label>Nagłówki sekcji (px)<input type="number" value={st.h2_size} onChange={e => setSt({ h2_size: Number(e.target.value) || 22 })} /></label>
          </div>
          {out.mode === 'custom' && (<>
            <label>Szkielet HTML (pola {'{{TYTUL}}'}, {'{{LEAD}}'}, {'{{#sekcje}}'}…{'{{/sekcje}}'}, {'{{#faq}}'}…)<textarea className="code" rows={10} value={out.html} onChange={e => setOut({ html: e.target.value })} /></label>
            <div className="filter-grid">
              <label>Dozwolone znaczniki<input value={out.allowed_tags} onChange={e => setOut({ allowed_tags: e.target.value })} /></label>
              <label>Limit znaków HTML (0 = bez)<input type="number" value={out.max_chars} onChange={e => setOut({ max_chars: Number(e.target.value) || 0 })} /></label>
            </div>
          </>)}
        </div>
        {canEdit ? <button className="btn" disabled={busy || !t.name.trim()} onClick={save}>{busy ? 'Zapisywanie…' : 'Zapisz szablon'}</button> : <p className="muted small">Szablony zmienia akceptujący lub admin.</p>}
        {msg && <p className={msg.type} role="status">{msg.text}</p>}
      </div>
      <div className="tpl-preview">
        <p className="preview-label">Podgląd z przykładową treścią{sample ? ` · zdjęcia: ${sample.sku}` : ''}</p>
        <div className="preview-frame" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}

export default function Templates({ profile }) {
  const canEdit = ['akceptujacy', 'admin'].includes(profile?.role)
  const [data, setData] = useState(null)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState('')
  const [sampleId, setSampleId] = useState('')

  async function load() {
    try {
      const [tp, ch, dicts, prods, media, brands] = await Promise.all([
        supabase.from('templates').select('*').order('created_at'), supabase.from('channels').select('id, code, marketplace, language'),
        loadDicts(), fetchAll('products', 'id, sku, name, images, brand_id', q => q.order('sku')),
        supabase.from('media_library').select('*').order('created_at', { ascending: false }), fetchAll('brands', 'id, name'),
      ])
      if (tp.error) throw tp.error
      const withImg = prods.filter(p => (p.images || []).length)
      setData({ templates: tp.data || [], channels: ch.data || [], dicts, products: withImg, media: media.data || [], brands: new Map(brands.map(b => [b.id, b.name])) })
      if (!sampleId && withImg[0]) setSampleId(withImg[0].id)
    } catch (e) { setErr(plError(e.message)) }
  }
  useEffect(() => { load() }, [])

  if (err) return <section className="page"><h1>Szablony opisów</h1><p className="error">{err}</p></section>
  if (!data) return <section className="page"><DrainLoader /></section>
  const chName = id => { const c = data.channels.find(x => x.id === id); return c ? `${c.marketplace} ${c.language.toUpperCase()}` : '—' }
  const sample = data.products.find(p => p.id === sampleId) || null
  const blank = ch => ({ id: null, channel_id: ch.id, name: `${ch.marketplace} ${ch.language.toUpperCase()} · nowy`, bl_category_id: null, status: 'szkic', version: 1,
    sections: (data.templates.find(t => t.channel_id === ch.id && !t.bl_category_id)?.sections) || [{ key: 'HERO', type: 'hero', enabled: true, image_source: 'product', image_position: 1 }, { key: 'FAQ', type: 'faq', enabled: true, max_questions: 4 }],
    styles: (data.templates.find(t => t.channel_id === ch.id && !t.bl_category_id)?.styles) || { hero_tag: 'h2', output: { ...OUTPUT_PRESETS.standard.output } } })

  return (
    <section className={edit ? 'page wide' : 'page'}>
      <h1>Szablony opisów</h1>
      <p className="muted lead">Szablon wyznacza sekcje opisu, ich tematy, grafiki (zdjęcia produktu z Baselinkera wg pozycji, grafiki z biblioteki – wybrane lub grafika marki wg roli – albo stałe adresy) i wygląd HTML. Generacja wybiera szablon kategorii rodziny, a gdy go brak – domyślny szablon kanału.</p>
      {edit ? (<>
        {data.products.length > 0 && (
          <label style={{ maxWidth: 520 }}>Produkt do podglądu zdjęć i grafik marki<select style={{ width: '100%' }} value={sampleId} onChange={e => setSampleId(e.target.value)}>{data.products.slice(0, 500).map(p => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
        )}
        <Editor tpl={edit} dicts={data.dicts} sample={sample} canEdit={canEdit} lib={{ media: data.media, brands: data.brands, canUpload: canEdit, reload: load }} onClose={() => setEdit(null)} onSaved={t => { setEdit(t); load() }} />
      </>) : (
        <div className="panel">
          <table className="compact">
            <thead><tr><th>Nazwa</th><th>Kanał</th><th>Kategoria</th><th>Status</th><th className="num">Sekcje</th><th /></tr></thead>
            <tbody>
              {data.templates.map(t => (
                <tr key={t.id}>
                  <td><button className="row-toggle" onClick={() => setEdit(t)}>{t.name}</button></td>
                  <td>{chName(t.channel_id)}</td>
                  <td className="path">{t.bl_category_id ? (data.dicts.catById.get(t.bl_category_id)?.path || t.bl_category_id) : 'domyślny'}</td>
                  <td><span className={`tag ${t.status === 'aktywny' ? 'okt' : ''}`}>{STATUS[t.status]}</span></td>
                  <td className="num">{(t.sections || []).filter(s => s.enabled !== false).length}</td>
                  <td className="actions">{canEdit && <button className="link-dark" onClick={() => setEdit({ ...t, id: null, name: `${t.name} (kopia)`, status: 'szkic' })}>Kopiuj</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && data.channels.map(ch => <button key={ch.id} className="btn ghost" onClick={() => setEdit(blank(ch))}>+ Nowy szablon {ch.marketplace} {ch.language.toUpperCase()}</button>)}
        </div>
      )}
    </section>
  )
}
