// Generowanie opisów: kontekst rodziny (fakty, szablon, frazy, grafiki) → zadanie n8n
import { supabase, fetchAll } from './supabase.js'
import { resolveImages } from './render.js'
import { runJob, startJob } from './jobs.js'
import { variantAttrs, colorParam } from './families.js'

const MARKET = c => `${c.marketplace} ${c.language.toUpperCase()}`
export const DEFAULT_TITLE_PATTERN = '[typ produktu] [marka] [model], [wymiary] cm, [materiał], [kolor/wykończenie]'

// Atrybuty wariantu dla AI: z nazwy (wymiar, strona, kolor akcesoriów); kolor produktu z parametru „Kolor” w BL, gdy jest
export const attrsOf = p => { const a = variantAttrs(p?.name); const c = colorParam(p?.features); if (c) a.kolor = c; return Object.fromEntries(Object.entries(a).filter(([, v]) => v)) }

// Łańcuch kategorii BL od najbardziej szczegółowej do korzenia (szablony i banki fraz dziedziczą w górę drzewa)
async function categoryChain(id) {
  const out = []
  if (!id) return out
  const cats = await fetchAll('bl_categories', 'bl_category_id, parent_id')
  const byId = new Map(cats.map(c => [c.bl_category_id, c]))
  let cur = byId.get(id), guard = 0
  while (cur && guard++ < 20) { out.push(cur.bl_category_id); cur = cur.parent_id ? byId.get(cur.parent_id) : null }
  return out
}
const pickByChain = (rows, chain, key = 'bl_category_id') => {
  for (const id of chain) { const hit = rows.find(r => r[key] === id); if (hit) return hit }
  return rows.find(r => !r[key]) || null
}

// Fakty dla konkretnego produktu rodziny: marka + rodzina + fakty wariantów obejmujące ten produkt
export const factsFor = (facts, productId) => facts.filter(f => f.level === 'marka' || f.level === 'rodzina' || (f.level === 'wariant' && (f.variant_ids || []).includes(productId)))

// Zbiera wszystko, czego potrzebuje generacja, i sprawdza warunki wstępne
export async function buildContext(familyId, channelId) {
  const { data: family, error } = await supabase.from('product_families').select('*').eq('id', familyId).single()
  if (error) throw new Error(error.message)
  const chain = await categoryChain(family.bl_category_id)
  const [ch, br, tp, members, facts, banks, rules, cat, media] = await Promise.all([
    supabase.from('channels').select('*').eq('id', channelId).single(),
    family.brand_id ? supabase.from('brands').select('id, name').eq('id', family.brand_id).single() : Promise.resolve({ data: null }),
    supabase.from('templates').select('*').eq('channel_id', channelId).eq('status', 'aktywny'),
    supabase.from('products').select('id, sku, name, features, images, is_bundle, bundle_items').eq('family_id', familyId),
    supabase.from('kb_facts').select('id, content, level, variant_ids').eq('status', 'zatwierdzony')
      .or(family.brand_id ? `family_id.eq.${familyId},and(level.eq.marka,brand_id.eq.${family.brand_id})` : `family_id.eq.${familyId}`),
    supabase.from('keyword_banks').select('*'),
    supabase.from('qa_rules').select('*').eq('status', 'aktywna'),
    family.bl_category_id ? supabase.from('bl_categories').select('path').eq('bl_category_id', family.bl_category_id).single() : Promise.resolve({ data: null }),
    supabase.from('media_library').select('id, brand_id, role, url'),
  ])
  const err = [ch, tp, members, facts, banks, rules].find(x => x.error)?.error
  if (err) throw new Error(err.message)
  const channel = ch.data
  const products = members.data || []
  const product = products.find(p => p.id === family.lead_product_id) || null
  const templates = (tp.data || []).filter(t => !t.brand_id || t.brand_id === family.brand_id)
  const template = pickByChain(templates.filter(t => !t.brand_id || t.brand_id === family.brand_id).sort((a, b) => (b.brand_id ? 1 : 0) - (a.brand_id ? 1 : 0)), chain)
  const bank = pickByChain((banks.data || []).filter(b => b.language === channel.language), chain)
  const excluded = new Set(bank?.excluded || [])
  const keywords = (bank?.keywords || []).filter(k => !excluded.has(k.kw)).map(k => ({ kw: k.kw, volume: k.volume }))
  const allFacts = facts.data || []
  const problems = []
  if (!product) problems.push('Wybierz wariant wiodący rodziny (ekran Rodziny produktów).')
  if (!template) problems.push(`Brak aktywnego szablonu opisu dla ${MARKET(channel)}.`)
  if (!allFacts.some(f => f.level !== 'marka')) problems.push('Brak zatwierdzonych faktów rodziny – wyciągnij i zatwierdź je na ekranie Fakty.')
  const lang = channel.language
  return {
    problems, family, channel, brand: br.data, template, media: media.data || [], product, products, facts: allFacts, keywords, bank, categoryPath: cat.data?.path || '',
    forbidden: (rules.data || []).filter(r => ['zakazany_wzorzec', 'marka_konkurencji'].includes(r.rule_type) && (!r.language || r.language === lang)).map(r => r.pattern),
    instructions: (rules.data || []).filter(r => r.rule_type === 'instrukcja' && (!r.language || r.language === lang)).map(r => r.pattern),
  }
}

