// Projeler ve dosya arşivi: IPC uçları, dosya kopyalama ve metin çıkarma kuyruğu.
// Yüklenen dosya userData/files/<uuid>.<uzantı> altına kopyalanır; metin çıkarma ayrı süreçte (extract-worker.mjs) yapılır,
// sonuçları veritabanına yalnızca bu modül yazar.
const { BrowserWindow, dialog, ipcMain, utilityProcess } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { openDb } = require('./db.cjs')
const search = require('./search.cjs')
const jobs = require('./jobs.cjs')

// Desteklenen türler. Yeni tür eklemek: buraya uzantıyı, gerekiyorsa extract-worker.mjs'e çıkarıcıyı ekleyin
// (çıkarıcısı olmayan türler düz metin olarak okunur). Eski ikili biçimler (.doc, .ppt) desteklenmez.
const TYPES = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown', '.json': 'application/json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}
const KINDS = ['ders', 'kisisel']

let db, dataDir
const abs = (stored) => path.join(dataDir, stored)
const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
const broadcast = (payload) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('files:event', payload) }

const PROJECT_SQL = `SELECT p.id, p.name, p.kind, p.created_at AS createdAt,
  (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS fileCount FROM projects p`
const FILE_SQL = `SELECT f.id, f.project_id AS projectId, f.name, f.mime, f.size, f.page_count AS pageCount, f.status, f.error, f.created_at AS createdAt,
  (SELECT COUNT(*) FROM file_pages g WHERE g.file_id = f.id AND g.needs_ocr = 1) AS ocrPages FROM files f`
const getProject = (id) => db.prepare(PROJECT_SQL + ' WHERE p.id = ?').get(id)
const getFile = (id) => db.prepare(FILE_SQL + ' WHERE f.id = ?').get(id)
const storedPath = (id) => db.prepare('SELECT stored_path FROM files WHERE id = ?').pluck().get(id)
const unlink = (stored) => { try { fs.unlinkSync(abs(stored)) } catch {} }

function setStatus(id, status, error = null) {
  db.prepare('UPDATE files SET status = ?, error = ? WHERE id = ?').run(status, error, id)
  const file = getFile(id)
  if (file) broadcast({ type: 'changed', file })
}

// ---- metin çıkarma: işler jobs.cjs üzerinden yardımcı süreçte sırayla çalışır ----
async function processFile(id) {
  const row = db.prepare('SELECT stored_path, mime FROM files WHERE id = ?').get(id)
  if (!row) return
  try {
    const m = await jobs.run('extract', { path: abs(row.stored_path), mime: row.mime }, {
      pri: 1,
      onStart: () => { if (storedPath(id)) setStatus(id, 'processing') },
      onProgress: (p) => broadcast({ type: 'progress', id, page: p.page, total: p.total })
    })
    if (!storedPath(id)) return // dosya bu arada silinmiş; sonuç atılır
    db.transaction(() => {
      db.prepare('DELETE FROM file_pages WHERE file_id = ?').run(id)
      const ins = db.prepare('INSERT INTO file_pages (file_id, page, text, needs_ocr) VALUES (?, ?, ?, ?)')
      for (const p of m.pages) ins.run(id, p.page, p.text, p.needsOcr ? 1 : 0)
      db.prepare('UPDATE files SET page_count = ? WHERE id = ?').run(m.pageCount, id)
      search.indexFile(id, m.chunks || [])
    })()
    setStatus(id, 'ready')
    search.syncVectors()
    runOcr(id)
  } catch (err) { if (storedPath(id)) setStatus(id, 'error', String(err && err.message ? err.message : err).slice(0, 300) || 'Metin çıkarılamadı.') }
}
const enqueue = (id) => { processFile(id) }

// ---- OCR: metni çıkarılamayan (taranmış) PDF sayfaları ----
// file_pages.needs_ocr: 0 metin var · 1 OCR bekliyor · 2 OCR denendi, metin bulunamadı (yeniden denenmez)
// cfg.ocr: 'off' | 'local' (Tesseract, tur + eng) | 'model' (sayfa görseli seçili sağlayıcının modeline gönderilir)
let cfg = { ocr: 'local', semantic: false }
let ocrImage = null // (pngBase64) => Promise<string>; main.cjs sağlar
const ocrActive = new Set()

