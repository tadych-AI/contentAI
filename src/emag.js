// eMAG: charakterystyki z danych Baselinkera (dopasowane do słowników z szablonu), gwarancja, typ rodziny, wiersze pliku importu.
// Bez zależności od przeglądarki i bazy – testowane w Node.
import { variantAttrs } from './familiesCore.js'

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
const COLOR_WORDS = [['biały', /bia[łl]/], ['czarny', /czarn/], ['złoty', /z[łl]ot/], ['chrom', /chrom/], ['grafit', /grafit/], ['antracyt', /antracyt/], ['szary', /szar/],
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

// Kolor samego produktu: z nazwy (bez koloru akcesoriów – syfonu, korka, nóżek, maskownic), potem z parametru „Kolor” → słownik eMAG
const METALLIC = new Set(['chrom', 'złoty', 'miedziany', 'nikiel', 'inox', 'srebrny'])
// produkty z akrylu/konglomeratu/ceramiki, które nie bywają metaliczne (metaliczny kolor dotyczy wtedy akcesoriów)
const NON_METAL_PRODUCT = /wann|brodzik|umywal|misk|kompakt|bidet|zlew|zlewozmyw|pisuar/
const METAL_PRODUCT = /bateri|syfon|odplyw|korek|uchwyt|kabin|drzwi|parawan|scian|grzejnik|deszczown|zestaw prysznic|sluchawk|wylewk|akcesori|polk|wieszak|dozownik|lustr|stelaz|przycisk/
export function colorOf(product, { categoryPath = '' } = {}) {
  const parts = variantAttrs(product.name)
  const param = featureOf(product.features, /^kolor|^barwa/)
  const raw = parts.kolor || param
  if (!raw) return parts.kolor_akcesoriow ? { pl: null, hu: null, note: `kolor „${parts.kolor_akcesoriow}” w nazwie dotyczy akcesoriów – Szín do uzupełnienia` } : null
  const key = COLOR_WORDS.find(([, re]) => re.test(fold(raw)))?.[0]
  const ctx = fold(`${product.name} ${categoryPath}`)
  if (key && METALLIC.has(key) && NON_METAL_PRODUCT.test(ctx) && !METAL_PRODUCT.test(fold(categoryPath))) {
    return { pl: raw, hu: null, note: `kolor „${raw}” (${parts.kolor ? 'z nazwy' : 'parametr BL'}) jest metaliczny, a produkt to wanna/umywalka/brodzik – to raczej kolor akcesoriów; Szín do uzupełnienia` }
  }
  const mat = /mat/.test(fold(raw)) || /\bmat\b/.test(fold(product.name))
  return { pl: raw, hu: key ? (mat && key === 'czarny' ? 'Matt fekete' : mat && key === 'biały' ? 'Matt fehér' : COLOR_HU[key]) : null }
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
  if (color) { if (color.note) notes.push(`Szín: ${color.note}`); else if (color.hu) put('Szín', color.hu, `kolor z BL: ${color.pl}`); else notes.push(`Szín: kolor „${color.pl}” bez odpowiednika w słowniku`) }
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

// Wiersz pliku importu dla produktu. ctx: { product, description, brand, values, family, template, defaults }
export function buildRow(fileType, { product, description, brand, values, family, template, defaults = {} }) {
  const imgs = [...(product.images || [])].sort((a, b) => a.position - b.position).map(i => i.url)
  const lang = (template.languages || []).find(l => /hu_HU/i.test(l)) || (template.languages || [])[0] || 'Magyar (hu_HU)'
  const w = warrantyMonths(product)
  const row = {
    part_number: String(product.sku || '').replace(/^#/, ''), vendor_ext_id: product.baselinker_product_id, ean: product.ean || '',
    name: description?.fields?.TITLE || '', brand: brand || '', description: description?.html || '', source_language: lang,
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
  if (!row.name) p.push('brak zaakceptowanego opisu (tytuł)')
  if (!row.description) p.push('brak zaakceptowanego opisu (HTML)')
  if (String(row.description || '').length > 32000) p.push('opis HTML dłuższy niż 32 000 znaków (limit komórki Excela)')
  if (!row.brand) p.push('brak marki')
  if (fileType !== 'family' && !row.main_image_url) p.push('brak zdjęcia głównego')
  if (row.ean && !/^\d{8}$|^\d{12,14}$/.test(String(row.ean))) p.push(`niepoprawny EAN „${row.ean}”`)
  const { missing } = characteristicIssues(chars, Object.fromEntries(chars.map(c => [c.key, row[c.key] ? { value: row[c.key] } : null])))
  if (missing.length) p.push(`brak obowiązkowych charakterystyk: ${missing.join(', ')}`)
  return p
}
