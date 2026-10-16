import { useEffect, useState } from 'react'
import { supabase, plError, ROLE_LABELS } from '../supabase.js'

export default function Users() {
  const [rows, setRows] = useState([])
  const [msg, setMsg] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('profiles').select('id, email, full_name, role').order('email')
    if (error) setMsg({ type: 'error', text: plError(error.message) }); else setRows(data)
  }
  useEffect(() => { load() }, [])

  async function setRole(id, role) {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
    setMsg(error ? { type: 'error', text: plError(error.message) } : { type: 'ok', text: 'Rola zapisana.' })
    load()
  }

  return (
    <section className="page">
      <h1>Użytkownicy</h1>
      <p className="muted lead">Nowe konto dodajesz w Supabase: Authentication → Users → Add user. Tu nadajesz mu rolę.</p>
      <div className="panel table-wrap">
        <table>
          <thead><tr><th>Osoba</th><th>E-mail</th><th>Rola</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.full_name || '—'}</td>
                <td>{r.email}</td>
                <td>
                  <select value={r.role} onChange={e => setRole(r.id, e.target.value)} aria-label={`Rola: ${r.email}`}>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className={msg.type} role="status">{msg.text}</p>}
    </section>
  )
}
