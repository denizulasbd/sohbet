// İki protokol: Anthropic Messages API ve OpenAI uyumlu (OpenRouter, OpenAI, Ollama, LM Studio, mlx_lm.server vb.)

async function* sseLines(res) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
}

async function failIfBad(res) {
  if (res.ok) return
  let detail = ''
  try { detail = await res.text() } catch {}
  try { const j = JSON.parse(detail); detail = j.error?.message || j.message || detail } catch {}
  throw new Error(`HTTP ${res.status}: ${detail.slice(0, 400)}`)
}

// ---- Düşünme (reasoning) ayarları -------------------------------------------------
// level = 'off' | 'low' | 'medium' | 'high' veya undefined (hiç istenmedi).
// Model adından tahmin yapılmaz: her seviye için denenecek parametre adayları sırayla döner, son aday hep parametresizdir.
// Sağlayıcı bir adayı 400/422 ile reddederse sıradaki denenir (bkz. streamChat).
const BUDGET = { low: 2048, medium: 8192, high: 16384 }

function anthropicReasoning(level) {
  const bare = { max_tokens: 4096 }
  if (!level) return [bare]
  if (level === 'off') return [
    { max_tokens: 8192, thinking: { type: 'disabled' } },
    { max_tokens: 8192, thinking: { type: 'between_tools' } }, // "disabled" kabul etmeyen modeller
    { max_tokens: 16000, output_config: { effort: 'low' } }, // düşünmesi kapatılamayan modeller
    bare
  ]
  const budget = BUDGET[level] || BUDGET.medium
  return [
    { max_tokens: 32000, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: level } }, // Claude 4.6+
    { max_tokens: budget + 4096, thinking: { type: 'enabled', budget_tokens: budget } }, // eski Claude
    bare
  ]
}

function openaiReasoning(provider, level) {
  if (!level) return [{}]
  if (String(provider.baseUrl || '').toLowerCase().includes('openrouter.ai')) {
    return [{ reasoning: { effort: level === 'off' ? 'none' : level } }, {}]
  }
  // "Kapalı": sunucu 'none' değerini tanımıyorsa kabul ettiği en düşük kademeye inilir.
  if (level === 'off') return [{ reasoning_effort: 'none' }, { reasoning_effort: 'minimal' }, { reasoning_effort: 'low' }, {}]
  return [{ reasoning_effort: level }, {}]
}

// Bazı modeller (DeepSeek-R1 türevleri, Qwen3, QwQ…) düşünceyi <think>…</think> etiketleriyle cevabın içinde akıtır.
// Etiketler parçalara bölünmüş gelebilir; bu yüzden olası yarım etiket sonda bekletilir.
function makeThinkSplitter(onText, onThink) {
  let inThink = false, buf = '', trimNext = false
  const tags = () => (inThink ? ['</think>', '</thinking>'] : ['<think>', '<thinking>'])
  const emit = (t) => {
    if (!t) return
    if (inThink) return onThink(t)
    if (trimNext) { t = t.replace(/^\s+/, ''); if (!t) return; trimNext = false }
    onText(t)
  }
  const drain = (final) => {
    for (;;) {
      const re = inThink ? /<\/think(ing)?>/ : /<think(ing)?>/
      const m = re.exec(buf)
      if (m) {
        emit(buf.slice(0, m.index))
        buf = buf.slice(m.index + m[0].length)
        if (inThink) trimNext = true
        inThink = !inThink
        continue
      }
      let keep = 0
      if (!final) {
        const lt = buf.lastIndexOf('<')
        if (lt >= 0 && tags().some((tg) => tg.startsWith(buf.slice(lt)))) keep = buf.length - lt
      }
      emit(buf.slice(0, buf.length - keep))
      buf = buf.slice(buf.length - keep)
      return
    }
  }
  return { push(t) { buf += t; drain(false) }, flush() { drain(true) } }
}