async function runOcr(fileId) {
  if (cfg.ocr === 'off' || ocrActive.has(fileId)) return
  const f = db.prepare("SELECT stored_path, mime FROM files WHERE id = ? AND status = 'ready'").get(fileId)
  if (!f || f.mime !== 'application/pdf') return
  const pages = db.prepare('SELECT page FROM file_pages WHERE file_id = ? AND needs_ocr = 1 ORDER BY page').pluck().all(fileId)
  if (!pages.length) return
  ocrActive.add(fileId)
  let done = 0, error = null
  try {
    for (const page of pages) {
      if (!storedPath(fileId) || cfg.ocr === 'off') break
      broadcast({ type: 'ocr', id: fileId, done, total: pages.length })
      let text
      if (cfg.ocr === 'model') {
        if (!ocrImage) throw new Error('Model ile OCR kullanılamıyor.')
        const { png } = await jobs.run('render', { path: abs(f.stored_path), page }, { pri: 4 })
        text = await ocrImage(png)
      } else {
        text = (await jobs.run('ocr', { path: abs(f.stored_path), page, cachePath: abs('tessdata') }, { pri: 4 })).text
      }
      text = String(text ?? '').replace(/\u0000/g, '').trim()
      db.prepare('UPDATE file_pages SET text = ?, needs_ocr = ? WHERE file_id = ? AND page = ?').run(text, text.replace(/\s/g, '').length >= 3 ? 0 : 2, fileId, page)
      done++
    }
  } catch (err) { error = String(err && err.message ? err.message : err).slice(0, 200) }
  finally {
    ocrActive.delete(fileId)
    if (storedPath(fileId)) {
      if (done) { try { search.reindexFile(fileId) } catch (err) { console.error('[arşiv] OCR sonrası indeksleme hatası:', err) } }
      broadcast({ type: 'ocr', id: fileId, done, total: pages.length, finished: true, ...(error ? { error } : {}) })
      broadcast({ type: 'changed', file: getFile(fileId) })
    }
  }
}
const runAllOcr = () => { for (const id of db.prepare('SELECT DISTINCT file_id FROM file_pages WHERE needs_ocr = 1').pluck().all()) runOcr(id) }

/** Ayarlar → Arşiv ve arama. Açılışta ve ayarlar kaydedilince çağrılır. */
function configure(a) {
  cfg = { ocr: ['off', 'local', 'model'].includes(a?.ocr) ? a.ocr : 'local', semantic: !!a?.semantic }
  search.setSemantic(cfg.semantic, abs('models'))
  runAllOcr()
}

