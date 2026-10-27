import { useState } from 'react'
import { supabase, plError } from '../supabase.js'

// Logo z folderu public/ (tadych-logo.svg albo .png); bez pliku – nazwa tekstem
const LOGOS = ['tadych-logo.svg', 'tadych-logo.png'].map(f => `${import.meta.env.BASE_URL}${f}`)
function Logo() {
  const [i, setI] = useState(0)
  if (i >= LOGOS.length) return <span className="login-logo-text">Tadych</span>
  return <img className="login-logo" src={LOGOS[i]} alt="Tadych" onError={() => setI(i + 1)} />
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(plError(error.message))
    setBusy(false)
  }

  return (
    <main className="login">
      <section className="login-side">
        <div className="login-water" aria-hidden="true">
          <span className="caustic c1" /><span className="caustic c2" />
        </div>
        <Logo />
        <p className="login-claim"><span className="claim-name">TadychAI</span> <span className="claim-sub">ContentStudio</span> <span className="claim-desc">Opisy, tytuły i atrybuty na marketplace</span></p>
      </section>
      <section className="login-form">
        <form onSubmit={submit} className="panel narrow" noValidate>
          <h1>Zaloguj się</h1>
          <p className="muted">Konto zakłada admin aplikacji.</p>
          <label>E-mail
            <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
          </label>
          <label>Hasło
            <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={busy || !email || !password}>{busy ? 'Logowanie…' : 'Zaloguj się'}</button>
        </form>
      </section>
    </main>
  )
}
