const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { streamChat, streamWithTools, listModels, supportsTools, isOpenRouter } = require('./providers.cjs')
const webSearch = require('./web-search.config.cjs')

const dataDir = () => app.getPath('userData')
const chatsFile = () => path.join(dataDir(), 'chats.json')
const notesFile = () => path.join(dataDir(), 'notes.json')
const settingsFile = () => path.join(dataDir(), 'settings.json')
const memoryFile = () => path.join(dataDir(), 'memory.json')

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return fallback } }
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)) }

// API anahtarları işletim sisteminin anahtarlığıyla şifrelenir (safeStorage); renderer'a asla düz gönderilmez.
const enc = (s) => (s && safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : s || '')
const dec = (s) => (s && s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : s || '')

const defaultSettings = () => ({
  activeProvider: 'openrouter',
  providers: [
    { id: 'openrouter', kind: 'openai', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: 'anthropic/claude-sonnet-4.5' },
    { id: 'local', kind: 'openai', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3.1' }
  ],
  systemPrompt: '',
  archive: { ocr: 'local', semantic: false }
})

// Eski sürümlerin hazır sağlayıcıları (Anthropic, OpenAI) kayıtlı ayarlardan ayıklanır; yalnızca OpenRouter ve Ollama kalır.
const REMOVED_PROVIDERS = ['anthropic', 'openai']
function loadSettings() {
  const s = readJson(settingsFile(), null) || defaultSettings()
  let providers = s.providers.filter((p) => !REMOVED_PROVIDERS.includes(p.id))
    .map((p) => (p.id === 'local' && p.name === 'Yerel (Ollama / LM Studio)' ? { ...p, name: 'Ollama' } : p))
  if (!providers.length) providers = defaultSettings().providers
  const activeProvider = providers.some((p) => p.id === s.activeProvider) ? s.activeProvider : providers[0].id
  return { ...s, providers, activeProvider }
}
// Kişisel hafıza: ayarlardan ayrı dosyada; otomatik çıkarım ve kullanıcı düzenlemeleri birbirinin üstüne yazmasın diye id bazlı işlemler.
const MAX_MEMORIES = 100
const loadMemory = () => {
  const m = readJson(memoryFile(), null)
  return { enabled: m?.enabled !== false, items: Array.isArray(m?.items) ? m.items : [] }
}
const saveMemory = (m) => writeJson(memoryFile(), m)
const memId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 300)

// Dış bağlantılar sistem tarayıcısında açılır; yalnızca http ve https adreslerine izin verilir.
function openExternal(url) {
  try {
    const u = new URL(String(url))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    shell.openExternal(u.href)
    return true
  } catch { return false }
}

// Web araması yalnızca OpenRouter'da ve araç destekleyen modellerde kullanılabilir.
const WEB_ONLY_OPENROUTER = 'Web araması yalnızca OpenRouter modellerinde kullanılabilir'
async function webAvailability(p) {
  if (!p || p.kind !== 'openai' || !isOpenRouter(p)) return { ok: false, reason: WEB_ONLY_OPENROUTER }
  if (!(await supportsTools(p))) return { ok: false, reason: 'Bu model araç kullanmayı desteklemiyor; web araması yapılamaz' }
  return { ok: true }
}

const WEB_RULES = `Web araması aracın var. Yalnızca güncel ya da emin olmadığın bilgi gerektiğinde ara; genel bilgiyle cevaplanabilen sorularda arama yapma.
Web'den aldığın her bilgiyi, ilgili cümlenin sonunda kaynağın bağlantısıyla belirt: [site adı](sayfanın tam adresi). Arama sonuçlarında olmayan bir adres uydurma.`
const WEB_PROJECT_RULES = `Proje kaynakları ile web birlikte kullanılırken:
- Önce search_knowledge ile proje kaynaklarına bak; web'i tamamlayıcı olarak kullan.
- Cevapta ders materyalinden gelen bilgiyle ([K#] etiketli) web'den gelen bilgiyi (bağlantılı) açıkça ayır. İkisi çelişiyorsa bunu belirt.`

