// eMAG: charakterystyki z danych Baselinkera (dopasowane do słowników z szablonu), gwarancja, typ rodziny, wiersze pliku importu.
// Bez zależności od przeglądarki i bazy – testowane w Node.
import { variantAttrs, colorParam } from './familiesCore.js'

const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/\s+/g, ' ').trim()

// Wartość dopasowana do słownika (bez wielkości liter i znaków diakrytycznych); null = brak w słowniku
export function matchAllowed(value, list) {
  if (value == null || value === '') return null
  const v = fold(value)
  return (list || []).find(x => fold(x) === v) || null
}

// --- słowniki PL → HU (wartości eMAG) ---
const COLOR_HU = { 'biały': 'Fehér', 'czarny': 'Fekete', 'złoty': 'Aranyszín', 'chrom': 'Króm', 'grafit': 'Antracitszürke', 'antracyt': 'Antracitszürke', 'szary': 'Szürke',
  'beżowy': 'Bézs', 'miedziany': 'Bronzszín', 'nikiel': 'Ezüstszín', 'inox': 'Ezüstszín', 'srebrny': 'Ezüstszín', 'brązowy': 'Barna', 'niebieski': 'Kék', 'zielony': 'Zöld', 'czerwony': 'Piros' }
const COLOR_WORDS = [['biały', /bia[łl]|white/], ['czarny', /czarn|black/], ['złoty', /z[łl]ot|gold/], ['chrom', /chrom/], ['grafit', /grafit/], ['antracyt', /antracyt/], ['szary', /szar/],
  ['beżowy', /be[żz]/], ['miedziany', /miedzian|miedź/], ['srebrny', /srebr/], ['brązowy', /br[ąa]z/], ['niebieski', /niebiesk/], ['zielony', /zielon/], ['czerwony', /czerwon/], ['inox', /inox|nierdzewn/]]
const MATERIAL_HU = [[/akryl/, 'Akril'], [/konglomerat|kompozyt|mineral|marmur lan|solid surface/, 'Ásványi kompozit'], [/stal|stalow/, 'Acél'], [/żeliw|zeliw/, 'Öntöttvas'],
  [/ceramik|porcelan/, 'Kerámia'], [/szk[łl]o|szklan/, 'Üveg'], [/marmur/, 'Márvány'], [/abs/, 'ABS'], [/pvc/, 'PVC'], [/drewn/, 'Fa']]
const SHAPE_HU = [[/prostok/, 'Négyszögletes'], [/owal/, 'Ovális'], [/asymetr/, 'Aszimmetrikus'], [/półokr|polokr/, 'Félkör'], [/okrąg|okrag/, 'Kör'], [/kwadrat/, 'Négyzet'], [/pięciok|pieciok/, 'Ötszög']]