// OpenRouter sunucu araçlarının (ör. web araması) cevaba eklediği url_citation kaydı → { url, title, content, start, end }.
// Araç beta aşamasında: alan eksik ya da beklenmedik biçimdeyse kayıt atlanır, akış bozulmaz. Yalnızca http/https adresleri kabul edilir.
function citation(a) {
  try {
    const c = a && a.type === 'url_citation' ? a.url_citation || a : null
    if (!c || typeof c.url !== 'string') return null
    const u = new URL(c.url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
    const idx = (v) => (Number.isInteger(v) && v >= 0 ? v : 0)
    return { url: u.href, title: str(c.title, 300), content: str(c.content, 8000), start: idx(c.start_index), end: idx(c.end_index) }
  } catch { return null }
}

// Araçlar sağlayıcıdan bağımsız tanımlanır: [{ name, description, parameters (JSON Schema) }]. toolChoice: undefined (model karar verir) | 'none'.
// extra: istek gövdesine olduğu gibi eklenen parametreler (ör. response_format; bkz. completeJson).
// Akış fonksiyonları kullanım bilgisinin yanında toolCalls ([{ id, name, input }]) ve sonraki tura eklenecek asistan mesajını (assistant) döndürür.
async function streamAnthropic({ provider, system, messages, signal, onToken, onThinking, params, extra, tools, toolChoice }) {
  if (!provider.apiKey) throw new Error('Claude için API anahtarı girilmemiş (Ayarlar).')
  const toolParams = tools?.length ? {
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    ...(toolChoice ? { tool_choice: { type: toolChoice } } : {})
  } : {}
  const res = await fetch(provider.baseUrl.replace(/\/$/, '') + '/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: provider.model, stream: true, ...params, ...extra, ...toolParams, ...(system ? { system } : {}), messages })
  })
  await failIfBad(res)
  let out = 0, inp = 0
  // İçerik blokları sırasıyla biriktirilir: araç turlarında düşünme blokları (imzalarıyla) aynen geri gönderilmek zorundadır.
  const blocks = []
  for await (const data of sseLines(res)) {
    let ev; try { ev = JSON.parse(data) } catch { continue }
    if (ev.type === 'content_block_start' && ev.content_block) {
      blocks[ev.index] = { ...ev.content_block, ...(ev.content_block.type === 'tool_use' ? { input: {}, _json: '' } : {}) }
    }
    if (ev.type === 'content_block_delta') {
      const b = blocks[ev.index], d = ev.delta || {}
      if (d.type === 'text_delta') { onToken(d.text); if (b) b.text = (b.text || '') + d.text }
      else if (d.type === 'thinking_delta') { if (d.thinking) onThinking?.(d.thinking); if (b) b.thinking = (b.thinking || '') + (d.thinking || '') }
      else if (d.type === 'signature_delta') { if (b) b.signature = (b.signature || '') + (d.signature || '') }
      else if (d.type === 'input_json_delta') { if (b) b._json += d.partial_json || '' }
    }
    if (ev.type === 'content_block_stop') {
      const b = blocks[ev.index]
      if (b?.type === 'tool_use') { try { b.input = b._json ? JSON.parse(b._json) : {} } catch { b.input = {} } delete b._json }
    }
    // Giriş tokenleri (önbellekten okunan/yazılanlar dahil) message_start'ta gelir.
    if (ev.type === 'message_start' && ev.message?.usage) { const u = ev.message.usage; inp = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) }
    if (ev.type === 'message_delta' && ev.usage) out = ev.usage.output_tokens ?? out
    if (ev.type === 'error') throw new Error(ev.error?.message || 'Akış hatası')
  }
  const content = blocks.filter((b) => b && !(b.type === 'text' && !b.text)) // boş metin bloğu geri gönderilemez
  const toolCalls = content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }))
  return { outputTokens: out, inputTokens: inp, toolCalls, assistant: { role: 'assistant', content } }
}

