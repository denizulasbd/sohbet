import type { EventInput, EventKind, EventRepeat, WeekDay } from './types'

export const EVENT_KINDS: { id: EventKind; label: string }[] = [
  { id: 'ders', label: 'Ders' }, { id: 'sinav', label: 'Sınav' }, { id: 'odev', label: 'Ödev' },
  { id: 'antrenman', label: 'Antrenman' }, { id: 'ogun', label: 'Öğün' }, { id: 'diger', label: 'Diğer' }
]
export const kindLabel = (k: EventKind) => EVENT_KINDS.find((x) => x.id === k)?.label ?? 'Diğer'
/** Haftanın günleri, pazartesiden başlayarak (Date.getDay() sırası değil). */
export const WEEK_DAYS: { id: WeekDay; label: string }[] = [
  { id: 'MO', label: 'Pzt' }, { id: 'TU', label: 'Sal' }, { id: 'WE', label: 'Çar' }, { id: 'TH', label: 'Per' }, { id: 'FR', label: 'Cum' }, { id: 'SA', label: 'Cmt' }, { id: 'SU', label: 'Paz' }
]
/** Projeye bağlanabilen türler (akademik taraf). */
export const PROJECT_KINDS: EventKind[] = ['ders', 'sinav', 'odev']

const tr = 'tr-TR'
const pad = (n: number) => String(n).padStart(2, '0')
export const DAY_MS = 86400000
export const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }
/** Gün ekler (yaz/kış saati geçişinde de gece yarısında kalır). */
export const addDays = (ms: number, n: number) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime() }
/** Haftanın pazartesisi, gece yarısı. */
export const startOfWeek = (ms: number) => { const d = new Date(startOfDay(ms)); return addDays(d.getTime(), -((d.getDay() + 6) % 7)) }
export const weekDayOf = (ms: number): WeekDay => WEEK_DAYS[(new Date(ms).getDay() + 6) % 7].id
export const ymd = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export const hm = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
/** 'YYYY-AA-GG' (+ 'SS:DD') → yerel saatle epoch ms; geçersizse null. */
export function fromYmd(date: string, time?: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), t = /^(\d{2}):(\d{2})$/.exec(time ?? '00:00')
  if (!m || !t) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2])).getTime()
}

/** "14 Kas Cmt" · bugün ve yarın adıyla. */
export function dayLabel(ms: number) {
  const today = startOfDay(Date.now()), day = startOfDay(ms)
  if (day === today) return 'Bugün'
  if (day === addDays(today, 1)) return 'Yarın'
  return new Date(ms).toLocaleDateString(tr, { day: 'numeric', month: 'short', weekday: 'short', ...(new Date(ms).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}
export const timeLabel = (o: { at: number; until: number | null; allDay: boolean }) => (o.allDay ? 'Tüm gün' : hm(o.at) + (o.until ? '–' + hm(o.until) : ''))
export function repeatLabel(r: EventRepeat | null) {
  if (!r) return ''
  const base = r.freq === 'daily' ? 'Her gün' : 'Her hafta' + (r.days.length ? ' ' + WEEK_DAYS.filter((d) => r.days.includes(d.id)).map((d) => d.label).join(', ') : '')
  const until = r.until ? fromYmd(r.until) : null
  return base + (until != null ? ` · ${new Date(until).toLocaleDateString(tr, { day: 'numeric', month: 'short', year: 'numeric' })} tarihine kadar` : '')
}
/** Bir etkinliğin tek satırlık zamanı: "14 Kas Cmt · 10:00–12:00 · Her hafta Pzt, Çar". */
export function eventLine(e: Pick<EventInput, 'startAt' | 'endAt' | 'allDay' | 'repeat'>) {
  const day = new Date(e.startAt).toLocaleDateString(tr, { day: 'numeric', month: 'short', weekday: 'short', year: 'numeric' })
  return [e.repeat ? null : day, timeLabel({ at: e.startAt, until: e.endAt, allDay: e.allDay }), e.repeat ? repeatLabel(e.repeat) + ` · ${day} tarihinden itibaren` : null].filter(Boolean).join(' · ')
}
