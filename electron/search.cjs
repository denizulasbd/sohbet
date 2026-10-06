// Arama indeksi: dosya ve not parçaları (chunks) + FTS5 trigram araması. Veritabanına yalnızca ana süreç yazar.
const { chunkPages, normalize } = require('./chunker.cjs')
const jobs = require('./jobs.cjs')

const NOTE_DEBOUNCE_MS = 2000
// Gömme modeli: değişirse tüm vektörler silinip yeniden hesaplanır (adı meta tablosunda saklanır).
const EMBED_MODEL = 'Xenova/multilingual-e5-small'
const EMBED_DIM = 384
const RRF_K = 60
let db
let vecOk = false, semantic = false, modelsDir = null, vecBusy = false, vecError = null

function init(database) {
  db = database
  // Paketlenmiş uygulamada uzantı app.asar içinden yüklenemez; açılmış kopyası (app.asar.unpacked) kullanılır.
  try { db.loadExtension(require('sqlite-vec').getLoadablePath().replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')); vecOk = true } catch (err) { console.error('[arama] sqlite-vec yüklenemedi; anlamsal arama kullanılamaz:', err) }
}

function replaceChunks(type, id, projectId, chunks) {
  db.prepare('DELETE FROM chunks WHERE source_type = ? AND source_id = ?').run(type, id)
  const ins = db.prepare('INSERT INTO chunks (project_id, source_type, source_id, page, heading, text, norm_text) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const c of chunks) if (c.norm) ins.run(projectId, type, id, c.page, c.heading, c.text, c.norm)
}

// ---- anlamsal arama: vektörler ----
/** Ayarlardan açılıp kapatılır. dir: modelin indirilip saklanacağı klasör. */
function setSemantic(on, dir) {
  modelsDir = dir
  semantic = !!on && vecOk
  jobs.setIdleMs(semantic ? 600000 : 30000)
  if (!semantic) return
  try {
    const cur = db.prepare("SELECT value FROM meta WHERE key = 'embed_model'").pluck().get()
    if (cur !== EMBED_MODEL) {
      db.exec('DROP TABLE IF EXISTS chunk_vec')
      db.prepare('UPDATE chunks SET embedded = 0').run()
      db.prepare("INSERT INTO meta (key, value) VALUES ('embed_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(EMBED_MODEL)
    }
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(project_id TEXT partition key, embedding float[${EMBED_DIM}] distance_metric=cosine)`)
  } catch (err) { semantic = false; vecError = String(err && err.message ? err.message : err); return }
  syncVectors()
}

/** Vektörü olmayan parçaları arka planda gömer. Parçalar her değiştiğinde çağrılır; aynı anda tek kopya çalışır. */
async function syncVectors() {
  if (!semantic || vecBusy) return
  vecBusy = true
  try {
    // silinmiş ya da içeriği değişmiş parçaların eski vektörleri
    db.prepare('DELETE FROM chunk_vec WHERE rowid NOT IN (SELECT id FROM chunks WHERE embedded = 1)').run()
    while (semantic) {
      const rows = db.prepare('SELECT id, project_id, text FROM chunks WHERE embedded = 0 ORDER BY id LIMIT 8').all()
      if (!rows.length) break
      const { vectors } = await jobs.run('embed', { model: EMBED_MODEL, cacheDir: modelsDir, texts: rows.map((r) => 'passage: ' + r.text.slice(0, 2000)) }, { pri: 3 })
      vecError = null
      db.transaction(() => {
        const still = db.prepare('SELECT text, project_id FROM chunks WHERE id = ? AND embedded = 0')
        rows.forEach((r, i) => {
          const now = still.get(r.id)
          if (!now || now.text !== r.text) return // bu arada silinmiş ya da değişmiş
          db.prepare('DELETE FROM chunk_vec WHERE rowid = ?').run(BigInt(r.id))
          db.prepare('INSERT INTO chunk_vec (rowid, project_id, embedding) VALUES (?, ?, ?)').run(BigInt(r.id), now.project_id ?? '', new Float32Array(vectors[i]))
          db.prepare('UPDATE chunks SET embedded = 1 WHERE id = ?').run(r.id)
        })
      })()
    }
  } catch (err) { vecError = String(err && err.message ? err.message : err); console.error('[arama] gömme hatası:', err) }
  finally { vecBusy = false }
}

function semanticStatus() {
  const n = db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(embedded), 0) AS embedded FROM chunks').get()
  return { available: vecOk, enabled: semantic, busy: vecBusy, total: n.total, embedded: semantic ? n.embedded : 0, error: vecError, model: EMBED_MODEL }
}

// ---- dosyalar ----
/** İşçiden gelen parçaları yazar (çağıran taraf transaction içinde olmalı). */
function indexFile(fileId, chunks) {
  const projectId = db.prepare('SELECT project_id FROM files WHERE id = ?').pluck().get(fileId)
  if (projectId) replaceChunks('file', fileId, projectId, chunks)
}
/** Dosyayı saklanan sayfa metinlerinden yeniden parçalar (ör. OCR yeni metin ekledikten sonra). */
function reindexFile(fileId) {
  const paged = db.prepare('SELECT page_count FROM files WHERE id = ?').pluck().get(fileId) != null
  const pages = db.prepare('SELECT page, text FROM file_pages WHERE file_id = ? ORDER BY page').all(fileId)
  db.transaction(() => indexFile(fileId, chunkPages(pages, paged)))()
  syncVectors()
}

/** İndeks eklenmeden önce işlenmiş dosyalar: saklanan sayfa metinlerinden parçalar üretilir (dosya yeniden okunmaz). */
function backfillFiles() {
  const todo = db.prepare(`SELECT f.id, f.page_count FROM files f WHERE f.status = 'ready'
    AND EXISTS (SELECT 1 FROM file_pages g WHERE g.file_id = f.id AND g.text <> '')
    AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source_type = 'file' AND c.source_id = f.id)`).all()
  const next = () => {
    const f = todo.shift()
    if (!f) return
    try {
      const pages = db.prepare('SELECT page, text FROM file_pages WHERE file_id = ? ORDER BY page').all(f.id)
      db.transaction(() => indexFile(f.id, chunkPages(pages, f.page_count != null)))()
    } catch (err) { console.error('[arama] dosya indekslenemedi:', err) }
    setImmediate(next) // dosyalar arasında ana sürecin olay döngüsüne nefes aldır
  }
  next()
  syncVectors()
}

// ---- notlar ----
// Notlar notes.json'da durur; burada yalnızca parçaları ve hangi sürümün indekslendiği (note_index) tutulur.
const stripMarks = (s) => String(s ?? '').replace(/\*+/g, '')
function noteTitle(n) {
  const first = stripMarks(n.body).split('\n').map((l) => l.trim().replace(/^(☐|☑|•)\s+/, '')).find(Boolean)
  return (String(n.title ?? '').trim() || first || 'Yeni not').slice(0, 80)
}

// [[dosya adı#sayfa]] bağlantıları: ad önce notun kendi projesinde, bulunamazsa tüm dosyalarda aranır. Sözdizimi src/links.ts ile aynı olmalı.
const LINK = /\[\[([^\[\]\n]+?)(?:#(\d+))?\]\]/g
function writeLinks(noteId, projectId, body) {
  db.prepare('DELETE FROM links WHERE note_id = ?').run(noteId)
  const find = db.prepare('SELECT id FROM files WHERE name = ? COLLATE NOCASE ORDER BY (project_id IS ?) DESC, created_at LIMIT 1').pluck()
  const ins = db.prepare('INSERT INTO links (note_id, file_id, page) VALUES (?, ?, ?)')
  const seen = new Set()
  for (const m of body.matchAll(LINK)) {
    const fileId = find.get(m[1].trim(), projectId)
    const page = m[2] ? Number(m[2]) : null
    if (!fileId || seen.has(fileId + '#' + page)) continue
    seen.add(fileId + '#' + page)
    ins.run(noteId, fileId, page)
  }
}

function indexNotes(notes) {
  const known = new Map(db.prepare('SELECT note_id, project_id, title, updated_at, created_by FROM note_index').all().map((r) => [r.note_id, r]))
  db.transaction(() => {
    for (const n of Array.isArray(notes) ? notes : []) {
      if (!n || typeof n.id !== 'string') continue
      const title = noteTitle(n), projectId = n.projectId ?? null, updatedAt = Number(n.updatedAt) || 0
      const createdBy = n.createdBy === 'ai' ? 'ai' : null
      const old = known.get(n.id)
      known.delete(n.id)
      if (old && old.updated_at === updatedAt && old.project_id === projectId && old.title === title && old.created_by === createdBy) continue
      const text = [String(n.title ?? '').trim(), stripMarks(n.body).trim()].filter(Boolean).join('\n\n')
      replaceChunks('note', n.id, projectId, chunkPages([{ page: 1, text }], false))
      writeLinks(n.id, projectId, String(n.body ?? ''))
      db.prepare(`INSERT INTO note_index (note_id, project_id, title, updated_at, created_by) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(note_id) DO UPDATE SET project_id = excluded.project_id, title = excluded.title, updated_at = excluded.updated_at, created_by = excluded.created_by`).run(n.id, projectId, title, updatedAt, createdBy)
    }
    for (const id of known.keys()) { // silinen notlar
      db.prepare("DELETE FROM chunks WHERE source_type = 'note' AND source_id = ?").run(id)
      db.prepare('DELETE FROM note_index WHERE note_id = ?').run(id)
      db.prepare('DELETE FROM links WHERE note_id = ?').run(id)
      db.prepare('DELETE FROM note_revisions WHERE note_id = ?').run(id)
    }
  })()
}

let pendingNotes = null, noteTimer = null
/** Notlar her kaydedildiğinde çağrılır; yeniden indeksleme son kayıttan ~2 sn sonra bir kez yapılır. */
function syncNotes(notes, immediate = false) {
  pendingNotes = notes
  clearTimeout(noteTimer)
  const run = () => { const n = pendingNotes; pendingNotes = null; try { indexNotes(n); syncVectors() } catch (err) { console.error('[arama] notlar indekslenemedi:', err) } }
  if (immediate) run(); else noteTimer = setTimeout(run, NOTE_DEBOUNCE_MS)
}

// ---- arama ----
const HIT_SQL = `SELECT c.id AS chunkId, c.source_type AS sourceType, c.source_id AS sourceId,
  COALESCE(f.name, n.title, '') AS sourceName, c.page, c.text, n.created_by AS createdBy
  FROM chunks c
  LEFT JOIN files f ON c.source_type = 'file' AND f.id = c.source_id
  LEFT JOIN note_index n ON c.source_type = 'note' AND n.note_id = c.source_id`
const likeArg = (t) => '%' + t.replace(/[\\%_]/g, '\\$&') + '%'
// FTS5 sorgu sözdizimi kullanıcıya/modele açılmaz: her terim tırnak içinde düz dizgi olarak verilir.
const quote = (t) => '"' + t.replace(/"/g, '""') + '"'

/** Seçili projede notlar ve dosyalar içinde arar; bm25 ile sıralar. Hata durumunda boş dizi döner, asla fırlatmaz.
 *  Önce tüm terimleri içeren parçalar gelir; sonuç azsa terimlerden herhangi birini içerenlerle tamamlanır. */
function searchKnowledge(projectId, query, limit = 8) {
  try {
    if (!db || typeof projectId !== 'string') return []
    const max = Math.min(Math.max(Number(limit) || 8, 1), 50)
    const terms = [...new Set(normalize(String(query ?? '').slice(0, 500)).replace(/\u0000/g, '').split(' ').filter(Boolean))].slice(0, 16)
    if (!terms.length) return []
    // Trigram tokenizer 3 karakterden kısa terimi eşleştiremez; kısa terimler LIKE ile aranır.
    const long = terms.filter((t) => [...t].length >= 3), short = terms.filter((t) => [...t].length < 3)
    const likes = short.map(() => " AND c.norm_text LIKE ? ESCAPE '\\'").join('')
    const likeArgs = short.map(likeArg)
    if (!long.length) {
      return db.prepare(`${HIT_SQL} WHERE c.project_id = ?${likes} ORDER BY c.source_type DESC, c.source_id, c.page, c.id LIMIT ?`).all(projectId, ...likeArgs, max)
    }
    const fts = (match, extra, args, n) => db.prepare(`${HIT_SQL} JOIN chunks_fts ON chunks_fts.rowid = c.id
      WHERE chunks_fts MATCH ? AND c.project_id = ?${extra} ORDER BY bm25(chunks_fts) LIMIT ?`).all(match, projectId, ...args, n)
    const hits = fts(long.map(quote).join(' AND '), likes, likeArgs, max)
    if (hits.length < max && terms.length > 1) {
      const seen = new Set(hits.map((h) => h.chunkId))
      for (const h of fts(long.map(quote).join(' OR '), '', [], max + hits.length)) {
        if (hits.length >= max) break
        if (!seen.has(h.chunkId)) hits.push(h)
      }
    }
    return hits
  } catch (err) { console.error('[arama] sorgu hatası:', err); return [] }
}

/** Karma arama: FTS (kelime eşleşmesi) ve vektör (anlam) sonuçları Reciprocal Rank Fusion ile birleştirilir.
 *  Anlamsal arama kapalıysa, model hazır değilse ya da gömme zaman aşımına uğrarsa yalnızca FTS sonuçları döner. */
async function searchHybrid(projectId, query, limit = 8) {
  const max = Math.min(Math.max(Number(limit) || 8, 1), 50)
  const q = String(query ?? '').trim().slice(0, 500)
  if (!semantic || !q || typeof projectId !== 'string') return searchKnowledge(projectId, q, max)
  const fts = searchKnowledge(projectId, q, Math.max(20, max))
  try {
    const timeout = new Promise((_r, reject) => setTimeout(() => reject(new Error('zaman aşımı')), 20000))
    const { vectors } = await Promise.race([jobs.run('embed', { model: EMBED_MODEL, cacheDir: modelsDir, texts: ['query: ' + q] }, { pri: 0 }), timeout])
    const knn = db.prepare('SELECT rowid FROM chunk_vec WHERE embedding MATCH ? AND project_id = ? AND k = ?').pluck().all(new Float32Array(vectors[0]), projectId, Math.max(20, max))
    if (!knn.length) return fts.slice(0, max)
    const score = new Map()
    const add = (id, rank) => score.set(id, (score.get(id) || 0) + 1 / (RRF_K + rank + 1))
    fts.forEach((h, i) => add(h.chunkId, i))
    knn.forEach((id, i) => add(Number(id), i))
    const ids = [...score].sort((a, b) => b[1] - a[1]).slice(0, max).map((x) => x[0])
    const rows = new Map(db.prepare(`${HIT_SQL} WHERE c.id IN (${ids.map(() => '?').join(',')}) AND c.project_id = ?`).all(...ids, projectId).map((r) => [r.chunkId, r]))
    return ids.map((id) => rows.get(id)).filter(Boolean)
  } catch (err) { console.error('[arama] anlamsal arama atlandı:', err && err.message); return fts.slice(0, max) }
}

/** Quiz için: arama yapmadan, kaynaklara (dosya/not) ve her kaynağın içinde baştan sona dengeli dağılan en fazla limit parça.
 *  sources: null → tüm proje; yoksa [{ type, id }]. Kısa parçalar (başlık, tek satır) mümkünse atlanır. */
function sampleChunks(projectId, sources, limit = 30, rnd = Math.random) {
  if (!db || typeof projectId !== 'string') return []
  const only = Array.isArray(sources) && sources.length ? new Set(sources.map((s) => s.type + ':' + s.id)) : null
  const all = db.prepare('SELECT id, source_type AS t, source_id AS s, length(text) AS len FROM chunks WHERE project_id = ? ORDER BY source_type, source_id, page, id').all(projectId)
    .filter((r) => !only || only.has(r.t + ':' + r.s))
  const long = all.filter((r) => r.len >= 200)
  const groups = new Map()
  for (const r of long.length ? long : all) { const k = r.t + ':' + r.s; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r.id) }
  // Pay: küçük kaynaklar tamamını verir, kalan hak büyüklere eşit bölünür.
  const lists = [...groups.values()].sort((a, b) => a.length - b.length)
  let left = Math.min(Math.max(Number(limit) || 30, 1), 60)
  const ids = []
  lists.forEach((list, i) => {
    const k = Math.min(list.length, Math.floor(left / (lists.length - i)))
    left -= k
    const off = rnd()
    for (let j = 0; j < k; j++) ids.push(list[Math.min(list.length - 1, Math.floor(((j + off) * list.length) / k))])
  })
  if (!ids.length) return []
  return db.prepare(`${HIT_SQL} WHERE c.id IN (${ids.map(() => '?').join(',')}) ORDER BY c.source_type, c.source_id, c.page, c.id`).all(...ids)
}

// "İlgili kaynaklar": notun metnindeki belirgin terimlerle aynı projedeki dosyalarda arama (sayfa başına tek sonuç).
const STOP = new Set(['için', 'veya', 'olarak', 'gibi', 'daha', 'kadar', 'ancak', 'sonra', 'önce', 'olan', 'bunu', 'buna', 'bunun', 'şekilde', 'ile', 'ise', 'ama', 'çok', 'her', 'hem', 'değil', 'vardir', 'vardır', 'olur', 'eder', 'the', 'and', 'for', 'with', 'that', 'this'].map((w) => normalize(w)))
function relatedSources(projectId, text, limit = 5) {
  try {
    if (!db || typeof projectId !== 'string') return { hits: [], query: '' }
    const count = new Map()
    for (const w of normalize(String(text ?? '').slice(0, 20000)).split(/[^\p{L}\p{N}]+/u)) {
      if ([...w].length >= 4 && !STOP.has(w)) count.set(w, (count.get(w) || 0) + 1)
    }
    const terms = [...count].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, 10).map((x) => x[0])
    if (!terms.length) return { hits: [], query: '' }
    const max = Math.min(Math.max(Number(limit) || 5, 1), 20)
    const rows = db.prepare(`${HIT_SQL} JOIN chunks_fts ON chunks_fts.rowid = c.id
      WHERE chunks_fts MATCH ? AND c.project_id = ? AND c.source_type = 'file' ORDER BY bm25(chunks_fts) LIMIT ?`).all(terms.map(quote).join(' OR '), projectId, max * 4)
    const seen = new Set(), hits = []
    for (const r of rows) {
      const k = r.sourceId + '#' + r.page
      if (seen.has(k)) continue
      seen.add(k); hits.push(r)
      if (hits.length >= max) break
    }
    return { hits, query: terms.join(' ') }
  } catch (err) { console.error('[arama] ilgili kaynaklar hatası:', err); return { hits: [], query: '' } }
}

// ---- kaynak okuma (araçlar için) ----
/** Projenin adı ve aranabilir kaynakları; proje yoksa null. */
function projectInfo(projectId) {
  const name = db.prepare('SELECT name FROM projects WHERE id = ?').pluck().get(projectId)
  if (name == null) return null
  return {
    name,
    files: db.prepare("SELECT id, name, mime, page_count AS pageCount FROM files WHERE project_id = ? AND status = 'ready' ORDER BY name COLLATE NOCASE").all(projectId),
    notes: db.prepare('SELECT note_id AS id, title, created_by AS createdBy FROM note_index WHERE project_id = ? ORDER BY title COLLATE NOCASE').all(projectId)
  }
}
/** pages: null → tümü; yoksa [başlangıç, bitiş] aralıkları. */
function filePages(fileId, ranges) {
  const rows = db.prepare('SELECT page, text, needs_ocr AS needsOcr FROM file_pages WHERE file_id = ? ORDER BY page').all(fileId)
  return ranges ? rows.filter((r) => ranges.some(([a, b]) => r.page >= a && r.page <= b)) : rows
}

module.exports = { init, indexFile, reindexFile, backfillFiles, syncNotes, syncVectors, setSemantic, semanticStatus, searchKnowledge, searchHybrid, sampleChunks, relatedSources, projectInfo, filePages }
