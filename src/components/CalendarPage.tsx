import { useEffect, useState } from 'react'
import type { CalEvent, EventInput, EventKind, EventOcc, Project, WeekDay } from '../types'
import { addDays, dayLabel, EVENT_KINDS, fromYmd, hm, kindLabel, PROJECT_KINDS, startOfDay, startOfWeek, timeLabel, WEEK_DAYS, weekDayOf, ymd } from '../calendar'
import { Back, Next, Plus } from './Icons'
import { Reveal } from './Sidebar'

const tr = 'tr-TR'
/** Düzenleyicinin açılış isteği: yeni etkinlik (gün ve tür önerisiyle) ya da mevcut bir etkinlik. */
export type CalRequest = { n: number; at?: number; create?: { kind?: EventKind } }

interface Props {
  projects: Project[]; sidebar: boolean; onOpenSidebar(): void
  /** Takvim başka bir yerden değişti (sohbetteki öneri, geri alma): liste yenilenir. */
  tick: number
  /** Bu sayfada yapılan değişiklik: kenar çubuğu ve proje sayfası yenilensin. */
  onChanged(): void
  /** Kenar çubuğundan gelen istek: bir güne git ya da yeni etkinlik aç. */
  req: CalRequest | null
}

interface Form { title: string; kind: EventKind; date: string; allDay: boolean; start: string; end: string; freq: 'none' | 'daily' | 'weekly'; days: WeekDay[]; until: string; projectId: string; notes: string }
function toForm(e: EventInput): Form {
  return {
    title: e.title, kind: e.kind, date: ymd(e.startAt), allDay: e.allDay, start: e.allDay ? '10:00' : hm(e.startAt), end: e.endAt != null ? hm(e.endAt) : '',
    freq: e.repeat?.freq ?? 'none', days: e.repeat?.days ?? [], until: e.repeat?.until ?? '', projectId: e.projectId ?? '', notes: e.notes ?? ''
  }
}
function blank(day: number, kind: EventKind = 'diger'): Form {
  // Ders programı hızlı girişi: ders seçilince haftalık tekrar ve o günün haftanın günü hazır gelir.
  return { title: '', kind, date: ymd(day), allDay: false, start: '10:00', end: '11:00', freq: kind === 'ders' ? 'weekly' : 'none', days: kind === 'ders' ? [weekDayOf(day)] : [], until: '', projectId: '', notes: '' }
}
/** Form → kaydedilecek alanlar; geçersizse hata metni. */
function fromForm(f: Form): EventInput | string {
  if (!f.title.trim()) return 'Başlık boş olamaz.'
  const startAt = fromYmd(f.date, f.allDay ? '00:00' : f.start)
  if (startAt == null) return 'Tarih ya da saat geçersiz.'
  const endAt = f.allDay || !f.end ? null : fromYmd(f.date, f.end)
  if (endAt != null && endAt <= startAt) return 'Bitiş saati başlangıçtan sonra olmalı.'
  if (f.freq === 'weekly' && !f.days.length) return 'Haftalık tekrar için en az bir gün seçin.'
  if (f.until && (fromYmd(f.until) ?? 0) < startOfDay(startAt)) return 'Tekrarın son günü başlangıçtan önce olamaz.'
  return {
    title: f.title.trim(), kind: f.kind, startAt, endAt, allDay: f.allDay,
    repeat: f.freq === 'none' ? null : { freq: f.freq, days: f.freq === 'weekly' ? f.days : [], until: f.until || null },
    projectId: PROJECT_KINDS.includes(f.kind) && f.projectId ? f.projectId : null, notes: f.notes.trim() || null
  }
}

