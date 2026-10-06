// Modelin yazdığı not içeriğinin kayıt biçimine çevrilmesi ve belge özetleme yardımcıları.
// Saf fonksiyonlar: veritabanına ve Electron'a bağlı değildir.
const { normalize } = require('./chunker.cjs')

// ---- [K#] → [[dosya adı#sayfa]] ----
// Dosya adları ve sayfa numaraları modelden alınmaz: etiketler sohbetin etiket listesinden (bkz. knowledge.cjs → label) çevrilir.
// Bağlantı sözdizimi src/links.ts ve search.cjs → LINK ile aynı olmalı; adı bu sözdizimine sığmayan dosyalar düz metin olarak yazılır.
const ONE = String.raw`\[\s*K\d+(?:\s*[,;]\s*K\d+)*\s*\]`
const TAG = new RegExp(`[ \\t]*${ONE}(?:[ \\t]*${ONE})*`, 'g') // art arda gelen etiketler ([K1][K2]) tek seferde çevrilir
const linkable = (s) => !/[\[\]\n]/.test(s.sourceName) && !(s.page == null && /#\d+$/.test(s.sourceName))

/** sources: [{ n, sourceType, sourceId, sourceName, page, loc }]. Listede olmayan (uydurma) etiketler silinir. */
function linkify(content, sources) {
  const list = Array.isArray(sources) ? sources : []
  return String(content ?? '').replace(TAG, (whole) => {
    const lead = /^[ \t]*/.exec(whole)[0]
    const out = []
    for (const m of whole.matchAll(/K(\d+)/g)) {
      const s = list.find((x) => x.n === Number(m[1]))
      if (!s) continue
      const t = s.sourceType === 'note' ? `(Not: ${s.sourceName})`
        : linkable(s) ? `[[${s.sourceName}${s.page != null ? '#' + s.page : ''}]]`
        : `(${s.sourceName}${s.loc ? ', ' + s.loc : ''})`
      if (!out.includes(t)) out.push(t)
    }
    return out.length ? lead + out.join(' ') : ''
  })
}

// ---- Markdown → not biçimi ----
// Not editörü yalnızca **kalın**, *italik* ve satır başında "☐ ", "☑ ", "• " tanır (bkz. src/richText.ts);
// başlıklar kalın satıra, madde işaretleri editörün işaretlerine çevrilir. Tablolar ve kod düz metin kalır.
function mdToNote(md) {
  const out = []
  let fence = false
  for (let line of String(md ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue }
    if (fence) { out.push(line); continue }
    line = line.replace(/\s+$/, '')
    if (/^\s*([-*_])(\s*\1){2,}$/.test(line)) { out.push(''); continue } // yatay çizgi
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*$/.exec(line)
    if (h) { const t = h[1].replace(/\*+/g, '').trim(); if (t) out.push('**' + t + '**'); continue }
    line = line.replace(/^\s*>\s?/, '')
      .replace(/^\s*[-*+]\s+\[\s\]\s+/, '☐ ').replace(/^\s*[-*+]\s+\[[xX]\]\s+/, '☑ ').replace(/^\s*[-*+]\s+/, '• ')
      .replace(/__([^_\n]+)__/g, '**$1**')
      .replace(/\[([^\[\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
      .replace(/`([^`\n]+)`/g, '$1')
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ---- özetleme: sayfa grupları ----
const PIECE = 20000 // tek başına bundan uzun sayfa (ya da sayfasız belgenin tamamı) bu boyda parçalara bölünür

function splitText(text) {
  const out = []
  let s = text
  while (s.length > PIECE) {
    let cut = s.lastIndexOf('\n', PIECE)
    if (cut < PIECE / 2) cut = s.lastIndexOf(' ', PIECE)
    if (cut < PIECE / 2) cut = PIECE
    out.push(s.slice(0, cut)); s = s.slice(cut).trimStart()
  }
  if (s) out.push(s)
  return out
}

/** pages: [{ page, text }] (sayfa sırasıyla, boş sayfalar dahil) → [{ from, to, parts: [{ page, text }], empty: [sayfa] }].
 *  Gruplar dengeli bölünür (84 sayfa → 9–10 sayfalık 9 grup) ve maxChars'ı aşmaz. Hiçbir sayfa dışarıda kalmaz;
 *  metni olmayan sayfalar grubun empty listesine yazılır. */
function pageGroups(pages, maxPages = 10, maxChars = 40000) {
  const n = Math.ceil(pages.length / maxPages) // sayfa sayısına göre grup sayısı; k. grubun bittiği sıra: ceil(k * toplam / n)
  const groups = []
  let cur = null, chars = 0, k = 1
  const close = () => { if (cur) groups.push(cur); cur = null; chars = 0 }
  pages.forEach((p, idx) => {
    const text = String(p.text ?? '').trim()
    if (idx >= Math.ceil((k * pages.length) / n)) { close(); k++ }
    for (const piece of text ? splitText(text) : ['']) {
      if (cur && piece && chars + piece.length > maxChars && cur.parts.length) close()
      if (!cur) cur = { from: p.page, to: p.page, parts: [], empty: [] }
      cur.to = p.page
      if (piece) { cur.parts.push({ page: p.page, text: piece }); chars += piece.length } else cur.empty.push(p.page)
    }
  })
  close()
  return groups
}

// ---- özetleme: tekrarların ayıklanması ----
const words = (s) => new Set(normalize(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 || /\d/.test(w)))
const numbers = (w) => [...w].filter((x) => /\d/.test(x)).sort().join(' ')
/** Aynı ya da neredeyse aynı (kelime kümeleri %80+ örtüşen) noktalardan ilki kalır.
 *  İçindeki sayılar farklı olan noktalar (farklı yıl, oran, yöntem numarası) benzer görünse de ayrı bilgidir, birleştirilmez. */
function dedupePoints(points) {
  const kept = []
  for (const p of points) {
    const w = words(p.point)
    if (!w.size) continue
    const nums = numbers(w)
    const dup = kept.some((k) => {
      if (k.nums !== nums) return false
      let both = 0
      for (const x of w) if (k.w.has(x)) both++
      return both / (w.size + k.w.size - both) >= 0.8
    })
    if (!dup) kept.push({ p, w, nums })
  }
  return kept.map((k) => k.p)
}

module.exports = { linkify, mdToNote, pageGroups, dedupePoints }
