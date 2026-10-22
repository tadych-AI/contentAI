import { useMemo, useState } from 'react'
import { plError } from '../supabase.js'
import { uploadMedia, ACCEPT } from '../media.js'

// Wybór grafiki z biblioteki (w edytorze szablonu); opcjonalnie szybkie wgranie nowej
export default function MediaPicker({ media, brands, selected, canUpload, onPick, onUploaded, onClose }) {
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return media.filter(m => (!brand || (brand === '-' ? !m.brand_id : m.brand_id === brand))
      && (!s || [m.name, m.role, ...(m.tags || []), brands.get(m.brand_id)].some(x => (x || '').toLowerCase().includes(s))))
  }, [media, q, brand])

  async function upload(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setBusy(true); setErr('')
    try { const m = await uploadMedia(file, { brandId: brand && brand !== '-' ? brand : null, brandName: brands.get(brand) || '' }); onUploaded?.(m); onPick(m) }
    catch (x) { setErr(plError(x.message)) }
    setBusy(false)
  }

  return (
    <div className="media-picker">
      <div className="row-form" style={{ alignItems: 'flex-end' }}>
        <label style={{ flex: 1, margin: 0 }}>Szukaj (nazwa, rola, tag)<input value={q} onChange={e => setQ(e.target.value)} autoFocus /></label>
        <label style={{ margin: 0 }}>Marka<select value={brand} onChange={e => setBrand(e.target.value)}>
          <option value="">wszystkie</option><option value="-">ogólne (bez marki)</option>
          {[...brands].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select></label>
        {canUpload && <label className="btn ghost upload">{busy ? 'Wgrywanie…' : 'Wgraj nową'}<input type="file" accept={ACCEPT.join(',')} hidden onChange={upload} disabled={busy} /></label>}
        <button className="link-dark" onClick={onClose}>Zamknij</button>
      </div>
      {err && <p className="error">{err}</p>}
      {list.length === 0 ? <p className="hint">Brak grafik{media.length ? ' dla tego filtra' : ' – wgraj je na ekranie Grafiki'}.</p> : (
        <div className="media-grid small-grid">
          {list.slice(0, 120).map(m => (
            <button key={m.id} type="button" className={'media-tile' + (selected === m.url ? ' selected' : '')} onClick={() => onPick(m)} title={m.name}>
              <img src={m.url} alt="" loading="lazy" />
              <span className="media-name">{m.name}</span>
              <span className="muted">{[brands.get(m.brand_id), m.role].filter(Boolean).join(' · ') || 'ogólna'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
