// Sohbette @proje seçiliyken modelin proje bilgisine erişimi: araç tanımları, araçların çalıştırılması,
// [K#] kaynak etiketleri ve araç desteklemeyen modeller için yedek yol.
// projectId hiçbir zaman araç parametresi değildir; oturum açılırken sabitlenir, model seçili projenin dışına çıkamaz.
const search = require('./search.cjs')
const { normalize } = require('./chunker.cjs')
const { streamChat, streamWithTools, supportsTools } = require('./providers.cjs')

const MAX_HITS = 8          // tek araç sonucundaki parça sayısı
const EXCERPT = 1500        // arama sonucunda parça başına karakter (tamamı için read_source)
const READ_LIMIT = 20000    // read_source sonucunun toplam karakter sınırı
const MAX_ROUNDS = 5
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const TOOLS = [
  {
    name: 'search_knowledge',
    description: 'Kullanıcının seçtiği projedeki notlar ve dosyalar içinde arar; en fazla 8 parça döndürür. Arama metin eşleşmesiyle yapılır (anlamsal değildir): ' +
      'cümle yerine 1-3 belirgin anahtar terim ver. Sonuç azsa ya da ilgisizse eş anlamlılar, farklı çekimler ve İngilizce karşılıklarla yeniden ara.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Aranacak anahtar terimler' } }, required: ['query'] }
  },
  {
    name: 'read_source',
    description: 'Bir dosyanın belirli sayfalarını ya da bir notun tamamını okur. Arama sonucundaki bir parçanın çevresini görmek için kullan.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Arama sonuçlarında ya da kaynak listesinde verilen source_id' },
        pages: { type: 'string', description: 'Sayfa ya da slayt aralığı, ör. "12-14" ya da "5". Yalnızca sayfalı dosyalarda (PDF, sunum); verilmezse baştan okunur.' }
      },
      required: ['source_id']
    }
  }
]

const RULES = `- Kaynaklardan kullandığın her bilgiyi, ilgili cümlenin sonunda kaynağın etiketiyle işaretle: [K1], birden fazlaysa [K1][K2]. Etiketleri aynen yaz; uydurma etiket kullanma.
- Kaynaklarda bulunmayan bir bilgiyi kaynakta varmış gibi sunma. Aradığını kaynaklarda bulamazsan bunu açıkça söyle; genel bilginle tamamlıyorsan hangi kısmın kaynaklardan gelmediğini belirt.
- "AI notu" olarak işaretli notlar yapay zekâ tarafından yazılmıştır. Kaynak gösterirken mümkünse orijinal belgeleri (dosyaları) tercih et.`

// "12-14", "5", "1,3-4" → [[12,14]], [[5,5]], [[1,1],[3,4]]; anlaşılmazsa null.
function parsePages(s) {
  const out = []
  for (const part of String(s ?? '').split(/[,;]/)) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part)
    if (!m) continue
    const a = Number(m[1]), b = Number(m[2] ?? m[1])
    out.push([Math.min(a, b), Math.max(a, b)])
  }
  return out.length ? out : null
}

