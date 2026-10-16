// Fakty: zlecanie ekstrakcji z opisów (produkt po produkcie) i stan faktów per produkt
import { fetchAll } from './supabase.js'
import { runJob } from './jobs.js'

export const LEVEL_LABEL = { produkt: 'Produkt', marka: 'Marka', rodzina: 'Rodzina', kategoria: 'Kategoria' }
export const STATUS_LABEL = { do_akceptacji: 'Do akceptacji', zatwierdzony: 'Zatwierdzone', odrzucony: 'Odrzucone' }

// Jeden produkt = jedno zadanie n8n (kolejne produkty widzą fakty marki zapisane przez poprzednie – bez powielania)
export async function extractFacts(products, { onProgress } = {}) {
  const started = Date.now()
  const sum = { done: 0, facts: 0, brand_facts: 0, flagged: 0, covered: 0, failed: [] }
  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    const progress = `produkt ${i + 1} z ${products.length} (${p.sku})`
    onProgress?.(progress)
    try {
      const r = await runJob('kb_extract_product', { product_id: p.id }, { timeoutSec: 300, started, progress })
      sum.done++; sum.facts += r?.facts || 0; sum.brand_facts += r?.brand_facts || 0; sum.flagged += r?.flagged || 0; sum.covered += r?.covered || 0
    } catch (e) {
      sum.failed.push({ sku: p.sku, error: e.message })
      // błąd konfiguracji (np. Vertex) powtórzy się dla każdego produktu – przerywamy po dwóch z rzędu
      if (sum.failed.length >= 2 && sum.done === 0) break
    }
  }
  return sum
}

// product_id → { pending, approved, rejected }
export async function factCounts() {
  const rows = await fetchAll('kb_facts', 'product_id, status', q => q.not('product_id', 'is', null))
  const m = new Map()
  for (const r of rows) {
    const c = m.get(r.product_id) || { do_akceptacji: 0, zatwierdzony: 0, odrzucony: 0 }
    c[r.status] = (c[r.status] || 0) + 1
    m.set(r.product_id, c)
  }
  return m
}

// Stan faktów produktu do wyświetlenia na liście
export function factState(p, counts) {
  if (!p.facts_extracted_at) return { key: 'brak', label: 'nie wyciągnięto' }
  const c = counts.get(p.id) || { do_akceptacji: 0, zatwierdzony: 0, odrzucony: 0 }
  const stale = p.facts_source_hash && p.source_hash && p.facts_source_hash !== p.source_hash
  if (stale) return { key: 'nieaktualne', label: 'opis w BL się zmienił', c }
  if (c.do_akceptacji) return { key: 'do_akceptacji', label: `${c.do_akceptacji} do akceptacji · ${c.zatwierdzony} ok`, c }
  return { key: 'gotowe', label: `${c.zatwierdzony} zatwierdzonych`, c }
}
