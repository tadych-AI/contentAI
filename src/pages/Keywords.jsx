import { useEffect, useState } from 'react'
import { supabase, plError } from '../supabase.js'
import { runJob } from '../jobs.js'
import { loadDicts } from '../catalog.js'
import Picker from '../components/Picker.jsx'
import DrainLoader from '../components/DrainLoader.jsx'

// Rynki fraz: kod języka → kraj i kod lokalizacji DataForSEO (Google Ads)
const LANGS = { hu: { name: 'węgierski', country: 'Węgry', location: 2348 }, ro: { name: 'rumuński', country: 'Rumunia', location: 2642 }, bg: { name: 'bułgarski', country: 'Bułgaria', location: 2100 }, pl: { name: 'polski', country: 'Polska', location: 2616 } }
const LANG = Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, `${v.name} (${v.country})`]))

function AddBank({ dicts, existing, onAdded }) {
  const [cat, setCat] = useState([])
  const [language, setLanguage] = useState('hu')
  const [seeds, setSeeds] = useState('')
  const [msg, setMsg] = useState(null)
  async function add(e) {
    e.preventDefault()
    const id = Number(cat[0]); const c = dicts.catById.get(id)
    if (!c) return
    const category = c.path || c.name
    if (existing.some(b => b.bl_category_id === id && b.language === language)) { setMsg({ type: 'error', text: 'Taki bank już istnieje.' }); return }
    const list = [...new Set(seeds.split('\n').map(x => x.trim()).filter(Boolean))]
    const { error } = await supabase.from('keyword_banks').insert({ bl_category_id: id, category, language, location_code: LANGS[language].location, seeds: list })
    setMsg(error ? { type: 'error', text: plError(error.message) } : { type: 'ok', text: 'Bank dodany. Przed odświeżeniem niech frazy startowe sprawdzi osoba znająca język.' })
    if (!error) { setSeeds(''); setCat([]); onAdded() }
  }
  return (
    <details className="panel">
      <summary><strong>Dodaj bank fraz</strong> <span className="muted small">dla kategorii Baselinkera i języka</span></summary>
      <form onSubmit={add}>
        <div className="filter-grid">
          <Picker label="Kategoria Baselinkera" help="Bank obowiązuje też dla podkategorii, które nie mają własnego banku (np. „Wanny > Wanny wolnostojące”)." options={dicts.categories.map(c => ({ value: c.bl_category_id, label: c.path || c.name }))} value={cat} onChange={v => setCat(v.slice(-1))} placeholder="np. Wanny wolnostojące" />
          <label>Język / rynek<select value={language} onChange={e => setLanguage(e.target.value)}>{Object.entries(LANG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <label>Frazy startowe w języku rynku (jedna w linii), np. „szabadon álló kád”<textarea rows={4} value={seeds} onChange={e => setSeeds(e.target.value)} /></label>
        <button className="btn" disabled={!cat.length}>Dodaj bank</button>
        {msg && <p className={msg.type} role="status">{msg.text}</p>}
      </form>
    </details>
  )
}

function Bank({ bank, onChanged, canVerify }) {
  const [seeds, setSeeds] = useState((bank.seeds || []).join('\n'))
  const [minVol, setMinVol] = useState(bank.min_volume ?? 10)
  const [manual, setManual] = useState('')
  const [stage, setStage] = useState('')
  const [msg, setMsg] = useState(null)
  const [all, setAll] = useState(false)
  const kws = bank.keywords || []
  const excluded = new Set(bank.excluded || [])
  const seedList = [...new Set(seeds.split('\n').map(s => s.trim()).filter(Boolean))]
  const seedsDirty = seedList.join('\n') !== (bank.seeds || []).join('\n') || Number(minVol) !== (bank.min_volume ?? 10)

  async function patch(p, ok) {
    const { error } = await supabase.from('keyword_banks').update(p).eq('id', bank.id)
    setMsg(error ? { type: 'error', text: plError(error.message) } : ok ? { type: 'ok', text: ok } : null)
    if (!error) onChanged()
  }
  async function refresh() {
    if (!(bank.seeds || []).length) { setMsg({ type: 'error', text: 'Bank nie ma fraz startowych. Wpisz je (w języku rynku) i zapisz, potem odśwież.' }); return }
    if (!bank.seeds_verified && !confirm('Frazy startowe tego banku nie zostały jeszcze sprawdzone przez osobę znającą język. Odświeżyć mimo to?')) return
    setMsg(null); setStage('DataForSEO pobiera wolumeny wyszukiwań…')
    try {
      if (seedsDirty) await supabase.from('keyword_banks').update({ seeds: seedList, min_volume: Number(minVol) }).eq('id', bank.id)
      const res = await runJob('keywords_refresh', { bank_id: bank.id, seeds: seedList, location_code: bank.location_code, language: bank.language,
        min_volume: Number(minVol), manual: kws.filter(k => k.source === 'manual') }, { timeoutSec: 240 })
      setMsg({ type: 'ok', text: `Zapisano ${res.saved} fraz (koszt DataForSEO: $${res.stats?.cost_usd ?? 0}).${res.notes?.length ? ' Uwagi: ' + res.notes.join('; ') : ''}` })
      onChanged()
    } catch (e) { setMsg({ type: 'error', text: e.message }) } finally { setStage('') }
  }
  const toggle = kw => patch({ excluded: excluded.has(kw) ? [...excluded].filter(x => x !== kw) : [...excluded, kw] })
  function addManual(e) {
    e.preventDefault()
    const kw = manual.trim(); if (!kw) return
    if (kws.some(k => k.kw.toLowerCase() === kw.toLowerCase())) { setMsg({ type: 'error', text: 'Ta fraza już jest w banku.' }); return }
    patch({ keywords: [{ kw, volume: null, source: 'manual' }, ...kws] }, 'Fraza dodana. Frazy ręczne (np. z wyszukiwarki eMAG) zawsze zostają w banku.')
    setManual('')
  }
  const shown = all ? kws : kws.slice(0, 40)

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{bank.category} · {LANG[bank.language] || bank.language}</h2>
        <span className="muted small">
          {bank.seeds_verified ? <span className="tag okt">frazy startowe sprawdzone</span> : <span className="tag warn">frazy startowe do weryfikacji</span>}
          {canVerify && <button className="link-dark gap" onClick={() => patch({ seeds_verified: !bank.seeds_verified }, bank.seeds_verified ? 'Cofnięto weryfikację.' : 'Oznaczono jako sprawdzone.')}>{bank.seeds_verified ? 'cofnij' : 'oznacz jako sprawdzone'}</button>}
          {' · '}{bank.refreshed_at ? `odświeżono ${new Date(bank.refreshed_at).toLocaleDateString('pl-PL')}` : 'jeszcze nie odświeżano'}
        </span>
      </div>
      <div className="kw-grid">
        <div>
          <label>Frazy startowe (jedna w linii)
            <textarea rows={8} value={seeds} onChange={e => setSeeds(e.target.value)} />
          </label>
          <label>Minimalny wolumen miesięczny<input type="number" min="0" value={minVol} onChange={e => setMinVol(e.target.value)} /></label>
          <p className="muted small">Frazy startowe sprawdź z osobą znającą język – to od nich zależy cała pula.</p>
          <button className="btn" onClick={refresh} disabled={!!stage || !seedList.length}>{stage ? 'Odświeżanie…' : 'Odśwież frazy'}</button>
          {seedsDirty && !stage && <button className="link-dark gap" onClick={() => patch({ seeds: seedList, min_volume: Number(minVol) }, 'Zapisano frazy startowe.')}>Zapisz bez odświeżania</button>}
          {stage && <p className="muted working" role="status">{stage}</p>}
          {msg && <p className={msg.type} role="status">{msg.text}</p>}
        </div>
        <div>
          <form className="row-form" onSubmit={addManual}>
            <label>Dodaj frazę ręcznie (np. z podpowiedzi wyszukiwarki eMAG.hu)<input value={manual} onChange={e => setManual(e.target.value)} /></label>
            <button className="btn ghost" disabled={!manual.trim()}>Dodaj</button>
          </form>
          {kws.length === 0 ? <p className="muted">Bank jest pusty. Kliknij „Odśwież frazy”.</p> : (
            <div className="table-wrap">
              <table className="compact">
                <thead><tr><th>Fraza</th><th className="num">Wyszukiwania / mies.</th><th>Źródło</th><th>Wyklucz</th></tr></thead>
                <tbody>
                  {shown.map(k => (
                    <tr key={k.kw} className={excluded.has(k.kw) ? 'inactive' : ''}>
                      <td>{k.kw}</td>
                      <td className="num">{k.volume == null ? '—' : Number(k.volume).toLocaleString('pl-PL')}</td>
                      <td className="muted">{k.source === 'manual' ? 'ręczna' : 'Google (DataForSEO)'}</td>
                      <td><input type="checkbox" checked={excluded.has(k.kw)} onChange={() => toggle(k.kw)} aria-label={`Wyklucz ${k.kw}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {kws.length > 40 && <button className="link-dark" onClick={() => setAll(!all)}>{all ? 'Pokaż mniej' : `Pokaż wszystkie (${kws.length})`}</button>}
            </div>
          )}
          {excluded.size > 0 && <p className="muted small">Wykluczone: {excluded.size}. AI ich nie użyje (np. frazy z markami konkurencji albo niepasujące do oferty).</p>}
        </div>
      </div>
    </div>
  )
}

export default function Keywords({ profile }) {
  const [banks, setBanks] = useState(null)
  const [dicts, setDicts] = useState(null)
  const [err, setErr] = useState('')
  async function load() {
    const [{ data, error }, d] = await Promise.all([supabase.from('keyword_banks').select('*').order('category').order('language'), loadDicts()])
    if (error) setErr(plError(error.message)); else { setBanks(data); setDicts(d) }
  }
  useEffect(() => { load().catch(e => setErr(plError(e.message))) }, [])
  if (err) return <section className="page"><h1>Frazy kluczowe</h1><p className="error">{err}</p></section>
  if (!banks || !dicts) return <section className="page"><DrainLoader /></section>
  return (
    <section className="page wide">
      <h1>Frazy kluczowe</h1>
      <p className="muted lead">Bank fraz jest wspólny dla kategorii Baselinkera (i jej podkategorii) w danym języku. Z niego AI dobiera frazę główną i frazy sekcji dla każdego opisu. Wolumeny pobiera DataForSEO (Google, wybrany kraj). Odświeżaj raz w miesiącu.</p>
      <AddBank dicts={dicts} existing={banks} onAdded={load} />
      {banks.length === 0 && <div className="panel empty"><p className="muted">Nie ma jeszcze banków fraz. Opisy można generować bez nich, ale wtedy AI nie dobiera fraz SEO.</p></div>}
      {banks.map(b => <Bank key={b.id + (b.refreshed_at || '') + (b.keywords || []).length + (b.excluded || []).length + b.seeds_verified} bank={b} onChanged={load} canVerify={['akceptujacy', 'admin'].includes(profile?.role)} />)}
    </section>
  )
}
