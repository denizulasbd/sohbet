// Arama sonucu önizlemesi: eşleşen terimlerin çevresinden kısa bir alıntı, eşleşmeler işaretli.

/** Ana süreçteki normalize() ile aynı harf katlaması (Türkçe küçük harf + ı→i), ama uzunluğu koruyarak:
 *  böylece katlanmış metindeki konumlar asıl metinde de geçerlidir. */
export function fold(s: string): string {
  let out = ''
  for (const c of s) {
    const l = c.toLocaleLowerCase('tr-TR')
    out += l.length !== c.length ? c : l === 'ı' ? 'i' : l
  }
  return out
}

export interface SnipPart { t: string; hit: boolean }

export function snippet(text: string, query: string, width = 280): { lead: boolean; parts: SnipPart[] } {
  const f = fold(text)
  const terms = [...new Set(fold(query).split(/\s+/).filter(Boolean))]
  let first = -1
  for (const t of terms) { const i = f.indexOf(t); if (i >= 0 && (first < 0 || i < first)) first = i }
  let start = Math.max(0, (first < 0 ? 0 : first) - 80)
  if (start > 0) { const sp = text.indexOf(' ', start); if (sp >= 0 && sp < start + 40) start = sp + 1 }
  const end = Math.min(text.length, start + width)
  // pencere içindeki eşleşme aralıkları, birleştirilmiş
  const ranges: [number, number][] = []
  for (const t of terms) for (let i = f.indexOf(t, start); i >= 0 && i < end; i = f.indexOf(t, i + t.length)) ranges.push([i, Math.min(i + t.length, end)])
  ranges.sort((a, b) => a[0] - b[0])
  const parts: SnipPart[] = []
  let pos = start
  for (const [a, b] of ranges) {
    if (b <= pos) continue
    if (a > pos) parts.push({ t: text.slice(pos, a), hit: false })
    parts.push({ t: text.slice(Math.max(a, pos), b), hit: true })
    pos = b
  }
  if (pos < end) parts.push({ t: text.slice(pos, end) + (end < text.length ? '…' : ''), hit: false })
  return { lead: start > 0, parts }
}
