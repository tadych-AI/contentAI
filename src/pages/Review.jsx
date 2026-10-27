import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, plError, fetchAll } from '../supabase.js'
import { regenerateSections, generateVariants } from '../gen.js'
import DrainLoader from '../components/DrainLoader.jsx'
import ImageSlots from '../components/ImageSlots.jsx'

const STATUS = { generowanie: 'w trakcie', do_weryfikacji: 'do weryfikacji', poprawki: 'poprawiony', zaakceptowany: 'zaakceptowany', opublikowany: 'opublikowany', blad: 'błąd', do_generacji: 'do generacji' }
const FILTERS = [['do_weryfikacji', 'Do weryfikacji'], ['zaakceptowany', 'Zaakceptowane'], ['blad', 'Błędy'], ['wszystkie', 'Wszystkie']]

function useLookups() {
  const [l, setL] = useState(null)
  useEffect(() => { (async () => {
    const [f, c, p] = await Promise.all([fetchAll('product_families', 'id, name'), supabase.from('channels').select('id, marketplace, language'), fetchAll('products', 'id, sku')])
    setL({ fam: Object.fromEntries((f || []).map(x => [x.id, x.name])), ch: Object.fromEntries((c.data || []).map(x => [x.id, `${x.marketplace} ${x.language.toUpperCase()}`])), sku: Object.fromEntries((p || []).map(x => [x.id, x.sku])) })
  })() }, [])
  return l
}

function ReviewList() {
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('do_weryfikacji')
  const lk = useLookups()
  useEffect(() => { (async () => {
    const data = await fetchAll('descriptions', 'id, family_id, channel_id, product_id, version, status, qa, created_at, is_base', q => q.order('version', { ascending: false }))
    const latest = {}
    for (const d of data || []) { const k = `${d.family_id}|${d.channel_id}|${d.product_id}`; if (!latest[k]) latest[k] = d }
    setRows(Object.values(latest).sort((a, b) => b.created_at.localeCompare(a.created_at)))
  })() }, [])
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
      {shown.length === 0 ? <div className="panel empty"><p className="muted">Brak opisów w tym widoku. Opis bazowy generujesz na ekranie Rodziny produktów (rodzina z zatwierdzonymi faktami).</p></div> : (
        <div className="panel table-wrap">
          <table className="compact">
            <thead><tr><th>Rodzina</th><th>SKU</th><th>Kanał</th><th>Wersja</th><th>Status</th><th>QA</th><th>Utworzono</th><th /></tr></thead>
            <tbody>{shown.map(r => (
              <tr key={r.id}>
                <td><strong>{lk.fam[r.family_id] || '—'}</strong>{r.is_base && <span className="tag">bazowy</span>}</td><td className="mono">{lk.sku[r.product_id]}</td><td>{lk.ch[r.channel_id]}</td><td>v{r.version}</td>
                <td><span className={`tag st-${r.status}`}>{STATUS[r.status]}</span></td>
                <td>{r.qa ? <>{r.qa.errors?.length ? <span className="tag err">{r.qa.errors.length} błędy</span> : <span className="tag okt">OK</span>} {r.qa.warnings?.length ? <span className="muted small">{r.qa.warnings.length} uwag</span> : null}</> : '—'}</td>
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
    let pending = data.status === 'generowanie'
    if (data.is_base) {
      const k = await supabase.from('descriptions').select('id, product_id, version, status, qa').eq('family_id', data.family_id).eq('channel_id', data.channel_id).eq('is_base', false).order('version', { ascending: false })
      const latest = {}; for (const x of k.data || []) if (!latest[x.product_id]) latest[x.product_id] = x
      const list = Object.values(latest); setKids(list)
      pending = pending || list.some(x => x.status === 'generowanie')
    }
    clearTimeout(timer.current)
    if (pending) timer.current = setTimeout(load, 5000)
  }
  useEffect(() => { setSel({}); setComments({}); setAsRule({}); setGeneral(''); setErr(''); load(); return () => clearTimeout(timer.current) }, [id])

  async function accept() {
    setBusy('accept'); setErr('')
    const { error } = await supabase.from('descriptions').update({ status: 'zaakceptowany' }).eq('id', d.id)
    if (error) setErr(plError(error.message)); else load()
    setBusy('')
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
  const editable = ['do_weryfikacji', 'blad'].includes(d.status)

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

      {d.status === 'generowanie' && <div className="panel"><p className="muted">AI pisze opis i tłumaczenie kontrolne, a jeśli kontrola znajdzie uwagi – poprawia je automatycznie (do 2 rund; zwykle 1–5 minut). Strona odświeży się sama.</p></div>}
      {d.status !== 'generowanie' && (
        <>
          {qa.auto_fix?.rounds > 0 && (
            <p className="muted small" role="status">Automatyczna poprawka: {qa.auto_fix.rounds === 1 ? '1 runda' : `${qa.auto_fix.rounds} rundy`}, poprawione pola: {[...new Set(qa.auto_fix.history.flatMap(h => h.changed))].join(', ') || '—'}.
              {(qa.errors?.length > 0 || qa.warnings?.length > 0) ? ' Pozostałe uwagi poniżej wymagają decyzji redaktora (np. brak faktów).' : ' Kontrola nie ma uwag.'}{qa.auto_fix.failed ? ` Poprawka przerwana: ${qa.auto_fix.failed}` : ''}</p>
          )}
          {(qa.errors?.length > 0 || qa.warnings?.length > 0) && (
            <div className="panel qa">
              {qa.errors?.length > 0 && <><h2>Błędy do poprawy</h2><ul className="qa-err">{qa.errors.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
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
              {d.html && <button className="btn ghost" onClick={() => navigator.clipboard.writeText(d.html)}>Kopiuj HTML</button>}
              {canApprove && d.status === 'do_weryfikacji' && (
                <button className="btn" onClick={accept} disabled={!!busy || qa.errors?.length > 0} title={qa.errors?.length ? 'Najpierw popraw błędy QA' : ''}>{busy === 'accept' ? 'Zapisywanie…' : 'Akceptuj opis'}</button>
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
              {blocks.map(b => (
                <div key={b.key} className={'review-grid' + (sel[b.key] ? ' picked' : '')}>
                  <div><label className="check">{editable && <input type="checkbox" checked={!!sel[b.key]} onChange={e => setSel({ ...sel, [b.key]: e.target.checked })} />}<strong>{b.label}</strong></label></div>
                  <div><Fields keys={b.keys} data={d.fields} /></div>
                  <div className="pl"><Fields keys={b.keys} data={d.translation_pl} /></div>
                  <div>{editable && <>
                    <textarea rows={3} placeholder="Co poprawić?" value={comments[b.key] || ''} onChange={e => { setComments({ ...comments, [b.key]: e.target.value }); if (e.target.value && !sel[b.key]) setSel({ ...sel, [b.key]: true }) }} />
                    {(comments[b.key] || '').trim() && <label className="check small rule-check"><input type="checkbox" checked={!!asRule[b.key]} onChange={e => setAsRule({ ...asRule, [b.key]: e.target.checked })} /> zaproponuj jako stałą zasadę</label>}
                  </>}</div>
                </div>
              ))}
              {editable && (
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
  return id ? <ReviewDetail id={id} profile={profile} /> : <ReviewList />
}
