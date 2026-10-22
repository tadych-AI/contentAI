// Szablony importu eMAG (XLSX): odczyt struktury i wypełnianie oryginalnego pliku.
// eMAG rozpoznaje plik po metadanych (docProps/core.xml: categoryId, templateId, exportToken) – dlatego nie tworzymy nowego
// skoroszytu, tylko dopisujemy wiersze do arkusza „Template” w pliku pobranym z eMAG. Reszta pliku zostaje bajt w bajt.
// Moduł nie zależy od przeglądarki (parsowanie XML wyrażeniami) – testowany w Node.
import JSZip from 'jszip'

export const FILE_TYPES = { 89: 'create', 6: 'update', 7: 'family' }
export const FILE_TYPE_LABEL = { create: 'Nowe produkty i oferty (create-product)', update: 'Aktualizacja dokumentacji (update-product)', family: 'Rodziny produktów (update-product-family)' }
export const FIRST_DATA_ROW = 6

const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // znaki sterujące niedozwolone w XML
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

export const colLetter = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
export const colIndex = letters => [...letters].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1

async function sheetPaths(zip) {
  const wb = await zip.file('xl/workbook.xml').async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
  const relMap = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [/Id="([^"]+)"/.exec(m[0])[1], /Target="([^"]+)"/.exec(m[0])[1]]))
  const out = {}
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(/name="([^"]*)"/.exec(m[0])[1]), rid = /r:id="([^"]+)"/.exec(m[0])[1]
    let t = relMap[rid] || ''
    t = t.startsWith('/') ? t.slice(1) : 'xl/' + t
    out[name.trim()] = t
  }
  return out
}

async function sharedStrings(zip) {
  const f = zip.file('xl/sharedStrings.xml')
  if (!f) return []
  const x = await f.async('string')
  return [...x.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => unesc(t[1])).join(''))
}

// Arkusz → macierz wartości (wiersze od 1, kolumny od 0)
function readSheet(xml, ss, maxRow = Infinity) {
  const rows = {}
  for (const rm of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(rm[1]); if (r > maxRow) break
    const cells = []
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || ''
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1]; if (!ref) continue
      const t = /t="([^"]+)"/.exec(attrs)?.[1]
      let v = null
      if (t === 's') { const i = /<v>([^<]*)<\/v>/.exec(body)?.[1]; v = i != null ? ss[Number(i)] : null }
      else if (t === 'inlineStr') v = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => unesc(x[1])).join('')
      else { const raw = /<v>([^<]*)<\/v>/.exec(body)?.[1]; v = raw != null ? unesc(raw) : null }
      cells[colIndex(ref)] = v
    }
    rows[r] = cells
  }
  return rows
}

const reqOf = s => {
  const t = String(s || '').toLowerCase()
  const restrictive = /rögzített|restrykcyjn|restrictive|restricted/.test(t)
  const level = /kötelező|obowiązkow|mandatory/.test(t) ? 'mandatory' : /ajánlott|zalecan|recommended/.test(t) ? 'recommended' : /legal|prawn/.test(t) ? 'legal' : 'optional'
  return { level, restrictive }
}

// Odczyt szablonu: typ pliku, kategoria, kolumny, charakterystyki z listami wartości, typy rodzin, języki
export async function parseTemplate(buf) {
  const zip = await JSZip.loadAsync(buf)
  const core = await zip.file('docProps/core.xml')?.async('string') || ''
  const kwRaw = /<(?:cp:)?keywords>([\s\S]*?)<\/(?:cp:)?keywords>/.exec(core)?.[1]
  let meta = {}
  try { meta = JSON.parse(unesc(kwRaw || '{}')) } catch { meta = {} }
  if (!meta.categoryId || !meta.templateId) throw new Error('To nie jest szablon importu eMAG (brak identyfikatora kategorii w metadanych pliku). Pobierz plik z eMAG Marketplace → Kategorie.')
  const paths = await sheetPaths(zip)
  const ss = await sharedStrings(zip)
  if (!paths.Template) throw new Error('W pliku brakuje arkusza „Template”.')
  const tpl = readSheet(await zip.file(paths.Template).async('string'), ss, 5)
  const keys = (tpl[3] || []).map(v => v == null ? '' : String(v).trim())
  const reqs = tpl[4] || [], labels = tpl[5] || []
  const columns = keys.map((key, i) => key ? { key, col: colLetter(i), index: i, label: labels[i] ? String(labels[i]).trim() : key, ...reqOf(reqs[i]) } : null).filter(Boolean)
  // charakterystyki: nagłówek „Nazwa: [ID]”
  const charCols = columns.filter(c => /:\s*\[\d+\]\s*$/.test(c.key))
  const values = {}, charReq = {}   // wymagania charakterystyk z arkusza wartości (wiersz wymagań w „Template” bywa przesunięty)
  const valSheet = Object.keys(paths).find(n => /warto|valori|values|értékek/i.test(n) && n !== 'Template')
  if (valSheet) {
    const vs = readSheet(await zip.file(paths[valSheet]).async('string'), ss)
    const head = vs[3] || [], hreq = vs[4] || []
    head.forEach((h, i) => { if (h) charReq[String(h).trim()] = reqOf(hreq[i]) })
    const rowNums = Object.keys(vs).map(Number).filter(r => r >= 6).sort((x, y) => x - y)
    head.forEach((h, i) => {
      if (!h) return
      const list = new Set()
      for (const r of rowNums) { const v = vs[r]?.[i]; if (v != null && String(v).trim() !== '') list.add(String(v).trim()) }
      values[String(h).trim()] = [...list]
    })
  }
  const characteristics = charCols.map(c => {
    const m = /^(.*?):?\s*:\s*\[(\d+)\]\s*$/.exec(c.key) || /^(.*?)\s*\[(\d+)\]\s*$/.exec(c.key)
    const rq = charReq[c.key] || c
    return { key: c.key, id: Number(m?.[2]), name: (m?.[1] || c.label).replace(/:\s*$/, '').trim(), level: rq.level, restrictive: rq.restrictive, values: values[c.key] || [] }
  })
  let familyTypes = [], languages = []
  if (paths['Data validations']) {
    const dv = readSheet(await zip.file(paths['Data validations']).async('string'), ss)
    for (const r of Object.keys(dv).map(Number).sort((a, b) => a - b)) {
      if (r < 6) continue
      const label = dv[r][1], lang = dv[r][2]
      if (label) {
        const id = Number(/\[(\d+)\]\s*$/.exec(label)?.[1])
        const attrs = String(label).replace(/\s*\[\d+\]\s*$/, '').split(/\s+-\s+/).map(x => ({ name: x.replace(/\s*\((visible|hidden)\)\s*$/i, '').trim(), visible: /\(visible\)/i.test(x) }))
        familyTypes.push({ id, label: String(label).trim(), attributes: attrs })
      }
      if (lang) languages.push(String(lang).trim())
    }
  }
  const categoryName = String((tpl[1] || []).find(v => v && /charakter|caracter|jellemz|characteristics/i.test(String(v))) || '').replace(/^.*?-\s*/, '').trim()
  return {
    file_type: FILE_TYPES[meta.type] || `typ ${meta.type}`, emag_type: meta.type, category_id: meta.categoryId, template_id: meta.templateId, has_families: !!meta.has_families,
    category_name: categoryName, columns, characteristics, family_types: familyTypes, languages,
  }
}