const productInfo = p => ({ sku: p.sku, name: p.name, attributes: attrsOf(p), params: p.features || {},
  bundle: p.is_bundle ? (p.bundle_items || []).map(b => `${b.quantity} × ${b.bl_id}`) : [] })

function payloadFrom(ctx, extra) {
  return {
    language: ctx.channel.language, market: MARKET(ctx.channel), brand: ctx.brand?.name || '',
    family: { name: ctx.family.name, category: ctx.categoryPath, varying: ctx.family.varying_attributes || [] },
    product: productInfo(ctx.product),
    facts: factsFor(ctx.facts, ctx.product.id).map(f => f.content), keywords: ctx.keywords.slice(0, 150),
    template: { sections: ctx.template.sections.filter(s => s && s.enabled !== false), styles: ctx.template.styles },
    images: resolveImages(ctx.template, ctx.product, { media: ctx.media, brandId: ctx.family.brand_id }),
    limits: ctx.channel.limits || {}, forbidden: ctx.forbidden, instructions: ctx.instructions,
    title_pattern: (ctx.channel.limits || {}).title_pattern || DEFAULT_TITLE_PATTERN,
    ...extra,
  }
}

async function nextVersion(channelId, productId) {
  const { data } = await supabase.from('descriptions').select('version').eq('channel_id', channelId).eq('product_id', productId).order('version', { ascending: false }).limit(1)
  return (data?.[0]?.version || 0) + 1
}

async function launch(descId, payload) {
  try {
    await runJob('generate_description', { ...payload, description_id: descId }, { timeoutSec: 900 })
  } catch (e) {
    await supabase.from('descriptions').update({ status: 'blad', qa: { pass: false, errors: [e.message], warnings: [] } }).eq('id', descId)
    throw e
  }
}

// Nowy opis bazowy rodziny (wariant wiodący) dla kanału
export async function generateBase(familyId, channelId, onCreated) {
  const ctx = await buildContext(familyId, channelId)
  if (ctx.problems.length) throw new Error(ctx.problems.join(' '))
  const { data: { session } } = await supabase.auth.getSession()
  const version = await nextVersion(channelId, ctx.product.id)
  const ins = await supabase.from('descriptions').insert({ family_id: familyId, product_id: ctx.product.id, channel_id: channelId, template_id: ctx.template.id,
    is_base: true, version, status: 'generowanie', created_by: session.user.id }).select('id').single()
  if (ins.error) throw new Error(ins.error.message)
  onCreated?.(ins.data.id)
  await launch(ins.data.id, payloadFrom(ctx, { mode: 'full' }))
  return ins.data.id
}