const featureOf = (features, re) => { for (const [k, v] of Object.entries(features || {})) if (re.test(fold(k))) return String(v); return null }
const numOf = s => { const m = String(s ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null }
const fmt = n => String(Math.round(n * 10) / 10).replace(/\.0$/, '')

// Gwarancja w miesiącach: parametr BL („Gwarancja”, „Okres gwarancji”), pole dodatkowe albo zdanie w opisie
export function warrantyMonths(product) {
  const fromText = t => {
    const s = fold(t)
    let m = s.match(/gwarancj\w*[^0-9]{0,40}(\d{1,3})\s*(lat|lata|rok|years?|mies|m-c|months?)/) || s.match(/(\d{1,3})\s*(lat|lata|rok|mies\w*)\s*gwarancj/)
    if (!m) { const only = s.match(/^(\d{1,3})\s*(lat|lata|rok|mies\w*|m-c|months?|years?)?$/); if (only) m = only }
    if (!m) return null
    const n = Number(m[1]); const unit = m[2] || ''
    return /mies|m-c|month/.test(unit) ? n : (unit ? n * 12 : (n <= 10 ? n * 12 : n))
  }
  const f = featureOf(product.features, /gwarancj/)
  if (f) { const v = fromText(f) ?? fromText(`gwarancja ${f}`); if (v) return { months: v, source: 'parametr BL' } }
  for (const v of Object.values(product.extra_fields || {})) { const x = typeof v === 'string' && /gwarancj/i.test(v) ? fromText(v) : null; if (x) return { months: x, source: 'pole dodatkowe BL' } }
  const d = String(product.description_pl || '').replace(/<[^>]+>/g, ' ')
  const x = /gwarancj/i.test(d) ? fromText(d) : null
  return x ? { months: x, source: 'opis BL' } : null
}

// Kolor samego produktu: parametr „Kolor” z Baselinkera (źródło nadrzędne); gdy go brak – kolor z nazwy bez koloru akcesoriów → słownik eMAG
const METALLIC = new Set(['chrom', 'złoty', 'miedziany', 'nikiel', 'inox', 'srebrny'])
// produkty z akrylu/konglomeratu/ceramiki, które nie bywają metaliczne (metaliczny kolor z nazwy dotyczy wtedy akcesoriów)
const NON_METAL_PRODUCT = /wann|brodzik|umywal|misk|kompakt|bidet|zlew|zlewozmyw|pisuar/
const METAL_PRODUCT = /bateri|syfon|odplyw|korek|uchwyt|kabin|drzwi|parawan|scian|grzejnik|deszczown|zestaw prysznic|sluchawk|wylewk|akcesori|polk|wieszak|dozownik|lustr|stelaz|przycisk/
const toHu = (raw, name = '') => {
  const key = COLOR_WORDS.find(([, re]) => re.test(fold(raw)))?.[0]
  const mat = /\bmat/.test(fold(raw)) || /\bmat\b/.test(fold(name))
  return { key, hu: key ? (mat && key === 'czarny' ? 'Matt fekete' : mat && key === 'biały' ? 'Matt fehér' : COLOR_HU[key]) : null }
}
export function colorOf(product, { categoryPath = '' } = {}) {
  const param = colorParam(product.features)
  if (param) return { pl: param, hu: toHu(param, product.name).hu, source: 'parametr BL „Kolor”' }
  const parts = variantAttrs(product.name)
  if (!parts.kolor) return parts.kolor_akcesoriow ? { pl: null, hu: null, note: `brak parametru „Kolor” w BL, a kolor „${parts.kolor_akcesoriow}” w nazwie dotyczy akcesoriów – Szín do uzupełnienia` } : null
  const { key, hu } = toHu(parts.kolor, product.name)
  if (key && METALLIC.has(key) && NON_METAL_PRODUCT.test(fold(`${product.name} ${categoryPath}`)) && !METAL_PRODUCT.test(fold(categoryPath))) {
    return { pl: parts.kolor, hu: null, note: `brak parametru „Kolor” w BL; kolor „${parts.kolor}” z nazwy jest metaliczny, a produkt to wanna/umywalka/brodzik – to raczej kolor akcesoriów; Szín do uzupełnienia` }
  }
  return { pl: parts.kolor, hu, source: 'nazwa produktu' }
}

// Charakterystyki ustalane deterministycznie z danych BL (bez AI). chars = charakterystyki z szablonu.
export function presetCharacteristics(chars, product, { categoryPath = '' } = {}) {
  const out = {}, notes = []
  const byName = n => chars.find(c => fold(c.name) === fold(n))
  const put = (name, value, origin) => {
    const c = byName(name); if (!c || value == null || value === '') return
    const canon = matchAllowed(value, c.values)
    if (c.restrictive && !canon) { notes.push(`${c.name}: „${value}” spoza słownika eMAG – do uzupełnienia`); return }
    out[c.key] = { value: canon || String(value), origin }
  }
  const f = product.features || {}, name = product.name || '', all = fold(`${name} ${categoryPath}`)
  const color = colorOf(product, { categoryPath })
  if (color) { if (color.note) notes.push(`Szín: ${color.note}`); else if (color.hu) put('Szín', color.hu, `${color.source}: ${color.pl}`); else { const before = notes.length; put('Szín', color.pl, color.source); if (!out[byName('Szín')?.key] && notes.length === before) notes.push(`Szín: kolor „${color.pl}” (${color.source}) bez odpowiednika w słowniku eMAG – wybierz ręcznie`) } }
  if (/hydromasa|whirlpool/.test(all)) put('Típus', 'Hidromasszázzsal', 'nazwa/kategoria')
  else if (/wolnostoj/.test(all)) put('Típus', 'Szabadon álló', 'nazwa/kategoria')
  else if (/wann/.test(all)) put('Típus', 'Standard', 'nazwa/kategoria')
  const mat = featureOf(f, /material|tworzyw|wykonan/) || name
  const m = MATERIAL_HU.find(([re]) => re.test(fold(mat)))
  if (m) put('Anyag', m[1], featureOf(f, /material|tworzyw|wykonan/) ? 'parametr BL' : 'nazwa')
  const shape = featureOf(f, /ksztalt|kształt/)
  const sh = shape && SHAPE_HU.find(([re]) => re.test(fold(shape)))
  if (sh) put('Forma', sh[1], 'parametr BL')
  const dims = variantAttrs(name).wymiar
  const [d1, d2, d3] = dims ? dims.split('x').map(Number) : []
  const len = numOf(featureOf(f, /dlugosc|długość/)) ?? d1, wid = numOf(featureOf(f, /szerokosc|szerokość/)) ?? d2, hei = numOf(featureOf(f, /wysokosc|wysokość/)) ?? d3
  if (len) put('Hosszúság', `${fmt(len)} cm`, featureOf(f, /dlugosc/) ? 'parametr BL' : 'wymiar z nazwy')
  if (wid) put('Szélesség', `${fmt(wid)} cm`, featureOf(f, /szerokosc/) ? 'parametr BL' : 'wymiar z nazwy')
  if (hei) put('Magasság', `${fmt(hei)} cm`, featureOf(f, /wysokosc/) ? 'parametr BL' : 'wymiar z nazwy')
  const cap = numOf(featureOf(f, /pojemnosc|pojemność/))
  if (cap) put('Térfogat', `${fmt(cap)} l`, 'parametr BL')
  if (Number(product.weight) > 0.05) put('Súly', `${fmt(Number(product.weight))} kg`, 'waga BL')
  const side = variantAttrs(name).strona
  if (side) put('Felszerelés helye', side === 'prawa' ? 'Jobb' : 'Bal', 'strona z nazwy')
  return { values: out, notes }
}

// Typ rodziny eMAG: najprostszy typ, którego atrybuty mają wartości u wszystkich wariantów i jednoznacznie je rozróżniają
export function chooseFamilyType(types, chars, variants) {
  if (variants.length < 2) return { type: null, why: 'rodzina jednoproduktowa' }
  const keyOf = name => chars.find(c => fold(c.name) === fold(name))?.key
  const cands = []
  for (const t of types || []) {
    const keys = t.attributes.map(a => keyOf(a.name))
    if (keys.some(k => !k)) continue
    const tuples = variants.map(v => keys.map(k => v.values?.[k]?.value ?? ''))
    if (tuples.some(tp => tp.some(x => !x))) continue
    if (new Set(tuples.map(tp => tp.join('|'))).size !== variants.length) continue
    cands.push({ t, n: keys.length })
  }
  cands.sort((a, b) => a.n - b.n || b.t.attributes.filter(a => a.visible).length - a.t.attributes.filter(a => a.visible).length)
  return cands[0] ? { type: cands[0].t.label } : { type: null, why: 'żaden typ rodziny eMAG nie rozróżnia wariantów – sprawdź Szín / Hosszúság / Szélesség / Felszerelés helye' }
}

// Braki: obowiązkowe charakterystyki i wartości spoza słownika
export function characteristicIssues(chars, values) {
  const missing = chars.filter(c => c.level === 'mandatory' && !values?.[c.key]?.value).map(c => c.name)
  const invalid = chars.filter(c => c.restrictive && values?.[c.key]?.value && !matchAllowed(values[c.key].value, c.values)).map(c => `${c.name}: „${values[c.key].value}”`)
  return { missing, invalid }
}

// Wiersz pliku importu dla produktu. ctx: { product, description, title, brand, values, family, template, defaults }
// title = zatwierdzony tytuł z modułu tytułów (gdy brak – tytuł z opisu)
export function buildRow(fileType, { product, description, title, brand, values, family, template, defaults = {} }) {
  const imgs = [...(product.images || [])].sort((a, b) => a.position - b.position).map(i => i.url)
  const lang = (template.languages || []).find(l => /hu_HU/i.test(l)) || (template.languages || [])[0] || 'Magyar (hu_HU)'
  const w = warrantyMonths(product)
  const row = {
    part_number: String(product.sku || '').replace(/^#/, ''), vendor_ext_id: product.baselinker_product_id, ean: product.ean || '',
    name: title || description?.fields?.TITLE || '', brand: brand || '', description: description?.html || '', source_language: lang,
    main_image_url: imgs[0] || '', other_image_url1: imgs[1] || '', other_image_url2: imgs[2] || '', other_image_url3: imgs[3] || '', other_image_url4: imgs[4] || '', other_image_url5: imgs[5] || '',
  }
  if (family && family.size > 1 && family.type) Object.assign(row, { family_id: family.id, family_name: family.name, family_type: family.type })
  for (const c of template.characteristics || []) { const v = values?.[c.key]?.value; if (v) row[c.key] = c.restrictive ? (matchAllowed(v, c.values) || v) : v }
  if (fileType === 'create') {
    Object.assign(row, { stock: defaults.stock ?? 1, handling_time: defaults.handling_time ?? 2, status: defaults.status ?? '' })
    if (w) row.warranty = w.months
  }
  if (fileType === 'update') row.force_download = ''
  return row
}
export const NUMERIC_COLUMNS = ['vendor_ext_id', 'stock', 'handling_time', 'lead_time', 'warranty', 'family_id', 'status', 'category_id', 'force_download']

// Kontrola wiersza przed eksportem (pola obowiązkowe wg definicji danych eMAG)
export function rowProblems(fileType, row, chars) {
  const p = []
  if (!row.part_number) p.push('brak kodu produktu (SKU)')
  if (!row.vendor_ext_id) p.push('brak ID produktu')
  if (!row.name) p.push('brak tytułu (moduł Tytuły eMAG albo zaakceptowany opis)')
  if (!row.description) p.push('brak zaakceptowanego opisu (HTML)')
  if (String(row.description || '').length > 32000) p.push('opis HTML dłuższy niż 32 000 znaków (limit komórki Excela)')
  if (!row.brand) p.push('brak marki')
  if (fileType !== 'family' && !row.main_image_url) p.push('brak zdjęcia głównego')
  if (row.ean && !/^\d{8}$|^\d{12,14}$/.test(String(row.ean))) p.push(`niepoprawny EAN „${row.ean}”`)
  const { missing } = characteristicIssues(chars, Object.fromEntries(chars.map(c => [c.key, row[c.key] ? { value: row[c.key] } : null])))
  if (missing.length) p.push(`brak obowiązkowych charakterystyk: ${missing.join(', ')}`)
  return p
}

// ===== Rodziny eMAG: jak warianty rodziny z aplikacji połączą się w eMAG =====
// Najpierw cała rodzina; gdy żaden typ eMAG nie rozróżnia wariantów – podział wg cechy, której eMAG nie opisuje
// (kolor akcesoriów, potem kolor, strona, wymiar), tak by w każdej podrodzinie typ eMAG działał.
const SPLITS = [['kolor_akcesoriow', 'kolor akcesoriów'], ['kolor', 'kolor'], ['strona', 'strona'], ['wymiar', 'wymiar']]
const ACC_HU = { 'biały': 'fehér', 'czarny': 'fekete', 'złoty': 'arany', 'chrom': 'króm', 'grafit': 'grafit', 'szary': 'szürke', 'miedziany': 'réz', 'nikiel': 'nikkel', 'inox': 'inox', 'antracyt': 'antracit', 'beżowy': 'bézs' }
const SIDE_HU = { lewa: 'bal oldali', prawa: 'jobb oldali' }
export const SPLIT_LABEL = Object.fromEntries(SPLITS)

function typeAttrKeys(types, chars, label) {
  const t = (types || []).find(x => x.label === label)
  return t ? t.attributes.map(a => ({ name: a.name, key: chars.find(c => fold(c.name) === fold(a.name))?.key })) : []
}
function selectorOf(types, chars, label, items) {
  return typeAttrKeys(types, chars, label).map(a => ({ name: a.name, values: [...new Set(items.map(m => m.values?.[a.key]?.value).filter(Boolean))].sort((x, y) => String(x).localeCompare(String(y), 'hu', { numeric: true })) }))
}
// typ wymuszony ręcznie – ważny, jeśli rozróżnia warianty
function typeFits(types, chars, label, items) {
  const keys = typeAttrKeys(types, chars, label).map(a => a.key)
  if (!keys.length || keys.some(k => !k)) return false
  const tuples = items.map(m => keys.map(k => m.values?.[k]?.value ?? ''))
  return !tuples.some(tp => tp.some(x => !x)) && new Set(tuples.map(tp => tp.join('|'))).size === items.length
}
export function splitSuffix(key, value) {
  if (!key || !value) return ''
  if (key === 'kolor_akcesoriow') return `${ACC_HU[value] || value} kiegészítőkkel`
  if (key === 'kolor') return ACC_HU[value] || value
  if (key === 'strona') return SIDE_HU[value] || value
  if (key === 'wymiar') return `${value} cm`
  return value
}

// items: [{ product, values }] → { mode: 'cala' | 'podzial' | 'osobno' | 'jeden', split_key, groups: [{ split_value, items, type, selector }], why }
export function planEmagFamilies(types, chars, items, { forcedType = null } = {}) {
  if (items.length < 2) return { mode: 'jeden', groups: [], why: 'rodzina jednoproduktowa – produkt trafi do eMAG bez rodziny' }
  const whole = forcedType && typeFits(types, chars, forcedType, items) ? { type: forcedType } : chooseFamilyType(types, chars, items)
  if (whole.type) return { mode: 'cala', split_key: '', groups: [{ split_value: '', items, type: whole.type, selector: selectorOf(types, chars, whole.type, items) }] }
  for (const [key] of SPLITS) {
    const val = m => variantAttrs(m.product?.name)[key] || ''
    const vals = new Set(items.map(val))
    if (vals.size < 2) continue
    const groups = [...vals].map(v => ({ split_value: v, items: items.filter(m => val(m) === v) }))
    let ok = true
    for (const g of groups) {
      if (g.items.length < 2) { g.type = null; continue }
      const r = chooseFamilyType(types, chars, g.items)
      if (!r.type) { ok = false; break }
      g.type = r.type; g.selector = selectorOf(types, chars, r.type, g.items)
    }
    if (ok && groups.some(g => g.type)) return { mode: 'podzial', split_key: key, groups: groups.sort((a, b) => a.split_value.localeCompare(b.split_value, 'pl')) }
  }
  return { mode: 'osobno', groups: [], why: whole.why || 'żaden typ rodziny eMAG ani podział nie rozróżnia wariantów – produkty trafią osobno' }
}

// Zmiany w spisie rodzin eMAG dla jednej rodziny z aplikacji: { upserts: [...], removals: [id], conflicts: [...] }
export function registryChanges(family, plan, existing, { channelId, categoryId, baseName }) {
  const upserts = [], conflicts = [], keep = new Set()
  for (const g of plan.groups.filter(x => x.type)) {
    const row = existing.find(r => r.split_value === g.split_value && r.status !== 'nieaktualna') || existing.find(r => r.split_value === g.split_value)
    const product_ids = g.items.map(m => m.product.id).sort()
    const suffix = splitSuffix(plan.split_key, g.split_value)
    const name = suffix ? `${baseName} – ${suffix}` : baseName
    if (row?.first_exported_at && row.type !== g.type) { conflicts.push(`#${row.id}: wysłana z typem „${row.type}”, teraz pasuje „${g.type}” – sprawdź charakterystyki`); keep.add(row.id); continue }
    if (row) keep.add(row.id)
    const next = { ...(row ? { id: row.id } : {}), channel_id: channelId, family_id: family.id, category_id: categoryId, split_key: plan.split_key || '', split_value: g.split_value,
      name: row?.name || name,
      type: g.type, product_ids, selector: g.selector || [], status: row?.first_exported_at ? 'wyslana' : 'zaplanowana' }
    const same = row && row.type === next.type && row.name === next.name && JSON.stringify([...(row.product_ids || [])].sort()) === JSON.stringify(product_ids) && JSON.stringify(row.selector || []) === JSON.stringify(next.selector) && row.status === next.status && (row.split_key || '') === next.split_key
    if (!same) upserts.push(next)
  }
  const removals = existing.filter(r => !keep.has(r.id) && !r.first_exported_at).map(r => r.id)
  const stale = existing.filter(r => !keep.has(r.id) && r.first_exported_at && r.status !== 'nieaktualna').map(r => ({ ...r, status: 'nieaktualna' }))
  return { upserts: [...upserts, ...stale], removals, conflicts }
}
