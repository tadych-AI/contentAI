import { Fragment, useEffect, useState } from 'react'
import { supabase, plError, ROLE_LABELS, fmtDate } from '../supabase.js'

// Hasło tymczasowe: 12 znaków, litery i cyfry (bez mylących 0/O, 1/l/I)
function genPassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz', dig = '23456789', all = abc + dig
  const rnd = n => { const a = new Uint32Array(n); crypto.getRandomValues(a); return [...a] }
  const chars = rnd(12).map(x => all[x % all.length])
  const [i, j] = rnd(2); chars[i % 12] = dig[j % dig.length]; chars[(i + 5) % 12] = abc[j % abc.length]
  return chars.join('')
}
const pwProblem = p => !p ? 'Podaj hasło' : p.length < 8 ? 'Hasło musi mieć co najmniej 8 znaków' : !/[0-9]/.test(p) || !/\p{L}/u.test(p) ? 'Hasło musi zawierać litery i cyfry' : ''
const rpcError = e => plError(String(e?.message || e).replace(/^.*?ERROR:\s*/, ''))

function PasswordField({ value, onChange, id }) {
  const [show, setShow] = useState(false)
  return (
    <span className="row-form" style={{ gap: 6, alignItems: 'center' }}>
      <input id={id} type={show ? 'text' : 'password'} value={value} autoComplete="new-password" onChange={e => onChange(e.target.value)} style={{ margin: 0, flex: 1, minWidth: 160 }} />
      <button type="button" className="link-dark" onClick={() => setShow(s => !s)}>{show ? 'Ukryj' : 'Pokaż'}</button>
      <button type="button" className="link-dark" onClick={() => { onChange(genPassword()); setShow(true) }}>Generuj</button>
    </span>
  )
}