// serverTools: sağlayıcının kendi çalıştırdığı araçlar (OpenRouter `openrouter:web_search`); isteğe olduğu gibi eklenir, tool_calls olarak geri dönmez.
// Sonuçları delta.annotations içinde gelir: onAnnotations(kayıtlar) ile bildirilir; metne bağlı olanlara ilgili metin parçası (quote) eklenir.
async function streamOpenAI({ provider, system, messages, signal, onToken, onThinking, params, extra, tools, toolChoice, serverTools, onAnnotations }) {
  const headers = { 'content-type': 'application/json' }
  if (provider.apiKey) headers.authorization = 'Bearer ' + provider.apiKey
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages
  const allTools = [...(tools || []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })), ...(serverTools || [])]
  const toolParams = allTools.length ? { tools: allTools, ...(toolChoice && tools?.length ? { tool_choice: toolChoice } : {}) } : {}
  const res = await fetch(provider.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', signal, headers,
    // OpenRouter: usage.include ile isteğin dolar karşılığı (usage.cost) da döner.
    body: JSON.stringify({ model: provider.model, messages: msgs, stream: true, stream_options: { include_usage: true }, ...(isOpenRouter(provider) ? { usage: { include: true } } : {}), ...params, ...extra, ...toolParams })
  })
  await failIfBad(res)
  let out = 0, inp = 0, cost, reasoningTokens = 0, webSearches = 0, text = ''
  const calls = [], details = [], anchored = []
  const searchCap = Number((serverTools || []).find((t) => t?.parameters?.max_uses > 0)?.parameters.max_uses) || Infinity
  const annotate = (list) => {
    if (!Array.isArray(list)) return
    const got = list.map(citation).filter(Boolean)
    for (const c of got) if (c.end > c.start) anchored.push(c)
    if (got.length) onAnnotations?.(got.map(({ url, title, content }) => ({ url, title, content })))
  }
  const split = makeThinkSplitter(onToken, (t) => onThinking?.(t))
  for await (const data of sseLines(res)) {
    if (data === '[DONE]') break
    let ev; try { ev = JSON.parse(data) } catch { continue }
    // OpenRouter akış ortasındaki hataları (ör. kredi bitti, sağlayıcı düştü) HTTP 200 içinde bir olay olarak gönderir.
    if (ev.error && !ev.choices?.[0]?.delta?.content) throw new Error(`HTTP ${Number(ev.error.code) || 500}: ${String(ev.error.message || 'Akış hatası').slice(0, 400)}`)
    annotate(ev.choices?.[0]?.message?.annotations)
    const d = ev.choices?.[0]?.delta
    if (d) {
      annotate(d.annotations)
      // DeepSeek/LM Studio: reasoning_content · Ollama/OpenRouter: reasoning · OpenRouter ayrıntılı: reasoning_details[]
      let th = typeof d.reasoning_content === 'string' ? d.reasoning_content : typeof d.reasoning === 'string' ? d.reasoning : ''
      if (!th && Array.isArray(d.reasoning_details)) th = d.reasoning_details.map((x) => x?.text || x?.summary || '').join('')
      if (th) onThinking?.(th)
      if (d.content) { text += d.content; split.push(d.content) }
      // Araç çağrıları parça parça gelir: kimlik ve ad ilk parçada, argümanlar (JSON metni) sonrakilerde.
      for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
        const c = (calls[tc.index ?? 0] ??= { id: '', name: '', args: '' })
        if (tc.id) c.id = tc.id
        if (tc.function?.name) c.name = tc.function.name
        if (typeof tc.function?.arguments === 'string') c.args += tc.function.arguments
      }
      // OpenRouter: düşünen modellerde araç turları arasında reasoning_details aynen geri gönderilmelidir.
      if (Array.isArray(d.reasoning_details)) d.reasoning_details.forEach((x, i) => {
        const cur = details[x?.index ?? i]
        if (!cur) { details[x?.index ?? i] = { ...x }; return }
        for (const k of ['text', 'summary', 'data']) if (typeof x[k] === 'string') cur[k] = (cur[k] || '') + x[k]
        if (x.signature) cur.signature = x.signature
      })
    }
    if (ev.usage?.completion_tokens) out = ev.usage.completion_tokens
    if (ev.usage?.prompt_tokens) inp = ev.usage.prompt_tokens
    if (typeof ev.usage?.cost === 'number' && ev.usage.cost >= 0) cost = ev.usage.cost // yalnızca fiyat bildiren sağlayıcılarda (OpenRouter)
    if (ev.usage?.completion_tokens_details?.reasoning_tokens) reasoningTokens = ev.usage.completion_tokens_details.reasoning_tokens
    // Belgede server_tool_use, gerçek yanıtlarda server_tool_use_details: ikisi de okunur.
    const ws = Number(ev.usage?.server_tool_use?.web_search_requests ?? ev.usage?.server_tool_use_details?.web_search_requests)
    // Sınırı aşan arama denemeleri de sayıya girer ama çalıştırılmaz ve ücretlendirilmez; sayı istekte verilen max_uses ile sınırlanır.
    if (ws > 0) webSearches = Math.min(ws, searchCap)
  }
  split.flush()
  // Konum bilgisi olan kayıtlar: bu turun metnindeki karşılığı bulunur (arayüz etiketi o parçanın sonuna koyar).
  const quoted = anchored.filter((c) => c.end <= text.length).map((c) => ({ url: c.url, title: c.title, content: c.content, quote: text.slice(c.start, c.end) })).filter((c) => c.quote.trim().length >= 8)
  if (quoted.length) onAnnotations?.(quoted)
  const made = calls.filter(Boolean).map((c, i) => ({ id: c.id || 'call_' + i, name: c.name, args: c.args || '{}' }))
  const toolCalls = made.map((c) => { let input = {}; try { input = JSON.parse(c.args) } catch {} return { id: c.id, name: c.name, input } })
  const assistant = { role: 'assistant', content: text, ...(made.length ? { tool_calls: made.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) } : {}) }
  if (details.some(Boolean)) assistant.reasoning_details = details.filter(Boolean)
  return { outputTokens: out, inputTokens: inp, ...(cost != null ? { cost } : {}), reasoningTokens, webSearches, toolCalls, assistant }
}

