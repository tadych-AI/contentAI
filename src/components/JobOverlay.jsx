import { useEffect, useState } from 'react'
import { jobActivity, activeJobList } from '../jobs.js'

const JOB_LABEL = {
  ping: 'Sprawdzanie połączenia z n8n',
  bl_catalog_list: 'Pobieranie listy katalogu z Baselinkera',
  bl_catalog_enrich: 'Dociąganie kategorii i producentów',
  bl_import: 'Import produktów z Baselinkera',
  kb_extract_product: 'Wyciąganie faktów z opisów (Gemini)',
  kb_extract_family: 'Wyciąganie faktów rodziny (Gemini)',
  keywords_refresh: 'Odświeżanie fraz kluczowych (DataForSEO)',
  generate_description: 'Generowanie opisu (Gemini)',
  generate_variants: 'Generowanie opisów wariantów',
  emag_characteristics: 'Uzupełnianie charakterystyk eMAG',
}
const STAGE_LABEL = { przygotowanie: 'Przygotowanie zadania…', wyslane: 'Zadanie wysłane do n8n…', w_toku: 'n8n pracuje – wynik pojawi się automatycznie' }
const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function JobOverlay() {
  const [jobs, setJobs] = useState(activeJobList())
  const [hidden, setHidden] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => { const l = activeJobList(); setJobs(l); if (!l.length) setHidden(false) }
    jobActivity.addEventListener('change', f); return () => jobActivity.removeEventListener('change', f)
  }, [])
  useEffect(() => { if (!jobs.length) return; const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t) }, [jobs.length])
  useEffect(() => { const k = e => { if (e.key === 'Escape') setHidden(true) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [])
  if (!jobs.length || hidden) return null
  const j = jobs[jobs.length - 1]
  const secs = Math.max(0, Math.round((Date.now() - jobs[0].started) / 1000))
  return (
    <div className="job-overlay">
      <div className="job-card" role="status" aria-live="polite">
        <span className="drain-grate lg" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <strong className="job-title">{JOB_LABEL[j.type] || 'Zadanie'}</strong>
        <span className="job-stage">{j.progress ? `${j.progress} · ` : ''}{STAGE_LABEL[j.stage] || j.stage}</span>
        <span className="job-time" aria-label={`Czas oczekiwania ${clock(secs)}`}>{clock(secs)}</span>
        <button className="btn ghost" onClick={() => setHidden(true)}>Ukryj – zadanie potrwa w tle</button>
      </div>
    </div>
  )
}
