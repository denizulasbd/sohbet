// Ağır işler (metin çıkarma, OCR, gömme) tek bir yardımcı süreçte (extract-worker.mjs) sırayla çalışır;
// ana süreç ve arayüz bloklanmaz. İşler önceliğe göre sıralanır: küçük sayı önce (0 sorgu gömme · 1 metin çıkarma · 3 parça gömme · 4 OCR).
const { utilityProcess } = require('electron')
const path = require('path')

const jobs = []
let worker = null, running = null, idle = null, seq = 0, idleMs = 30000

function ensureWorker() {
  if (worker) return worker
  const w = utilityProcess.fork(path.join(__dirname, 'extract-worker.mjs'), [], { serviceName: 'Sohbet arka plan işleri' })
  w.on('message', (m) => {
    if (!running || m.jid !== running.jid) return
    if (m.type === 'progress') { running.onProgress?.(m); return }
    const j = running
    running = null
    if (m.type === 'done') j.resolve(m); else j.reject(new Error(m.message || 'İşlem başarısız.'))
    pump()
  })
  w.on('exit', () => {
    if (worker === w) worker = null
    if (running) { const j = running; running = null; j.reject(new Error('Arka plan işlemi beklenmedik şekilde durdu.')) }
    pump()
  })
  return (worker = w)
}

function pump() {
  clearTimeout(idle)
  if (running) return
  const j = jobs.shift()
  if (!j) { idle = setTimeout(() => { if (!running && worker) worker.kill() }, idleMs); return } // boşta kalan işçi kapatılır
  running = j
  try { j.onStart?.() } catch {}
  ensureWorker().postMessage({ jid: j.jid, kind: j.kind, ...j.payload })
}

/** İşi sıraya koyar; işçinin 'done' mesajıyla çözülür, hata ya da işçinin ölmesiyle reddedilir. */
function run(kind, payload, { pri = 5, onStart, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    jobs.push({ jid: ++seq, kind, payload, pri, onStart, onProgress, resolve, reject })
    jobs.sort((a, b) => a.pri - b.pri || a.jid - b.jid)
    pump()
  })
}

/** İşçi boşta ne kadar açık kalsın (gömme modeli yüklüyken uzun tutulur; her aramada yeniden yüklenmesin). */
function setIdleMs(ms) { idleMs = ms }

module.exports = { run, setIdleMs }