const run = (args) => (args.provider.kind === 'anthropic' ? streamAnthropic(args) : streamOpenAI(args))

// Adaylar sırayla denenir: sağlayıcı 400/422 dönerse ve henüz hiçbir şey akmadıysa sıradakine geçilir.
// Çalışan aday model + seviye başına hatırlanır; başka seviyeler ve düşünmeyle ilgisiz hatalar bundan etkilenmez.
const picked = new Map()
async function streamChat(args) {
  const { provider, reasoning: level } = args
  const list = provider.kind === 'anthropic' ? anthropicReasoning(level) : openaiReasoning(provider, level)
  const key = [provider.baseUrl, provider.model, level].join('|')
  const last = list.length - 1
  let started = false
  const wrap = (f) => f && ((t) => { started = true; f(t) })
  for (let i = Math.min(picked.get(key) || 0, last); ; i++) {
    try {
      const usage = await run({ ...args, onToken: wrap(args.onToken), onThinking: wrap(args.onThinking), params: list[i] })
      picked.set(key, i)
      // 'ignored': model seviyeyi kabul etmedi · 'lowest': kapatılamadı, en düşük kademe kullanıldı
      const note = !level || i === 0 ? undefined : level === 'off' ? (i < last ? 'lowest' : undefined) : i === last ? 'ignored' : undefined
      return note ? { ...usage, reasoningNote: note } : usage
    } catch (err) {
      const retry = i < last && !started && !args.signal?.aborted && /^HTTP (400|422)/.test(String(err && err.message))
      if (!retry) throw err
    }
  }
}

// Araç döngüsü: cevapta araç çağrısı olduğu sürece araç çalıştırılır, sonucu mesajlara eklenir ve model yeniden çağrılır.
// En fazla maxRounds araç turu; sınır dolunca model son bir kez araçsız (tool_choice: none) çağrılıp cevap yazdırılır.
// runTool(call) → modele dönecek metin. Dönen kullanım bilgisi turların toplamıdır.
// serverTools dizi ya da (o ana kadarki web araması sayısı) → dizi fonksiyonu olabilir: sunucu aracının sınırı istek başınadır,
// fonksiyon biçimi sınırın turlar arasında (cevap başına) tutulmasını sağlar. Son (araçsız) turda sunucu araçları da gönderilmez.
async function streamWithTools({ tools, runTool, maxRounds = 5, serverTools, ...args }) {
  const messages = [...args.messages]
  const total = { outputTokens: 0, inputTokens: 0, reasoningTokens: 0, webSearches: 0 }
  let note
  for (let round = 0; ; round++) {
    const final = round >= maxRounds
    let wrote = false
    let thought = false
    const server = final ? undefined : typeof serverTools === 'function' ? serverTools(total.webSearches) : serverTools
    const r = await streamChat({ ...args, messages, tools, serverTools: server, toolChoice: final ? 'none' : undefined, onToken: (t) => { wrote = true; args.onToken(t) }, onThinking: args.onThinking && ((t) => { thought = true; args.onThinking(t) }) })
    total.outputTokens += r.outputTokens || 0
    total.inputTokens += r.inputTokens || 0 // her turda konuşmanın tamamı yeniden gönderilir; ücretlendirilen giriş turların toplamıdır
    if (r.cost != null) total.cost = (total.cost || 0) + r.cost
    total.reasoningTokens += r.reasoningTokens || 0
    total.webSearches += r.webSearches || 0
    note = r.reasoningNote ?? note
    if (final || !r.toolCalls?.length) return { ...total, ...(note ? { reasoningNote: note } : {}) }
    messages.push(r.assistant)
    const results = []
    for (const call of r.toolCalls) results.push({ call, content: String(await runTool(call)) })
    if (args.provider.kind === 'anthropic') messages.push({ role: 'user', content: results.map((x) => ({ type: 'tool_result', tool_use_id: x.call.id, content: x.content })) })
    else for (const x of results) messages.push({ role: 'tool', tool_call_id: x.call.id, content: x.content })
    if (wrote) args.onToken('\n\n') // model aramadan önce bir şey yazdıysa cevapla bitişmesin
    if (thought) args.onThinking?.('\n\n') // turların düşünceleri de birbirine yapışmasın
  }
}