// Poprawka wybranych sekcji na podstawie uwag recenzenta → nowa wersja
export async function regenerateSections(desc, sections, comments, general, onCreated) {
  const ctx = await buildContext(desc.family_id, desc.channel_id)
  if (!ctx.template) throw new Error('Brak aktywnego szablonu')
  const { data: { session } } = await supabase.auth.getSession()
  const rows = comments.filter(c => c.text.trim()).map(c => ({ description_id: desc.id, section_key: c.section, content: c.text.trim(), make_rule: !!c.rule, author: session.user.id }))
  if (general.trim()) rows.push({ description_id: desc.id, section_key: null, content: general.trim(), make_rule: false, author: session.user.id })
  if (rows.length) {
    const { data: saved } = await supabase.from('review_comments').insert(rows).select('id, content, make_rule')
    const proposals = (saved || []).filter(c => c.make_rule).map(c => ({ rule_type: 'instrukcja', pattern: c.content, language: ctx.channel.language, source_comment_id: c.id, status: 'propozycja', created_by: session.user.id }))
    if (proposals.length) await supabase.from('qa_rules').insert(proposals)
  }
  await supabase.from('descriptions').update({ status: 'poprawki' }).eq('id', desc.id)
  const ins = await supabase.from('descriptions').insert({ family_id: desc.family_id, product_id: desc.product_id, channel_id: desc.channel_id, template_id: ctx.template.id,
    is_base: desc.is_base, parent_id: desc.parent_id, version: desc.version + 1, fields: desc.fields, translation_pl: desc.translation_pl, meta: desc.meta,
    status: 'generowanie', created_by: session.user.id }).select('id').single()
  if (ins.error) throw new Error(ins.error.message)
  onCreated?.(ins.data.id)
  const product = ctx.products.find(p => p.id === desc.product_id) || ctx.product
  await launch(ins.data.id, payloadFrom({ ...ctx, product }, {
    mode: 'sections', sections, comments: comments.filter(c => c.text.trim()), general_comment: general.trim(),
    current_fields: desc.fields, current_translation: desc.translation_pl, keyword_map: desc.meta?.keyword_map,
  }))
  await supabase.from('review_comments').update({ status: 'uwzgledniona' }).eq('description_id', desc.id).eq('status', 'otwarta')
  return ins.data.id
}

// Warianty z zaakceptowanego opisu bazowego: paczki po 6 SKU w jednym wykonaniu n8n
export async function generateVariants(base, { onlyMissing = true } = {}) {
  const ctx = await buildContext(base.family_id, base.channel_id)
  if (!ctx.template) throw new Error('Brak aktywnego szablonu')
  if (base.status !== 'zaakceptowany') throw new Error('Najpierw zaakceptuj opis bazowy')
  const { data: existing } = await supabase.from('descriptions').select('product_id, version, status').eq('family_id', base.family_id).eq('channel_id', base.channel_id).eq('is_base', false).order('version', { ascending: false })
  const latest = {}
  for (const d of existing || []) if (!latest[d.product_id]) latest[d.product_id] = d
  const baseProduct = ctx.products.find(p => p.id === base.product_id)
  const todo = ctx.products.filter(p => p.id !== base.product_id && (!onlyMissing || !['zaakceptowany', 'opublikowany', 'generowanie'].includes(latest[p.id]?.status)))
  if (!todo.length) return 0
  const { data: { session } } = await supabase.auth.getSession()
  const rows = todo.map(p => ({ family_id: base.family_id, product_id: p.id, channel_id: base.channel_id, template_id: ctx.template.id, is_base: false,
    parent_id: base.id, version: (latest[p.id]?.version || 0) + 1, status: 'generowanie', created_by: session.user.id }))
  const { data: created, error } = await supabase.from('descriptions').insert(rows).select('id, product_id')
  if (error) throw new Error(error.message)
  const common = {
    market: MARKET(ctx.channel), language: ctx.channel.language, brand: ctx.brand?.name || '',
    family: { name: ctx.family.name, category: ctx.categoryPath, varying: ctx.family.varying_attributes || [] },
    keywords: ctx.keywords.slice(0, 80), limits: ctx.channel.limits || {}, forbidden: ctx.forbidden, instructions: ctx.instructions,
    template: { sections: ctx.template.sections.filter(s => s && s.enabled !== false), styles: ctx.template.styles },
    base: { ...productInfo(baseProduct), fields: base.fields, translation_pl: base.translation_pl, keyword_map: base.meta?.keyword_map, approved_by: base.approved_by,
      facts: factsFor(ctx.facts, baseProduct.id).map(f => f.content) },
  }
  const byId = Object.fromEntries(todo.map(p => [p.id, p]))
  const variants = created.map(c => { const p = byId[c.product_id]; return { description_id: c.id, ...productInfo(p), images: resolveImages(ctx.template, p, { media: ctx.media, brandId: ctx.family.brand_id }),
    facts: factsFor(ctx.facts, p.id).map(f => f.content) } })
  for (let i = 0; i < variants.length; i += 6) {
    const chunk = variants.slice(i, i + 6)
    try { await startJob('generate_variants', { ...common, variants: chunk }) }
    catch (e) {
      await supabase.from('descriptions').update({ status: 'blad', qa: { pass: false, errors: [e.message], warnings: [] } }).in('id', chunk.map(v => v.description_id))
      throw e
    }
  }
  return variants.length
}