// OpenRouter hataları için anlaşılır Türkçe açıklama; tanınmayan hatalar olduğu gibi kalır.
function explainError(message, provider) {
  const m = /^HTTP (\d+): ?(.*)$/s.exec(String(message))
  if (!m || !isOpenRouter(provider)) return String(message)
  const tr = {
    401: 'OpenRouter API anahtarı geçersiz ya da eksik (Ayarlar → API ve model).',
    402: 'OpenRouter krediniz bu istek için yeterli değil.',
    403: 'OpenRouter bu isteğe izin vermedi (model ya da hesap ayarları kısıtlıyor olabilir).',
    408: 'OpenRouter isteği zaman aşımına uğradı; yeniden deneyin.',
    429: 'İstek sınırına ulaşıldı; biraz bekleyip yeniden deneyin.',
    502: 'Model sağlayıcısı şu an yanıt vermiyor; yeniden deneyin ya da başka bir model seçin.',
    503: 'Bu model için şu an uygun bir sağlayıcı yok; yeniden deneyin ya da başka bir model seçin.'
  }[m[1]]
  return tr ? `${tr} (${m[2].slice(0, 200) || 'HTTP ' + m[1]})` : String(message)
}

function buildSystem(s) {
  const mem = loadMemory()
  // Tarih kullanıcının yerel saat dilimine göredir; model güncel bilgi gerekip gerekmediğine buna bakarak karar verir.
  const parts = [`Bugünün tarihi: ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (saat dilimi: ${Intl.DateTimeFormat().resolvedOptions().timeZone}).`]
  if (s.systemPrompt && s.systemPrompt.trim()) parts.push('Kullanıcının kalıcı talimatları (her zaman uy):\n' + s.systemPrompt.trim())
  if (mem.enabled) parts.push('Not: Bu uygulamada kişisel hafızaya kayıt otomatik ve arka planda yapılır. Kullanıcı bir şeyi hatırlamanı isterse "kaydettim" veya "not ettim" gibi bir söz verme; normal şekilde cevap ver.')
  if (mem.enabled && mem.items.length) {
    parts.push('Kullanıcı hakkında hatırladıkların (kişisel hafıza). Yalnızca ilgili olduğunda ve doğal biçimde kullan; hafızadan bahsetme, gereksiz yere tekrar etme. Kaydetme işlemini uygulama arka planda kendisi yapar; sen asla "kaydettim/not ettim" deme:\n' + mem.items.map((i) => '- ' + i.text).join('\n'))
  }
  return parts.join('\n\n')
}

async function completeText(p, system, userText, signal) {
  let out = ''
  await streamChat({ provider: p, system, messages: [{ role: 'user', content: userText }], signal, onToken: (t) => { out += t } })
  return out
}

const EXTRACT_SYSTEM = `Bir kişisel hafıza yöneticisisin. Sana kullanıcının son mesajı, asistanın cevabı ve mevcut hafıza maddeleri verilecek.
Görevin: kullanıcının GELECEKTEKİ sohbetlerde de işine yarayacak kalıcı bilgileri çıkarmak: kişisel detaylar (ad, meslek, yer, aile, ilgi alanları), tercihler, devam eden projeler/önemli konular ve kullanıcının verdiği kalıcı talimatlar ("her zaman...", "bundan sonra...").
Kurallar:
- Tek seferlik görev içeriğini, soruların kendisini, geçici ayrıntıları KAYDETME.
- Parola, API anahtarı, kart/kimlik numarası gibi hassas verileri KAYDETME.
- Mevcut maddelerde zaten olan veya aynı anlama gelen bilgiyi tekrar etme.
- Her madde kısa, tek cümle, üçüncü şahıs olmadan ("Kullanıcı ..." ile başlayarak) ve kullanıcının dilinde olsun.
- Kaydedilecek bir şey yoksa boş dizi döndür.
YALNIZCA JSON string dizisi döndür, başka hiçbir şey yazma. Örn: ["Kullanıcı İstanbul'da yaşıyor."] veya []`

