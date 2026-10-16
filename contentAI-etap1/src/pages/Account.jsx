import { useState } from 'react'
import { supabase, plError, ROLE_LABELS } from '../supabase.js'

export default function Account({ profile }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const tooShort = pw.length > 0 && pw.length < 10
  const mismatch = pw2.length > 0 && pw !== pw2

  async function save(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setMsg(error ? { type: 'error', text: plError(error.message) } : { type: 'ok', text: 'Hasło zmienione.' })
    if (!error) { setPw(''); setPw2('') }
    setBusy(false)
  }

  return (
    <section className="page">
      <h1>Moje konto</h1>
      <div className="panel narrow">
        <dl className="facts">
          <dt>E-mail</dt><dd>{profile?.email}</dd>
          <dt>Rola</dt><dd>{ROLE_LABELS[profile?.role]}</dd>
        </dl>
      </div>
      <form className="panel narrow" onSubmit={save}>
        <h2>Zmień hasło</h2>
        <p className="muted">Masz hasło tymczasowe od admina? Ustaw tu własne.</p>
        <label>Nowe hasło (min. 10 znaków)
          <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
        </label>
        {tooShort && <p className="hint">Jeszcze {10 - pw.length} zn.</p>}
        <label>Powtórz nowe hasło
          <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
        </label>
        {mismatch && <p className="hint">Hasła się różnią.</p>}
        {msg && <p className={msg.type} role="status">{msg.text}</p>}
        <button className="btn" disabled={busy || pw.length < 10 || pw !== pw2}>{busy ? 'Zapisywanie…' : 'Zmień hasło'}</button>
      </form>
    </section>
  )
}
