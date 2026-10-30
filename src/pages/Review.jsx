import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, plError, fetchAll } from '../supabase.js'
import { regenerateSections, generateVariants } from '../gen.js'
import DrainLoader from '../components/DrainLoader.jsx'
import ImageSlots from '../components/ImageSlots.jsx'
import { renderDescription, templateFields } from '../render.js'

const STATUS = { generowanie: 'w trakcie', do_weryfikacji: 'do weryfikacji', poprawki: 'poprawiony', zaakceptowany: 'zaakceptowany', opublikowany: 'opublikowany', blad: 'błąd', do_generacji: 'do generacji' }
const STUCK_MIN = 20
const secs = ms => { const v = Math.round((ms || 0) / 1000); return v >= 60 ? `${Math.floor(v / 60)} min ${v % 60} s` : `${v} s` }
const FILTERS = [['do_weryfikacji', 'Do weryfikacji'], ['zaakceptowany', 'Zaakceptowane'], ['blad', 'Błędy'], ['wszystkie', 'Wszystkie']]

function useLookups() {
  const [l, setL] = useState(null)
  useEffect(() => { (async () => {
    const [f, c, p] = await Promise.all([fetchAll('product_families', 'id, name'), supabase.from('channels').select('id, marketplace, language'), fetchAll('products', 'id, sku')])
    setL({ fam: Object.fromEntries((f || []).map(x => [x.id, x.name])), ch: Object.fromEntries((c.data || []).map(x => [x.id, `${x.marketplace} ${x.language.toUpperCase()}`])), sku: Object.fromEntries((p || []).map(x => [x.id, x.sku])) })
  })() }, [])
  return l
}

