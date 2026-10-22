// Tytuły eMAG: elementy tytułu (od AI, po węgiersku) składane w kolejności wzoru kategorii. Bez zależności od przeglądarki – testowane w Node.
import { variantAttrs, colorParam } from './familiesCore.js'

// elementy, z których można zbudować wzór (klucz → etykieta i opis dla AI)
export const TOKENS = {
  typ: { label: 'Typ produktu', ai: 'krótka, rzeczowa nazwa typu produktu po węgiersku, z wielkiej litery (np. „Szabadon álló kád”, „Aszimmetrikus kád”, „Mosdócsaptelep”); jeśli pasuje, fraza główna SEO' },
  marka: { label: 'Marka (producent)', ai: 'marka producenta dokładnie jak w danych (np. „Besco”)' },
  model: { label: 'Model / seria', ai: 'nazwa modelu lub serii dokładnie jak w danych, bez marki, wymiarów i koloru (np. „Navia”, „Vitae Slim Plus”)' },
  wymiary: { label: 'Wymiary', ai: 'wymiary wariantu w formacie „160x80 cm”' },
  kolor: { label: 'Kolor', ai: 'kolor SAMEGO produktu po węgiersku małą literą (np. „fehér”, „matt fekete”) – nigdy kolor akcesoriów' },
  material: { label: 'Materiał', ai: 'materiał głównego produktu po węgiersku małą literą (np. „akril”, „öntött márvány”)' },
  ksztalt: { label: 'Kształt', ai: 'kształt po węgiersku małą literą (np. „ovális”, „téglalap alakú”), tylko gdy nie wynika już z typu' },
  strona: { label: 'Strona (L/P)', ai: 'wersja strony po węgiersku („bal oldali” / „jobb oldali”), tylko gdy produkt ją ma' },
  montaz: { label: 'Montaż', ai: 'sposób montażu po węgiersku (np. „falra szerelhető”, „pultra ültethető”), tylko gdy wyróżnia produkt' },
  pojemnosc: { label: 'Pojemność', ai: 'pojemność w formacie „190 l”' },
  cecha: { label: 'Cecha wyróżniająca', ai: 'jedna najważniejsza cecha z faktów, 1–4 słowa po węgiersku, bez przymiotników reklamowych; pusta, jeśli nic nie wyróżnia' },
  zestaw: { label: 'Zawartość zestawu', ai: 'tylko dla zestawów: co jest w zestawie oprócz głównego produktu i gratisów, krótko po węgiersku (np. „szifonnal és lábakkal”)' },
  gratis: { label: 'Gratis', ai: 'tylko gdy zestaw zawiera gratis: krótko po węgiersku ze słowem „ajándék” (np. „ajándék törölközővel”)' },
}
export const SEPARATORS = { '': '(na początku)', ' ': 'spacja', ', ': 'przecinek', ' – ': 'półpauza', ' + ': 'plus', ' | ': 'kreska' }
export const DEFAULT_TOKENS = [
  { key: 'typ', sep: '', required: true }, { key: 'marka', sep: ' ', required: true }, { key: 'model', sep: ' ', required: true },
  { key: 'wymiary', sep: ', ', required: false }, { key: 'kolor', sep: ', ', required: false }, { key: 'material', sep: ', ', required: false },
  { key: 'strona', sep: ', ', required: false }, { key: 'zestaw', sep: ' + ', required: false }, { key: 'gratis', sep: ' + ', required: false },
]

const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const clean = s => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/^[\s,;+–|-]+|[\s,;+–|-]+$/g, '').trim()

// Element wzoru: wbudowany (TOKENS) albo własny ({ custom: true, label, ai }); każdy może mieć stałą wartość (value), np. marka „Aqua 4 You”
export const tokenLabel = t => t?.custom ? (t.label || 'Własny element') : (TOKENS[t?.key]?.label || t?.key)
export const tokenAi = t => t?.custom ? (t.ai || t.label || '') : (TOKENS[t?.key]?.ai || '')
export const validTokens = pattern => (pattern?.tokens || DEFAULT_TOKENS).filter(t => t && (TOKENS[t.key] || t.custom) && t.enabled !== false)
// elementy, które ustala AI (bez stałej wartości)
export const aiTokens = pattern => validTokens(pattern).filter(t => !clean(t.value))
export const newCustomKey = tokens => { let i = 1; while ((tokens || []).some(t => t.key === `wlasny_${i}`)) i++; return `wlasny_${i}` }

// wartość elementu: ręcznie poprawiona w produkcie > stała wartość wzoru > wartość od AI
const valueOf = (t, parts, lang) => {
  const src = lang === 'pl' ? (parts?._pl || {}) : (parts || {})
  if ((parts?._edited || []).includes(t.key)) return clean(src[t.key] ?? (lang === 'pl' ? parts?.[t.key] : ''))
  return clean(t.value) || clean(src[t.key])
}

// Składa tytuł z elementów w kolejności wzoru; elementy puste pomija, powtórzenia usuwa.
// Za długi tytuł skraca, usuwając elementy nieobowiązkowe od końca wzoru. lang 'pl' = tłumaczenie kontrolne z parts._pl
export function assembleTitle(pattern, parts, lang = 'hu') {
  const tokens = validTokens(pattern)
  const maxLen = Number(pattern?.max_len) || 150
  const build = list => {
    let out = ''
    for (const t of list) {
      const v = valueOf(t, parts, lang)
      if (!v) continue
      if (out && fold(out).includes(fold(v))) continue          // np. marka już w typie lub modelu
      out += out ? (t.sep || ' ') + v : v.charAt(0).toUpperCase() + v.slice(1)
    }
    return out.replace(/\s+/g, ' ').trim()
  }
  let used = tokens.slice(), title = build(used)
  const dropped = []
  while (title.length > maxLen) {
    const i = used.map(t => !t.required && !!valueOf(t, parts, lang)).lastIndexOf(true)
    if (i < 0) break
    dropped.push(used[i].key); used = used.filter((_, j) => j !== i); title = build(used)
  }
  const missing = tokens.filter(t => t.required && !valueOf(t, parts, lang)).map(t => t.key)
  return { title, dropped, missing, over: title.length > maxLen, length: title.length }
}

// Wzór dla kategorii produktu: najbliższy w górę drzewa kategorii BL, potem domyślny kanału
export function patternFor(patterns, categoryId, catById) {
  let cur = categoryId ? catById.get(categoryId) : null, guard = 0
  while (cur && guard++ < 20) {
    const hit = patterns.find(p => p.bl_category_id === cur.bl_category_id)
    if (hit) return hit
    cur = cur.parent_id ? catById.get(cur.parent_id) : null
  }
  return patterns.find(p => !p.bl_category_id) || null
}

const SIDE_HU = { lewa: 'bal oldali', prawa: 'jobb oldali' }
// Elementy pewne z danych BL (AI ich nie zmienia, tylko tłumaczy kolor/materiał): wymiary, strona, marka, kolor z parametru
export function presetParts(product, { brand = '' } = {}) {
  const a = variantAttrs(product?.name)
  const out = {}
  if (a.wymiar) out.wymiary = `${a.wymiar} cm`
  if (a.strona) out.strona = SIDE_HU[a.strona]
  if (brand) out.marka = brand
  const kolor = colorParam(product?.features)
  return { parts: out, hints: { kolor_pl: kolor || a.kolor || null, kolor_akcesoriow_pl: a.kolor_akcesoriow || null } }
}
