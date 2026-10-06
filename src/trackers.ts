import type { Tracker, TrackerInput, TrackerKind } from './types'

/** Hazır şablonlar. Kilo ve kalori takibi bilerek yoktur; kullanıcı isterse kendi takibini ekler. */
export const TRACKER_TEMPLATES: TrackerInput[] = [
  { name: 'Su', kind: 'number', unit: 'bardak', frequency: 'daily', target: 8 },
  { name: 'Uyku', kind: 'duration', unit: 'saat', frequency: 'daily', target: 8 },
  { name: 'Antrenman', kind: 'check', unit: null, frequency: 'weekly', target: 3 },
  { name: 'Ders çalışma', kind: 'duration', unit: 'dakika', frequency: 'daily', target: 120 },
  { name: 'Düzenli öğün', kind: 'number', unit: 'öğün', frequency: 'daily', target: 3 },
  { name: 'Kitap okuma', kind: 'duration', unit: 'dakika', frequency: 'daily', target: 20 }
]
export const TRACKER_KINDS: { id: TrackerKind; label: string }[] = [{ id: 'check', label: 'Yapıldı / yapılmadı' }, { id: 'number', label: 'Sayı' }, { id: 'duration', label: 'Süre' }]

export const num = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',')
/** Sayaçtaki artış adımı: saat yarımşar, dakika beşer, diğerleri birer. */
export const stepOf = (t: TrackerInput) => (t.kind === 'duration' ? (t.unit === 'saat' ? 0.5 : 5) : 1)
export const valueText = (t: TrackerInput, v: number) => (t.kind === 'check' ? (v > 0 ? 'Yapıldı' : 'Yapılmadı') : `${num(v)}${t.unit ? ' ' + t.unit : ''}`)
/** "Günde 8 bardak" / "Haftada 3 gün"; hedef yoksa boş. */
export function goalText(t: TrackerInput) {
  if (!t.target) return ''
  const per = t.frequency === 'weekly' ? 'Haftada' : 'Günde'
  return t.kind === 'check' ? (t.frequency === 'weekly' ? `Haftada ${num(t.target)} gün` : 'Her gün') : `${per} ${num(t.target)}${t.unit ? ' ' + t.unit : ''}`
}
/** Haftalık satırın alt yazısı: hedef ve bu haftaki durum. */
export function weekText(t: Tracker, days: number[], total: number) {
  const done = days.filter((v) => v > 0).length
  if (t.kind === 'check') return [goalText(t), `bu hafta ${done} gün`].filter(Boolean).join(' · ')
  return [goalText(t), t.frequency === 'weekly' ? `bu hafta ${num(total)}${t.unit ? ' ' + t.unit : ''}` : done ? `bu hafta ${done} gün kayıt` : ''].filter(Boolean).join(' · ')
}
/** Bir günün doluluk düzeyi (haftalık şeritteki nokta): 0 boş · 1 kısmen · 2 hedefe ulaştı (hedef yoksa kayıt varsa 2). */
export const dayLevel = (t: TrackerInput, v: number) => (v <= 0 ? 0 : t.kind !== 'check' && t.frequency === 'daily' && t.target && v < t.target ? 1 : 2)
