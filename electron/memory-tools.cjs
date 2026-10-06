// Hafıza alanları ve modlar arası erişim. Her kayıt bir alana aittir: 'akademik' (sohbet modu), 'yasam' (koç modu) ya da 'genel' (iki mod).
// Bir mod kendi alanını ve 'genel' kayıtları sistem talimatında görür; diğer alanın kayıtlarına yalnızca search_memory aracıyla ulaşır.
// modeOnly kayıtlar diğer moda hiçbir yoldan geçmez: süzme burada kodla yapılır, modele bırakılmaz.
const { normalize } = require('./chunker.cjs')

const DOMAINS = ['akademik', 'yasam', 'genel']
const OWN = { chat: 'akademik', coach: 'yasam' }
const OTHER_NAME = { chat: 'yaşam koçu', coach: 'sohbet (akademik)' }
const ownDomain = (mode) => OWN[mode] || OWN.chat
const domainOf = (item) => (DOMAINS.includes(item?.domain) ? item.domain : 'genel')

/** Sistem talimatına eklenen kayıtlar: modun kendi alanı ve 'genel'. */
const inPrompt = (items, mode) => items.filter((i) => { const d = domainOf(i); return d === 'genel' || d === ownDomain(mode) })
/** search_memory ile ulaşılabilen kayıtlar: diğer alanın modeOnly olmayanları. */
const searchable = (items, mode) => items.filter((i) => { const d = domainOf(i); return d !== 'genel' && d !== ownDomain(mode) && !i.modeOnly })

// Sağlık, beslenme, kilo, uyku ve ruh hâli: çıkarım modeli alanı yanlış seçse de bu kayıtlar 'yasam' ve modeOnly olur (normalize edilmiş metinde aranır).
const SENSITIVE = /uyku|uyu[ymd]|kilo(?!metre|bayt)|diyet|kalori|beslen|öğün|ilaç|hastal|depres|kaygi|anksiyete|panik atak|ruh hal|stres|sağlik|tansiyon|diyabet|hamile|terapi|psikolo|psikiyatr|yeme bozuk|sakatl|alerji|astim|migren|ameliyat/
/** Otomatik çıkarımdan gelen kaydın alanı ve modeOnly değeri. */
function classify(text, domain) {
  if (SENSITIVE.test(normalize(text))) return { domain: 'yasam', modeOnly: true }
  return { domain: DOMAINS.includes(domain) ? domain : 'genel', modeOnly: false }
}

const TOOL = {
  name: 'search_memory',
  description: 'Kullanıcının uygulamanın diğer modunda kaydedilmiş hafıza kayıtlarında arar. Yalnızca mevcut soru o bilgiye gerçekten ihtiyaç duyuyorsa kullan.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'Aranacak konu; birkaç anahtar kelime (ör. "sınav tarihleri", "antrenman günleri")' } }, required: ['query'] }
}

const MAX_RESULTS = 12
/** Türkçe ekler yüzünden tam kelime eşleşmesi aranmaz: sorgudaki her kelimenin ilk 5 harfi kayıtta geçiyorsa eşleşme sayılır. */
function search(items, query, limit = 8) {
  const stems = [...new Set(normalize(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3).map((w) => w.slice(0, 5)))]
  if (!stems.length) return []
  return items.map((i) => { const t = normalize(i.text); return { i, score: stems.filter((s) => t.includes(s)).length } })
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.i)
}

/** Bir cevap için search_memory aracı (not araçlarıyla aynı arayüz). items: searchable() sonucu; boşsa araç sunulmaz. */
function create({ items, mode, emit }) {
  if (!items.length) return null
  const other = OTHER_NAME[mode] || OTHER_NAME.chat
  return {
    tools: [TOOL], maxRounds: 3,
    rules: `search_memory aracın var: kullanıcının ${other} modunda kaydedilmiş bilgilerinde arar (ör. ${mode === 'coach' ? 'sınav tarihleri, ders programı' : 'antrenman günleri, günlük rutin'}). Diğer moddan gelen bir bilgiyi yalnızca mevcut soruya doğrudan katkı sağlıyorsa kullan; ilgisiz sorularda arama yapma ve bu bilgileri gereksiz yere anma.`,
    has: (name) => name === TOOL.name,
    async run(call) {
      const query = String(call.input?.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      emit('tool', { phase: 'start', kind: 'memory', text: query })
      // Kelime eşleşmesi eş anlamlıları kaçırır ("sınav" ↔ "final haftası"); bu yüzden eşleşenlerin ardına en yeni kayıtlar da eklenir, ilgili olanı model seçer.
      const hits = search(items, query)
      const out = [...hits, ...items.filter((i) => !hits.includes(i))].slice(0, MAX_RESULTS)
      emit('tool', { phase: 'end', kind: 'memory', text: query, count: out.length })
      return `Diğer modun hafızasındaki kayıtlar (ilgililer üstte; yalnızca soruyla doğrudan ilgili olanı kullan, diğerlerini anma):\n${out.map((i) => '- ' + i.text).join('\n')}`
    }
  }
}

/** İki araç setini tek sette birleştirir (biri yoksa diğeri döner). */
function combine(a, b) {
  if (!a || !b) return a || b || null
  return {
    tools: [...a.tools, ...b.tools], maxRounds: Math.max(a.maxRounds, b.maxRounds), rules: a.rules + '\n\n' + b.rules,
    has: (name) => a.has(name) || b.has(name),
    run: (call) => (a.has(call.name) ? a.run(call) : b.run(call))
  }
}

module.exports = { DOMAINS, domainOf, inPrompt, searchable, classify, search, create, combine }
