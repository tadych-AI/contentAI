// Renderer opisu HTML sterowany szablonem (kolejność sekcji, obrazki, style) – przeniesiony z aplikacji AI Opisy (Schedpol).
// Blok RENDER START…END jest kopiowany 1:1 do n8n (węzły „GEN: QA i HTML” i „VAR: QA i HTML”) – zmieniaj w obu miejscach.
export const DEFAULT_STYLES = { max_width: 920, font_size: 15, line_height: 1.6, text_color: '#333333', heading_color: '#0D1B3E', accent_color: '#1E4D9B', h1_size: 26, h2_size: 22, hero_tag: 'h1' }

// === RENDER START === (blok kopiowany 1:1 do n8n – węzły „GEN: QA i HTML” i „VAR: QA i HTML”)
// Formaty wyjściowe: standard (bogaty HTML eMAG), custom (własny szkielet HTML z polami {{…}}); oba przechodzą przez filtr dozwolonych znaczników.
function rdOut(template) { return { mode: 'standard', html: '', allowed_tags: '', keep_styles: true, images: true, max_chars: 0, ...((template && template.styles && template.styles.output) || {}) } }

// Mini-silnik szablonów: {{pole}} (z escapowaniem), {{{pole}}} (bez), {{#lista}}…{{/lista}} (pętla / warunek), {{^pole}}…{{/pole}} (gdy puste), {{.}} (bieżący element)
function rdMustache(tpl, ctx) {
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const look = (stack, name) => { if (name === '.') return stack[stack.length - 1]; for (let i = stack.length - 1; i >= 0; i--) { const o = stack[i]; if (o && typeof o === 'object' && name in o) return o[name] } return '' }
  const render = (t, stack) => {
    let out = '', i = 0
    while (i < t.length) {
      const open = t.indexOf('{{', i)
      if (open < 0) { out += t.slice(i); break }
      out += t.slice(i, open)
      if (t.startsWith('{{{', open)) { const close = t.indexOf('}}}', open); const name = t.slice(open + 3, close).trim(); out += String(look(stack, name) ?? ''); i = close + 3; continue }
      const close = t.indexOf('}}', open); const tag = t.slice(open + 2, close).trim(); i = close + 2
      if (tag[0] === '#' || tag[0] === '^') {
        const name = tag.slice(1).trim(); let depth = 1, j = i, end = -1
        const re = /\{\{\s*([#^/])\s*([^}]+?)\s*\}\}/g; re.lastIndex = i; let m
        while ((m = re.exec(t))) { if (m[2] !== name) continue; if (m[1] === '/') { depth--; if (!depth) { end = m.index; j = re.lastIndex; break } } else depth++ }
        if (end < 0) { i = t.length; break }
        const inner = t.slice(i, end), val = look(stack, name)
        const empty = !val || (Array.isArray(val) && !val.length)
        if (tag[0] === '^') { if (empty) out += render(inner, stack) }
        else if (Array.isArray(val)) val.forEach(v => { out += render(inner, [...stack, v]) })
        else if (!empty) out += render(inner, [...stack, val])
        i = j
      } else if (tag[0] !== '/' && tag[0] !== '!') out += esc(look(stack, tag))
    }
    return out
  }
  return render(String(tpl || ''), [ctx])
}

// Filtr: zostają tylko dozwolone znaczniki (treść usuniętych zostaje), bez skryptów; atrybuty tylko src/alt/href (+ style, jeśli dozwolone)
function rdSanitize(html, out) {
  const allowed = String(out.allowed_tags || '').toLowerCase().split(/[\s,;]+/).filter(Boolean)
  let h = String(html).replace(/<(script|style|iframe)[^>]*>[\s\S]*?<\/\1>/gi, '')
  if (out.keep_styles === false) h = h.replace(/\s+style="[^"]*"/gi, '')
  if (out.images === false) h = h.replace(/<img\b[^>]*>/gi, '')
  if (allowed.length) {
    h = h.replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (m, tag, attrs) => {
      const t = tag.toLowerCase(); if (!allowed.includes(t)) return ''
      if (m.startsWith('</')) return `</${t}>`
      const keep = (attrs.match(/\s(src|alt|href|style)="[^"]*"/gi) || []).filter(a => !/^\s*style=/i.test(a) || out.keep_styles !== false).join('')
      return `<${t}${keep}${/\/\s*>$/.test(m) ? ' /' : ''}>`
    })
    h = h.replace(/<(p|li|ul|ol|h[1-6]|div|strong|b)>\s*<\/\1>/gi, '')
  }
  return h.replace(/\n{3,}/g, '\n\n').trim()
}

// Dane dla własnego szkieletu: wszystkie pola (np. {{S1_H2}}) + listy {{#sekcje}} i {{#faq}}
function rdContext(fields, template, images) {
  const g = k => String(fields?.[k] ?? '').trim()
  const ctx = { ...fields, TYTUL: g('HERO_H1'), LEAD: g('HERO_LEAD'), HERO_IMG: '', sekcje: [], faq: [], FAQ_H2: g('FAQ_H2') }
  for (const sec of (template?.sections || []).filter(s => s && s.enabled !== false)) {
    const k = sec.key, src = images ? (images[k] || '') : (['static', 'library'].includes(sec.image_source || 'static') ? (sec.image_url || '') : '')
    if (sec.type === 'hero') ctx.HERO_IMG = src
    if (sec.type === 'content') {
      const li = sec.list === false ? [] : [1, 2, 3, 4, 5].map(b => g(`${k}_LI${b}`)).filter(Boolean)
      const s = { KLUCZ: k, H2: g(`${k}_H2`), P: g(`${k}_P`), P_BOLD: sec.bold === false ? '' : g(`${k}_P_BOLD`), AKCENT: sec.accent ? g(`${k}_AKCENT`) : '', LI: li, IMG: src, IMG_ALT: g(`${k}_IMG_ALT`) }
      s.MA_LI = s.LI.length > 0
      if (s.H2 || s.P || s.P_BOLD || s.LI.length || s.AKCENT) { ctx.sekcje.push(s); ctx[`${k}_IMG`] = src }
    }
    if (sec.type === 'features') ctx.atuty = [1, 2, 3, 4, 5, 6].map(i => g(`FEAT${i}`)).filter(Boolean)
    if (sec.type === 'why') ctx.dlaczego = [1, 2, 3, 4, 5].map(i => g(`WHY_LI${i}`)).filter(Boolean)
    if (sec.type === 'specs') ctx.specyfikacja = Array.from({ length: 12 }, (_, i) => g(`SPEC${i + 1}`)).filter(Boolean)
    if (sec.type === 'gallery') ctx.galeria = rdGallery(sec, images)
    if (sec.type === 'banner') ctx[`${k}_IMG`] = images ? (images[k] || '') : (sec.image_url || '')
    if (sec.type === 'faq') ctx.faq = [1, 2, 3, 4, 5, 6].slice(0, sec.max_questions || 6).map(i => ({ NR: i, Q: g(`FAQ_Q${i}`), A: g(`FAQ_A${i}`) })).filter(x => x.Q && x.A)
  }
  ctx.MA_FAQ = ctx.faq.length > 0
  return ctx
}

// Bloki dodatkowe (oba układy): atuty ✓, „dlaczego warto”, podsumowanie, specyfikacja, galeria zdjęć
function rdSplit(text, seps) { for (const sp of seps) { const i = text.indexOf(sp); if (i > 0 && i < 80) return [text.slice(0, i).trim(), text.slice(i + sp.length).trim()] } return ['', text] }
function rdGallery(sec, images) { const out = []; for (let i = 1; i <= 12; i++) { const u = images ? images[`${sec.key}_${i}`] : ''; if (u) out.push(u) } return out }
function rdExtraBlock(sec, g, images, st, esc, attr, showcase) {
  const box = showcase ? 'background: #f5f5f5; padding: 18px 20px; margin: 18px 0' : 'margin: 24px 0'
  const head = (t, size) => t ? `<h2 style="margin: 0 0 12px 0; font-size: ${size || st.h2_size}px; font-weight: 700; color: ${st.heading_color}; text-align: center">${esc(t)}</h2>` : ''
  if (sec.type === 'features') {
    const f = [1, 2, 3, 4, 5, 6].map(i => g(`FEAT${i}`)).filter(Boolean)
    if (!f.length) return ''
    let h = ''
    for (let r = 0; r < f.length; r += 3) {
      const row = f.slice(r, r + 3)
      h += `<div style="background: #f5f5f5; padding: 14px; margin: ${r ? 10 : 18}px 0 ${r + 3 >= f.length ? 18 : 0}px 0"><table cellpadding="0" cellspacing="0" style="border-collapse: collapse; text-align: center; width: 100%"><tbody><tr>` +
        row.map(x => `<td style="width: ${(100 / row.length).toFixed(2)}%; padding: 8px; vertical-align: middle"><strong style="color: ${st.accent_color}">✓</strong> ${esc(x)}</td>`).join('') + '</tr></tbody></table></div>'
    }
    return h
  }
  if (sec.type === 'why') {
    const li = [1, 2, 3, 4, 5].map(i => g(`WHY_LI${i}`)).filter(Boolean)
    if (!li.length) return ''
    return `<div style="${box}">${head(g('WHY_H2'))}<ul style="margin: 0 auto; max-width: 980px; padding-left: 18px; text-align: left">` +
      li.map(x => { const [a, b] = rdSplit(x, [' – ', ' - ', ': ']); return `<li style="margin: 0 0 4px 0">${a ? `<strong>${esc(a)}</strong> – ` : ''}${esc(b)}</li>` }).join('') + '</ul></div>'
  }
  if (sec.type === 'closing') {
    if (!g('CLOSING_H2') && !g('CLOSING_P')) return ''
    return `<div style="padding: 18px 20px; margin: 24px 0; text-align: center">${head(g('CLOSING_H2'))}<p style="margin: 0 auto; max-width: 980px">${esc(g('CLOSING_P'))}</p></div>`
  }
  if (sec.type === 'specs') {
    const sp = Array.from({ length: 12 }, (_, i) => g(`SPEC${i + 1}`)).filter(Boolean)
    if (!sp.length) return ''
    return `<hr style="border: none; height: 1px; background: #e5e7eb; margin: 8px 0 16px 0">${head(g('SPECS_H2'))}<div style="background: #f8fafc; border: 1px solid #e5e7eb; padding: 16px 18px; margin: 0 0 18px 0"><ul style="margin: 0; padding-left: 18px; text-align: left">` +
      sp.map(x => { const [a, b] = rdSplit(x, [': ']); return `<li>${a ? `${esc(a)}: <strong>${esc(b)}</strong>` : esc(b)}</li>` }).join('') + '</ul></div>'
  }
  if (sec.type === 'banner') {
    const src = images ? (images[sec.key] || '') : (['static', 'library'].includes(sec.image_source || 'static') ? (sec.image_url || '') : '')
    if (!src) return ''
    return `<p style="margin: ${showcase ? '18px 0' : '24px 0'}; text-align: center"><img alt="${attr(sec.alt || g('HERO_H1'))}" src="${attr(src)}" style="width: 100%; max-width: 100%; height: auto"></p>`
  }
  if (sec.type === 'gallery') {
    const im = rdGallery(sec, images)
    if (!im.length) return ''
    return `<div style="${showcase ? 'background: #f5f5f5; padding: 20px; margin: 18px 0; ' : 'margin: 24px 0; '}text-align: center">` + im.map((u, i) => `<p style="margin: 0 0 ${i === im.length - 1 ? 0 : 12}px 0"><img alt="${attr(g('HERO_H1'))}" src="${attr(u)}" style="max-width: 100%; height: auto"></p>`).join('') + '</div>'
  }
  return ''
}

// Układ „wizytówka”: baner, tytuł między liniami, atuty w kafelkach, „dlaczego warto”, sekcje naprzemiennie zdjęcie | tekst, podsumowanie, specyfikacja, FAQ, galeria
function rdShowcase(fields, template, images, st) {
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const attr = s => esc(s).replace(/"/g, '&quot;')
  const g = k => String(fields?.[k] ?? '').trim()
  const srcOf = sec => images ? (images[sec.key] || '') : (['static', 'library'].includes(sec.image_source || 'static') ? (sec.image_url || '') : '')
  const img = (src, alt) => src ? `<img alt="${attr(alt)}" src="${attr(src)}" style="max-width: 100%; height: auto">` : ''
  const line = m => `<hr style="border: none; height: 1px; background: #e5e7eb; margin: ${m}">`
  const ht = st.hero_tag === 'h2' ? 'h2' : 'h1'
  let h = `<div style="max-width: ${Math.max(st.max_width, 1100)}px; margin: 0 auto; padding: 20px 0; font-family: Arial, Helvetica, sans-serif; color: ${st.text_color}; font-size: ${st.font_size}px; line-height: ${st.line_height}; background: #fff; text-align: center">`
  let n = 0
  for (const sec of (template?.sections || []).filter(s => s && s.enabled !== false)) {
    const k = sec.key
    if (sec.type === 'hero') {
      const src = srcOf(sec)
      if (src) h += `<p style="margin: 0 0 16px 0">${img(src, g('HERO_IMG_ALT'))}</p>`
      h += line('10px 0 20px 0') + `<${ht} style="margin: 0 0 12px 0; font-size: ${st.h1_size}px; font-weight: 700; color: ${st.heading_color}">${esc(g('HERO_H1'))}</${ht}>` + line('12px 0 20px 0')
      if (g('HERO_LEAD')) h += `<p style="margin: 0 auto 20px auto; max-width: 980px">${esc(g('HERO_LEAD'))}</p>`
    } else if (sec.type === 'content') {
      const lis = sec.list === false ? [] : [1, 2, 3, 4, 5].map(b => g(`${k}_LI${b}`)).filter(Boolean)
      const H2 = g(`${k}_H2`), P = g(`${k}_P`), PB = sec.bold === false ? '' : g(`${k}_P_BOLD`), AK = sec.accent ? g(`${k}_AKCENT`) : ''
      if (!H2 && !P && !PB && !lis.length && !AK) continue
      let text = (H2 ? `<h3 style="margin: 0 0 10px 0; font-size: ${Math.max(st.h2_size - 2, 16)}px; color: ${st.heading_color}"><strong>${esc(H2)}</strong></h3>` : '')
      if (P || PB) text += `<p style="margin: 0 0 ${lis.length || AK ? 10 : 0}px 0">${esc(P)}${PB ? ' <strong>' + esc(PB) + '</strong>' : ''}</p>`
      if (lis.length) text += '<ul style="margin: 0 0 ' + (AK ? 10 : 0) + 'px 0; padding-left: 18px; text-align: left">' + lis.map(l => `<li>${esc(l)}</li>`).join('') + '</ul>'
      if (AK) text += `<p style="margin: 0; color: ${st.accent_color}"><strong>${esc(AK)}</strong></p>`
      const src = srcOf(sec)
      if (!src) { h += `<div style="background: #f5f5f5; padding: 20px; margin: 18px 0">${text}</div>`; continue }
      const pic = `<td style="width: 50%; text-align: center; padding: 10px; vertical-align: middle">${img(src, g(`${k}_IMG_ALT`))}</td>`
      const txt = `<td style="width: 50%; text-align: center; padding: 10px; vertical-align: middle">${text}</td>`
      h += `<div style="background: #f5f5f5; padding: 20px; margin: 18px 0"><table cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%"><tbody><tr>${n % 2 === 0 ? pic + txt : txt + pic}</tr></tbody></table></div>`
      n++
    } else if (sec.type === 'faq') {
      const qs = [1, 2, 3, 4, 5, 6].slice(0, sec.max_questions || 6).map(i => ({ q: g(`FAQ_Q${i}`), a: g(`FAQ_A${i}`) })).filter(x => x.q && x.a)
      if (!qs.length) continue
      h += line('8px 0 16px 0') + `<h2 style="margin: 0 0 12px 0; font-size: ${st.h2_size}px; color: ${st.heading_color}"><strong>${esc(g('FAQ_H2'))}</strong></h2>` + line('0 0 16px 0')
      h += '<div style="background: #f8fafc; border: 1px solid #e5e7eb; padding: 16px 18px; margin: 0 0 18px 0"><ul style="margin: 0; padding-left: 18px; text-align: left">' +
        qs.map((x, i) => `<li style="margin: ${i ? 10 : 0}px 0 0 0"><strong>${esc(x.q)}</strong><br>${esc(x.a)}</li>`).join('') + '</ul></div>'
    } else h += rdExtraBlock(sec, g, images, st, esc, attr, true)
  }
  return h + '</div>'
}

function renderDescription(fields, template, images) {
  const out = rdOut(template)
  if (out.mode === 'custom' && out.html) return rdSanitize(rdMustache(out.html, rdContext(fields, template, images)), out)
  const st = { ...DEFAULT_STYLES, ...(template?.styles || {}) }
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const attr = s => esc(s).replace(/"/g, '&quot;')
  const g = k => String(fields?.[k] ?? '').trim()
  const img = (src, alt) => src ? `<img alt="${attr(alt)}" src="${attr(src)}" style="width: 100%; height: auto">` : ''
  const srcOf = sec => images ? (images[sec.key] || '') : (['static', 'library'].includes(sec.image_source || 'static') ? (sec.image_url || '') : '')
  const hr = '<hr style="border: none; margin: 32px auto">'
  const h2 = (text, bottom) => `<h2 style="font-size: ${st.h2_size}px; color: ${st.heading_color}; margin: 0 0 ${bottom}px 0">${esc(text)}</h2>`
  const ht = st.hero_tag === 'h2' ? 'h2' : 'h1'
  if (st.layout === 'showcase') { const hs = rdShowcase(fields, template, images, st); return (out.allowed_tags || out.keep_styles === false || out.images === false) ? rdSanitize(hs, out) : hs }
  let h = `<div style="max-width: ${st.max_width}px; margin: 0 auto; color: ${st.text_color}; font-size: ${st.font_size}px; line-height: ${st.line_height}">`
  for (const sec of (template?.sections || []).filter(s => s && s.enabled !== false)) {
    const k = sec.key
    if (sec.type === 'hero') {
      h += img(srcOf(sec), g('HERO_IMG_ALT'))
      h += `<${ht} style="font-size: ${st.h1_size}px; color: ${st.heading_color}; margin: 0 0 10px 0">${esc(g('HERO_H1'))}</${ht}>`
      if (g('HERO_LEAD')) h += `<p style="margin: 0 0 8px 0; font-size: 16px">${esc(g('HERO_LEAD'))}</p>`
    } else if (sec.type === 'content') {
      const lis = sec.list === false ? [] : [1, 2, 3, 4, 5].map(b => g(`${k}_LI${b}`)).filter(Boolean)
      const H2 = g(`${k}_H2`), P = g(`${k}_P`), PB = sec.bold === false ? '' : g(`${k}_P_BOLD`), AK = sec.accent ? g(`${k}_AKCENT`) : ''
      if (!H2 && !P && !PB && !lis.length && !AK) continue   // pusta sekcja znika razem z obrazkiem
      h += hr + '<div style="text-align: left">' + h2(H2, 12)
      if (P || PB) h += `<p style="margin: 0 0 ${(lis.length || AK) ? 10 : 14}px 0">${esc(P)}${PB ? ' <strong>' + esc(PB) + '</strong>' : ''}</p>`
      if (lis.length) h += `<ul style="margin: 0 0 ${AK ? 10 : 14}px 0; padding-left: 18px">` + lis.map(l => `<li>${esc(l)}</li>`).join('') + '</ul>'
      if (AK) h += `<p style="margin: 0 0 14px 0; color: ${st.accent_color}"><strong>${esc(AK)}</strong></p>`
      h += img(srcOf(sec), g(`${k}_IMG_ALT`)) + '</div>'
    } else if (['features', 'why', 'closing', 'specs', 'gallery', 'banner'].includes(sec.type)) {
      h += rdExtraBlock(sec, g, images, st, esc, attr, false)
    } else if (sec.type === 'faq') {
      const qs = [1, 2, 3, 4, 5, 6].slice(0, sec.max_questions || 6).map(i => ({ q: g(`FAQ_Q${i}`), a: g(`FAQ_A${i}`) })).filter(x => x.q && x.a)
      if (!qs.length) continue
      h += hr + '<div>' + h2(g('FAQ_H2'), 16)
      qs.forEach((x, i) => {
        h += `<p style="margin: 0 0 4px 0; color: ${st.heading_color}"><strong>${i + 1}. ${esc(x.q)}</strong></p><p style="${i === qs.length - 1 ? 'margin: 0' : 'margin: 0 0 14px 0'}">${esc(x.a)}</p>`
      })
      h += '</div>'
    }
  }
  h += '</div>'
  const needsFilter = out.allowed_tags || out.keep_styles === false || out.images === false
  return needsFilter ? rdSanitize(h, out) : h
}
// === RENDER END ===
export { renderDescription, rdMustache, rdSanitize, rdContext }

// Gotowe formaty wyjściowe do wyboru w edytorze szablonów
export const OUTPUT_PRESETS = {
  standard: { label: 'eMAG – bogaty HTML (style, grafiki)', output: { mode: 'standard', html: '', allowed_tags: '', keep_styles: true, images: true, max_chars: 0 } },
  kaufland: { label: 'Kaufland – prosty HTML (nagłówki, akapity, listy)', output: { mode: 'custom', keep_styles: false, images: false, max_chars: 5000,
    allowed_tags: 'h2, h3, p, br, ul, ol, li, b, strong',
    html: `<h2>{{TYTUL}}</h2>
{{#LEAD}}<p>{{LEAD}}</p>{{/LEAD}}
{{#sekcje}}
<h3>{{H2}}</h3>
<p>{{P}}{{#P_BOLD}} <b>{{P_BOLD}}</b>{{/P_BOLD}}</p>
{{#MA_LI}}<ul>{{#LI}}<li>{{.}}</li>{{/LI}}</ul>{{/MA_LI}}
{{#AKCENT}}<p><b>{{AKCENT}}</b></p>{{/AKCENT}}
{{/sekcje}}
{{#MA_FAQ}}<h3>{{FAQ_H2}}</h3>{{/MA_FAQ}}
{{#faq}}<p><b>{{Q}}</b><br>{{A}}</p>{{/faq}}` } },
  custom: { label: 'Własny kod HTML', output: { mode: 'custom', keep_styles: true, images: true, max_chars: 0, allowed_tags: '', html: '' } },
}

// Lista pól, które AI ma wypełnić dla danego szablonu (kontrakt generacji)
export function templateFields(template) {
  const keys = []
  for (const sec of (template?.sections || []).filter(s => s && s.enabled !== false)) {
    if (sec.type === 'hero') keys.push('HERO_IMG_ALT', 'HERO_H1', 'HERO_LEAD')
    if (sec.type === 'content') {
      keys.push(`${sec.key}_H2`, `${sec.key}_P`)
      if (sec.bold !== false) keys.push(`${sec.key}_P_BOLD`)
      if (sec.list !== false) keys.push(...[1, 2, 3, 4, 5].map(b => `${sec.key}_LI${b}`))
      if (sec.accent) keys.push(`${sec.key}_AKCENT`)
      if (hasImage(sec)) keys.push(`${sec.key}_IMG_ALT`)
    }
    if (sec.type === 'features') keys.push(...[1, 2, 3, 4, 5, 6].map(i => `FEAT${i}`))
    if (sec.type === 'why') keys.push('WHY_H2', ...[1, 2, 3, 4, 5].map(i => `WHY_LI${i}`))
    if (sec.type === 'closing') keys.push('CLOSING_H2', 'CLOSING_P')
    if (sec.type === 'specs') keys.push('SPECS_H2', ...Array.from({ length: 12 }, (_, i) => `SPEC${i + 1}`))
    if (sec.type === 'faq') { keys.push('FAQ_H2'); for (let i = 1; i <= (sec.max_questions || 6); i++) keys.push(`FAQ_Q${i}`, `FAQ_A${i}`) }
  }
  return keys
}

const hasImage = sec => { const src = sec.image_source || 'static'; return src === 'static' || src === 'library' ? !!sec.image_url : src !== 'none' }

// Źródła grafik: zdjęcie produktu z BL, grafika z biblioteki (wybrana albo grafika marki wg roli), stały adres URL albo brak
export const IMAGE_SOURCES = { product: 'zdjęcie produktu z Baselinkera', library: 'grafika z biblioteki', brand: 'grafika marki z biblioteki (wg roli)', static: 'stały adres URL', none: 'bez grafiki' }

// „2-5, 8” → [2, 3, 4, 5, 8]
export function parsePositions(txt) { const out = []; for (const part of String(txt || '').split(/[,;\s]+/)) { const m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) continue; const a = Number(m[1]), b = Number(m[2] || m[1]); for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 30; i++) out.push(i) } return [...new Set(out)] }

// Dobór grafik dla konkretnego produktu (wariantu); media = wiersze media_library, brandId = marka produktu/rodziny
export function resolveImages(template, product = {}, { media = [], brandId = null } = {}) {
  const out = {}
  const imgs = [...(product.images || [])].sort((a, b) => a.position - b.position)
  const brand = brandId || product.brand_id || null
  for (const sec of (template?.sections || []).filter(s => s && s.enabled !== false && s.type === 'gallery')) {
    // galeria: zdjęcia produktu z podanych pozycji (np. „5-10”) albo wybrane ręcznie dla SKU (adresy rozdzielone nową linią)
    const pos = parsePositions(sec.positions || '2-8')
    const choice = product?.image_choice || {}
    const picked = Object.prototype.hasOwnProperty.call(choice, sec.key) ? String(choice[sec.key] || '').split('\n').filter(Boolean) : pos.map(n => (imgs.find(i => i.position === n) || imgs[n - 1] || {}).url).filter(Boolean)
    picked.slice(0, 12).forEach((u, i) => { out[`${sec.key}_${i + 1}`] = u })
  }
  for (const sec of (template?.sections || []).filter(s => s && s.enabled !== false && s.type !== 'faq' && s.type !== 'gallery' && !['features', 'why', 'closing', 'specs'].includes(s.type))) {
    const choice = product?.image_choice || {}
    if (Object.prototype.hasOwnProperty.call(choice, sec.key)) { if (choice[sec.key]) out[sec.key] = choice[sec.key]; continue }   // wybór ręczny dla SKU
    const src = sec.image_source || 'static'
    if (src === 'none') continue
    if (src === 'static' || src === 'library') { if (sec.image_url) out[sec.key] = sec.image_url; continue }
    if (src === 'brand') {
      const role = (sec.image_role || '').trim().toLowerCase()
      const hit = media.find(m => brand && m.brand_id === brand && (m.role || '').trim().toLowerCase() === role)
      if (hit) out[sec.key] = hit.url
      else if (sec.image_url) out[sec.key] = sec.image_url   // zapasowa grafika
      continue
    }
    if (src === 'product') {
      const pos = Number(sec.image_position) || 1
      const hit = imgs.find(i => i.position === pos) || imgs[pos - 1]
      if (hit) out[sec.key] = hit.url
      else if (sec.image_url) out[sec.key] = sec.image_url   // zapasowy stały adres
    }
  }
  return out
}
