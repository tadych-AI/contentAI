// Biblioteka grafik: pliki w publicznym buckecie Supabase Storage „grafiki”, opis w tabeli media_library
import { supabase } from './supabase.js'

export const BUCKET = 'grafiki'
export const MAX_BYTES = 5 * 1024 * 1024
export const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
// Role podpowiadane w szablonach (grafika marki wg roli); można wpisać własną
export const ROLE_SUGGESTIONS = ['baner marki', 'logo marki', 'gwarancja', 'certyfikat', 'technologia', 'pielęgnacja', 'montaż', 'wymiary']

const slug = s => (s || 'grafika').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'grafika'

export const baseName = file => file.name.replace(/\.[^.]+$/, '')

export function checkFile(file) {
  if (!ACCEPT.includes(file.type)) return `${file.name}: dozwolone formaty JPG, PNG, WebP, GIF.`
  if (file.size > MAX_BYTES) return `${file.name}: plik ma ${(file.size / 1048576).toFixed(1)} MB (limit 5 MB).`
  return ''
}

async function dimensions(file) {
  try { const b = await createImageBitmap(file); const d = { width: b.width, height: b.height }; b.close?.(); return d } catch { return { width: null, height: null } }
}

export async function uploadMedia(file, { name, brandId = null, brandName = '', role = '', tags = [] } = {}) {
  const bad = checkFile(file); if (bad) throw new Error(bad)
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || file.type.split('/')[1]).toLowerCase()
  const path = `${brandId ? slug(brandName) : 'ogolne'}/${Date.now().toString(36)}-${slug(name || baseName(file))}.${ext}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false })
  if (up.error) throw up.error
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const { width, height } = await dimensions(file)
  const { data, error } = await supabase.from('media_library').insert({
    name: (name || baseName(file)).trim(), url, storage_path: path, mime: file.type, size_bytes: file.size, width, height,
    brand_id: brandId, scope: brandId ? 'marka' : 'ogolna', role: role.trim(), tags,
  }).select().single()
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw error }
  return data
}

export async function deleteMedia(m) {
  if (m.storage_path) { const r = await supabase.storage.from(BUCKET).remove([m.storage_path]); if (r.error) throw r.error }
  const { error } = await supabase.from('media_library').delete().eq('id', m.id)
  if (error) throw error
}

export async function loadMedia() {
  const { data, error } = await supabase.from('media_library').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Gdzie grafika jest użyta (szablony: wybrana z biblioteki, zapasowa lub stały adres; grafika marki wg roli)
export function usageOf(m, templates) {
  const out = []
  for (const t of templates || []) for (const s of t.sections || []) {
    if (s.image_url === m.url || s.media_id === m.id) out.push(`${t.name} · ${s.key}`)
    else if (s.image_source === 'brand' && m.brand_id && (s.image_role || '').trim().toLowerCase() === (m.role || '').trim().toLowerCase()) out.push(`${t.name} · ${s.key} (rola)`)
  }
  return out
}
