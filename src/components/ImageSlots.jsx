import { useEffect, useState } from 'react'
import { supabase, plError } from '../supabase.js'
import { renderDescription, resolveImages } from '../render.js'
import MediaPicker from './MediaPicker.jsx'

// Grafiki opisu dla jednego SKU: wybór zdjęcia z Baselinkera (dowolna pozycja), grafiki z biblioteki albo „bez grafiki” dla każdego miejsca w szablonie.
// Wybór zapisuje się przy produkcie (products.image_choice) – obowiązuje też przy kolejnych generacjach – i od razu przebudowuje HTML tego opisu.
const slotLabel = s => s.type === 'hero' ? 'Nagłówek (HERO)' : `Sekcja ${s.key}${s.topic ? ` – ${s.topic}` : ''}`

export default function ImageSlots({ d, tpl, canEdit, onSaved }) {
  const [p, setP] = useState(null)
  const [media, setMedia] = useState([])
  const [brands, setBrands] = useState(new Map())
  const [picking, setPicking] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  async function load() {
    const [pr, m, b, f] = await Promise.all([
      supabase.from('products').select('id, sku, name, images, image_choice, brand_id').eq('id', d.product_id).single(),
      supabase.from('media_library').select('*').order('created_at', { ascending: false }),
      supabase.from('brands').select('id, name'),
      d.family_id ? supabase.from('product_families').select('brand_id').eq('id', d.family_id).single() : Promise.resolve({ data: null }),
    ])
    if (pr.error) { setMsg({ type: 'error', text: plError(pr.error.message) }); return }
    setP({ ...pr.data, brand_id: pr.data.brand_id || f.data?.brand_id || null }); setMedia(m.data || []); setBrands(new Map((b.data || []).map(x => [x.id, x.name])))
  }
  useEffect(() => { load() }, [d.product_id])
  if (!tpl) return <p className="muted">Brak szablonu opisu.</p>
  if (!p) return <p className="muted">{msg?.text || 'Wczytywanie zdjęć…'}</p>

  const slots = (tpl.sections || []).filter(s => s && s.enabled !== false && ['hero', 'content'].includes(s.type) && (s.image_source || 'static') !== 'none')
  const gallery = (tpl.sections || []).find(s => s && s.enabled !== false && s.type === 'gallery')
  const imgs = [...(p.images || [])].sort((a, b) => a.position - b.position)
  const current = resolveImages(tpl, p, { media, brandId: p.brand_id })
  const choice = p.image_choice || {}

  async function choose(key, url) {   // url: adres | '' (bez grafiki) | null (wróć do ustawienia szablonu)
    setBusy(true); setMsg(null)
    const next = { ...choice }
    if (url === null) delete next[key]; else next[key] = url
    const r1 = await supabase.from('products').update({ image_choice: next }).eq('id', p.id)
    if (r1.error) { setBusy(false); setMsg({ type: 'error', text: plError(r1.error.message) }); return }
    const product = { ...p, image_choice: next }
    const images = resolveImages(tpl, product, { media, brandId: p.brand_id })
    // brakujący opis obrazka (sekcja wcześniej bez grafiki) → nagłówek sekcji
    const fields = { ...(d.fields || {}) }
    for (const s of slots) { const k = `${s.key}_IMG_ALT`; if (images[s.key] && !String(fields[k] || '').trim()) fields[k] = s.type === 'hero' ? (fields.HERO_H1 || fields.TITLE || '') : (fields[`${s.key}_H2`] || '') }
    const html = renderDescription(fields, tpl, images)
    const r2 = await supabase.from('descriptions').update({ html, fields, meta: { ...(d.meta || {}), images } }).eq('id', d.id)
    setBusy(false)
    if (r2.error) { setMsg({ type: 'error', text: plError(r2.error.message) }); return }
    setP(product); setPicking(null); setMsg({ type: 'ok', text: 'Zapisano – podgląd opisu zaktualizowany.' }); onSaved?.()
  }

  return (
    <div className="image-slots">
      <p className="muted small">Wybierz zdjęcie dla każdego miejsca w szablonie. Wybór zapisuje się dla SKU {p.sku} i obowiązuje także przy kolejnych generacjach tego produktu. Tekst opisu się nie zmienia.</p>
      {imgs.length === 0 && <p className="hint">Produkt nie ma zdjęć w Baselinkerze – możesz użyć grafik z biblioteki.</p>}
      {slots.map(s => {
        const cur = current[s.key] || '', own = Object.prototype.hasOwnProperty.call(choice, s.key)
        return (
          <div key={s.key} className="slot panel">
            <div className="slot-head">
              <div className="slot-current">{cur ? <img src={cur} alt="" /> : <span className="slot-empty">bez grafiki</span>}</div>
              <div>
                <strong>{slotLabel(s)}</strong>
                <span className="muted small" style={{ display: 'block' }}>{own ? 'wybrane ręcznie' : `wg szablonu: ${s.image_source === 'product' ? `zdjęcie nr ${s.image_position || 1} z BL` : s.image_source === 'brand' ? `grafika marki (${s.image_role || '—'})` : 'grafika stała'}`}</span>
                {canEdit && <span className="row-form" style={{ gap: 10, marginTop: 4 }}>
                  <button className="link-dark" disabled={busy} onClick={() => setPicking(picking === s.key ? null : s.key)}>{picking === s.key ? 'Zamknij bibliotekę' : 'Z biblioteki'}</button>
                  <button className="link-dark" disabled={busy || (own && !choice[s.key])} onClick={() => choose(s.key, '')}>Bez grafiki</button>
                  {own && <button className="link-dark" disabled={busy} onClick={() => choose(s.key, null)}>Przywróć z szablonu</button>}
                </span>}
              </div>
            </div>
            {canEdit && imgs.length > 0 && (
              <div className="slot-thumbs" role="list" aria-label={`Zdjęcia produktu dla: ${slotLabel(s)}`}>
                {imgs.map(im => (
                  <button key={im.url} type="button" role="listitem" className={'slot-thumb' + (cur === im.url ? ' on' : '')} disabled={busy} onClick={() => choose(s.key, im.url)} title={`Zdjęcie nr ${im.position}`}>
                    <img src={im.url} alt={`Zdjęcie nr ${im.position}`} loading="lazy" /><span>{im.position}</span>
                  </button>
                ))}
              </div>
            )}
            {picking === s.key && <MediaPicker media={media} brands={brands} selected={cur} canUpload={false} onPick={m => choose(s.key, m.url)} onClose={() => setPicking(null)} />}
          </div>
        )
      })}
      {gallery && (() => {
        const own = Object.prototype.hasOwnProperty.call(choice, gallery.key)
        const sel = Object.keys(current).filter(k => k.startsWith(`${gallery.key}_`)).sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop())).map(k => current[k])
        const toggle = url => { const next = sel.includes(url) ? sel.filter(u => u !== url) : [...sel, url]; choose(gallery.key, next.join('\n')) }
        return (
          <div className="slot panel">
            <strong>Galeria zdjęć</strong>
            <span className="muted small" style={{ display: 'block' }}>{own ? 'wybrane ręcznie' : `wg szablonu: zdjęcia nr ${gallery.positions || '2-8'} z BL`} · zaznaczone: {sel.length} · kolejność = kolejność klikania</span>
            {canEdit && <div className="slot-thumbs">{imgs.map(im => { const i = sel.indexOf(im.url); return (
              <button key={im.url} type="button" className={'slot-thumb' + (i >= 0 ? ' on' : '')} disabled={busy} onClick={() => toggle(im.url)} title={`Zdjęcie nr ${im.position}`}>
                <img src={im.url} alt={`Zdjęcie nr ${im.position}`} loading="lazy" /><span>{i >= 0 ? `✓ ${i + 1}` : im.position}</span>
              </button>) })}</div>}
            {canEdit && own && <button className="link-dark" disabled={busy} onClick={() => choose(gallery.key, null)}>Przywróć z szablonu</button>}
          </div>
        )
      })()}
      {msg && <p className={msg.type} role="status">{msg.text}</p>}
    </div>
  )
}