export default function Users({ profile }) {
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState(null)
  const [form, setForm] = useState({ email: '', full_name: '', role: 'generujacy', password: '' })
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(null)       // { id, full_name, role }
  const [pw, setPw] = useState(null)           // { id, password }

  async function load() {
    const { data, error } = await supabase.rpc('admin_list_users')
    if (error) {
      // przed migracją 009 – lista z profili (bez zarządzania kontami)
      const p = await supabase.from('profiles').select('id, email, full_name, role').order('email')
      setRows((p.data || []).map(r => ({ ...r, legacy: true })))
      setMsg({ type: 'error', text: /admin_list_users|function/i.test(error.message) ? 'Uruchom w Supabase migrację 009_uzytkownicy.sql, aby dodawać i usuwać użytkowników.' : rpcError(error) })
      return
    }
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  async function create(e) {
    e.preventDefault()
    const bad = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()) ? 'Podaj poprawny adres e-mail' : pwProblem(form.password)
    if (bad) { setMsg({ type: 'error', text: bad }); return }
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('admin_create_user', { p_email: form.email.trim(), p_password: form.password, p_full_name: form.full_name.trim() || null, p_role: form.role })
    setBusy(false)
    if (error) { setMsg({ type: 'error', text: rpcError(error) }); return }
    setMsg({ type: 'ok', text: `Utworzono konto ${form.email.trim().toLowerCase()}. Przekaż hasło tej osobie bezpiecznym kanałem – po zalogowaniu może je zmienić w „Moje konto”.` })
    setForm({ email: '', full_name: '', role: 'generujacy', password: '' }); load()
  }

  async function saveEdit() {
    const { error } = await supabase.rpc('admin_update_user', { p_user: edit.id, p_full_name: edit.full_name, p_role: edit.role })
    setMsg(error ? { type: 'error', text: rpcError(error) } : { type: 'ok', text: 'Zapisano zmiany.' })
    if (!error) { setEdit(null); load() }
  }

  async function savePassword(u) {
    const bad = pwProblem(pw.password)
    if (bad) { setMsg({ type: 'error', text: bad }); return }
    const { error } = await supabase.rpc('admin_set_password', { p_user: u.id, p_password: pw.password })
    setMsg(error ? { type: 'error', text: rpcError(error) } : { type: 'ok', text: `Nadano nowe hasło dla ${u.email}${u.id === profile?.id ? '.' : '. Otwarte sesje tej osoby zostały wylogowane.'}` })
    if (!error) setPw(null)
  }

  async function remove(u) {
    if (!window.confirm(`Usunąć konto ${u.email}?\n\nTa osoba straci dostęp do aplikacji. Jej zadania, akceptacje i autorstwo wpisów zostaną przypisane do Ciebie. Tej operacji nie można cofnąć.`)) return
    const { error } = await supabase.rpc('admin_delete_user', { p_user: u.id })
    setMsg(error ? { type: 'error', text: rpcError(error) } : { type: 'ok', text: `Usunięto konto ${u.email}.` })
    if (!error) load()
  }

  const legacy = rows?.some(r => r.legacy)
  return (
    <section className="page">
      <h1>Użytkownicy</h1>
      <p className="muted lead">Konta osób pracujących w aplikacji. Role: <strong>generujący</strong> – importuje, generuje i poprawia treści; <strong>akceptujący</strong> – dodatkowo zatwierdza fakty, opisy, tytuły i konfigurację; <strong>admin</strong> – wszystko, w tym konta i hasła.</p>

      {!legacy && (
        <form className="panel" onSubmit={create}>
          <h2 style={{ marginTop: 0 }}>Dodaj użytkownika</h2>
          <div className="filter-grid">
            <label>E-mail<input type="email" value={form.email} autoComplete="off" onChange={e => setForm({ ...form, email: e.target.value })} required /></label>
            <label>Imię i nazwisko<input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></label>
            <label>Rola<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label htmlFor="new-pw">Hasło (min. 8 znaków, litery i cyfry)<PasswordField id="new-pw" value={form.password} onChange={v => setForm({ ...form, password: v })} /></label>
          </div>
          <button className="btn" disabled={busy} style={{ marginTop: 12 }}>{busy ? 'Tworzenie…' : 'Utwórz konto'}</button>
          <p className="muted small" style={{ marginBottom: 0 }}>Konto jest od razu aktywne (bez e-maila z potwierdzeniem).</p>
        </form>
      )}

      {msg && <p className={msg.type} role="status">{msg.text}</p>}

      <div className="panel">
        {!rows ? <p className="muted">Wczytywanie…</p> : (
          <table className="compact">
            <thead><tr><th>Osoba</th><th>E-mail</th><th>Rola</th><th>Ostatnie logowanie</th><th /></tr></thead>
            <tbody>{rows.map(u => {
              const me = u.id === profile?.id
              return (
                <Fragment key={u.id}>
                  <tr>
                    <td>{edit?.id === u.id ? <input value={edit.full_name || ''} onChange={e => setEdit({ ...edit, full_name: e.target.value })} style={{ margin: 0 }} aria-label="Imię i nazwisko" /> : (u.full_name || '—')}{me && <span className="tag info" style={{ marginLeft: 6 }}>Ty</span>}</td>
                    <td>{u.email}</td>
                    <td>{edit?.id === u.id
                      ? <select value={edit.role} onChange={e => setEdit({ ...edit, role: e.target.value })} aria-label={`Rola: ${u.email}`}>{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      : ROLE_LABELS[u.role]}</td>
                    <td className="small">{legacy ? '—' : u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : 'jeszcze nie logował(a) się'}</td>
                    <td className="actions">{!legacy && (edit?.id === u.id
                      ? <span className="row-form" style={{ gap: 8, justifyContent: 'flex-end' }}><button className="link-dark" onClick={saveEdit}>Zapisz</button><button className="link-dark" onClick={() => setEdit(null)}>Anuluj</button></span>
                      : <span className="row-form" style={{ gap: 10, justifyContent: 'flex-end' }}>
                          <button className="link-dark" onClick={() => { setEdit({ id: u.id, full_name: u.full_name || '', role: u.role }); setPw(null) }}>Edytuj</button>
                          <button className="link-dark" onClick={() => { setPw(pw?.id === u.id ? null : { id: u.id, password: '' }); setEdit(null) }}>Hasło</button>
                          {!me && <button className="link-dark danger" onClick={() => remove(u)}>Usuń</button>}
                        </span>)}</td>
                  </tr>
                  {pw?.id === u.id && (
                    <tr className="detail-row"><td colSpan={5}>
                      <label htmlFor={`pw-${u.id}`} style={{ maxWidth: 520 }}>Nowe hasło dla {u.email}<PasswordField id={`pw-${u.id}`} value={pw.password} onChange={v => setPw({ ...pw, password: v })} /></label>
                      <span className="row-form" style={{ marginTop: 8 }}><button className="btn" onClick={() => savePassword(u)}>Ustaw hasło</button><button className="link-dark" onClick={() => setPw(null)}>Anuluj</button>
                        <span className="muted small">{me ? 'Zmieniasz własne hasło.' : 'Przekaż hasło tej osobie bezpiecznym kanałem. Jej otwarte sesje zostaną wylogowane.'}</span></span>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}</tbody>
          </table>
        )}
      </div>
    </section>
  )
}
