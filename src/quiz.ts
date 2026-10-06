import type { QuizDifficulty, QuizKind, QuizPhase, QuizSettings } from './types'

export const DIFFICULTIES: { id: QuizDifficulty; label: string }[] = [{ id: 'easy', label: 'Kolay' }, { id: 'medium', label: 'Orta' }, { id: 'hard', label: 'Zor' }]
export const KINDS: { id: QuizKind; label: string }[] = [{ id: 'mcq', label: 'Çoktan seçmeli' }, { id: 'open', label: 'Klasik' }, { id: 'mixed', label: 'Karışık' }]
export const COUNTS = [5, 10, 15, 20]
export const LETTERS = 'ABCD'
export const PHASE: Record<QuizPhase, string> = { sources: 'Kaynaklar taranıyor…', questions: 'Sorular hazırlanıyor…', grading: 'Cevaplar değerlendiriliyor…', interpreting: 'Yorum hazırlanıyor…' }

export const requestId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
export const fmtScore = (n: number) => String(Math.round(n))
/** Liste ve sonuç ekranındaki ayar özeti: "Orta · Karışık · 10 soru · Odak: …". n: quiz'deki gerçek soru sayısı. */
export function settingsLine(s: QuizSettings, n: number): string {
  return [
    DIFFICULTIES.find((d) => d.id === s.difficulty)?.label, KINDS.find((k) => k.id === s.type)?.label, `${n} soru`,
    s.focus ? `Odak: ${s.focus}` : null, s.sources.length ? `${s.sources.length} seçili kaynak` : null
  ].filter(Boolean).join(' · ')
}
