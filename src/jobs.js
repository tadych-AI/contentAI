import { supabase, N8N_URL } from './supabase.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Aktywne zadania n8n – znak w menu i nakładka pokazują, że coś się dzieje
export const jobActivity = new EventTarget()
const active = new Map()   // id → { type, stage, started, progress }
let seq = 0
const emit = () => jobActivity.dispatchEvent(new CustomEvent('change', { detail: active.size }))
export const activeJobCount = () => active.size
export const activeJobList = () => [...active.values()]

// Zleca zadanie n8n (wiersz w tabeli jobs + webhook) i czeka na wynik zapisany w bazie
// opts.progress – tekst postępu dla nakładki (np. „paczka 3 z 12”)
export async function runJob(jobType, payload, opts = {}) {
  const id = ++seq
  active.set(id, { type: jobType, stage: 'przygotowanie', started: opts.started || Date.now(), progress: opts.progress || '' }); emit()
  const onStage = st => { const j = active.get(id); if (j) { j.stage = st; emit() } opts.onStage?.(st) }
  try { return await runJobInner(jobType, payload, { ...opts, onStage }) } finally { active.delete(id); emit() }
}

async function runJobInner(jobType, payload, { onStage, timeoutSec = 180 } = {}) {
  if (!N8N_URL) throw new Error('Brakuje adresu n8n (zmienna VITE_N8N_WEBHOOK_URL).')
  const { data: { session } } = await supabase.auth.getSession()
  const ins = await supabase.from('jobs').insert({ job_type: jobType, payload, created_by: session.user.id }).select('id').single()
  if (ins.error) throw new Error(ins.error.message)
  const jobId = ins.data.id
  onStage?.('wyslane')
  let res
  try {
    res = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ job_id: jobId }),
    })
  } catch {
    await supabase.from('jobs').update({ status: 'blad', error: 'Brak połączenia z n8n' }).eq('id', jobId).eq('status', 'w_kolejce')
    throw new Error('Brak połączenia z n8n. Sprawdź, czy workflow „ContentAI – zadania” jest włączony (Active).')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    await supabase.from('jobs').update({ status: 'blad', error: body.error || `kod ${res.status}` }).eq('id', jobId).eq('status', 'w_kolejce')
    throw new Error(body.error || `n8n odrzucił zadanie (kod ${res.status}).`)
  }
  onStage?.('w_toku')
  for (let i = 0; i < timeoutSec / 2; i++) {
    await sleep(2000)
    const { data } = await supabase.from('jobs').select('status, result, error').eq('id', jobId).single()
    if (data?.status === 'gotowe') return data.result
    if (data?.status === 'blad') throw new Error(data.error || 'n8n zgłosił błąd zadania.')
  }
  await supabase.from('jobs').update({ status: 'blad', error: 'Przekroczony czas oczekiwania w aplikacji' }).eq('id', jobId).in('status', ['w_kolejce', 'w_toku'])
  throw new Error('n8n nie zakończył zadania w oczekiwanym czasie. Otwórz Executions w n8n i sprawdź, na którym węźle się zatrzymał.')
}
