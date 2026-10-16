// Wspólna logika indeksu katalogu Baselinkera: słowniki, drzewo kategorii, filtr wyboru produktów, zlecenia n8n
import { supabase, fetchAll } from './supabase.js'
import { runJob } from './jobs.js'

export const MAX_RESULTS = 5000       // więcej wyników = prośba o zawężenie filtra
export const ENRICH_CHUNK = 1000      // ID na jedno zadanie „dociągnij kategorię i producenta” (10 zapytań do BL)
export const IMPORT_CHUNK = 100       // ID na jedno zadanie importu (1 zapytanie getInventoryProductsData)

// Kategorie i producenci z BL (małe tabele – ładowane w całości)
export async function loadDicts() {
  const [categories, manufacturers] = await Promise.all([
    fetchAll('bl_categories', 'bl_category_id, name, parent_id, path'),
    fetchAll('bl_manufacturers', 'bl_manufacturer_id, name'),
  ])
  const catById = new Map(categories.map(c => [c.bl_category_id, c]))
  const manById = new Map(manufacturers.map(m => [m.bl_manufacturer_id, m]))
  categories.sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name, 'pl'))
  manufacturers.sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  return { categories, manufacturers, catById, manById }
}

// Kategoria wraz ze wszystkimi podkategoriami
export function withDescendants(categories, ids) {
  const kids = new Map()
  for (const c of categories) { const p = c.parent_id || 0; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(c.bl_category_id) }
  const out = new Set(), stack = [...ids]
  while (stack.length) { const id = stack.pop(); if (out.has(id)) continue; out.add(id); stack.push(...(kids.get(id) || [])) }
  return [...out]
}

export const splitTerms = s => String(s || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean)
const orQuote = s => `"${String(s).replace(/["\\]/g, '')}"`

// filters: { brands: [{ id, name }], keywords, exclude, categoryIds, kind: 'all'|'single'|'bundle'|'variant' }
// Marka = producent w BL LUB nazwa marki w nazwie produktu (część katalogu nie ma producenta albo marki w nazwie)
export function applyFilters(q, filters, categories) {
  const brands = filters.brands || []
  if (brands.length) {
    const ids = brands.map(b => b.id).filter(Boolean)
    const parts = brands.map(b => `name.ilike.${orQuote(`*${b.name}*`)}`)
    if (ids.length) parts.unshift(`bl_manufacturer_id.in.(${ids.join(',')})`)
    q = q.or(parts.join(','))
  }
  for (const kw of splitTerms(filters.keywords)) q = q.ilike('name', `%${kw}%`)
  for (const kw of splitTerms(filters.exclude)) q = q.not('name', 'ilike', `%${kw}%`)
  if (filters.categoryIds?.length) q = q.in('bl_category_id', withDescendants(categories, filters.categoryIds))
  if (filters.kind === 'bundle') q = q.eq('is_bundle', true)
  if (filters.kind === 'single') q = q.eq('is_bundle', false).is('parent_id', null)
  if (filters.kind === 'variant') q = q.not('parent_id', 'is', null)
  return q
}

export const hasFilter = f => !!((f.brands || []).length || splitTerms(f.keywords).length || (f.categoryIds || []).length || (f.kind && f.kind !== 'all'))

export async function searchCatalog(filters, categories) {
  const cols = 'bl_id, parent_id, sku, ean, name, bl_category_id, bl_manufacturer_id, is_bundle'
  const head = await applyFilters(supabase.from('bl_catalog').select('bl_id', { count: 'exact', head: true }), filters, categories)
  if (head.error) throw head.error
  const total = head.count || 0
  if (total > MAX_RESULTS) return { total, rows: [], tooMany: true }
  const rows = await fetchAll('bl_catalog', cols, q => applyFilters(q, filters, categories).order('name'))
  return { total, rows, tooMany: false }
}

export async function indexStatus() {
  const [all, enriched, last] = await Promise.all([
    supabase.from('bl_catalog').select('bl_id', { count: 'exact', head: true }),
    supabase.from('bl_catalog').select('bl_id', { count: 'exact', head: true }).not('enriched_at', 'is', null),
    supabase.from('bl_catalog').select('synced_at, batch_id').order('synced_at', { ascending: false }).limit(1),
  ])
  const err = [all, enriched, last].find(x => x.error)?.error
  if (err) throw err
  return { total: all.count || 0, enriched: enriched.count || 0, syncedAt: last.data?.[0]?.synced_at || null, batchId: last.data?.[0]?.batch_id || null }
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

// Pełne odświeżenie indeksu: lista całego katalogu (n8n) → dociągnięcie kategorii i producentów paczkami
export async function refreshIndex({ full = false, onProgress } = {}) {
  const started = Date.now()
  onProgress?.('Pobieranie listy katalogu…')
  const list = await runJob('bl_catalog_list', {}, { timeoutSec: 600, started, progress: 'lista katalogu' })
  const rows = await fetchAll('bl_catalog', 'bl_id', q => full ? q : q.is('enriched_at', null))
  const ids = rows.map(r => r.bl_id)
  const parts = chunks(ids, ENRICH_CHUNK)
  let done = 0
  for (let i = 0; i < parts.length; i++) {
    const progress = `kategorie i producenci: paczka ${i + 1} z ${parts.length}`
    onProgress?.(progress)
    const r = await runJob('bl_catalog_enrich', { ids: parts[i], batch_id: list.batch_id }, { timeoutSec: 300, started, progress })
    done += r?.updated || 0
  }
  return { list, enriched: done, chunks: parts.length }
}

// Import wybranych produktów (pełne dane z BL → tabela products)
export async function importProducts(ids, { onProgress } = {}) {
  const started = Date.now()
  const parts = chunks(ids, IMPORT_CHUNK)
  const sum = { imported: 0, created: 0, updated: 0, skipped: [], warnings: [] }
  for (let i = 0; i < parts.length; i++) {
    const progress = `paczka ${i + 1} z ${parts.length}`
    onProgress?.(progress)
    const r = await runJob('bl_import', { ids: parts[i] }, { timeoutSec: 300, started, progress })
    sum.imported += r?.imported || 0
    sum.created += r?.created || 0
    sum.updated += r?.updated || 0
    sum.skipped.push(...(r?.skipped || []))
    sum.warnings.push(...(r?.warnings || []))
  }
  return sum
}
