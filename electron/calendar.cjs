// Takvim: etkinlikler app.db → events tablosunda durur. Tekrarlayan etkinlik tek satırdır (rrule); görünen günler istenen aralık için rrule kütüphanesiyle açılır.
// Modelin takvim araçları (list_events, create_event, update_event, delete_event) da buradadır: yazma araçları not araçlarıyla aynı öneri/onay hattını kullanır
// (main.cjs → propose); etkinliği onaydan sonra arayüz bu modülün IPC uçlarıyla yazar.
const crypto = require('crypto')
const { ipcMain } = require('electron')
const { RRule } = require('rrule')
const { normalize } = require('./chunker.cjs')

const KINDS = ['ders', 'sinav', 'odev', 'antrenman', 'ogun', 'diger']
const KIND_LABEL = { ders: 'Ders', sinav: 'Sınav', odev: 'Ödev', antrenman: 'Antrenman', ogun: 'Öğün', diger: 'Diğer' }
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const DAY_LABEL = { MO: 'Pzt', TU: 'Sal', WE: 'Çar', TH: 'Per', FR: 'Cum', SA: 'Cmt', SU: 'Paz' }
const MAX_LISTED = 60
let db = null

// ---- tekrarlama ----
// rrule kütüphanesi saatleri "UTC gibi" ele alır: yerel duvar saati UTC alanlarına yazılıp açılır, sonuç yeniden yerel saate çevrilir.
// Böylece haftalık 10:00 dersi yaz/kış saati geçişinde de 10:00'da kalır.
const toFloat = (ms) => { const d = new Date(ms); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes())) }
const fromFloat = (f) => new Date(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes()).getTime()
const pad = (n) => String(n).padStart(2, '0')
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim()); return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null }
const parseHm = (s) => { const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(s ?? '').trim()); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? [Number(m[1]), Number(m[2])] : null }

/** repeat: { freq: 'daily' | 'weekly', days?: ['MO', …], until?: 'YYYY-AA-GG' } → RRULE metni (yoksa null). */
function toRule(repeat) {
  if (!repeat || (repeat.freq !== 'daily' && repeat.freq !== 'weekly')) return null
  const parts = ['FREQ=' + (repeat.freq === 'daily' ? 'DAILY' : 'WEEKLY')]
  const days = repeat.freq === 'weekly' ? DAYS.filter((d) => (repeat.days || []).includes(d)) : []
  if (days.length) parts.push('BYDAY=' + days.join(','))
  const u = parseYmd(repeat.until)
  if (u) parts.push(`UNTIL=${u[0]}${pad(u[1] + 1)}${pad(u[2])}T235959Z`)
  return parts.join(';')
}
function fromRule(rule) {
  if (!rule) return null
  const f = Object.fromEntries(String(rule).split(';').map((p) => p.split('=')))
  const u = /^(\d{4})(\d{2})(\d{2})/.exec(f.UNTIL || '')
  return { freq: f.FREQ === 'DAILY' ? 'daily' : 'weekly', days: f.BYDAY ? f.BYDAY.split(',').filter((d) => DAYS.includes(d)) : [], until: u ? `${u[1]}-${u[2]}-${u[3]}` : null }
}

// ---- kayıtlar ----
const COLS = 'id, title, kind, start_at AS startAt, end_at AS endAt, all_day AS allDay, rrule, project_id AS projectId, notes, created_by AS createdBy, created_at AS createdAt'
const shape = (r) => (r ? { id: r.id, title: r.title, kind: r.kind, startAt: r.startAt, endAt: r.endAt, allDay: !!r.allDay, repeat: fromRule(r.rrule), projectId: r.projectId, notes: r.notes, createdBy: r.createdBy, createdAt: r.createdAt } : null)
const get = (id) => shape(db.prepare(`SELECT ${COLS} FROM events WHERE id = ?`).get(String(id ?? '')))

