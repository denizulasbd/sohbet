// Bugün ekranının yapay zekâ özeti: takvim, takipler ve ilgili hafıza kayıtlarından günde bir kez üretilir ve app.db → meta tablosunda saklanır.
// Ekran her açıldığında önbellekteki özet döner; yeniden üretim yalnızca gün değişince ya da kullanıcı "Yenile" deyince yapılır.
const calendar = require('./calendar.cjs')
const trackers = require('./trackers.cjs')
const { COACH_RULES } = require('./coach.cjs')

const KEY = 'today_summary'
const KIND_LABEL = { ders: 'Ders', sinav: 'Sınav', odev: 'Ödev', antrenman: 'Antrenman', ogun: 'Öğün', diger: 'Diğer' }
let db = null
let running = null // süren özet üretimi
const register = (database) => { db = database }

const pad = (n) => String(n).padStart(2, '0')
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const dayText = (ms) => new Date(ms).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })
const num = (v) => String(v).replace('.', ',')

const SYSTEM = `${COACH_RULES}

Şimdi kullanıcının "Bugün" ekranı için kısa bir günlük özet yazacaksın. Sana bugünün tarihi, takvimi, yaklaşan sınav ve ödevler, alışkanlık takipleri ve hafıza kayıtları verilecek.
- Planlama odaklı ol: bugün ne var, neye hazırlanmalı, günü nasıl dengeleyebilir. Yarın ya da yakın günlerde sınav ya da ödev varsa mutlaka belirt.
- Kullanıcıyı yargılama; eksik kalan takipleri suçlama konusu yapma, en fazla bir küçük adım öner.
- Yalnızca verilen bilgileri kullan; etkinlik, sayı ya da alışkanlık uydurma. Kalori ya da kilo hedefi verme.
- En fazla 4 kısa cümle ya da 4 kısa madde yaz. Başlık, selamlama ve kapanış cümlesi ekleme. "Sen" diye hitap et.
- Hiç veri yoksa bunu tek cümleyle söyle ve takvime bir etkinlik ya da bir takip eklemeyi öner.`

/** Özetin dayandığı veriler, modele verilecek düz metin olarak. */
function context(memory, modules) {
  const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), end = start + 86400000
  const projects = new Map(db.prepare('SELECT id, name FROM projects').all().map((p) => [p.id, p.name]))
  const line = (o, withDay) => `- ${withDay ? dayText(o.at) + ' ' : ''}${o.allDay ? 'tüm gün' : hm(o.at) + (o.until ? '–' + hm(o.until) : '')} · ${KIND_LABEL[o.kind] || 'Diğer'}: ${o.title}${projects.get(o.projectId) ? ` (${projects.get(o.projectId)})` : ''}`
  const cal = modules?.calendar !== false, trkOn = modules?.trackers !== false
  const todays = cal ? calendar.list(start, end) : []
  const soon = cal ? calendar.list(end, start + 8 * 86400000).filter((o) => o.kind === 'sinav' || o.kind === 'odev') : []
  const idx = (now.getDay() + 6) % 7
  const trk = (trkOn ? trackers.list() : []).map((t) => {
    const v = t.days[idx] ?? 0, unit = t.unit ? ' ' + t.unit : ''
    const todayText = t.kind === 'check' ? (v > 0 ? 'bugün yapıldı' : 'bugün henüz yapılmadı') : `bugün ${num(v)}${unit}`
    const goal = t.target ? ` · hedef: ${t.frequency === 'weekly' ? 'haftada' : 'günde'} ${num(t.target)}${t.kind === 'check' ? ' gün' : unit}` : ''
    return `- ${t.name}: ${todayText}${goal} · bu hafta ${t.kind === 'check' ? t.days.filter((d) => d > 0).length + ' gün' : num(t.total) + unit}`
  })
  return [
    `Bugün: ${dayText(now.getTime())}, saat ${hm(now.getTime())}.`,
    ...(cal ? [`BUGÜNÜN ETKİNLİKLERİ:\n${todays.map((o) => line(o, false)).join('\n') || '(yok)'}`, `ÖNÜMÜZDEKİ 7 GÜNDE SINAV VE ÖDEVLER:\n${soon.map((o) => line(o, true)).join('\n') || '(yok)'}`] : []),
    ...(trkOn ? [`TAKİPLER:\n${trk.join('\n') || '(takip yok)'}`] : []),
    `HAFIZA KAYITLARI:\n${(memory || []).slice(0, 40).map((t) => '- ' + t).join('\n') || '(yok)'}`
  ].join('\n\n')
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function cached() {
  try { const v = JSON.parse(db.prepare('SELECT value FROM meta WHERE key = ?').pluck().get(KEY) || 'null'); return v && v.date === today() && v.text ? v : null } catch { return null }
}

/** Bugünün özeti: { date, text, createdAt }. force değilse ve bugün üretilmişse önbellekteki döner.
 *  memory: koç modunun görebildiği hafıza metinleri · complete(system, user) → modelin cevabı. */
async function summary({ force, memory, complete, modules }) {
  if (!db) throw new Error('Veritabanı açılamadı.')
  const hit = force ? null : cached()
  if (hit) return hit
  // Aynı anda gelen istekler (ör. ekran iki kez açılırsa) tek model çağrısını paylaşır.
  if (!running) running = (async () => {
    const text = String(await complete(SYSTEM, context(memory, modules))).replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    if (!text) throw new Error('Model boş cevap döndürdü.')
    const out = { date: today(), text, createdAt: Date.now() }
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(out))
    return out
  })().finally(() => { running = null })
  return running
}

module.exports = { register, summary, context }