// Wypełnienie oryginalnego szablonu: rows = [{ kolumna(key): wartość }] → nowy plik (Uint8Array)
export async function fillTemplate(buf, rows, { numeric = [] } = {}) {
  const zip = await JSZip.loadAsync(buf)
  const paths = await sheetPaths(zip)
  const ss = await sharedStrings(zip)
  const path = paths.Template
  let xml = await zip.file(path).async('string')
  const head = readSheet(xml, ss, 3)[3] || []
  const colOf = Object.fromEntries(head.map((k, i) => k ? [String(k).trim(), i] : null).filter(Boolean))
  // style komórek z pierwszego pustego wiersza danych (np. format tekstowy dla kodów i EAN)
  const tplRow = /<row\b[^>]*\br="6"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/.exec(xml)
  const styles = {}
  for (const cm of (tplRow?.[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const ref = /r="([A-Z]+)\d+"/.exec(cm[1])?.[1], s = /s="(\d+)"/.exec(cm[1])?.[1]
    if (ref && s) styles[colIndex(ref)] = s
  }
  const num = new Set(numeric)
  const rowXml = rows.map((row, i) => {
    const r = FIRST_DATA_ROW + i
    const cells = Object.entries(row).map(([k, v]) => [colOf[k], k, v]).filter(([c, , v]) => c !== undefined && v !== null && v !== undefined && String(v) !== '')
      .sort((a, b) => a[0] - b[0]).map(([c, k, v]) => {
        const ref = `${colLetter(c)}${r}`, s = styles[c] ? ` s="${styles[c]}"` : ''
        if (num.has(k) && /^-?\d+(\.\d+)?$/.test(String(v))) return `<c r="${ref}"${s}><v>${v}</v></c>`
        return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
      })
    return `<row r="${r}">${cells.join('')}</row>`
  }).join('')
  // usuń istniejące wiersze danych (od 6.) i dopisz nowe
  xml = xml.replace(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, (m, r) => Number(r) >= FIRST_DATA_ROW ? '' : m)
  xml = xml.replace('</sheetData>', rowXml + '</sheetData>')
  const last = FIRST_DATA_ROW + rows.length - 1
  xml = xml.replace(/<dimension ref="[^"]*"\s*\/?>(<\/dimension>)?/, `<dimension ref="A1:${colLetter(Math.max(0, head.length - 1))}${Math.max(5, last)}"></dimension>`)
  zip.file(path, xml)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// Odczyt wierszy danych z pliku (np. pliku błędów odesłanego przez eMAG): [{ kolumna: wartość }]
export async function readRows(buf, sheet = 'Template') {
  const zip = await JSZip.loadAsync(buf)
  const paths = await sheetPaths(zip)
  const ss = await sharedStrings(zip)
  const name = paths[sheet] ? sheet : 'Template'
  const all = readSheet(await zip.file(paths[name]).async('string'), ss)
  const head = (all[3] || []).map(v => v == null ? '' : String(v).trim())
  return Object.keys(all).map(Number).filter(r => r >= FIRST_DATA_ROW).sort((a, b) => a - b)
    .map(r => Object.fromEntries(head.map((k, i) => [k, all[r][i]]).filter(([k, v]) => k && v != null && v !== '')))
    .filter(o => Object.keys(o).length)
}
