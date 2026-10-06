// Alışkanlık ve takip: her konu için ayrı modül yok, tek genel yapı var (trackers + tracker_entries).
// Bir günün değeri o günün kayıtlarının toplamıdır ("6 bardak" + "2 bardak" = 8); 'check' türünde kayıt varsa o gün yapılmıştır.
// Modelin araçları koç modundadır: list_trackers, get_tracker_summary, log_entry (anında kaydedilir, sohbetten geri alınır), create_tracker (onay kartıyla).
const crypto = require('crypto')
const { ipcMain } = require('electron')
const { normalize } = require('./chunker.cjs')

const KINDS = ['check', 'number', 'duration']
const MAX_RANGE_DAYS = 92
let db = null

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = () => ymd(new Date())
const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim()); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null }
const addYmd = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d) }
/** Tarihin haftasının pazartesisi (YYYY-AA-GG). */
const weekStart = (s) => { const d = parseYmd(s); return addYmd(s, -((d.getDay() + 6) % 7)) }
const round = (n) => Math.round(n * 100) / 100

const COLS = 'id, name, kind, unit, frequency, target, created_at AS createdAt'
const get = (id) => db.prepare(`SELECT ${COLS} FROM trackers WHERE id = ? AND archived = 0`).get(String(id ?? '')) ?? null
const all = () => db.prepare(`SELECT ${COLS} FROM trackers WHERE archived = 0 ORDER BY created_at`).all()

