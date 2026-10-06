// Parçalama ve arama normalizasyonu. Hem metin çıkarma işçisi (dosyalar) hem ana süreç (notlar, sorgular) kullanır;
// indekslenen metin ile sorgu aynı normalize() fonksiyonundan geçmelidir.

// Bir parça en fazla TARGET + OVERLAP (≈2800) karakter olur. Parçalar paragraf ve başlık sınırlarında bölünür;
// sığmayan paragraf satırlara, sığmayan satır cümlelere ayrılır.
const TARGET = 2500
const OVERLAP = 300
const MIN_BEFORE_HEADING = 600 // bundan kısa parça yeni başlıkta bölünmez, başlıkla birlikte devam eder
const HEADING = /^#{1,6}\s+(\S.*)$/

/** Arama metni: Türkçe küçük harf (İ→i, I→ı), ardından ı→i katlaması; böylece "ISLAH", "ıslah" ve "islah" aynı yere düşer.
 *  Ayrıca satır sonu tirelemesi birleştirilir, bitişik harfler (ﬁ) açılır, boşluklar teke iner. */
function normalize(s) {
  return String(s ?? '').normalize('NFKC')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/̇/g, '')
    .replace(/\s+/g, ' ').trim()
}

function hardSplit(s) {
  const out = []
  while (s.length > TARGET) {
    let cut = s.lastIndexOf(' ', TARGET)
    if (cut < TARGET / 2) cut = TARGET
    out.push(s.slice(0, cut)); s = s.slice(cut).trimStart()
  }
  if (s) out.push(s)
  return out
}

/** Metni, her biri TARGET'i aşmayan sıralı birimlere ayırır. sep: birimin öncekine nasıl bağlanacağı. */
function pieces(text) {
  const out = []
  for (const raw of text.split(/\n{2,}/)) {
    const block = raw.trim()
    if (!block) continue
    const heading = HEADING.exec(block.split('\n', 1)[0])?.[1].trim() ?? null
    let firstInBlock = true
    for (const line of block.length <= TARGET ? [block] : block.split('\n')) {
      let firstInLine = true
      for (const sent of line.length <= TARGET ? [line] : line.split(/(?<=[.!?…])\s+/)) {
        for (const t of sent.length <= TARGET ? [sent] : hardSplit(sent)) {
          if (!t.trim()) continue
          out.push({ t, sep: firstInBlock ? '\n\n' : firstInLine ? '\n' : ' ', blockStart: firstInBlock, heading: firstInBlock ? heading : null })
          firstInBlock = false; firstInLine = false
        }
      }
    }
  }
  return out
}

// Örtüşme: kapanan parçanın son ~OVERLAP karakteri, kelime başından başlayacak şekilde.
function tail(s) {
  const t = s.slice(-OVERLAP)
  const i = t.search(/\s/)
  return (i >= 0 && i < t.length - 1 ? t.slice(i + 1) : t).trim()
}

function chunkText(text) {
  const chunks = []
  let cur = '', fresh = false, heading = null, curHeading = null
  const close = (overlap) => {
    if (fresh) chunks.push({ heading: curHeading, text: cur })
    cur = overlap && fresh ? tail(cur) : ''
    fresh = false
  }
  for (const p of pieces(text)) {
    if (p.heading) {
      if (fresh && cur.length >= MIN_BEFORE_HEADING) close(false) // yeni başlık yeni parça başlatır, örtüşme taşınmaz
      heading = p.heading
    }
    if (fresh && cur.length + p.sep.length + p.t.length > TARGET) close(true)
    if (!fresh) curHeading = heading
    cur = cur ? cur + p.sep + p.t : p.t
    fresh = true
  }
  close(false)
  return chunks
}

/** pages: [{ page, text }]. paged: sayfa/slayt numarası anlamlıysa true (PDF, PPTX); değilse page NULL yazılır.
 *  Her sayfa ayrı parçalanır, yani hiçbir parça sayfa sınırını aşmaz. */
function chunkPages(pages, paged) {
  const out = []
  for (const pg of pages) {
    for (const c of chunkText(pg.text || '')) out.push({ page: paged ? pg.page : null, heading: c.heading, text: c.text, norm: normalize(c.text) })
  }
  return out
}

module.exports = { chunkPages, normalize }