/** Koç modunun takvimi: haftalık görünüm ve yaklaşan etkinlikler. Etkinliğe tıklayınca düzenleyici açılır. */
export default function CalendarPage({ projects, sidebar, onOpenSidebar, tick, onChanged, req }: Props) {
  const [week, setWeek] = useState(() => startOfWeek(Date.now()))
  const [occs, setOccs] = useState<EventOcc[]>([])
  const [upcoming, setUpcoming] = useState<EventOcc[]>([])
  const [edit, setEdit] = useState<{ id: string | null; form: Form; repeating: boolean } | null>(null)
  const [err, setErr] = useState('')
  const [local, setLocal] = useState(0)
  const today = startOfDay(Date.now())

  useEffect(() => {
    let live = true
    window.api.listEvents(week, addDays(week, 7)).then((l) => { if (live) setOccs(l) }).catch(() => { if (live) setOccs([]) })
    window.api.listEvents(today, addDays(today, 30)).then((l) => { if (live) setUpcoming(l.filter((o) => (o.until ?? o.at) >= Date.now() || o.allDay).slice(0, 12)) }).catch(() => {})
    return () => { live = false }
  }, [week, tick, local, today])
  useEffect(() => {
    if (!req) return
    if (req.at != null) setWeek(startOfWeek(req.at))
    if (req.create) open(null, blank(req.at ?? Date.now(), req.create.kind))
  }, [req?.n])

  function open(ev: CalEvent | null, form?: Form) { setErr(''); setEdit({ id: ev?.id ?? null, form: form ?? toForm(ev!), repeating: !!ev?.repeat }) }
  const set = (d: Partial<Form>) => setEdit((e) => (e ? { ...e, form: { ...e.form, ...d } } : e))
  const done = () => { setEdit(null); setLocal((n) => n + 1); onChanged() }
  async function save() {
    if (!edit) return
    const input = fromForm(edit.form)
    if (typeof input === 'string') { setErr(input); return }
    try {
      if (edit.id) { if (!(await window.api.updateEvent(edit.id, input))) throw new Error('Etkinlik artık yok.') }
      else await window.api.createEvent(input, 'user')
      done()
    } catch (e: any) { setErr(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
  async function remove() {
    if (!edit?.id) return
    if (!confirm(edit.repeating ? 'Bu tekrarlayan etkinliğin tüm günleri silinsin mi?' : 'Bu etkinlik silinsin mi?')) return
    await window.api.deleteEvent(edit.id); done()
  }

  const f = edit?.form
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const range = `${new Date(week).toLocaleDateString(tr, { day: 'numeric', month: 'short' })} – ${new Date(days[6]).toLocaleDateString(tr, { day: 'numeric', month: 'short', year: 'numeric' })}`
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name

  return (
    <>
      <header className={'top' + (sidebar ? '' : ' bare')}>
        <div className="top-l">
          {!sidebar && <Reveal onOpen={onOpenSidebar} onNew={() => open(null, blank(Math.max(today, week)))} newLabel="Yeni etkinlik" />}
          <h1>Takvim</h1>
        </div>
        <div className="top-r">
          <button className="pill" title="Haftalık tekrarlanan ders ekle" onClick={() => open(null, blank(Math.max(today, week), 'ders'))}><Plus size={15} /><span className="pl">Ders ekle</span></button>
          <button className="pill primary" onClick={() => open(null, blank(Math.max(today, week)))}><Plus size={15} /><span className="pl">Etkinlik ekle</span></button>
        </div>
      </header>
      <div className="scroll">
        <div className="cal-page">
          <div className="cal-nav">
            <button className="circle" aria-label="Önceki hafta" onClick={() => setWeek(addDays(week, -7))}><Back size={16} /></button>
            <button className="pill" disabled={week === startOfWeek(Date.now())} onClick={() => setWeek(startOfWeek(Date.now()))}>Bu hafta</button>
            <button className="circle" aria-label="Sonraki hafta" onClick={() => setWeek(addDays(week, 7))}><Next size={16} /></button>
            <span className="cal-range">{range}</span>
          </div>

          <div className="cal-week">
            {days.map((d, i) => {
              const list = occs.filter((o) => startOfDay(o.at) === d)
              return (
                <section key={d} className={'cal-day' + (d === today ? ' today' : '') + (list.length ? '' : ' none')} aria-label={new Date(d).toLocaleDateString(tr, { weekday: 'long', day: 'numeric', month: 'long' })}>
                  <div className="cal-dh"><span>{WEEK_DAYS[i].label}</span><b>{new Date(d).getDate()}</b>
                    <button className="cal-add" aria-label="Bu güne etkinlik ekle" title="Bu güne etkinlik ekle" onClick={() => open(null, blank(d))}><Plus size={14} /></button>
                  </div>
                  {list.map((o) => (
                    <button key={o.id + o.at} className={'cal-ev k-' + o.kind} title={[o.title, timeLabel(o), projectName(o.projectId), o.notes].filter(Boolean).join('\n')} onClick={() => open(o)}>
                      <span className="t">{o.title}</span>
                      <span className="s">{timeLabel(o)}{o.kind !== 'diger' ? ' · ' + kindLabel(o.kind) : ''}</span>
                    </button>
                  ))}
                </section>
              )
            })}
          </div>

          <section className="stack">
            <span className="label gl">YAKLAŞAN · 30 GÜN</span>
            <div className="group">
              {upcoming.length === 0 && <div className="frow"><span className="note">Önümüzdeki 30 günde etkinlik yok. Sohbette "pazartesi ve çarşamba 10–12 dersim var, programıma ekle" diyebilir ya da yukarıdan ekleyebilirsiniz.</span></div>}
              {upcoming.map((o) => (
                <button key={o.id + o.at} className="frow pj-row pj-open" onClick={() => { setWeek(startOfWeek(o.at)); open(o) }}>
                  <div className="pj-tx"><span className="pj-n">{o.title}</span><span className="pj-s">{[kindLabel(o.kind), projectName(o.projectId)].filter(Boolean).join(' · ')}</span></div>
                  <span className="grow" /><span className="pj-st">{dayLabel(o.at)} · {timeLabel(o)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      {edit && f && (
        <div className="modal-bg pad" onMouseDown={(e) => e.target === e.currentTarget && setEdit(null)}>
          <form className="cn-dlg ev-dlg" role="dialog" aria-label={edit.id ? 'Etkinliği düzenle' : 'Yeni etkinlik'} onSubmit={(e) => { e.preventDefault(); save() }}>
            <span className="label">{edit.id ? 'ETKİNLİĞİ DÜZENLE' : 'YENİ ETKİNLİK'}</span>
            <input className="nw-title-in" autoFocus aria-label="Başlık" placeholder={f.kind === 'ders' ? 'Dersin adı' : 'Başlık'} value={f.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} />
            <div className="seg wrap" role="group" aria-label="Tür">
              {EVENT_KINDS.map((k) => <button type="button" key={k.id} aria-pressed={f.kind === k.id} onClick={() => set({ kind: k.id, ...(k.id === 'ders' && !edit.id && f.freq === 'none' ? { freq: 'weekly', days: [weekDayOf(fromYmd(f.date) ?? Date.now())] } : {}) })}>{k.label}</button>)}
            </div>
            <div className="group">
              <label className="frow"><span className="fl">{f.freq === 'none' ? 'Tarih' : 'İlk gün'}</span><input className="fin" type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>
              <div className="frow"><span className="fl" id="ev-all">Tüm gün</span><button type="button" className="sw" role="switch" aria-checked={f.allDay} aria-labelledby="ev-all" onClick={() => set({ allDay: !f.allDay })}><i /></button></div>
              {!f.allDay && (
                <div className="frow"><span className="fl">Saat</span>
                  <div className="fr ev-time"><input className="fin" type="time" required aria-label="Başlangıç" value={f.start} onChange={(e) => set({ start: e.target.value })} /><span className="note">–</span><input className="fin" type="time" aria-label="Bitiş" value={f.end} onChange={(e) => set({ end: e.target.value })} /></div>
                </div>
              )}
            </div>
            <div className="group">
              <label className="frow"><span className="fl">Tekrar</span>
                <select className="fin" value={f.freq} onChange={(e) => { const freq = e.target.value as Form['freq']; set({ freq, days: freq === 'weekly' && !f.days.length ? [weekDayOf(fromYmd(f.date) ?? Date.now())] : f.days }) }}>
                  <option value="none">Yok</option><option value="daily">Her gün</option><option value="weekly">Her hafta</option>
                </select>
              </label>
              {f.freq === 'weekly' && (
                <div className="frow"><span className="fl">Günler</span>
                  <div className="ev-days" role="group" aria-label="Haftanın günleri">
                    {WEEK_DAYS.map((d) => <button type="button" key={d.id} aria-pressed={f.days.includes(d.id)} onClick={() => set({ days: f.days.includes(d.id) ? f.days.filter((x) => x !== d.id) : [...f.days, d.id] })}>{d.label}</button>)}
                  </div>
                </div>
              )}
              {f.freq !== 'none' && <label className="frow"><span className="fl">Son gün</span><input className="fin" type="date" value={f.until} min={f.date} onChange={(e) => set({ until: e.target.value })} /></label>}
            </div>
            <div className="group">
              {PROJECT_KINDS.includes(f.kind) && (
                <label className="frow"><span className="fl">Proje</span>
                  <select className="fin" value={projects.some((p) => p.id === f.projectId) ? f.projectId : ''} onChange={(e) => set({ projectId: e.target.value })}>
                    <option value="">Bağlı değil</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              <label className="frow"><span className="fl">Not</span><input className="fin ev-note" value={f.notes} maxLength={2000} placeholder="Yer, konu, hareketler…" onChange={(e) => set({ notes: e.target.value })} /></label>
            </div>
            {f.freq !== 'none' && edit.id && <p className="note gcap">Tekrarlayan etkinlikte değişiklik tüm günlere uygulanır.</p>}
            {err && <div className="memo bad"><span>{err}</span></div>}
            <div className="row-btns">
              {edit.id && <button type="button" className="pill plain danger" onClick={remove}>Sil</button>}
              <span className="grow" />
              <button type="button" className="pill" onClick={() => setEdit(null)}>Vazgeç</button>
              <button type="submit" className="pill primary">Kaydet</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