// OCR'ın "model" seçeneği: sayfa görseli sohbette seçili sağlayıcının modeline gönderilir, model yalnızca sayfadaki metni döndürür.
const OCR_PROMPT = 'Bu, taranmış bir belge sayfasının görüntüsü. Sayfadaki metni olduğu gibi, okuma sırasıyla yaz. Yorum, özet ya da açıklama ekleme; yalnızca sayfadaki metni döndür. Sayfada metin yoksa hiçbir şey yazma.'
async function ocrImage(pngBase64) {
  const s = withPlainKeys(loadSettings())
  const p = s.providers.find((x) => x.id === s.activeProvider)
  if (!p) throw new Error('Sağlayıcı bulunamadı.')
  const content = p.kind === 'anthropic'
    ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } }, { type: 'text', text: OCR_PROMPT }]
    : [{ type: 'text', text: OCR_PROMPT }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + pngBase64 } }]
  let out = ''
  await streamChat({ provider: p, messages: [{ role: 'user', content }], signal: AbortSignal.timeout(90000), onToken: (t) => { out += t } })
  return out
}

const withPlainKeys = (s) => ({ ...s, providers: s.providers.map((p) => ({ ...p, apiKey: dec(p.apiKey) })) })

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 560, backgroundColor: '#1B1E22',
    autoHideMenuBar: true,
    // macOS: başlık çubuğu gizli; trafik ışıkları kenar çubuğunun üst satırında durur (arayüzde .tl yer ayırır, bkz. styles.css).
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 28 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' } })
  if (process.env.VITE_DEV) win.loadURL('http://localhost:5173')
  else win.loadFile(path.join(__dirname, '../dist/index.html'))
}

const controllers = new Map()
// Onay bekleyen not önerileri: "<requestId>:<öneri id>" → sonucu araca ileten fonksiyon (bkz. note-tools.cjs).
const pendingNotes = new Map()
// Araç parametresini reddeden modeller ("sağlayıcı|model"): proje seçili olmayan sohbette create_note bir daha gönderilmez.
const noTools = new Set()
// Projeler, dosya arşivi ve arama indeksi (SQLite). Yerel modül yüklenemezse null kalır; uygulamanın geri kalanı çalışmaya devam eder.
let archive = null