/** Arayüzden ya da araçtan gelen etkinlik alanlarını doğrular; geçersizse hata fırlatır. */
function clean(input) {
  const title = String(input?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!title) throw new Error('Başlık boş olamaz.')
  const startAt = Number(input?.startAt)
  if (!Number.isFinite(startAt)) throw new Error('Başlangıç tarihi geçersiz.')
  const allDay = !!input?.allDay
  let endAt = input?.endAt == null || allDay ? null : Number(input.endAt)
  if (endAt != null && (!Number.isFinite(endAt) || endAt <= startAt)) endAt = null
  const projectId = input?.projectId && db.prepare('SELECT 1 FROM projects WHERE id = ?').get(String(input.projectId)) ? String(input.projectId) : null
  return {
    title, kind: KINDS.includes(input?.kind) ? input.kind : 'diger', startAt, endAt, allDay: allDay ? 1 : 0,
    rrule: toRule(input?.repeat), projectId, notes: String(input?.notes ?? '').trim().slice(0, 2000) || null
  }
}
function insert(c, id, createdBy, createdAt) {
  db.prepare('INSERT INTO events (id, title, kind, start_at, end_at, all_day, rrule, project_id, notes, created_by, created_at) VALUES (@id, @title, @kind, @startAt, @endAt, @allDay, @rrule, @projectId, @notes, @createdBy, @createdAt)')
    .run({ ...c, id, createdBy: createdBy === 'ai' ? 'ai' : 'user', createdAt })
  return get(id)
}
const create = (input, createdBy) => insert(clean(input), crypto.randomUUID(), createdBy, Date.now())
function update(id, input) {
  const cur = get(id)
  if (!cur) return null
  db.prepare('UPDATE events SET title = @title, kind = @kind, start_at = @startAt, end_at = @endAt, all_day = @allDay, rrule = @rrule, project_id = @projectId, notes = @notes WHERE id = @id').run({ ...clean({ ...cur, ...input }), id: cur.id })
  return get(cur.id)
}
/** Siler ve silinen etkinliği döndürür ("Geri al" bununla geri yükler). */
function remove(id) {
  const cur = get(id)
  if (cur) db.prepare('DELETE FROM events WHERE id = ?').run(cur.id)
  return cur
}
/** Silinmiş etkinliği aynı kimlikle geri yükler. */
function restore(snapshot) {
  if (!snapshot?.id) return null
  return get(snapshot.id) ?? insert(clean(snapshot), String(snapshot.id), snapshot.createdBy, Number(snapshot.createdAt) || Date.now())
}