// ---- işlemler ----
function addFiles(projectId, paths) {
  const added = [], rejected = []
  if (!getProject(projectId)) return { added, rejected }
  fs.mkdirSync(abs('files'), { recursive: true })
  for (const src of Array.isArray(paths) ? paths : []) {
    const name = path.basename(String(src))
    const ext = path.extname(name).toLowerCase()
    try {
      const st = fs.statSync(src)
      if (!TYPES[ext] || !st.isFile()) { rejected.push(name); continue }
      const id = crypto.randomUUID()
      const stored = path.join('files', id + ext)
      fs.copyFileSync(src, abs(stored))
      db.prepare('INSERT INTO files (id, project_id, name, stored_path, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, projectId, name, stored, TYPES[ext], st.size, Date.now())
      added.push(getFile(id))
      enqueue(id)
    } catch { rejected.push(name) }
  }
  return { added, rejected }
}

function deleteFile(id) {
  const stored = storedPath(id)
  if (!stored) return
  db.prepare('DELETE FROM files WHERE id = ?').run(id)
  unlink(stored)
}

function deleteProject(id) {
  const stored = db.prepare('SELECT stored_path FROM files WHERE project_id = ?').pluck().all(id)
  db.prepare('DELETE FROM projects WHERE id = ?').run(id) // dosya ve sayfa satırları CASCADE ile gider
  stored.forEach(unlink)
}

function register(dir, opts = {}) {
  ocrImage = opts.ocrImage || null
  dataDir = dir
  db = openDb(dir)
  search.init(db)
  require('./calendar.cjs').register(db)
  require('./trackers.cjs').register(db)
  require('./today.cjs').register(db)
  // Önceki oturumda yarım kalan işler yeniden sıraya alınır.
  db.prepare("UPDATE files SET status = 'queued', error = NULL WHERE status = 'processing'").run()
  for (const id of db.prepare("SELECT id FROM files WHERE status = 'queued' ORDER BY created_at").pluck().all()) enqueue(id)

  ipcMain.handle('projects:list', () => db.prepare(PROJECT_SQL + ' ORDER BY p.name COLLATE NOCASE').all())
  ipcMain.handle('projects:create', (_e, { name, kind } = {}) => {
    const id = crypto.randomUUID()
    db.prepare('INSERT INTO projects (id, name, kind, created_at) VALUES (?, ?, ?, ?)').run(id, cleanName(name) || 'Yeni proje', KINDS.includes(kind) ? kind : 'ders', Date.now())
    return getProject(id)
  })
  ipcMain.handle('projects:update', (_e, id, patch = {}) => {
    const name = cleanName(patch.name)
    if (name) db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id)
    if (KINDS.includes(patch.kind)) db.prepare('UPDATE projects SET kind = ? WHERE id = ?').run(patch.kind, id)
    return getProject(id) ?? null
  })
  ipcMain.handle('projects:delete', (_e, id) => { deleteProject(id) })

  // projectId null: tüm projelerin dosyaları (projesiz notlardaki bağlantılar için)
  ipcMain.handle('files:list', (_e, projectId) => projectId == null
    ? db.prepare(FILE_SQL + ' ORDER BY f.name COLLATE NOCASE').all()
    : db.prepare(FILE_SQL + ' WHERE f.project_id = ? ORDER BY f.created_at DESC, f.name').all(projectId))
  ipcMain.handle('files:get', (_e, id) => getFile(id) ?? null)
  // Görüntüleyici için: dosyanın uygulama içindeki kopyası (PDF) ya da çıkarılmış metni (diğer türler)
  ipcMain.handle('files:read', async (_e, id) => {
    const stored = storedPath(id)
    if (!stored) return null
    try { return new Uint8Array(await fs.promises.readFile(abs(stored))) } catch { return null }
  })
  ipcMain.handle('files:text', (_e, id) => search.filePages(id, null).map((r) => ({ page: r.page, text: r.text, needsOcr: !!r.needsOcr })))
  ipcMain.handle('search:related', (_e, projectId, text, limit) => search.relatedSources(projectId, text, limit))
  ipcMain.handle('files:add', (_e, projectId, paths) => addFiles(projectId, paths))
  ipcMain.handle('files:pick', async (e, projectId) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win, {
      title: 'Dosya ekle', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Belgeler (PDF, Word, PowerPoint, TXT, MD, JSON)', extensions: Object.keys(TYPES).map((x) => x.slice(1)) }]
    })
    return r.canceled ? { added: [], rejected: [] } : addFiles(projectId, r.filePaths)
  })
  ipcMain.handle('files:delete', (_e, id) => { deleteFile(id) })
  // Not revizyonları: model bir nota dokunmadan önce arayüz notun o anki halini buraya yazar ("Geri al" için). Not başına son 30 revizyon tutulur.
  ipcMain.handle('notes:revisionAdd', (_e, r = {}) => {
    if (typeof r.noteId !== 'string' || typeof r.body !== 'string') return null
    const id = db.prepare('INSERT INTO note_revisions (note_id, title, body, reason, chat_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.noteId, String(r.title ?? ''), r.body, r.reason === 'edit' ? 'edit' : 'append', typeof r.chatId === 'string' ? r.chatId : null, Date.now()).lastInsertRowid
    db.prepare('DELETE FROM note_revisions WHERE note_id = ? AND id NOT IN (SELECT id FROM note_revisions WHERE note_id = ? ORDER BY id DESC LIMIT 30)').run(r.noteId, r.noteId)
    return Number(id)
  })
  ipcMain.handle('notes:revisionGet', (_e, id) => db.prepare('SELECT id, note_id AS noteId, title, body, reason, created_at AS createdAt FROM note_revisions WHERE id = ?').get(Number(id)) ?? null)
  ipcMain.handle('search:knowledge', (_e, projectId, query, limit) => search.searchHybrid(projectId, query, limit))
  require('./quiz.cjs').register(db, { getProvider: opts.getProvider, explainError: opts.explainError })
  ipcMain.handle('archive:status', () => ({
    ocr: { mode: cfg.ocr, pending: db.prepare('SELECT COUNT(*) FROM file_pages WHERE needs_ocr = 1').pluck().get(), running: ocrActive.size > 0 },
    semantic: search.semanticStatus()
  }))

  search.backfillFiles()
}

/** Not yazma araçları için: model projeyi adıyla verir, eşleştirme uygulamada yapılır. */
const projectNames = () => (db ? db.prepare('SELECT id, name FROM projects ORDER BY name COLLATE NOCASE').all() : [])

module.exports = { register, configure, syncNotes: search.syncNotes, projectNames }
