// Rodziny produktów – logika bez zależności od przeglądarki i bazy (propozycje grupowania, atrybuty wariantu, stan faktów)

// --- atrybuty wariantu odczytywane z nazwy ---
const DIMS_RX = /(\d{2,3}(?:[.,]\d)?)\s*[x×]\s*(\d{2,3}(?:[.,]\d)?)(?:\s*[x×]\s*(\d{1,3}(?:[.,]\d)?))?\s*(?:cm|mm)?/i
const COLORS = [
  ['biały', /\bbia[łl](?:y|ym|a|ą|e|ej|ymi)(?![\p{L}])/iu], ['czarny', /\bczarn(?:y|ym|a|ą|e|ej|ymi)(?![\p{L}])/iu], ['złoty', /\bz[łl]ot(?:y|ym|a|ą|e|ej|ymi)(?![\p{L}])/iu],
  ['chrom', /\bchrom(?:owany|owana|owe)?\b/i], ['grafit', /\bgrafit(?:owy|owa|owe)?\b/i], ['szary', /\bszar(?:y|ym|a|e)\b/i],
  ['beżowy', /\bbe[żz]ow(?:y|ym|a|e)\b/i], ['antracyt', /\bantracyt(?:owy|owa)?\b/i], ['miedziany', /\bmiedzian(?:y|ym|a|e)\b/i],
  ['nikiel', /\bnikiel\b|\bniklowan\w*/i], ['inox', /\binox\b|\bstal(?:owy|owa)? szczotkowan\w*/i], ['mat', /\bmatow(?:y|ym|a|e)\b/i],
]
const SIDES = [['prawa', /\bpraw(?:a|y|e|ostronn\w*)\b|\bP\b$/i], ['lewa', /\blew(?:a|y|e|ostronn\w*)\b|\bL\b$/i]]

// słowa opisujące typ produktu lub ofertę, a nie model – usuwane z klucza rodziny (rozszerzalne)
const FILLERS = new Set(`wanna wanny wannę wannie wolnostojąca wolnostojące wolnostojacy wolnostojąca przyścienna przyscienna narożna narozna
  asymetryczna symetryczna prostokątna prostokatna owalna okrągła okragla akrylowa akrylowe kompozytowa konglomeratowa
  brodzik brodziki umywalka umywalki nablatowa podblatowa wpuszczana wisząca wiszaca stojąca stojaca kabina prysznicowa drzwi ścianka scianka
  bateria baterie umywalkowa wannowa prysznicowa podtynkowa natynkowa zestaw komplet set
  syfon syfonem syfonu syfony maskownica maskownice maskownicą maskownicami korek korkiem korka klik klak click clack automatyczny automatycznym odpływ odpływem
  obudowa obudową obudowy obudowie obudowa nóżki nóżkami nóżkach nogi nogami stelaż stelażem
  z ze w we do na i oraz kolorze kolor wersji wersja cm mm x
  idealna idealny niezwykła niezwykly niezwykła luksusowa luksusowy komfort styl luksus twojej twoja twoim łazience lazience nowoczesna elegancka
  gratis cenie cena`.split(/\s+/).filter(Boolean))

const norm = s => String(s || '').toLowerCase().normalize('NFC')
const fold = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')

// rzeczowniki akcesoriów: kolor stojący po nich dotyczy akcesorium (syfon, korek, nóżki…), a nie samego produktu
const ACCESSORY_RX = /(?<![\p{L}])(syfon\w*|kor(?:ek|kiem|ka)|odp[łl]yw\w*|przelew\w*|maskownic\w*|n[óo][żz]k\w*|n[óo]g(?:ami|i)?|stela[żz]\w*|uchwyt\w*|bateri\w*|klik|click|zaw[óo]r\w*|r[ąa]czk\w*|wylewk\w*|zag[łl][óo]wk\w*|panel\w* sterow\w*|pokr[ęe]t\w*|zatyczk\w*)(?![\p{L}])/iu
const SEP_RX = /,|\+|;|\s(?:z|ze|i|oraz|wraz z|w zestawie z)\s/giu

// kolor produktu i kolor akcesoriów z nazwy, np. „wanna … z białą obudową, syfonem chrom” → produkt: biały, akcesoria: chrom
export function colorParts(name) {
  const n = String(name || '')
  const firstWords = (n.match(/^\s*\S+\s+\S+/) || [''])[0].length   // typ produktu na początku nazwy (np. „Bateria umywalkowa …”) nie jest akcesorium
  let product = null, accessory = null
  for (const [key, re] of COLORS) {
    if (key === 'mat') continue
    const g = new RegExp(re.source, 'giu')
    let m
    while ((m = g.exec(n))) {
      const before = n.slice(0, m.index)
      let segStart = 0
      for (const sm of before.matchAll(SEP_RX)) segStart = sm.index + sm[0].length
      const seg = n.slice(segStart, m.index)
      const acc = [...seg.matchAll(new RegExp(ACCESSORY_RX.source, 'giu'))].some(a => segStart + a.index >= firstWords)
      if (acc) accessory = accessory || key
      else product = product || key
    }
  }
  return { product, accessory }
}