function ReviewList({ profile }) {
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('do_weryfikacji')
  const [sel, setSel] = useState(new Set())
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const lk = useLookups()
  const canApprove = ['akceptujacy', 'admin'].includes(profile?.role)
  async function load() {
    const data = await fetchAll('descriptions', 'id, family_id, channel_id, product_id, version, status, qa, created_at, is_base', q => q.order('version', { ascending: false }))
    const latest = {}
    for (const d of data || []) { const k = `${d.family_id}|${d.channel_id}|${d.product_id}`; if (!latest[k]) latest[k] = { ...d, versions: [] }; latest[k].versions.push(d) }
    setRows(Object.values(latest).sort((a, b) => b.created_at.localeCompare(a.created_at)))
  }
  useEffect(() => { load() }, [])
  // usuwa opis produktu razem ze wszystkimi wersjami (generujący – tylko gdy żadna wersja nie jest zaakceptowana)
  async function removeSelected() {
    const chosen = rows.filter(r => sel.has(r.id))
    const blocked = canApprove ? [] : chosen.filter(r => r.versions.some(v => ['zaakceptowany', 'opublikowany'].includes(v.status)))
    const ok = chosen.filter(r => !blocked.includes(r))
    if (!ok.length) { setMsg({ type: 'error', text: 'Zaakceptowane opisy może usunąć tylko akceptujący lub admin.' }); return }
    const accepted = ok.filter(r => r.versions.some(v => ['zaakceptowany', 'opublikowany'].includes(v.status))).length
    if (!window.confirm(`Usunąć ${ok.length === 1 ? 'opis' : `${ok.length} opisy`} razem ze wszystkimi wersjami?${accepted ? `\n\nW tym ${accepted} zaakceptowanych – nie trafią do pliku eMAG, dopóki nie wygenerujesz ich ponownie.` : ''}\n\nTej operacji nie można cofnąć.`)) return
    setBusy(true); setMsg(null)
    const ids = ok.flatMap(r => r.versions.map(v => v.id))
    let err = null
    for (let i = 0; i < ids.length; i += 200) { const r = await supabase.from('descriptions').delete().in('id', ids.slice(i, i + 200)); err = err || r.error }
    setBusy(false); setSel(new Set())
    setMsg(err ? { type: 'error', text: plError(err.message) } : { type: 'ok', text: `Usunięto ${ok.length === 1 ? 'opis' : `${ok.length} opisy`}${blocked.length ? `; pominięto ${blocked.length} zaakceptowanych (usuwa je akceptujący lub admin)` : ''}.` })
    load()
  }
  if (!rows || !lk) return <section className="page"><DrainLoader /></section>
  const shown = filter === 'wszystkie' ? rows : rows.filter(r => r.status === filter || (filter === 'do_weryfikacji' && r.status === 'generowanie'))
  return (
    <section className="page">
      <h1>Opisy</h1>
      <p className="muted lead">Opisy na marketplace – opis bazowy rodziny (wariant wiodący) i opisy wariantów. Opis bazowy generujesz na ekranie Rodziny produktów.</p>
      <div className="tabs" role="tablist">
        {FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'tab on' : 'tab'} onClick={() => setFilter(k)}>{l}
          <span className="count">{k === 'wszystkie' ? rows.length : rows.filter(r => r.status === k || (k === 'do_weryfikacji' && r.status === 'generowanie')).length}</span></button>)}
      </div>
      {msg && <p className={msg.type} role="status">{msg.text}</p>}
      {sel.size > 0 && <div className="import-bar" role="region" aria-label="Akcje opisów"><strong style={{ flex: 1 }}>Zaznaczono {sel.size}</strong>
        <button className="btn ghost danger" disabled={busy} onClick={removeSelected}>{busy ? 'Usuwanie…' : 'Usuń zaznaczone'}</button><button className="link-dark" onClick={() => setSel(new Set())}>Odznacz</button></div>}
      {shown.length === 0 ? <div className="panel empty"><p className="muted">Brak opisów w tym widoku. Opis bazowy generujesz na ekranie Rodziny produktów (rodzina z zatwierdzonymi faktami).</p></div> : (
        <div className="panel table-wrap">
          <table className="compact">
            <thead><tr><th className="check"><input type="checkbox" aria-label="Zaznacz wszystkie" checked={shown.length > 0 && shown.every(r => sel.has(r.id))} onChange={e => setSel(e.target.checked ? new Set(shown.map(r => r.id)) : new Set())} /></th><th>Rodzina</th><th>SKU</th><th>Kanał</th><th>Wersja</th><th>Status</th><th>QA</th><th>Utworzono</th><th /></tr></thead>
            <tbody>{shown.map(r => (
              <tr key={r.id}>
                <td className="check"><input type="checkbox" aria-label={`Zaznacz ${lk.sku[r.product_id]}`} checked={sel.has(r.id)} onChange={() => setSel(x => { const n = new Set(x); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })} /></td>
                <td><strong>{lk.fam[r.family_id] || 'bez rodziny'}</strong>{r.is_base && <span className="tag">bazowy</span>}</td><td className="mono">{lk.sku[r.product_id]}</td><td>{lk.ch[r.channel_id]}</td><td>v{r.version}{r.versions.length > 1 ? <span className="muted small"> ({r.versions.length} wersje)</span> : ''}</td>
                <td><span className={`tag st-${r.status}`}>{STATUS[r.status]}</span>{r.status === 'generowanie' && Date.now() - new Date(r.created_at).getTime() > STUCK_MIN * 60000 && <span className="hint-inline small"> – ponad {STUCK_MIN} min, prawdopodobnie przerwane</span>}</td>
                <td>{r.qa ? <>{r.qa.errors?.length ? (r.qa.override ? <span className="tag warn" title={`Zaakceptowano mimo błędów: ${r.qa.override.by_name || ''}${r.qa.override.note ? ' – ' + r.qa.override.note : ''}`}>{r.qa.errors.length} błędy – zaakceptowano mimo</span> : <span className="tag err">{r.qa.errors.length} błędy</span>) : <span className="tag okt">OK</span>} {r.qa.warnings?.length ? <span className="muted small">{r.qa.warnings.length} uwag</span> : null}</> : '—'}</td>
                <td className="muted">{new Date(r.created_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td><Link to={`/opisy/${r.id}`}>Otwórz</Link></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function sectionBlocks(template) {
  const out = [{ key: 'TITLE', label: 'Tytuł oferty', keys: ['TITLE'] }]
  for (const s of (template?.sections || []).filter(x => x && x.enabled !== false)) {
    if (s.type === 'hero') out.push({ key: 'HERO', label: 'Nagłówek i lead', keys: ['HERO_H1', 'HERO_LEAD', 'HERO_IMG_ALT'] })
    if (s.type === 'content') out.push({ key: s.key, label: s.topic || s.key, keys: [`${s.key}_H2`, `${s.key}_P`, `${s.key}_P_BOLD`, ...[1, 2, 3, 4, 5].map(i => `${s.key}_LI${i}`), `${s.key}_AKCENT`, `${s.key}_IMG_ALT`] })
    if (s.type === 'faq') out.push({ key: 'FAQ', label: 'FAQ', keys: ['FAQ_H2', ...[1, 2, 3, 4, 5, 6].flatMap(i => [`FAQ_Q${i}`, `FAQ_A${i}`])] })
    if (s.type === 'features') out.push({ key: s.key, label: 'Atuty w kafelkach', keys: [1, 2, 3, 4, 5, 6].map(i => `FEAT${i}`) })
    if (s.type === 'why') out.push({ key: s.key, label: 'Dlaczego warto', keys: ['WHY_H2', ...[1, 2, 3, 4, 5].map(i => `WHY_LI${i}`)] })
    if (s.type === 'closing') out.push({ key: s.key, label: 'Podsumowanie', keys: ['CLOSING_H2', 'CLOSING_P'] })
    if (s.type === 'specs') out.push({ key: s.key, label: 'Specyfikacja', keys: ['SPECS_H2', ...Array.from({ length: 12 }, (_, i) => `SPEC${i + 1}`)] })
  }
  return out
}

// nazwa pola w trybie edycji
function fieldLabel(k) {
  let m
  if (k === 'TITLE') return 'Tytuł'
  if (k === 'HERO_H1') return 'Nagłówek H1'
  if (k === 'HERO_LEAD') return 'Lead'
  if (/_IMG_ALT$/.test(k)) return 'Opis obrazka (ALT)'
  if (/_H2$/.test(k)) return 'Nagłówek sekcji'
  if (/_P_BOLD$/.test(k)) return 'Pogrubione zdanie'
  if (/_AKCENT$/.test(k)) return 'Wyróżnik'
  if (/_P$/.test(k)) return k === 'CLOSING_P' ? 'Podsumowanie' : 'Akapit'
  if ((m = k.match(/_LI(\d)$/))) return `Punkt ${m[1]}`
  if ((m = k.match(/^FEAT(\d)$/))) return `Atut ${m[1]}`
  if ((m = k.match(/^SPEC(\d+)$/))) return `Parametr ${m[1]} („Nazwa: wartość”)`
  if ((m = k.match(/^FAQ_Q(\d)$/))) return `Pytanie ${m[1]}`
  if ((m = k.match(/^FAQ_A(\d)$/))) return `Odpowiedź ${m[1]}`
  return k
}
const LONG_FIELD = k => /_P$|_P_BOLD$|HERO_LEAD|FAQ_A|CLOSING_P|WHY_LI/.test(k)
// po ręcznej edycji: błędy kontroli, które da się sprawdzić od razu (limity znaków, liczby spoza faktów), są przeliczane
function recheckErrors(errors, fields) {
  const all = Object.values(fields).join(' ')
  const nums = new Set((all.match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(',', '.').replace(/^0+(?=\d)/, '').replace(/\.0+$/, '')))
  return (errors || []).flatMap(e => {
    let m
    if ((m = e.match(/^([A-Z0-9_]+): (\d+) zn\. > limit (\d+)$/))) { const len = String(fields[m[1]] || '').trim().length; return len > Number(m[3]) ? [`${m[1]}: ${len} zn. > limit ${m[3]}`] : [] }
    if ((m = e.match(/^(Liczby spoza faktów[^:]*): (.+)$/))) { const left = m[2].split(/,\s*/).filter(n => nums.has(n)); return left.length ? [`${m[1]}: ${left.join(', ')}`] : [] }
    return [e]
  })
}

function Fields({ keys, data }) {
  const v = k => String(data?.[k] ?? '').trim()
  const items = keys.filter(v)
  if (!items.length) return <p className="muted small">Sekcja pusta – brak pasujących faktów.</p>
  const lis = items.filter(k => /_LI\d$|^FEAT\d$|^SPEC\d+$/.test(k))
  return (
    <div className="fields">
      {items.map(k => {
        if (/_LI\d$|^FEAT\d$|^SPEC\d+$/.test(k)) return k === lis[0] ? <ul key={k}>{lis.map(x => <li key={x}>{v(x)}</li>)}</ul> : null
        if (/_H2$|_H1$|^FAQ_Q|^FAQ_H2|^TITLE$/.test(k)) return <p key={k} className="f-head">{v(k)}</p>
        if (/_IMG_ALT$/.test(k)) return <p key={k} className="muted small">ALT obrazka: {v(k)}</p>
        if (/_P_BOLD$|_AKCENT$/.test(k)) return <p key={k}><strong>{v(k)}</strong></p>
        return <p key={k}>{v(k)}</p>
      })}
    </div>
  )
}

function ReviewDetail({ id, profile }) {
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [tpl, setTpl] = useState(null)
  const [versions, setVersions] = useState([])
  const [sel, setSel] = useState({})
  const [comments, setComments] = useState({})
  const [asRule, setAsRule] = useState({})
  const [general, setGeneral] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [view, setView] = useState('sekcje')
  const [kids, setKids] = useState([])
  const [edit, setEdit] = useState(null)   // ręczna edycja: { fields, pl }
  const lk = useLookups()
  const timer = useRef(null)
  const canApprove = ['akceptujacy', 'admin'].includes(profile?.role)

  async function load() {
    const { data, error } = await supabase.from('descriptions').select('*').eq('id', id).single()
    if (error) { setErr(plError(error.message)); return }
    setD(data)
    if (data.template_id) { const t = await supabase.from('templates').select('*').eq('id', data.template_id).single(); setTpl(t.data) }
    const v = await supabase.from('descriptions').select('id, version, status').eq('channel_id', data.channel_id).eq('product_id', data.product_id).order('version', { ascending: false })
    setVersions(v.data || [])
    let pending = data.status === 'generowanie' || (data.meta?.translation_pending && Date.now() - new Date(data.updated_at || data.created_at).getTime() < 10 * 60000)
    if (data.is_base) {
      const k = await supabase.from('descriptions').select('id, product_id, version, status, qa').eq('family_id', data.family_id).eq('channel_id', data.channel_id).eq('is_base', false).order('version', { ascending: false })
      const latest = {}; for (const x of k.data || []) if (!latest[x.product_id]) latest[x.product_id] = x
      const list = Object.values(latest); setKids(list)
      pending = pending || list.some(x => x.status === 'generowanie')
    }
    clearTimeout(timer.current)
    if (pending) timer.current = setTimeout(load, 5000)
  }
  useEffect(() => { setSel({}); setComments({}); setAsRule({}); setGeneral(''); setErr(''); setEdit(null); load(); return () => clearTimeout(timer.current) }, [id])

  async function saveEdit() {
    const fields = Object.fromEntries(Object.entries({ ...(d.fields || {}), ...edit.fields }).map(([k, v]) => [k, String(v ?? '').trim()]))
    const pl = Object.fromEntries(Object.entries(edit.pl).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v))
    const changed = Object.keys(fields).filter(k => fields[k] !== String(d.fields?.[k] ?? '').trim())
    const plChanged = Object.keys({ ...pl, ...(d.translation_pl || {}) }).filter(k => (pl[k] || '') !== String(d.translation_pl?.[k] ?? '').trim())
    if (!changed.length && !plChanged.length) { setEdit(null); return }
    setBusy('edit'); setErr('')
    const html = renderDescription(fields, tpl, d.meta?.images || {})
    // tłumaczenie kontrolne pól zmienionych tylko w oryginale – oznaczone jako nieaktualne
    const stale = [...new Set([...(d.meta?.pl_stale || []), ...changed.filter(k => !plChanged.includes(k) && fields[k])])].filter(k => !plChanged.includes(k))
    const errors = recheckErrors(d.qa?.errors, fields)
    const entry = { by: profile?.id || null, by_name: profile?.full_name || profile?.email || '', at: new Date().toISOString(), fields: changed, pl_fields: plChanged, before: Object.fromEntries(changed.map(k => [k, d.fields?.[k] ?? ''])) }
    const patch = { fields, html, translation_pl: pl, meta: { ...(d.meta || {}), pl_stale: stale, manual_edits: [...(d.meta?.manual_edits || []), entry].slice(-20) },
      qa: { ...(d.qa || {}), errors, pass: errors.length === 0, manual_edit: entry }, ...(d.status === 'blad' ? { status: 'do_weryfikacji' } : {}) }
    const { error } = await supabase.from('descriptions').update(patch).eq('id', d.id)
    setBusy('')
    if (error) { setErr(plError(error.message)); return }
    setEdit(null); load()
  }
  function startEdit() {
    const keys = ['TITLE', ...templateFields(tpl)]
    setEdit({ fields: Object.fromEntries(keys.map(k => [k, d.fields?.[k] ?? ''])), pl: Object.fromEntries(keys.map(k => [k, d.translation_pl?.[k] ?? ''])) })
    setView('sekcje'); setSel({})
  }

  async function accept() {
    const errs = d.qa?.errors || []
    let patch = { status: 'zaakceptowany' }
    if (errs.length) {
      // akceptacja mimo błędów kontroli – świadoma decyzja redaktora, zapisana w QA (kto, kiedy, które błędy)
      const ok = window.confirm(`Ten opis ma ${errs.length === 1 ? '1 błąd' : `${errs.length} błędy`} kontroli:\n\n${errs.slice(0, 8).map(e => '• ' + e).join('\n')}${errs.length > 8 ? `\n… i ${errs.length - 8} więcej` : ''}\n\nCzy na pewno zaakceptować opis mimo tych błędów? Sprawdź wcześniej treść – np. liczby spoza faktów mogą być poprawne, jeśli wynikają z parametrów lub danych zestawu.`)
      if (!ok) return
      const note = window.prompt('Krótko: dlaczego akceptujesz mimo błędów? (opcjonalnie – zapisze się w historii opisu)', '') 
      if (note === null) return
      patch.qa = { ...(d.qa || {}), override: { by: profile?.id || null, by_name: profile?.full_name || profile?.email || '', at: new Date().toISOString(), errors: errs, note: note.trim() || null } }
    }
    setBusy('accept'); setErr('')
    const { error } = await supabase.from('descriptions').update(patch).eq('id', d.id)
    if (error) setErr(plError(error.message)); else load()
    setBusy('')
  }
  async function markStuck() {
    setBusy('stuck')
    const { error } = await supabase.from('descriptions').update({ status: 'blad', qa: { ...(d.qa || {}), pass: false, errors: ['Generowanie przerwane (brak odpowiedzi z n8n) – wygeneruj opis ponownie'] } }).eq('id', d.id).eq('status', 'generowanie')
    setBusy(''); if (error) setErr(plError(error.message)); else load()
  }
  async function removeVersion() {
    const others = versions.filter(v => v.id !== d.id)
    if (!window.confirm(`Usunąć wersję v${d.version} tego opisu?${others.length ? ` Zostanie ${others.length === 1 ? '1 wersja' : `${others.length} wersje`}.` : ' To jedyna wersja – opis tego SKU zniknie z listy.'}${d.is_base && kids.length ? '\n\nOpisy wariantów zostają.' : ''}\n\nTej operacji nie można cofnąć.`)) return
    setBusy('delete'); setErr('')
    const { error } = await supabase.from('descriptions').delete().eq('id', d.id)
    setBusy('')
    if (error) { setErr(plError(error.message)); return }
    nav(others.length ? `/opisy/${others[0].id}` : '/opisy')
  }
  async function variants() {
    setBusy('variants'); setErr('')
    try { const n = await generateVariants(d); if (!n) setErr('Wszystkie warianty mają już zaakceptowane opisy.'); await load() } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  async function regenerate() {
    const sections = Object.keys(sel).filter(k => sel[k])
    setBusy('regen'); setErr('')
    try {
      await regenerateSections(d, sections, sections.map(s => ({ section: s, text: comments[s] || '', rule: !!asRule[s] })), general, newId => nav(`/opisy/${newId}`))
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  if (err && !d) return <section className="page"><p className="error">{err}</p></section>
  if (!d || !lk) return <section className="page"><DrainLoader /></section>
  const qa = d.qa || {}
  const blocks = sectionBlocks(tpl)
  const chosen = Object.keys(sel).filter(k => sel[k])
  const editable = ['do_weryfikacji', 'blad', 'poprawki'].includes(d.status)

  return (
    <section className="page wide">
      <p><Link to="/opisy">← Wszystkie opisy</Link></p>
      <header className="page-head">
        <div>
          <h1>{lk.fam[d.family_id]} · {lk.ch[d.channel_id]}</h1>
          <p className="muted">{d.is_base ? 'Opis bazowy rodziny' : 'Opis wariantu'} · SKU {lk.sku[d.product_id]} · <span className={`tag st-${d.status}`}>{STATUS[d.status]}</span>{d.meta?.mode === 'variant' && d.status === 'zaakceptowany' && <span className="muted small"> (akceptacja odziedziczona z opisu bazowego)</span>}</p>
        </div>
        <label className="lead" style={{ flex: '0 0 220px' }}>Wersja
          <select value={d.id} onChange={e => nav(`/opisy/${e.target.value}`)}>
            {versions.map(v => <option key={v.id} value={v.id}>v{v.version} · {STATUS[v.status]}</option>)}
          </select>
        </label>
      </header>

      {d.status === 'generowanie' && Date.now() - new Date(d.created_at).getTime() > STUCK_MIN * 60000 && (
        <div className="panel"><p className="hint" style={{ marginTop: 0 }}>Generowanie trwa ponad {STUCK_MIN} minut – zadanie w n8n najpewniej zostało przerwane (np. limit czasu Gemini albo n8n). Oznacz opis jako przerwany i wygeneruj go ponownie; w n8n (Executions) widać, na którym kroku się zatrzymało.</p>
          <button className="btn ghost" disabled={!!busy} onClick={markStuck}>Oznacz jako przerwany</button></div>
      )}
      {d.status === 'generowanie' && <div className="panel"><p className="muted">AI pisze opis, a jeśli kontrola znajdzie błędy – poprawia je automatycznie. Zwykle 1–3 minuty; tłumaczenie kontrolne dochodzi chwilę po pojawieniu się opisu. Strona odświeży się sama.</p></div>}
      {d.status !== 'generowanie' && (
        <>
          {(d.meta?.timing?.total_ms || d.meta?.translation_pending || d.meta?.translation_error) && (
            <p className="muted small" style={{ margin: '0 0 6px' }}>{d.meta?.timing?.total_ms ? `Czas generowania: ${secs(d.meta.timing.total_ms)} (treść ${secs(d.meta.timing.content_ms)}${d.meta.timing.fix1_ms ? `, poprawki ${secs((d.meta.timing.fix1_ms || 0) + (d.meta.timing.fix2_ms || 0))}` : ''}${d.meta.timing.translation_ms ? `, tłumaczenie ${secs(d.meta.timing.translation_ms)}` : ''}). ` : ''}
              {d.meta?.translation_pending ? 'Tłumaczenie kontrolne (PL) w przygotowaniu – pojawi się za chwilę.' : d.meta?.translation_error ? `Tłumaczenie kontrolne nie powiodło się: ${d.meta.translation_error}` : ''}</p>
          )}
          {qa.auto_fix?.rounds > 0 && (
            <p className="muted small" role="status">Automatyczna poprawka: {qa.auto_fix.rounds === 1 ? '1 runda' : `${qa.auto_fix.rounds} rundy`}, poprawione pola: {[...new Set(qa.auto_fix.history.flatMap(h => h.changed))].join(', ') || '—'}.
              {(qa.errors?.length > 0 || qa.warnings?.length > 0) ? ' Pozostałe uwagi poniżej wymagają decyzji redaktora (np. brak faktów).' : ' Kontrola nie ma uwag.'}{qa.auto_fix.failed ? ` Poprawka przerwana: ${qa.auto_fix.failed}` : ''}</p>
          )}
          {(qa.errors?.length > 0 || qa.warnings?.length > 0) && (
            <div className="panel qa">
              {qa.errors?.length > 0 && <><h2>{qa.override ? 'Błędy kontroli (zaakceptowane mimo nich)' : 'Błędy do poprawy'}</h2><ul className="qa-err">{qa.errors.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
              {qa.override && <p className="warn small">Zaakceptowano mimo błędów{qa.override.by_name ? `: ${qa.override.by_name}` : ''}, {new Date(qa.override.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}{qa.override.note ? ` – „${qa.override.note}”` : ''}.</p>}
              {qa.manual_edit && <p className="muted small">Opis edytowano ręcznie ({qa.manual_edit.by_name || '—'}, {new Date(qa.manual_edit.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}). Limity znaków i liczby przeliczono ponownie; pozostałe uwagi dotyczą treści sprzed edycji – sprawdź je przed akceptacją.</p>}
              {qa.warnings?.length > 0 && <details open={!qa.errors?.length}><summary>Uwagi ({qa.warnings.length})</summary><ul className="qa-warn">{qa.warnings.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
            </div>
          )}
          <div className="review-bar">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={view === 'sekcje'} className={view === 'sekcje' ? 'tab on' : 'tab'} onClick={() => setView('sekcje')}>Sekcje i tłumaczenie</button>
              <button role="tab" aria-selected={view === 'podglad'} className={view === 'podglad' ? 'tab on' : 'tab'} onClick={() => setView('podglad')}>Podgląd opisu</button>
              <button role="tab" aria-selected={view === 'grafiki'} className={view === 'grafiki' ? 'tab on' : 'tab'} onClick={() => setView('grafiki')}>Grafiki</button>
            </div>
            <div className="review-actions">
              {(canApprove || !['zaakceptowany', 'opublikowany'].includes(d.status)) && <button className="btn ghost danger" disabled={!!busy} onClick={removeVersion}>Usuń wersję</button>}
              {d.html && <button className="btn ghost" onClick={() => navigator.clipboard.writeText(d.html)}>Kopiuj HTML</button>}
              {editable && tpl && !edit && <button className="btn ghost" disabled={!!busy} onClick={startEdit}>Edytuj ręcznie</button>}
              {edit && <><button className="btn ghost" disabled={!!busy} onClick={() => setEdit(null)}>Anuluj edycję</button><button className="btn" disabled={!!busy} onClick={saveEdit}>{busy === 'edit' ? 'Zapisywanie…' : 'Zapisz zmiany'}</button></>}
              {canApprove && d.status === 'do_weryfikacji' && !edit && (
                <button className={qa.errors?.length ? 'btn warn' : 'btn'} onClick={accept} disabled={!!busy} title={qa.errors?.length ? 'Opis ma błędy kontroli – możesz go zaakceptować po świadomym potwierdzeniu' : ''}>{busy === 'accept' ? 'Zapisywanie…' : qa.errors?.length ? 'Akceptuj mimo błędów' : 'Akceptuj opis'}</button>
              )}
            </div>
          </div>
          {err && <p className="error" role="alert">{err}</p>}

          {d.is_base && d.status === 'zaakceptowany' && (
            <div className="panel variants">
              <div className="panel-head">
                <h2>Warianty rodziny</h2>
                <button className="btn top" onClick={variants} disabled={!!busy}>{busy === 'variants' ? 'Uruchamianie…' : kids.length ? 'Generuj brakujące warianty' : 'Generuj opisy wariantów'}</button>
              </div>
              {kids.length === 0 ? <p className="muted">Opisy pozostałych SKU powstaną z tego opisu: AI zmieni tylko tytuł, nagłówek i fragmenty zależne od wariantu (wymiar, kolor, strona, parametry). Warianty bez błędów QA dziedziczą akceptację.</p> : (
                <>
                  <p className="summary">
                    {['zaakceptowany', 'do_weryfikacji', 'generowanie', 'blad'].map(st => { const n = kids.filter(x => x.status === st).length; return n ? <span key={st} className={`tag st-${st}`}>{n} {STATUS[st]}</span> : null })}
                  </p>
                  <div className="kid-list">
                    {kids.filter(x => x.status !== 'zaakceptowany').map(x => <Link key={x.id} to={`/opisy/${x.id}`} className={`tag st-${x.status}`}>{lk.sku[x.product_id]}</Link>)}
                  </div>
                </>
              )}
            </div>
          )}

          {view === 'grafiki' ? (
            <div className="images-view">
              <ImageSlots d={d} tpl={tpl} canEdit={['do_weryfikacji', 'blad', 'poprawki'].includes(d.status) || (d.status === 'zaakceptowany' && canApprove)} onSaved={load} />
              <div className="preview-frame" dangerouslySetInnerHTML={{ __html: d.html || '' }} />
            </div>
          ) : view === 'podglad' ? <div className="preview-frame" dangerouslySetInnerHTML={{ __html: d.html || '' }} /> : (
            <>
              <div className="review-grid head"><div /><div>Oryginał</div><div>Tłumaczenie kontrolne (PL)</div><div>Uwagi</div></div>
              {edit ? blocks.map((b, bi) => {
                const keys = b.keys.filter(k => k in edit.fields)
                if (!keys.length) return null
                return (
                  <div key={b.key} className="review-grid editing">
                    <div><strong>{b.label}</strong></div>
                    <div>{keys.map(k => <label key={k} className="edit-field">{fieldLabel(k)} <span className="muted small">{String(edit.fields[k] || '').length} zn.</span>
                      <textarea rows={LONG_FIELD(k) ? 4 : 2} value={edit.fields[k]} onChange={e => setEdit({ ...edit, fields: { ...edit.fields, [k]: e.target.value } })} /></label>)}</div>
                    <div className="pl">{keys.map(k => <label key={k} className="edit-field">{fieldLabel(k)} (PL)
                      <textarea rows={LONG_FIELD(k) ? 4 : 2} value={edit.pl[k]} onChange={e => setEdit({ ...edit, pl: { ...edit.pl, [k]: e.target.value } })} /></label>)}</div>
                    <div className="muted small">{bi === 0 && 'Puste pole = element nie pojawi się w opisie. Tłumaczenie PL służy tylko do kontroli – jeśli go nie poprawisz, zostanie oznaczone jako nieaktualne. Po zapisie podgląd HTML odświeży się automatycznie.'}</div>
                  </div>
                )
              }) : blocks.map(b => (
                <div key={b.key} className={'review-grid' + (sel[b.key] ? ' picked' : '')}>
                  <div><label className="check">{editable && <input type="checkbox" checked={!!sel[b.key]} onChange={e => setSel({ ...sel, [b.key]: e.target.checked })} />}<strong>{b.label}</strong></label></div>
                  <div><Fields keys={b.keys} data={d.fields} /></div>
                  <div className="pl">{b.keys.some(k => (d.meta?.pl_stale || []).includes(k)) && <p className="warn small" style={{ margin: '0 0 6px' }}>Tłumaczenie nieaktualne – oryginał edytowano ręcznie</p>}<Fields keys={b.keys} data={d.translation_pl} /></div>
                  <div>{editable && <>
                    <textarea rows={3} placeholder="Co poprawić?" value={comments[b.key] || ''} onChange={e => { setComments({ ...comments, [b.key]: e.target.value }); if (e.target.value && !sel[b.key]) setSel({ ...sel, [b.key]: true }) }} />
                    {(comments[b.key] || '').trim() && <label className="check small rule-check"><input type="checkbox" checked={!!asRule[b.key]} onChange={e => setAsRule({ ...asRule, [b.key]: e.target.checked })} /> zaproponuj jako stałą zasadę</label>}
                  </>}</div>
                </div>
              ))}
              {editable && !edit && (
                <div className="panel regen">
                  <label>Uwaga ogólna do poprawianych sekcji (opcjonalnie)<textarea rows={2} value={general} onChange={e => setGeneral(e.target.value)} /></label>
                  <button className="btn" onClick={regenerate} disabled={!chosen.length || !!busy}>{busy === 'regen' ? 'Wysyłanie…' : `Popraw zaznaczone sekcje (${chosen.length})`}</button>
                  <p className="muted small">Powstanie nowa wersja opisu. Zaznaczone sekcje AI przepisze z uwzględnieniem uwag, pozostałe zostaną bez zmian.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

export default function Review({ profile }) {
  const { id } = useParams()
  return id ? <ReviewDetail id={id} profile={profile} /> : <ReviewList profile={profile} />
}