app.whenReady().then(() => {
  ipcMain.handle('chats:load', () => readJson(chatsFile(), []))
  ipcMain.handle('chats:save', (_e, chats) => { writeJson(chatsFile(), chats) })
  ipcMain.handle('notes:load', () => readJson(notesFile(), []))
  // immediate: indeks beklemeden güncellenir (model az önce yazdığı notu aynı cevapta görebilsin).
  ipcMain.handle('notes:save', (_e, notes, immediate) => { writeJson(notesFile(), notes); archive?.syncNotes(notes, !!immediate) })
  ipcMain.handle('note:resolve', (_e, requestId, opId, result) => { pendingNotes.get(requestId + ':' + opId)?.(result) })

  // Renderer'a anahtar yerine "kayıtlı mı" bilgisi gider.
  ipcMain.handle('settings:load', () => {
    const s = loadSettings()
    return { ...s, providers: s.providers.map((p) => ({ ...p, apiKey: '', hasKey: !!p.apiKey })) }
  })
  ipcMain.handle('settings:save', (_e, incoming) => {
    const old = loadSettings()
    const next = {
      ...incoming,
      providers: incoming.providers.map((p) => {
        const prev = old.providers.find((o) => o.id === p.id)
        const { hasKey, ...rest } = p
        return { ...rest, apiKey: p.apiKey ? enc(p.apiKey) : prev ? prev.apiKey : '' }
      })
    }
    writeJson(settingsFile(), next)
    try { archive?.configure(next.archive) } catch (err) { console.error('[arşiv] ayar uygulanamadı:', err) }
  })
  ipcMain.handle('settings:clearKey', (_e, id) => {
    const s = loadSettings()
    s.providers = s.providers.map((p) => (p.id === id ? { ...p, apiKey: '' } : p))
    writeJson(settingsFile(), s)
  })

  ipcMain.handle('models:list', async (_e, providerId) => {
    const s = withPlainKeys(loadSettings())
    const p = s.providers.find((x) => x.id === providerId)
    if (!p) return []
    try { return await listModels(p) } catch { return [] }
  })

  ipcMain.handle('web:available', async (_e, providerId, model) => {
    const s = withPlainKeys(loadSettings())
    const p = s.providers.find((x) => x.id === providerId)
    try { return await webAvailability(p && { ...p, model: model || p.model }) } catch { return { ok: false, reason: WEB_ONLY_OPENROUTER } }
  })
  ipcMain.handle('open:external', (_e, url) => openExternal(url))

  ipcMain.on('chat:stream', async (e, { requestId, messages, providerId, model, reasoning, projectId, userText, sources, web, webSources }) => {
    const s = withPlainKeys(loadSettings())
    const p = s.providers.find((x) => x.id === providerId)
    const send = (ch, payload) => { if (!e.sender.isDestroyed()) e.sender.send(ch, { requestId, ...payload }) }
    if (!p) return send('chat:error', { message: 'Sağlayıcı bulunamadı.' })
    const ctrl = new AbortController()
    controllers.set(requestId, ctrl)
    const provider = { ...p, model: model || p.model }
    try {
      // Web araması: düğme açıksa ve sağlayıcı/model uygunsa araç isteğe eklenir; kapalıyken hiç gönderilmez.
      const useWeb = !!web && (await webAvailability(provider)).ok
      // [W#] etiketleri: aynı adres sohbet boyunca aynı numarayı alır (webSources sohbetin o ana kadarki listesi).
      const webList = (Array.isArray(webSources) ? webSources : []).filter((x) => x && Number.isInteger(x.n) && typeof x.url === 'string')
      const onAnnotations = (found) => {
        const ns = []
        for (const c of found) {
          let w = webList.find((x) => x.url === c.url)
          if (!w) { w = { n: webList.reduce((m, x) => Math.max(m, x.n), 0) + 1, url: c.url, title: c.title, content: c.content }; webList.push(w) }
          else { if (!w.title && c.title) w.title = c.title; if (c.content && c.content.length > (w.content || '').length) w.content = c.content }
          if (c.quote && !(w.quotes || []).includes(c.quote)) w.quotes = [...(w.quotes || []), c.quote].slice(-8)
          ns.push(w.n)
        }
        send('chat:web', { webSources: webList, ns })
      }
      let started = false
      const mark = (f) => (t) => { started = true; f(t) }
      const base = {
        provider, messages, signal: ctrl.signal, reasoning,
        onToken: mark((t) => send('chat:token', { token: t })),
        onThinking: mark((t) => send('chat:thinking', { token: t }))
      }
      // @proje seçiliyse model proje içinde araçlarla arar; proje silinmişse ya da arşiv açılamadıysa normal sohbet.
      const knowledge = projectId && archive ? require('./knowledge.cjs') : null
      const readNotes = () => readJson(notesFile(), [])
      const session = knowledge?.open(projectId, sources, readNotes)
      const emit = (ch, payload) => { started = true; send('chat:' + ch, payload) }
      // Not yazma araçları yalnızca araç destekleyen modellere gönderilir. Öneri arayüze gider, araç kullanıcının kararını bekler;
      // cevap durdurulursa öneri reddedilmiş sayılır.
      const toolKey = provider.baseUrl + '|' + provider.model
      const propose = (op) => new Promise((resolve) => {
        const id = crypto.randomUUID(), key = requestId + ':' + id
        const finish = (r) => { pendingNotes.delete(key); ctrl.signal.removeEventListener('abort', onAbort); resolve(r) }
        const onAbort = () => finish({ action: 'cancel' })
        if (ctrl.signal.aborted || e.sender.isDestroyed()) return resolve({ action: 'cancel' })
        ctrl.signal.addEventListener('abort', onAbort)
        pendingNotes.set(key, finish)
        emit('note', { op: { id, ...op } })
      })
      // Cevap sırasında yapılan alt model çağrıları (belge özetleme) da cevabın token ve maliyetine eklenir.
      const sub = { inputTokens: 0, outputTokens: 0, cost: null }
      const onUsage = (u) => { sub.inputTokens += u?.inputTokens || 0; sub.outputTokens += u?.outputTokens || 0; if (u?.cost != null) sub.cost = (sub.cost || 0) + u.cost }
      const notes = !noTools.has(toolKey) && (await supportsTools(provider))
        ? require('./note-tools.cjs').create({ onUsage, session, sources, readNotes, provider, signal: ctrl.signal, emit, propose, projects: archive ? archive.projectNames() : [], autoCreate: !!s.notes?.autoCreate })
        : null
      const go = (withWeb, withNotes) => {
        const system = [buildSystem(s), withWeb ? WEB_RULES : '', withWeb && session ? WEB_PROJECT_RULES : ''].filter(Boolean).join('\n\n')
        const b = withWeb ? { ...base, onAnnotations } : base
        if (session) return knowledge.streamWithKnowledge({ session, base: { ...b, ...(withWeb ? { serverTools: webSearch.toolsFor } : {}) }, system, userText, emit, notes: withNotes ? notes : null })
        // Proje seçili değilken: yalnızca create_note; araç döngüsü kısa tutulur.
        return withNotes
          ? streamWithTools({ ...b, system: system + '\n\n' + notes.rules, tools: notes.tools, maxRounds: 3, runTool: (call) => { started = true; return notes.run(call) }, ...(withWeb ? { serverTools: webSearch.toolsFor } : {}) })
          : streamChat({ ...b, system, ...(withWeb ? { serverTools: webSearch.toolsFor(0) } : {}) })
      }
      // Araç yüzünden reddedilen istek (henüz hiçbir şey akmadan 4xx) sırayla sadeleştirilerek yeniden denenir:
      // önce web araması çıkarılır, proje seçili değilse ardından not aracı. (Proje seçiliyken araçsız yedek yol knowledge.cjs'tedir.)
      const plans = [{ web: useWeb, notes: !!notes }]
      if (useWeb) plans.push({ web: false, notes: !!notes })
      if (notes && !session) plans.push({ web: false, notes: false })
      let usage, webNote, dropped = false
      for (let i = 0; ; i++) {
        try { usage = await go(plans[i].web, plans[i].notes); if (dropped) noTools.add(toolKey); break } catch (err) {
          if (i === plans.length - 1 || started || ctrl.signal.aborted || !/^HTTP (400|403|404|422)/.test(String(err && err.message))) throw err
          if (plans[i].web && !plans[i + 1].web) {
            console.error('[web] arama aracı reddedildi, aramasız deneniyor:', String(err && err.message))
            webNote = 'Web araması bu istekte kullanılamadı; cevap arama yapılmadan üretildi.'
          } else {
            console.error('[not] model araç parametresini reddetti, araçsız deneniyor:', String(err && err.message))
            dropped = true // araçsız deneme başarılı olursa bu model için hatırlanır
          }
        }
      }
      const n = Number(usage?.webSearches) || 0
      const cost = usage?.cost != null || sub.cost != null ? (usage?.cost || 0) + (sub.cost || 0) : null
      send('chat:done', { usage: { ...usage, inputTokens: (usage?.inputTokens || 0) + sub.inputTokens, outputTokens: (usage?.outputTokens || 0) + sub.outputTokens, ...(cost != null ? { cost } : {}), webSearches: n, ...(n ? { webCost: n * webSearch.PRICE_PER_SEARCH } : {}), ...(webNote ? { webNote } : {}) } })
    } catch (err) {
      if (ctrl.signal.aborted) send('chat:done', { aborted: true })
      else send('chat:error', { message: explainError(err && err.message ? err.message : err, provider) })
    } finally { controllers.delete(requestId) }
  })
  ipcMain.handle('memory:load', () => loadMemory())
  ipcMain.handle('memory:setEnabled', (_e, enabled) => { const m = loadMemory(); m.enabled = !!enabled; saveMemory(m); return m })
  ipcMain.handle('memory:add', (_e, text) => {
    const m = loadMemory(); const t = norm(text)
    if (t && !m.items.some((i) => i.text.toLowerCase() === t.toLowerCase())) m.items.unshift({ id: memId(), text: t, createdAt: Date.now() })
    m.items = m.items.slice(0, MAX_MEMORIES); saveMemory(m); return m
  })
  ipcMain.handle('memory:update', (_e, id, text) => {
    const m = loadMemory(); const t = norm(text)
    m.items = m.items.map((i) => (i.id === id && t ? { ...i, text: t } : i)); saveMemory(m); return m
  })
  ipcMain.handle('memory:delete', (_e, id) => { const m = loadMemory(); m.items = m.items.filter((i) => i.id !== id); saveMemory(m); return m })
  ipcMain.handle('memory:clear', () => { const m = loadMemory(); m.items = []; saveMemory(m); return m })

  // Her cevaptan sonra: sohbette kalıcı bir şey var mı? Varsa hafızaya ekle, eklenenleri döndür.
  ipcMain.handle('memory:extract', async (_e, { providerId, model, userText, assistantText }) => {
    try {
      if (!loadMemory().enabled) return { added: [] }
      const s = withPlainKeys(loadSettings())
      const p = s.providers.find((x) => x.id === providerId)
      if (!p) return { added: [] }
      const mem = loadMemory()
      const prompt = `MEVCUT HAFIZA:\n${mem.items.map((i) => '- ' + i.text).join('\n') || '(boş)'}\n\nKULLANICI MESAJI:\n${String(userText).slice(0, 4000)}\n\nASİSTAN CEVABI:\n${String(assistantText).slice(0, 1500)}`
      const raw = await completeText({ ...p, model: model || p.model }, EXTRACT_SYSTEM, prompt, AbortSignal.timeout(30000))
      const m = raw.match(/\[[\s\S]*\]/)
      if (!m) { console.log('[hafıza] JSON bulunamadı:', raw.slice(0, 300)); return { added: [], error: 'Model geçerli bir JSON döndürmedi.' } }
      const arr = JSON.parse(m[0])
      if (!Array.isArray(arr)) return { added: [] }
      const cur = loadMemory()
      const added = []
      for (const x of arr.slice(0, 5)) {
        const t = norm(typeof x === 'string' ? x : '')
        if (t && !cur.items.some((i) => i.text.toLowerCase() === t.toLowerCase()) && !added.includes(t)) added.push(t)
      }
      cur.items = [...added.map((text) => ({ id: memId(), text, createdAt: Date.now() })), ...cur.items].slice(0, MAX_MEMORIES)
      if (added.length) saveMemory(cur)
      return { added }
    } catch (err) { console.log('[hafıza] hata:', err); return { added: [], error: String(err && err.message ? err.message : err) } }
  })

  ipcMain.on('chat:abort', (_e, requestId) => controllers.get(requestId)?.abort())

  try {
    archive = require('./archive.cjs')
    // Quiz üretimi ve puanlaması da o an seçili sağlayıcı/modelle yapılır (anahtar yalnızca ana süreçte çözülür).
    const getProvider = (providerId, model) => { const p = withPlainKeys(loadSettings()).providers.find((x) => x.id === providerId); return p ? { ...p, model: model || p.model } : null }
    archive.register(dataDir(), { ocrImage, getProvider, explainError })
    archive.configure(loadSettings().archive)
    archive.syncNotes(readJson(notesFile(), []), true) // uygulama kapalıyken değişmiş/hiç indekslenmemiş notlar
  } catch (err) { archive = null; console.error('[arşiv] başlatılamadı:', err) }

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
