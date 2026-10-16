import { useId, useMemo, useState } from 'react'

// Wybór wielu pozycji z długiej listy: pole wyszukiwania + lista podpowiedzi + wybrane jako „chipy”
// options: [{ value, label, hint? }], value: [value], allowFree: dopisanie własnej wartości (np. marki spoza listy)
export default function Picker({ label, help, options, value, onChange, placeholder = 'Szukaj…', allowFree = false, freeLabel = v => `Dodaj „${v}”` }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const id = useId()
  const chosen = new Set(value.map(String))
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = options.filter(o => !chosen.has(String(o.value)))
    return (s ? list.filter(o => o.label.toLowerCase().includes(s)) : list).slice(0, 60)
  }, [q, options, value])
  const add = v => { onChange([...value, v]); setQ('') }
  const remove = v => onChange(value.filter(x => String(x) !== String(v)))
  const labelOf = v => options.find(o => String(o.value) === String(v))?.label || String(v)
  const free = allowFree && q.trim() && !options.some(o => o.label.toLowerCase() === q.trim().toLowerCase()) && !chosen.has(q.trim())

  return (
    <div className="picker">
      <label htmlFor={id}>{label}{help && <span className="field-help">{help}</span>}</label>
      <input id={id} value={q} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`${id}-list`}
        onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (hits[0]) add(hits[0].value); else if (free) add(q.trim()) } if (e.key === 'Escape') setOpen(false) }} />
      {open && (hits.length > 0 || free) && (
        <ul className="picker-list" id={`${id}-list`} role="listbox">
          {free && <li><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => add(q.trim())}>{freeLabel(q.trim())}</button></li>}
          {hits.map(o => <li key={o.value}><button type="button" role="option" aria-selected="false" onMouseDown={e => e.preventDefault()} onClick={() => add(o.value)}>{o.label}{o.hint && <span className="muted small"> · {o.hint}</span>}</button></li>)}
        </ul>
      )}
      {value.length > 0 && (
        <div className="chips">
          {value.map(v => <span key={v} className="chip">{labelOf(v)}<button type="button" aria-label={`Usuń ${labelOf(v)}`} onClick={() => remove(v)}>×</button></span>)}
        </div>
      )}
    </div>
  )
}