function clean(input) {
  const name = String(input?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!name) throw new Error('Ad boş olamaz.')
  const kind = KINDS.includes(input?.kind) ? input.kind : 'check'
  const target = Number(input?.target)
  return {
    name, kind, unit: kind === 'check' ? null : String(input?.unit ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || (kind === 'duration' ? 'dakika' : null),
    frequency: input?.frequency === 'weekly' ? 'weekly' : 'daily', target: Number.isFinite(target) && target > 0 ? round(target) : null
  }
}
function create(input) {
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO trackers (id, name, kind, unit, frequency, target, created_at) VALUES (@id, @name, @kind, @unit, @frequency, @target, @createdAt)').run({ ...clean(input), id, createdAt: Date.now() })
  return get(id)
}
function update(id, patch) {
  const cur = get(id)
  if (!cur) return null
  db.prepare('UPDATE trackers SET name = @name, kind = @kind, unit = @unit, frequency = @frequency, target = @target WHERE id = @id').run({ ...clean({ ...cur, ...patch }), id: cur.id })
  return get(cur.id)
}
/** Takibi ve tüm kayıtlarını siler. */
const remove = (id) => { db.prepare('DELETE FROM trackers WHERE id = ?').run(String(id ?? '')) }

/** [from, to] aralığında (dahil) gün → toplam değer. */
function totals(trackerId, from, to) {
  const rows = db.prepare('SELECT date, SUM(COALESCE(value, 0)) AS v FROM tracker_entries WHERE tracker_id = ? AND date >= ? AND date <= ? GROUP BY date').all(trackerId, from, to)
  return new Map(rows.map((r) => [r.date, round(r.v)]))
}
/** Takipler ve verilen haftanın (pazartesiden başlayan 7 gün) günlük değerleri. */
function list(weekOf) {
  const start = weekStart(parseYmd(weekOf) ? weekOf : today())
  return all().map((t) => {
    const m = totals(t.id, start, addYmd(start, 6))
    const days = Array.from({ length: 7 }, (_, i) => m.get(addYmd(start, i)) ?? 0)
    return { ...t, days, total: round(days.reduce((a, b) => a + b, 0)) }
  })
}
/** Ek kayıt: günün toplamına eklenir. */
function log(trackerId, date, value, note) {
  const t = get(trackerId)
  if (!t) return null
  const v = t.kind === 'check' ? 1 : Number(value)
  if (!Number.isFinite(v) || v <= 0) throw new Error('Değer sıfırdan büyük bir sayı olmalı.')
  const id = crypto.randomUUID(), day = parseYmd(date) ? String(date).trim() : today()
  db.prepare('INSERT INTO tracker_entries (id, tracker_id, date, value, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, t.id, day, round(v), String(note ?? '').trim().slice(0, 300) || null, Date.now())
  return { id, trackerId: t.id, date: day, value: round(v) }
}
/** Günün değerini doğrudan belirler (arayüzdeki tek dokunuş ve sayaç): o günün kayıtları tek kayıtla değiştirilir; 0 günü boşaltır. */
function setDay(trackerId, date, value) {
  const t = get(trackerId)
  if (!t || !parseYmd(date)) return
  const v = Number(value)
  db.transaction(() => {
    db.prepare('DELETE FROM tracker_entries WHERE tracker_id = ? AND date = ?').run(t.id, date)
    if (Number.isFinite(v) && v > 0) db.prepare('INSERT INTO tracker_entries (id, tracker_id, date, value, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), t.id, date, t.kind === 'check' ? 1 : round(v), Date.now())
  })()
}
const removeEntry = (id) => { db.prepare('DELETE FROM tracker_entries WHERE id = ?').run(String(id ?? '')) }

function register(database) {
  db = database
  ipcMain.handle('trackers:list', (_e, weekOf) => list(weekOf))
  ipcMain.handle('trackers:create', (_e, input) => create(input))
  ipcMain.handle('trackers:update', (_e, id, patch) => update(id, patch))
  ipcMain.handle('trackers:delete', (_e, id) => remove(id))
  ipcMain.handle('trackers:setDay', (_e, id, date, value) => setDay(id, date, value))
  ipcMain.handle('trackers:deleteEntry', (_e, id) => removeEntry(id))
}

// ---- model araçları ----
const str = (description) => ({ type: 'string', description })
const tool = (name, description, properties, required) => ({ name, description, parameters: { type: 'object', properties, required } })
const TOOLS = [
  tool('list_trackers', 'Kullanıcının takiplerini (su, uyku, antrenman gibi alışkanlıklar) ve bugünkü değerlerini listeler. Kayıt eklemeden önce doğru takibin tracker_id değerini bulmak için kullan.', {}, []),
  tool('get_tracker_summary', 'Bir takibin verilen tarih aralığındaki günlük kayıtlarını ve özetini (toplam, ortalama, kayıtlı gün sayısı) döndürür. "Bu hafta uykum nasıldı?" gibi sorularda tahmin yürütme, bunu kullan.',
    { tracker_id: str('Takibin id değeri (list_trackers sonucundan)'), from: str('İlk gün, YYYY-AA-GG'), to: str('Son gün (dahil), YYYY-AA-GG') }, ['tracker_id', 'from', 'to']),
  tool('log_entry', 'Bir takibe kayıt ekler (ör. "6 bardak su içtim"). Onay istemez, hemen kaydedilir; kullanıcı sohbetten geri alabilir. Değer o günün toplamına EKLENİR.',
    { tracker_id: str('Takibin id değeri (list_trackers sonucundan)'), date: str('Gün, YYYY-AA-GG. Verilmezse bugün.'), value: { type: 'number', description: 'Eklenecek miktar, takibin biriminde (ör. bardak, dakika, saat). Yapıldı/yapılmadı türünde verme.' }, note: str('İsteğe bağlı kısa not') }, ['tracker_id']),
  tool('create_tracker', 'Yeni bir takip oluşturur. Kullanıcıya önizleme gösterilir; ancak onaylarsa oluşturulur.',
    { name: str('Kısa ad (ör. "Su", "Yürüyüş", "Kitap okuma")'), kind: { type: 'string', enum: KINDS, description: 'check: yapıldı/yapılmadı · number: sayı (bardak, sayfa) · duration: süre (dakika, saat)' },
      unit: str('Birim (ör. bardak, dakika, saat, sayfa). check türünde verme.'), frequency: { type: 'string', enum: ['daily', 'weekly'], description: 'Hedefin dönemi' }, target: { type: 'number', description: 'İsteğe bağlı hedef: günlük ya da haftalık miktar (check türünde haftada kaç gün)' } }, ['name', 'kind', 'frequency'])
]
const RULES = `Takip araçların var (list_trackers, get_tracker_summary, log_entry, create_tracker).
- Kullanıcı bir alışkanlıkla ilgili yaptığını söylediğinde ("6 bardak su içtim", "40 dakika yürüdüm", "antrenmanı yaptım") önce list_trackers ile ilgili takibi bul, sonra log_entry ile kaydet. Bir mesajda birden fazla şey söylendiyse her biri için ayrı log_entry çağır.
- Uygun bir takip yoksa uydurma bir id kullanma: create_tracker ile öner; kullanıcı onaylarsa dönen id ile kaydı ekle.
- Kullanıcı bir alışkanlığının nasıl gittiğini sorduğunda ("bu hafta uykum nasıldı?") get_tracker_summary ile gerçek kayıtlara bak ve yalnızca kayıtlarda olanı söyle; kayıt yoksa bunu belirt.
- Kayıtları yorumlarken yargılama; eksik günleri suçlama konusu yapma, bir sonraki küçük adımı öner.
- Kullanıcı açıkça istemedikçe kalori ya da kilo takibi önerme ve oluşturma.`

const fmt = (t, v) => (t.kind === 'check' ? (v > 0 ? 'yapıldı' : 'yapılmadı') : `${String(v).replace('.', ',')}${t.unit ? ' ' + t.unit : ''}`)
const goal = (t) => (t.target ? ` · hedef: ${t.frequency === 'weekly' ? 'haftada' : 'günde'} ${t.kind === 'check' ? t.target + ' gün' : fmt(t, t.target)}` : '')
const dayText = (s) => parseYmd(s).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })

/** Bir cevap için takip araçları (not araçlarıyla aynı arayüz).
 *  emit('note', { op }): anında kaydedilen kayıt sohbette "Geri al" etiketi olarak görünür · propose(öneri): create_tracker onayı → { action: 'saved', trackerId } */
function createTools({ propose, emit, signal }) {
  if (!db) return null
  const names = new Set(TOOLS.map((t) => t.name))
  const NO = 'Hata: böyle bir takip yok. tracker_id değerini list_trackers ile al.'

  function runList() {
    const list0 = all(), day = today()
    emit('tool', { phase: 'start', kind: 'tracker', text: '' })
    emit('tool', { phase: 'end', kind: 'tracker', text: '', count: list0.length })
    if (!list0.length) return 'Henüz takip yok. Kullanıcı bir alışkanlığını kaydetmek istiyorsa create_tracker ile öner.'
    return `Takipler (bugün: ${day}):\n${list0.map((t) => `- ${t.name} · ${t.kind === 'check' ? 'yapıldı/yapılmadı' : t.kind === 'duration' ? 'süre' : 'sayı'}${goal(t)} · bugün: ${fmt(t, totals(t.id, day, day).get(day) ?? 0)} · tracker_id: ${t.id}`).join('\n')}`
  }
  function runSummary(input) {
    const t = get(input.tracker_id)
    if (!t) return NO
    const a = parseYmd(input.from), b = parseYmd(input.to)
    if (!a || !b || b < a) return 'Hata: from ve to YYYY-AA-GG biçiminde olmalı; to, from değerinden önce olamaz.'
    const n = Math.round((b - a) / 86400000) + 1
    if (n > MAX_RANGE_DAYS) return `Hata: aralık en fazla ${MAX_RANGE_DAYS} gün olabilir.`
    emit('tool', { phase: 'start', kind: 'tracker', text: t.name })
    const m = totals(t.id, ymd(a), ymd(b))
    emit('tool', { phase: 'end', kind: 'tracker', text: t.name, count: m.size })
    if (!m.size) return `"${t.name}" takibinde ${input.from} – ${input.to} aralığında hiç kayıt yok (${n} gün).`
    const notes = db.prepare('SELECT date, note FROM tracker_entries WHERE tracker_id = ? AND date >= ? AND date <= ? AND note IS NOT NULL ORDER BY date').all(t.id, ymd(a), ymd(b))
    const sum = round([...m.values()].reduce((x, y) => x + y, 0))
    const lines = Array.from({ length: n }, (_, i) => addYmd(ymd(a), i)).map((d) => `- ${dayText(d)} (${d}): ${m.has(d) ? fmt(t, m.get(d)) : 'kayıt yok'}`)
    return [
      `"${t.name}"${goal(t)} · ${input.from} – ${input.to} (${n} gün):`, ...lines,
      t.kind === 'check' ? `Yapılan gün: ${m.size} / ${n}.` : `Toplam: ${fmt(t, sum)} · kayıtlı gün: ${m.size} / ${n} · kayıtlı günlerin ortalaması: ${fmt(t, round(sum / m.size))}.`,
      ...(notes.length ? ['Notlar:', ...notes.map((x) => `- ${x.date}: ${x.note}`)] : [])
    ].join('\n')
  }
  function runLog(input) {
    const t = get(input.tracker_id)
    if (!t) return NO
    if (input.date != null && String(input.date).trim() && !parseYmd(input.date)) return 'Hata: date YYYY-AA-GG biçiminde olmalı.'
    if (t.kind !== 'check' && !(Number(input.value) > 0)) return 'Hata: value sıfırdan büyük bir sayı olmalı.'
    const e = log(t.id, input.date, input.value, input.note)
    const total = totals(t.id, e.date, e.date).get(e.date) ?? e.value
    emit('note', { op: { id: crypto.randomUUID(), target: 'entry', kind: 'create', title: t.name, body: `${fmt(t, e.value)} · ${e.date === today() ? 'bugün' : dayText(e.date)}`, entryId: e.id, trackerId: t.id } })
    return `Kaydedildi: ${t.name} · ${fmt(t, e.value)} (${e.date}).${t.kind === 'check' ? '' : ` Günün toplamı: ${fmt(t, total)}.`}${goal(t)}`
  }
  async function runCreate(input) {
    let c
    try { c = clean(input) } catch (err) { return 'Hata: ' + err.message }
    const same = all().find((t) => normalize(t.name) === normalize(c.name))
    if (same) return `Bu adla bir takip zaten var (tracker_id: ${same.id}); yenisini oluşturma, onu kullan.`
    const r = await propose({ target: 'tracker', kind: 'create', title: c.name, body: '', tracker: c })
    if (r?.action === 'saved') return `Takip oluşturuldu (tracker_id: ${r.trackerId}). Kullanıcının söylediği kayıt varsa şimdi log_entry ile ekle.`
    if (r?.action === 'error') return `Hata: takip oluşturulamadı (${String(r.message || 'bilinmeyen hata').slice(0, 200)}).`
    return 'Kullanıcı reddetti. Takip oluşturulmadı; istenmedikçe yeniden önerme.'
  }

  return {
    tools: TOOLS, maxRounds: 8, rules: RULES,
    has: (name) => names.has(name),
    async run(call) {
      const input = call.input && typeof call.input === 'object' ? call.input : {}
      try {
        if (call.name === 'list_trackers') return runList()
        if (call.name === 'get_tracker_summary') return runSummary(input)
        if (call.name === 'log_entry') return runLog(input)
        if (call.name === 'create_tracker') return await runCreate(input)
        return `Hata: "${call.name}" adlı bir araç yok.`
      } catch (err) {
        if (signal?.aborted) return 'İşlem kullanıcı tarafından durduruldu.'
        console.error('[takip] araç hatası:', err)
        return 'Hata: araç çalıştırılamadı.'
      }
    }
  }
}

module.exports = { register, list, createTools }