/** [from, to) aralığındaki görünen günler: tekrarlayan etkinlikler açılır. Her eleman etkinlik + at/until (o günün başlangıcı ve bitişi). */
function list(from, to) {
  from = Number(from); to = Number(to)
  if (!db || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return []
  const rows = db.prepare(`SELECT ${COLS} FROM events WHERE rrule IS NOT NULL OR (start_at < @to AND COALESCE(end_at, start_at) >= @from)`).all({ from, to })
  const out = []
  for (const r of rows) {
    const ev = shape(r), dur = ev.endAt != null ? ev.endAt - ev.startAt : 0
    if (!r.rrule) { out.push({ ...ev, at: ev.startAt, until: ev.endAt }); continue }
    try {
      const rule = new RRule({ ...RRule.parseString(r.rrule), dtstart: toFloat(ev.startAt) })
      for (const f of rule.between(toFloat(from - dur), toFloat(to - 1), true).slice(0, 400)) { const at = fromFloat(f); out.push({ ...ev, at, until: dur ? at + dur : null }) }
    } catch (err) { console.error('[takvim] tekrarlama kuralı açılamadı:', r.rrule, err) }
  }
  return out.sort((a, b) => a.at - b.at)
}

function register(database) {
  db = database
  ipcMain.handle('events:list', (_e, from, to) => list(from, to))
  ipcMain.handle('events:get', (_e, id) => get(id))
  ipcMain.handle('events:create', (_e, input, createdBy) => create(input, createdBy))
  ipcMain.handle('events:update', (_e, id, input) => update(id, input))
  ipcMain.handle('events:delete', (_e, id) => remove(id))
  ipcMain.handle('events:restore', (_e, snapshot) => restore(snapshot))
}

// ---- model araçları ----
const str = (description) => ({ type: 'string', description })
const tool = (name, description, properties, required) => ({ name, description, parameters: { type: 'object', properties, required } })
const FIELDS = (anyProject) => ({
  title: str('Etkinliğin kısa adı (ör. "Bitki Islahı", "İstatistik vizesi", "Bacak antrenmanı")'),
  kind: { type: 'string', enum: KINDS, description: 'ders | sinav | odev | antrenman | ogun | diger' },
  date: str('Tarih, YYYY-AA-GG. Tekrarlayan etkinlikte ilk günün tarihi.'),
  start_time: str('Başlangıç saati, SS:DD (24 saat). Tüm gün süren etkinlikte verme.'),
  end_time: str('Bitiş saati, SS:DD. İsteğe bağlı.'),
  repeat: { type: 'string', enum: ['none', 'daily', 'weekly'], description: 'Tekrarlama. Haftalık ders programı için weekly.' },
  repeat_days: { type: 'array', items: { type: 'string', enum: DAYS }, description: 'weekly için haftanın günleri (MO TU WE TH FR SA SU). Birden fazla gün tek etkinlikte verilir.' },
  repeat_until: str('Tekrarlamanın son günü, YYYY-AA-GG. İsteğe bağlı.'),
  ...(anyProject ? { project_name: str('İsteğe bağlı: etkinliğin bağlanacağı projenin (dersin) adı. Sınav ve ödevlerde kullanıcı bir proje andıysa ver.') } : {}),
  notes: str('İsteğe bağlı kısa açıklama (yer, konu, hareketler).')
})
const LIST = tool('list_events', 'Kullanıcının takvimindeki etkinlikleri verilen tarih aralığında listeler (dersler, sınavlar, ödevler, antrenmanlar, öğünler). Plan yapmadan ya da etkinlik eklemeden önce çakışmaları görmek için kullan.',
  { from: str('İlk gün, YYYY-AA-GG'), to: str('Son gün (dahil), YYYY-AA-GG') }, ['from', 'to'])
const CREATE = (anyProject) => tool('create_event', 'Takvime yeni bir etkinlik ekler. Kullanıcıya önizleme gösterilir; etkinlik ancak onaylarsa kaydedilir.', FIELDS(anyProject), ['title', 'kind', 'date'])
const UPDATE = (anyProject) => tool('update_event', 'Takvimdeki bir etkinliği değiştirir; yalnızca değişecek alanları ver. Tekrarlayan etkinlikte tüm seri değişir. Kullanıcıya önizleme gösterilir.',
  { id: str('Etkinliğin id değeri (list_events sonucundan)'), ...FIELDS(anyProject) }, ['id'])
const DELETE = tool('delete_event', 'Takvimden bir etkinliği siler; tekrarlayan etkinlikte tüm seri silinir. Kullanıcıya sorulur; ancak onaylarsa silinir.', { id: str('Etkinliğin id değeri (list_events sonucundan)') }, ['id'])

const RULES = `Takvim araçların var (list_events, create_event, update_event, delete_event).
- Kullanıcı bir ders, sınav, ödev, antrenman ya da öğün saatinin programına eklenmesini istediğinde ya da bir sınav/ödev tarihi bildirdiğinde create_event kullan. Sıradan sohbette kendiliğinden etkinlik oluşturma.
- Göreli tarihleri ("yarın", "gelecek salı", "haftaya") yukarıdaki bugünün tarihine göre çöz ve YYYY-AA-GG olarak ver. Yıl söylenmediyse en yakın gelecek tarihi al.
- Haftalık ders programı gibi tekrarlayan etkinlikleri TEK create_event çağrısıyla ekle: repeat "weekly", repeat_days ilgili günler (ör. pazartesi ve çarşamba → ["MO","WE"]), date ise bugünden itibaren bu günlerden EN YAKIN olanı (ör. bugün salıysa ve günler pazartesi-çarşamba ise yarınki çarşamba; gelecek haftanın pazartesisi değil).
- Plan ya da program önerirken önce list_events ile ilgili aralığa bak; mevcut etkinliklerle, özellikle sınavlarla çakışan saat önerme.
- Bir etkinliği değiştirmek ya da silmek için id değerini list_events sonucundan al; id uydurma.
- Araç sonucu "kaydedildi" diyorsa kullanıcıya kısaca bildir. Kullanıcı reddettiyse hiçbir şey yazılmamıştır: kaydedilmiş gibi sunma ve istenmedikçe aynı çağrıyı yineleme.`

const dayText = (ms) => new Date(ms).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const timeText = (o) => (o.allDay ? 'tüm gün' : hm(o.at) + (o.until ? '–' + hm(o.until) : ''))
const repeatText = (r) => (!r ? '' : (r.freq === 'daily' ? 'her gün' : 'her hafta' + (r.days.length ? ' ' + r.days.map((d) => DAY_LABEL[d]).join(', ') : '')) + (r.until ? ` (${r.until} tarihine kadar)` : ''))

/** Bir cevap için takvim araçları (not araçlarıyla aynı arayüz). session: @proje seçiliyse bilgi oturumu; projects: [{ id, name }].
 *  propose(öneri) → { action: 'saved', eventId } | { action: 'cancel' } | { action: 'error', message } */
function createTools({ propose, emit, projects, session, signal }) {
  if (!db) return null
  const tools = [LIST, CREATE(!session), UPDATE(!session), DELETE]
  const names = new Set(tools.map((t) => t.name))
  const projectName = (id) => (projects || []).find((p) => p.id === id)?.name

  /** Araç girdisi → etkinlik alanları. base: değiştirilen etkinliğin mevcut hali (update). { error } dönerse araç sonucu odur. */
  function fields(input, base) {
    const has = (k) => input[k] != null && String(input[k]).trim() !== ''
    const d0 = base ? new Date(base.startAt) : null
    let day = d0 ? [d0.getFullYear(), d0.getMonth(), d0.getDate()] : null
    if (has('date')) { day = parseYmd(input.date); if (!day) return { error: 'Hata: date YYYY-AA-GG biçiminde olmalı (ör. 2026-11-14).' } }
    if (!day) return { error: 'Hata: date gerekli.' }
    let start = base && !base.allDay ? [d0.getHours(), d0.getMinutes()] : null
    if (has('start_time')) { start = parseHm(input.start_time); if (!start) return { error: 'Hata: start_time SS:DD biçiminde olmalı (ör. 10:00).' } }
    let end = base?.endAt != null ? [new Date(base.endAt).getHours(), new Date(base.endAt).getMinutes()] : null
    if (has('end_time')) { end = parseHm(input.end_time); if (!end) return { error: 'Hata: end_time SS:DD biçiminde olmalı (ör. 12:00).' } }
    const startAt = new Date(day[0], day[1], day[2], start ? start[0] : 0, start ? start[1] : 0).getTime()
    const endAt = start && end ? new Date(day[0], day[1], day[2], end[0], end[1]).getTime() : null
    if (endAt != null && endAt <= startAt) return { error: 'Hata: end_time, start_time değerinden sonra olmalı.' }
    let repeat = base?.repeat ?? null
    if (has('repeat') || Array.isArray(input.repeat_days) || has('repeat_until')) {
      const freq = input.repeat === 'none' ? null : input.repeat === 'daily' ? 'daily' : input.repeat === 'weekly' || Array.isArray(input.repeat_days) ? 'weekly' : repeat?.freq ?? null
      const until = has('repeat_until') ? (parseYmd(input.repeat_until) ? String(input.repeat_until).trim() : null) : repeat?.until ?? null
      repeat = freq ? { freq, days: Array.isArray(input.repeat_days) ? input.repeat_days.filter((x) => DAYS.includes(x)) : repeat?.days ?? [], until } : null
    }
    let projectId = base ? base.projectId : null
    if (session) { if (!base && ['ders', 'sinav', 'odev'].includes(input.kind)) projectId = session.projectId }
    else if (has('project_name')) {
      const want = normalize(String(input.project_name).replace(/^@/, ''))
      projectId = (projects || []).find((p) => normalize(p.name) === want)?.id ?? projectId
    }
    return {
      event: {
        title: has('title') ? String(input.title).replace(/\s+/g, ' ').trim().slice(0, 160) : base?.title ?? '',
        kind: KINDS.includes(input.kind) ? input.kind : base?.kind ?? 'diger',
        startAt, endAt, allDay: !start, repeat, projectId,
        notes: has('notes') ? String(input.notes).trim().slice(0, 2000) : base?.notes ?? null
      }
    }
  }
  const outcome = (r, done) => {
    if (r?.action === 'saved') return done
    if (r?.action === 'error') return `Hata: işlem yapılamadı (${String(r.message || 'bilinmeyen hata').slice(0, 200)}). Hiçbir şey değişmedi.`
    return 'Kullanıcı reddetti. Hiçbir şey değişmedi.'
  }

  function runList(input) {
    const a = parseYmd(input.from), b = parseYmd(input.to) || a
    if (!a) return 'Hata: from YYYY-AA-GG biçiminde olmalı.'
    const from = new Date(a[0], a[1], a[2]).getTime(), to = new Date(b[0], b[1], b[2] + 1).getTime()
    if (to <= from) return 'Hata: to, from değerinden önce olamaz.'
    if (to - from > 370 * 86400000) return 'Hata: aralık en fazla bir yıl olabilir.'
    const range = to - from > 86400000 * 1.5 ? `${input.from} – ${input.to}` : String(input.from)
    emit('tool', { phase: 'start', kind: 'calendar', text: range })
    const occ = list(from, to)
    emit('tool', { phase: 'end', kind: 'calendar', text: range, count: occ.length })
    if (!occ.length) return `${range} aralığında takvimde etkinlik yok.`
    const lines = occ.slice(0, MAX_LISTED).map((o) => `- ${dayText(o.at)} ${timeText(o)} · ${KIND_LABEL[o.kind]}: ${o.title}${o.projectId && projectName(o.projectId) ? ` · proje: ${projectName(o.projectId)}` : ''}${o.repeat ? ` · tekrar: ${repeatText(o.repeat)}` : ''} · id: ${o.id}`)
    return `${range} aralığındaki etkinlikler:\n${lines.join('\n')}${occ.length > MAX_LISTED ? `\n(${occ.length - MAX_LISTED} etkinlik daha var; aralığı daralt.)` : ''}`
  }
  async function runCreate(input) {
    const f = fields(input, null)
    if (f.error) return f.error
    if (!f.event.title) return 'Hata: title boş olamaz.'
    const r = await propose({ target: 'event', kind: 'create', title: f.event.title, body: '', event: f.event })
    return outcome(r, `Etkinlik kaydedildi (id: ${r?.eventId}). ${dayText(f.event.startAt)}${f.event.repeat ? ', ' + repeatText(f.event.repeat) : ''}.`)
  }
  async function runUpdate(input) {
    const cur = get(input.id)
    if (!cur) return 'Hata: böyle bir etkinlik yok. id değerini list_events ile al.'
    const f = fields(input, cur)
    if (f.error) return f.error
    return outcome(await propose({ target: 'event', kind: 'update', title: f.event.title, body: '', eventId: cur.id, event: f.event, before: cur }), 'Etkinlik güncellendi.')
  }
  async function runDelete(input) {
    const cur = get(input.id)
    if (!cur) return 'Hata: böyle bir etkinlik yok. id değerini list_events ile al.'
    return outcome(await propose({ target: 'event', kind: 'delete', title: cur.title, body: '', eventId: cur.id, before: cur }), 'Etkinlik silindi.')
  }

  return {
    tools, maxRounds: 8, rules: RULES,
    has: (name) => names.has(name),
    async run(call) {
      const input = call.input && typeof call.input === 'object' ? call.input : {}
      try {
        if (call.name === 'list_events') return runList(input)
        if (call.name === 'create_event') return await runCreate(input)
        if (call.name === 'update_event') return await runUpdate(input)
        if (call.name === 'delete_event') return await runDelete(input)
        return `Hata: "${call.name}" adlı bir araç yok.`
      } catch (err) {
        if (signal?.aborted) return 'İşlem kullanıcı tarafından durduruldu.'
        console.error('[takvim] araç hatası:', err)
        return 'Hata: araç çalıştırılamadı.'
      }
    }
  }
}

module.exports = { register, list, createTools, ymd }
