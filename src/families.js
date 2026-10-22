// Rodziny produktów: zlecanie ekstrakcji faktów (logika grupowania w familiesCore.js)
import { runJob } from './jobs.js'
export * from './familiesCore.js'

// Jedna rodzina = jedno zadanie n8n (kolejne rodziny widzą fakty marki zapisane przez poprzednie)
export async function extractFamilyFacts(families, { onProgress } = {}) {
  const started = Date.now()
  const sum = { done: 0, family: 0, variant: 0, brand: 0, flagged: 0, covered: 0, failed: [] }
  for (let i = 0; i < families.length; i++) {
    const f = families[i]
    const progress = `rodzina ${i + 1} z ${families.length} (${f.name})`
    onProgress?.(progress)
    try {
      const r = await runJob('kb_extract_family', { family_id: f.id }, { timeoutSec: 360, started, progress })
      sum.done++; sum.family += r?.family_facts || 0; sum.variant += r?.variant_facts || 0; sum.brand += r?.brand_facts || 0
      sum.flagged += r?.flagged || 0; sum.covered += r?.covered || 0
    } catch (e) {
      sum.failed.push({ name: f.name, error: e.message })
      if (sum.failed.length >= 2 && sum.done === 0) break   // błąd konfiguracji – nie powtarzamy dla każdej rodziny
    }
  }
  return sum
}