// Parçanın, sorgu terimlerinin ilk geçtiği yerin çevresinden alınmış kısmı.
function excerpt(text, query) {
  if (text.length <= EXCERPT) return text
  const low = text.toLocaleLowerCase('tr-TR')
  let at = -1
  for (const t of normalize(query).split(' ')) {
    if (!t) continue
    const i = low.indexOf(t)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  const start = Math.max(0, Math.min((at < 0 ? 0 : at) - 300, text.length - EXCERPT))
  return (start > 0 ? '…' : '') + text.slice(start, start + EXCERPT) + (start + EXCERPT < text.length ? '…' : '')
}

/** Bir cevap için proje oturumu. sources: sohbetin o ana kadarki etiket listesi (yeni kaynaklar sona eklenir, numaralar değişmez).
 *  readNotes: notların güncel tam listesini döndürür (notlar notes.json'da durur). Proje yoksa null. */
function open(projectId, sources, readNotes) {
  let info = typeof projectId === 'string' ? search.projectInfo(projectId) : null
  if (!info) return null
  const list = Array.isArray(sources) ? sources.filter((s) => s && Number.isInteger(s.n)) : []
  const unit = (fileId) => (info.files.find((f) => f.id === fileId)?.mime === PPTX ? 'slayt' : 'sayfa')

  // Aynı kaynağın aynı sayfası hep aynı etiketi alır; etiket ↔ (dosya/not, sayfa) eşlemesi sohbette saklanır.
  function label(sourceType, sourceId, sourceName, page) {
    let s = list.find((x) => x.sourceType === sourceType && x.sourceId === sourceId && x.page === page)
    if (!s) {
      const loc = sourceType === 'note' ? 'not' : page != null ? `${unit(sourceId)} ${page}` : ''
      s = { n: list.reduce((m, x) => Math.max(m, x.n), 0) + 1, sourceType, sourceId, sourceName, page, loc }
      list.push(s)
    }
    return s
  }
  const head = (s) => `[K${s.n}] ${s.sourceType === 'note' ? (s.ai ? 'Not (AI notu): ' : 'Not: ') : ''}${s.sourceName}${s.sourceType === 'file' && s.loc ? ' · ' + s.loc : ''} · source_id: ${s.sourceId}`
  const block = (h, query) => { const s = label(h.sourceType, h.sourceId, h.sourceName, h.page ?? null); if (h.createdBy === 'ai') s.ai = true; return `${head(s)}\n${excerpt(h.text, query)}` }
  // Kaynak, source_id ile ya da (model id yerine ad yazdıysa) adıyla bulunur.
  const pick = (list, key, id) => list.find((x) => x.id === id) ?? list.find((x) => x[key].toLocaleLowerCase('tr-TR') === id.toLocaleLowerCase('tr-TR'))
  const findFile = (sourceId) => pick(info.files, 'name', String(sourceId ?? '').trim())
  const findNote = (sourceId) => pick(info.notes, 'title', String(sourceId ?? '').trim())

  async function runSearch(query) {
    const q = String(query ?? '').trim()
    if (!q) return { text: 'Hata: query boş olamaz.', count: 0 }
    const hits = await search.searchHybrid(projectId, q, MAX_HITS)
    if (!hits.length) return { text: `"${q}" için sonuç bulunamadı. Daha kısa ya da farklı terimler dene (eş anlamlılar, İngilizce karşılıklar).`, count: 0 }
    return { text: hits.map((h) => block(h, q)).join('\n\n'), count: hits.length }
  }

  function runRead(sourceId, pages) {
    const file = findFile(sourceId)
    if (file) {
      const paged = file.pageCount != null
      const ranges = paged ? parsePages(pages) : null
      const rows = search.filePages(file.id, ranges)
      if (!rows.length) return { text: paged ? `Hata: "${file.name}" dosyasında bu sayfalar yok (toplam ${file.pageCount} ${unit(file.id)}).` : `"${file.name}" dosyasında metin yok.`, count: 0, what: file.name }
      const out = []
      let used = 0, cut = null
      for (const r of rows) {
        if (used >= READ_LIMIT) { cut = r.page; break }
        const body = r.text ? r.text.slice(0, READ_LIMIT - used) : r.needsOcr ? '(bu sayfada metin yok: taranmış görüntü)' : '(boş)'
        out.push(`${head(label('file', file.id, file.name, paged ? r.page : null))}\n${body}${body.length < r.text.length ? '\n(kısaltıldı)' : ''}`)
        used += body.length
      }
      if (cut != null) out.push(`(Sınır nedeniyle ${unit(file.id)} ${cut} ve sonrası okunmadı; devamı için pages parametresiyle yeniden çağır. Toplam ${file.pageCount} ${unit(file.id)}.)`)
      const first = rows[0].page, last = cut != null ? cut - 1 : rows[rows.length - 1].page
      return { text: out.join('\n\n'), count: out.length, what: paged ? `${file.name} · ${unit(file.id)} ${first === last ? first : first + '–' + last}` : file.name }
    }
    const meta = findNote(sourceId)
    if (meta) {
      const note = (readNotes() || []).find((n) => n && n.id === meta.id && (n.projectId ?? null) === projectId)
      if (note) {
        const body = [String(note.title ?? '').trim(), String(note.body ?? '').trim()].filter(Boolean).join('\n\n')
        const s = label('note', meta.id, meta.title, null)
        if (meta.createdBy === 'ai') s.ai = true
        return { text: `${head(s)}\n${body.slice(0, READ_LIMIT)}`, count: 1, what: 'Not: ' + meta.title }
      }
    }
    return { text: 'Hata: bu projede böyle bir kaynak yok. source_id değerini arama sonuçlarından ya da kaynak listesinden al.', count: 0 }
  }

  return {
    sources: list,
    // Not yazma araçları (note-tools.cjs) aynı oturumu, aynı etiket listesini kullanır.
    projectId, get name() { return info.name }, get files() { return info.files }, get notes() { return info.notes },
    label, unit, findFile, findNote,
    /** Kaynak listesini yeniler (cevap sırasında not oluşturulduysa). */
    refresh() { info = search.projectInfo(projectId) ?? info },
    /** Bir araç çağrısını çalıştırır; emit ile arayüze durum ve güncel kaynak listesi bildirilir. Asla fırlatmaz. */
    async run(call, emit) {
      const input = call.input && typeof call.input === 'object' ? call.input : {}
      try {
        if (call.name === 'search_knowledge') {
          const q = String(input.query ?? '').trim().slice(0, 200)
          emit('tool', { phase: 'start', kind: 'search', text: q })
          const r = await runSearch(q)
          emit('sources', { sources: list })
          emit('tool', { phase: 'end', kind: 'search', text: q, count: r.count })
          return r.text
        }
        if (call.name === 'read_source') {
          emit('tool', { phase: 'start', kind: 'read', text: '' })
          const r = runRead(input.source_id, input.pages)
          emit('sources', { sources: list })
          emit('tool', { phase: 'end', kind: 'read', text: r.what || String(input.source_id ?? '').slice(0, 80), count: r.count })
          return r.text
        }
        return `Hata: "${call.name}" adlı bir araç yok.`
      } catch (err) { console.error('[bilgi] araç hatası:', err); return 'Hata: araç çalıştırılamadı.' }
    },
    systemPrompt() {
      const files = info.files.slice(0, 60).map((f) => `- ${f.name}${f.pageCount != null ? ` (${f.pageCount} ${unit(f.id)})` : ''} · source_id: ${f.id}`)
      const notes = info.notes.slice(0, 40).map((n) => `- ${n.createdBy === 'ai' ? 'Not (AI notu)' : 'Not'}: ${n.title} · source_id: ${n.id}`)
      return `Kullanıcı bu mesaj için "${info.name}" projesini seçti. Projedeki notlara ve dosyalara search_knowledge ve read_source araçlarıyla erişebilirsin.
- Cevaplamadan önce arama yap. Tek sonuçla yetinme: farklı terimler, eş anlamlılar ve İngilizce karşılıklarla birkaç arama dene.
${RULES}

Projedeki kaynaklar:
${[...files, ...notes].join('\n') || '(proje boş)'}`
    },
    /** Araç desteklemeyen modeller: kullanıcının mesajıyla doğrudan arama, ilk 8 parça etiketli olarak sistem mesajına eklenir. */
    async fallback(userText, emit) {
      const q = String(userText ?? '').trim()
      emit('tool', { phase: 'start', kind: 'search', text: q.slice(0, 80) })
      const hits = q ? await search.searchHybrid(projectId, q, MAX_HITS) : []
      const blocks = hits.map((h) => block(h, q))
      emit('sources', { sources: list })
      emit('tool', { phase: 'end', kind: 'search', text: q.slice(0, 80), count: hits.length })
      return `Kullanıcı bu mesaj için "${info.name}" projesini seçti. Kullanıcının mesajıyla proje içinde arama yapıldı; ` +
        (blocks.length ? `bulunan kaynak parçaları aşağıda.\n${RULES}\n\n${blocks.join('\n\n')}` : 'ilgili bir kaynak bulunamadı. Bunu kullanıcıya açıkça söyle; cevabı genel bilginle veriyorsan bunu belirt.')
    }
  }
}

/** Proje seçiliyken cevap akışı. base: streamChat argümanları (system hariç); emit(kanal, veri): arayüze bildirim.
 *  notes: not yazma araçları (note-tools.cjs → create); yalnızca araçlı yolda gönderilir, yedek yolda yoktur. */
async function streamWithKnowledge({ session, base, system, userText, emit, notes }) {
  const sys = (extra) => [system, extra].filter(Boolean).join('\n\n')
  // Yedek yol araç desteklemeyen modeller içindir: sunucu araçları (web araması) da gönderilmez.
  const viaFallback = async () => streamChat({ ...base, serverTools: undefined, system: sys(await session.fallback(userText, emit)) })
  if (!(await supportsTools(base.provider))) return viaFallback()
  let started = false
  const mark = (f) => f && ((t) => { started = true; f(t) })
  try {
    return await streamWithTools({
      ...base, onToken: mark(base.onToken), onThinking: mark(base.onThinking),
      system: sys([session.systemPrompt(), notes?.rules].filter(Boolean).join('\n\n')),
      tools: notes ? [...TOOLS, ...notes.tools] : TOOLS, maxRounds: notes ? notes.maxRounds : MAX_ROUNDS,
      runTool: (call) => { started = true; return notes?.has(call.name) ? notes.run(call) : session.run(call, emit) }
    })
  } catch (err) {
    // Model araç parametresini reddettiyse (henüz hiçbir şey akmadan 4xx) yedek yola geç.
    // Web araması da istenmişse reddin nedeni o olabilir: hata çağırana bırakılır, o da aramasız yeniden dener (bkz. main.cjs).
    if (started || base.serverTools || base.signal?.aborted || !/^HTTP (400|404|422)/.test(String(err && err.message))) throw err
    return viaFallback()
  }
}

module.exports = { open, streamWithKnowledge }
