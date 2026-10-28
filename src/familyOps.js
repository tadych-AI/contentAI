// Ręczne tworzenie rodzin i dokładanie produktów do istniejących (ekran Produkty w aplikacji)
import { supabase, fetchAll } from './supabase.js'
import { variantAttrs, familyKey } from './familiesCore.js'

const VARY = ['wymiar', 'kolor', 'kolor_akcesoriow', 'strona']
export const varyingOf = items => VARY.filter(a => new Set(items.map(i => variantAttrs(i.name)[a] || '')).size > 1)
const longestDesc = items => [...items].sort((a, b) => (b.desc_len || 0) - (a.desc_len || 0))[0]

// propozycja nazwy: wspólny klucz modelu z nazw (bez marki, wymiarów, kolorów), inaczej nazwa pierwszego produktu
export function suggestName(items, brandName = () => '') {
  const keys = items.map(p => familyKey(p.name, brandName(p.brand_id))).filter(Boolean)
  if (!keys.length) return items[0]?.name || ''
  const words = keys[0].split(' ').filter(w => keys.every(k => k.split(' ').includes(w)))
  const s = (words.length ? words.join(' ') : keys[0])
  return s.replace(/(^|\s)\p{L}/gu, c => c.toUpperCase())
}

// po przeniesieniu produktów: rodziny źródłowe bez produktów są usuwane, a gdy odszedł wariant wiodący – wybierany jest nowy
async function tidySources(sourceIds, movedIds) {
  const ids = [...new Set(sourceIds.filter(Boolean))]
  if (!ids.length) return { removed: 0 }
  const fams = await fetchAll('product_families', 'id, lead_product_id', q => q.in('id', ids))
  const left = (await fetchAll('products', 'id, family_id', q => q.in('family_id', ids))).filter(p => !movedIds.includes(p.id))
  const empty = fams.filter(f => !left.some(p => p.family_id === f.id)).map(f => f.id)
  if (empty.length) { const r = await supabase.from('product_families').delete().in('id', empty); if (r.error) throw r.error }
  for (const f of fams.filter(f => !empty.includes(f.id) && movedIds.includes(f.lead_product_id))) {
    const next = left.find(p => p.family_id === f.id)
    const r = await supabase.from('product_families').update({ lead_product_id: next.id }).eq('id', f.id); if (r.error) throw r.error
  }
  return { removed: empty.length }
}

export async function createFamily(items, { name, leadId, approve, userId }) {
  if (!items.length) throw new Error('Zaznacz produkty')
  const lead = items.find(p => p.id === leadId) || longestDesc(items)
  const { data, error } = await supabase.from('product_families').insert({
    name: name.trim() || lead.name, brand_id: lead.brand_id || null, bl_category_id: lead.bl_category_id || null, lead_product_id: lead.id,
    status: approve ? 'zatwierdzone' : 'propozycja', grouping: { rule: 'recznie', sku: items.map(p => p.sku) }, varying_attributes: varyingOf(items), created_by: userId || null,
  }).select('id').single()
  if (error) throw error
  const sources = items.map(p => p.family_id)
  const r = await supabase.from('products').update({ family_id: data.id }).in('id', items.map(p => p.id)); if (r.error) throw r.error
  const t = await tidySources(sources, items.map(p => p.id))
  return { id: data.id, ...t }
}

export async function addToFamily(familyId, items) {
  const moving = items.filter(p => p.family_id !== familyId)
  if (!moving.length) return { added: 0, removed: 0 }
  const sources = moving.map(p => p.family_id)
  let r = await supabase.from('products').update({ family_id: familyId }).in('id', moving.map(p => p.id)); if (r.error) throw r.error
  const members = await fetchAll('products', 'id, name', q => q.eq('family_id', familyId))
  r = await supabase.from('product_families').update({ varying_attributes: varyingOf(members) }).eq('id', familyId); if (r.error) throw r.error
  const t = await tidySources(sources, moving.map(p => p.id))
  return { added: moving.length, ...t }
}