export function variantAttrs(name) {
  const n = String(name || '')
  const d = n.match(DIMS_RX)
  const { product, accessory } = colorParts(n)
  const side = SIDES.find(([, re]) => re.test(n))?.[0] || null
  return { wymiar: d ? `${d[1]}x${d[2]}${d[3] ? 'x' + d[3] : ''}`.replace(/,/g, '.') : null, kolor: product, kolor_akcesoriow: accessory, strona: side }
}

// klucz modelu: nazwa bez marki, wymiarów, kolorów, strony i słów-wypełniaczy (wersje typu SLIM, PLUS, Nova zostają)
export function familyKey(name, brandName) {
  let s = ' ' + norm(name) + ' '
  if (brandName) s = s.split(norm(brandName)).join(' ')
  s = s.replace(new RegExp(DIMS_RX.source, 'gi'), ' ')
  for (const [, re] of [...COLORS, ...SIDES]) s = s.replace(new RegExp(re.source, re.flags.includes('u') ? 'giu' : 'gi'), ' ')
  s = s.replace(/[+\-–—,.;:()/\\"'!?]/g, ' ')
  const words = s.split(/\s+/).filter(w => w && !FILLERS.has(w) && !FILLERS.has(fold(w)) && !/^\d+$/.test(w))
  return words.join(' ').trim()
}

// kategoria do grupowania: dwa pierwsze poziomy ścieżki (głębsze poziomy BL bywają „po rozmiarze”)
const catGroup = path => String(path || '').split('>').map(x => x.trim()).filter(Boolean).slice(0, 2).join(' > ')

const plainLen = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length
const skuStem = sku => String(sku || '').replace(/^#/, '').split(/[-_/ ]/).slice(0, 1).join('-').toUpperCase()

// products: [{ id, sku, name, brand_id, bl_category_id, bl_parent_id, baselinker_product_id, is_bundle, desc_len }]
// → [{ key, name, brand_id, bl_category_id, items: [product + attrs], lead_id, varying, signals }]
export function proposeFamilies(products, { brandName = () => '', catPath = () => '' } = {}) {
  const groups = new Map()
  const byBl = new Map(products.map(p => [p.baselinker_product_id, p]))
  for (const p of products) {
    const attrs = variantAttrs(p.name)
    // warianty w BL (produkt nadrzędny) – jedna rodzina niezależnie od nazwy
    const parent = p.bl_parent_id ? byBl.get(p.bl_parent_id) : null
    let key
    if (p.is_bundle) key = `bundle:${p.id}`
    else if (p.bl_parent_id) key = `bl:${p.bl_parent_id}`
    else if (products.some(x => x.bl_parent_id === p.baselinker_product_id)) key = `bl:${p.baselinker_product_id}`
    else {
      const k = familyKey(p.name, brandName(p.brand_id))
      key = k ? `n:${p.brand_id || '-'}|${catGroup(catPath(p.bl_category_id))}|${k}` : `solo:${p.id}`
    }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ ...p, attrs, _parent: parent })
  }
  const out = []
  for (const [key, items] of groups) {
    items.sort((a, b) => (a.attrs.wymiar || '').localeCompare(b.attrs.wymiar || '', 'pl', { numeric: true }) || (a.attrs.kolor || '').localeCompare(b.attrs.kolor || '', 'pl') || a.sku.localeCompare(b.sku))
    const varying = ['wymiar', 'kolor', 'kolor_akcesoriow', 'strona'].filter(a => new Set(items.map(i => i.attrs[a] || '')).size > 1)
    // wiodący: najdłuższy opis, przy remisie – wariant biały / bez koloru
    const lead = [...items].sort((a, b) => (b.desc_len || 0) - (a.desc_len || 0) || (a.attrs.kolor === 'biały' ? -1 : 0) - (b.attrs.kolor === 'biały' ? -1 : 0))[0]
    const words = key.startsWith('n:') ? key.split('|').pop() : ''
    const label = words ? words.replace(/\b\p{L}/gu, c => c.toUpperCase()) : lead.name
    const stems = new Set(items.map(i => skuStem(i.sku)))
    out.push({
      key, name: label, brand_id: lead.brand_id, bl_category_id: lead.bl_category_id, items, lead_id: lead.id, varying,
      signals: { rule: key.split(':')[0] === 'n' ? 'nazwa' : key.split(':')[0], sku_stems: [...stems], bl_parent: key.startsWith('bl:') },
    })
  }
  return out.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, 'pl'))
}

export const descLen = plainLen

// --- stan faktów rodziny ---
// skrót danych źródłowych wszystkich wariantów (ten sam algorytm co w n8n)
export function familyHash(hashes) {
  const s = [...hashes].map(h => h || '').sort().join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function familyFactState(f, members, counts) {
  if (!f.facts_extracted_at) return { key: 'brak', label: 'nie wyciągnięto' }
  const c = counts.get(f.id) || { do_akceptacji: 0, zatwierdzony: 0, odrzucony: 0 }
  if (f.facts_source_hash && f.facts_source_hash !== familyHash(members.map(m => m.source_hash))) return { key: 'nieaktualne', label: 'dane w BL się zmieniły', c }
  if (c.do_akceptacji) return { key: 'do_akceptacji', label: `${c.do_akceptacji} do akceptacji · ${c.zatwierdzony} ok`, c }
  return { key: 'gotowe', label: `${c.zatwierdzony} zatwierdzonych`, c }
}

