import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://nyivgmimhwlhavdkgnzg.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configMissing = !url || !key
export const supabase = configMissing ? null : createClient(url, key)

export const ROLE_LABELS = { admin: 'Admin', akceptujacy: 'Akceptujący', generujacy: 'Generujący' }

export function plError(message = '') {
  if (message.includes('Invalid login credentials')) return 'Nieprawidłowy e-mail lub hasło.'
  if (message.includes('Email not confirmed')) return 'Konto nie jest potwierdzone. Poproś admina o zaznaczenie „Auto Confirm” w Supabase.'
  if (message.includes('should be different')) return 'Nowe hasło musi się różnić od obecnego.'
  if (message.includes('Password should be at least')) return 'Hasło jest za krótkie.'
  if (message.includes('Failed to fetch')) return 'Brak połączenia z bazą. Sprawdź internet albo adres Supabase w zmiennych repozytorium.'
  if (message.includes('row-level security')) return 'Brak uprawnień do tej operacji (rola użytkownika).'
  return message || 'Nieznany błąd.'
}

export const N8N_URL = import.meta.env.VITE_N8N_WEBHOOK_URL || ''

// Pobiera wszystkie wiersze tabeli (Supabase zwraca domyślnie maks. 1000 na zapytanie)
export async function fetchAll(table, cols, build = q => q) {
  let out = [], from = 0
  for (;;) {
    const { data, error } = await build(supabase.from(table).select(cols)).range(from, from + 999)
    if (error) throw error
    out = out.concat(data || [])
    if (!data || data.length < 1000) return out
    from += 1000
  }
}

export const plN = (n, a, b, c) => `${n.toLocaleString('pl-PL')} ${n === 1 ? a : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? b : c}`
export const fmtDate = d => d ? new Date(d).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—'