// Modelin desteklediği istek parametreleri. Yalnızca OpenRouter bunu bildirir (models API → supported_parameters);
// diğer sağlayıcılarda ve liste alınamadığında null döner (bilinmiyor).
const paramSupport = new Map()
const isOpenRouter = (p) => /^https:\/\/([a-z0-9-]+\.)?openrouter\.ai(\/|$)/i.test(String(p?.baseUrl || ''))
async function supportedParams(p) {
  if (!isOpenRouter(p)) return null
  try {
    let hit = paramSupport.get(p.baseUrl)
    if (!hit || Date.now() - hit.at > 3600000) {
      const r = await fetch(p.baseUrl.replace(/\/$/, '') + '/models', { headers: p.apiKey ? { authorization: 'Bearer ' + p.apiKey } : {}, signal: AbortSignal.timeout(8000) })
      if (!r.ok) return null
      hit = { at: Date.now(), models: new Map(((await r.json()).data || []).map((m) => [m.id, m.supported_parameters])) }
      paramSupport.set(p.baseUrl, hit)
    }
    const params = hit.models.get(p.model)
    return Array.isArray(params) ? params : null
  } catch { return null }
}
// Model araç çağrısını destekliyor mu? Bilinmiyorsa desteklendiği varsayılır, desteklemeyen model isteği reddedince yedek yola geçilir (bkz. knowledge.cjs).
async function supportsTools(p) {
  const params = await supportedParams(p)
  return !params || params.includes('tools')
}

// ---- yapılandırılmış (JSON) çıktı ----
// Cevap metninden JSON nesnesi: kod bloğu işaretleri ve nesnenin önündeki/arkasındaki yazı atılır.
function extractJson(text) {
  const t = String(text ?? '')
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('cevapta JSON nesnesi yok')
  return JSON.parse(t.slice(a, b + 1))
}
// Model response_format ile JSON şemasını destekliyorsa o kullanılır; sağlayıcı parametreyi reddederse (4xx) düz JSON istenir
// ve bu, model başına hatırlanır. Her iki yolda da çıktı parse(nesne) ile doğrulanır (geçersizse fırlatmalı):
// geçersiz çıktıda istek hatayla birlikte bir kez yinelenir, yine olmazsa invalid = true işaretli hata fırlatılır.
const noSchema = new Set()
// onUsage(kullanım): her model çağrısından sonra (yinelenen denemeler dahil) çağrılır.
async function completeJson({ provider, system, user, signal, name, jsonSchema, parse, onUsage }) {
  const key = provider.baseUrl + '|' + provider.model
  let structured = provider.kind !== 'anthropic' && !noSchema.has(key)
  if (structured) { const params = await supportedParams(provider); structured = !params || params.includes('structured_outputs') }
  const ask = async (prompt, withSchema) => {
    let out = ''
    const extra = provider.kind === 'anthropic' ? { max_tokens: 16000 }
      : withSchema ? { response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } } } : undefined
    onUsage?.(await streamChat({ provider, system, messages: [{ role: 'user', content: prompt }], signal, extra, onToken: (t) => { out += t } }))
    return out
  }
  let problem = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt ? `${user}\n\nÖnceki cevabın geçersizdi (${problem}). Yalnızca istenen biçimde, geçerli tek bir JSON nesnesi döndür.` : user
    let raw
    try { raw = await ask(prompt, structured) } catch (err) {
      if (!structured || signal?.aborted || !/^HTTP (400|404|422)/.test(String(err && err.message))) throw err
      structured = false; noSchema.add(key)
      raw = await ask(prompt, false)
    }
    try { return parse(extractJson(raw)) } catch (err) { problem = String(err && err.message ? err.message : err).replace(/\s+/g, ' ').slice(0, 300) }
  }
  console.error('[json] model geçerli çıktı üretemedi:', problem)
  throw Object.assign(new Error('Model geçerli bir çıktı üretemedi. Yeniden deneyin ya da başka bir model seçin.'), { invalid: true })
}

async function listModels(p) {
  if (p.kind === 'anthropic') {
    if (!p.apiKey) return []
    const r = await fetch(p.baseUrl.replace(/\/$/, '') + '/v1/models?limit=100', { headers: { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' } })
    if (!r.ok) return []
    return ((await r.json()).data || []).map((m) => m.id)
  }
  const headers = p.apiKey ? { authorization: 'Bearer ' + p.apiKey } : {}
  const r = await fetch(p.baseUrl.replace(/\/$/, '') + '/models', { headers })
  if (!r.ok) return []
  return ((await r.json()).data || []).map((m) => m.id).sort()
}

module.exports = { streamChat, streamWithTools, supportsTools, isOpenRouter, listModels, completeJson }
