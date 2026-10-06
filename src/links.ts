// Notlardaki [[dosya adı#sayfa]] bağlantıları. Sözdizimi electron/search.cjs → LINK ile aynı olmalı.
const LINK = /\[\[([^\[\]\n]+?)(?:#(\d+))?\]\]/g

export interface NoteLink { name: string; page: number | null; from: number; to: number }

export function linksIn(text: string): NoteLink[] {
  return Array.from(text.matchAll(LINK), (m) => ({ name: m[1].trim(), page: m[2] ? Number(m[2]) : null, from: m.index!, to: m.index! + m[0].length }))
}
/** İmlecin içinde durduğu bağlantı (uçları hariç: bağlantının hemen yanına tıklamak onu açmaz). */
export const linkAt = (text: string, off: number) => linksIn(text).find((l) => off > l.from && off < l.to) ?? null

/** İmlecin solunda yazılmakta olan, henüz kapanmamış "[[sorgu". */
export function openLinkQuery(before: string): { start: number; q: string } | null {
  const m = /\[\[([^\[\]\n#]*)$/.exec(before)
  return m ? { start: m.index, q: m[1] } : null
}
