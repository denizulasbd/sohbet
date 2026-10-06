import type { Msg, Note, NoteRef } from './types'

const DAY = 86400000
const tr = 'tr-TR'

export const isEmptyNote = (n: Note) => !n.title.trim() && !n.body.trim()
const firstLine = (s: string) => s.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
const stripPfx = (l: string) => l.replace(/^(☐|☑|•)\s+/, '')
/** Kalın/italik işaretlerini (** ve *) listede ve başlıkta gösterme. */
export const plain = (s: string) => s.replace(/\*+/g, '')

/** Başlık boşsa ilk satır başlık olur (Apple Notlar gibi). */
export const noteTitle = (n: Note) => (n.title.trim() || stripPfx(plain(firstLine(n.body))) || 'Yeni not').slice(0, 80)
export function noteSnippet(n: Note) {
  const lines = n.body.split('\n').map((l) => stripPfx(plain(l.trim()))).filter(Boolean)
  return (n.title.trim() ? lines : lines.slice(1)).join(' ').slice(0, 90) || 'Ek metin yok'
}
export const toRef = (n: Note): NoteRef => ({ id: n.id, title: noteTitle(n), text: n.body.trim() })

/** Mesajın modele giden hali: ekli notlar başa eklenir, arayüzde yalnızca etiket olarak görünür. */
export function contentOf(m: Msg): string {
  if (m.role !== 'user' || !m.notes?.length) return m.text
  const blocks = m.notes.map((n) => `<not başlık="${n.title.replace(/"/g, "'")}">\n${n.text}\n</not>`).join('\n\n')
  return `Aşağıda kendi notlarım var; sorumla ilgiliyse bunları kullan.\n\n${blocks}\n\n---\n\n${m.text}`
}

// ---- tarihler ----
export function noteGroup(ts: number): string {
  const today = new Date().setHours(0, 0, 0, 0)
  if (ts >= today) return 'BUGÜN'
  if (ts >= today - DAY) return 'DÜN'
  if (ts >= today - 7 * DAY) return 'ÖNCEKİ 7 GÜN'
  if (ts >= today - 30 * DAY) return 'ÖNCEKİ 30 GÜN'
  const d = new Date(ts)
  return d.getFullYear() === new Date().getFullYear() ? d.toLocaleDateString(tr, { month: 'long' }).toLocaleUpperCase(tr) : String(d.getFullYear())
}
export function shortDate(ts: number): string {
  const today = new Date().setHours(0, 0, 0, 0)
  const d = new Date(ts)
  if (ts >= today) return d.toLocaleTimeString(tr, { hour: '2-digit', minute: '2-digit' })
  if (ts >= today - DAY) return 'Dün'
  if (ts >= today - 7 * DAY) return d.toLocaleDateString(tr, { weekday: 'long' })
  return d.toLocaleDateString(tr)
}
/** Liste satırları için kısa tarih: bugün saat, dün "Dün", son 7 gün kısa gün adı, daha eskiler gg.aa. */
export function tinyDate(ts: number): string {
  const today = new Date().setHours(0, 0, 0, 0)
  const d = new Date(ts)
  if (ts >= today) return d.toLocaleTimeString(tr, { hour: '2-digit', minute: '2-digit' })
  if (ts >= today - DAY) return 'Dün'
  if (ts >= today - 7 * DAY) return d.toLocaleDateString(tr, { weekday: 'short' })
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0')
}
export const longDate =(ts: number) => new Date(ts).toLocaleString(tr, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
