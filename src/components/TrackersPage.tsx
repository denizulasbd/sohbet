import { useEffect, useState } from 'react'
import type { TrackerInput, TrackerKind, TrackerWeek } from '../types'
import { addDays, dayLabel, startOfDay, startOfWeek, WEEK_DAYS, ymd } from '../calendar'
import { dayLevel, num, stepOf, TRACKER_KINDS, TRACKER_TEMPLATES, weekText } from '../trackers'
import { Back, Check, Next, Plus } from './Icons'
import { Reveal } from './Sidebar'

export type TrackerRequest = { n: number; create?: boolean }
interface Props {
  sidebar: boolean; onOpenSidebar(): void
  /** Takipler başka bir yerden değişti (sohbetteki kayıt, geri alma): liste yenilenir. */
  tick: number
  /** Bu sayfada yapılan değişiklik: kenar çubuğu yenilensin. */
  onChanged(): void
  req: TrackerRequest | null
}
interface Form { name: string; kind: TrackerKind; unit: string; frequency: 'daily' | 'weekly'; target: string }
const toForm = (t: TrackerInput): Form => ({ name: t.name, kind: t.kind, unit: t.unit ?? '', frequency: t.frequency, target: t.target ? String(t.target) : '' })
const BLANK: Form = { name: '', kind: 'check', unit: '', frequency: 'daily', target: '' }
const same = (a: string, b: string) => a.trim().toLocaleLowerCase('tr-TR') === b.trim().toLocaleLowerCase('tr-TR')

/** Koç modunun takip sayfası: seçili günün takipleri tek dokunuşla işaretlenir; her satırda o haftanın şeridi görünür. */
export default function TrackersPage({ sidebar, onOpenSidebar, tick, onChanged, req }: Props) {
  const today = startOfDay(Date.now())
  const [day, setDay] = useState(today)
  const [items, setItems] = useState<TrackerWeek[]>([])
  const [loaded, setLoaded] = useState(false)
  const [dlg, setDlg] = useState<{ id: string | null; form: Form } | null>(null)
  const [err, setErr] = useState('')
  const [local, setLocal] = useState(0)
  const week = startOfWeek(day), idx = Math.round((day - week) / 86400000)

  useEffect(() => {
    let live = true
    window.api.listTrackers(ymd(week)).then((l) => { if (live) { setItems(l); setLoaded(true) } }).catch(() => { if (live) setLoaded(true) })
    return () => { live = false }
  }, [week, tick, local])
  useEffect(() => { if (req?.create) openNew() }, [req?.n])

  function openNew() { setErr(''); setDlg({ id: null, form: BLANK }) }
  const changed = () => { setLocal((n) => n + 1); onChanged() }
  async function setValue(t: TrackerWeek, v: number) {
    const value = Math.max(0, Math.round(v * 100) / 100)
    setItems((l) => l.map((x) => (x.id === t.id ? { ...x, days: x.days.map((d, i) => (i === idx ? value : d)) } : x))) // anında görünsün
    await window.api.setTrackerDay(t.id, ymd(day), value).catch(() => {})
    changed()
  }
  const set = (d: Partial<Form>) => setDlg((x) => (x ? { ...x, form: { ...x.form, ...d } } : x))
  async function save() {
    if (!dlg) return
    const f = dlg.form
    if (!f.name.trim()) { setErr('Ad boş olamaz.'); return }
    if (items.some((t) => t.id !== dlg.id && same(t.name, f.name))) { setErr('Bu adla bir takip zaten var.'); return }
    const target = Number(f.target.replace(',', '.'))
    const input: TrackerInput = { name: f.name.trim(), kind: f.kind, unit: f.kind === 'check' ? null : f.unit.trim() || null, frequency: f.frequency, target: target > 0 ? target : null }
    try {
      if (dlg.id) await window.api.updateTracker(dlg.id, input); else await window.api.createTracker(input)
      setDlg(null); changed()
    } catch { setErr('Takip kaydedilemedi.') }
  }
  async function remove() {
    if (!dlg?.id || !confirm(`"${dlg.form.name}" takibi tüm kayıtlarıyla birlikte silinsin mi?`)) return
    await window.api.deleteTracker(dlg.id); setDlg(null); changed()
  }

  const f = dlg?.form
  const free = TRACKER_TEMPLATES.filter((t) => !items.some((x) => same(x.name, t.name)))
  return (
    <>
      <header className={'top' + (sidebar ? '' : ' bare')}>
        <div className="top-l">
          {!sidebar && <Reveal onOpen={onOpenSidebar} onNew={openNew} newLabel="Yeni takip" />}
          <h1>Takip</h1>
        </div>
        <div className="top-r"><button className="pill primary" onClick={openNew}><Plus size={15} /><span className="pl">Takip ekle</span></button></div>
      </header>
      <div className="scroll">
        <div className="trk-page">
          <div className="cal-nav">
            <button className="circle" aria-label="Önceki hafta" onClick={() => setDay(addDays(day, -7))}><Back size={16} /></button>
            <div className="trk-days" role="group" aria-label="Gün seç">
              {WEEK_DAYS.map((d, i) => { const ms = addDays(week, i); return (
                <button key={d.id} aria-pressed={ms === day} className={ms === today ? 'today' : ''} disabled={ms > today} onClick={() => setDay(ms)}><span>{d.label}</span><b>{new Date(ms).getDate()}</b></button>
              ) })}
            </div>
            <button className="circle" aria-label="Sonraki hafta" disabled={addDays(week, 7) > today} onClick={() => setDay(Math.min(addDays(day, 7), today))}><Next size={16} /></button>
            {day !== today && <button className="pill" onClick={() => setDay(today)}>Bugün</button>}
          </div>

          <section className="stack">
            <span className="label gl">{dayLabel(day).toLocaleUpperCase('tr-TR')}</span>
            {loaded && items.length === 0 ? (
              <div className="group"><div className="frow trk-empty">
                <span className="note">Henüz takip yok. Hazır şablonlardan seçin ya da kendi takibinizi ekleyin; sohbette "bugün 6 bardak su içtim" dediğinizde ilgili takibe kaydedilir.</span>
                <div className="trk-tpl">{TRACKER_TEMPLATES.map((t) => <button key={t.name} className="pill sm" onClick={async () => { await window.api.createTracker(t); changed() }}><Plus size={13} />{t.name}</button>)}</div>
              </div></div>
            ) : (
              <div className="group">
                {items.map((t) => {
                  const v = t.days[idx] ?? 0, step = stepOf(t)
                  return (
                    <div key={t.id} className="frow trk">
                      <button className="trk-name" title="Takibi düzenle" onClick={() => { setErr(''); setDlg({ id: t.id, form: toForm(t) }) }}>
                        <span className="pj-n">{t.name}</span><span className="pj-s">{weekText(t, t.days, t.total) || 'Hedef yok'}</span>
                      </button>
                      <div className="trk-wk" aria-hidden>{t.days.map((d, i) => <i key={i} className={'l' + dayLevel(t, d) + (i === idx ? ' cur' : '')} title={WEEK_DAYS[i].label} />)}</div>
                      {t.kind === 'check' ? (
                        <button className={'trk-check' + (v > 0 ? ' on' : '')} role="switch" aria-checked={v > 0} aria-label={t.name} onClick={() => setValue(t, v > 0 ? 0 : 1)}><Check size={18} /></button>
                      ) : (
                        <div className="trk-num">
                          <button className="circle sm" aria-label="Azalt" disabled={v <= 0} onClick={() => setValue(t, v - step)}>−</button>
                          <label><input key={t.id + day + v} inputMode="decimal" aria-label={`${t.name} değeri`} defaultValue={num(v)}
                            onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            onBlur={(e) => { const n = Number(e.target.value.replace(',', '.')); if (Number.isFinite(n) && n >= 0 && n !== v) setValue(t, n); else e.target.value = num(v) }} /><span>{t.unit}</span></label>
                          <button className="circle sm" aria-label="Artır" onClick={() => setValue(t, v + step)}>+</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {dlg && f && (
        <div className="modal-bg pad" onMouseDown={(e) => e.target === e.currentTarget && setDlg(null)}>
          <form className="cn-dlg ev-dlg" role="dialog" aria-label={dlg.id ? 'Takibi düzenle' : 'Yeni takip'} onSubmit={(e) => { e.preventDefault(); save() }}>
            <span className="label">{dlg.id ? 'TAKİBİ DÜZENLE' : 'YENİ TAKİP'}</span>
            {!dlg.id && free.length > 0 && <div className="trk-tpl">{free.map((t) => <button type="button" key={t.name} className="pill sm" onClick={() => set(toForm(t))}>{t.name}</button>)}</div>}
            <input className="nw-title-in" autoFocus aria-label="Ad" placeholder="Ad (ör. Yürüyüş)" value={f.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
            <div className="seg wrap" role="group" aria-label="Tür">
              {TRACKER_KINDS.map((k) => <button type="button" key={k.id} aria-pressed={f.kind === k.id} onClick={() => set({ kind: k.id, unit: k.id === 'duration' && !f.unit ? 'dakika' : f.unit })}>{k.label}</button>)}
            </div>
            <div className="group">
              {f.kind !== 'check' && <label className="frow"><span className="fl">Birim</span><input className="fin" value={f.unit} maxLength={20} placeholder={f.kind === 'duration' ? 'dakika ya da saat' : 'bardak, sayfa…'} onChange={(e) => set({ unit: e.target.value })} /></label>}
              <label className="frow"><span className="fl">Hedef dönemi</span>
                <select className="fin" value={f.frequency} onChange={(e) => set({ frequency: e.target.value as Form['frequency'] })}><option value="daily">Günlük</option><option value="weekly">Haftalık</option></select>
              </label>
              <label className="frow"><span className="fl">{f.kind === 'check' ? (f.frequency === 'weekly' ? 'Haftada kaç gün' : 'Hedef') : 'Hedef'}</span>
                <input className="fin" inputMode="decimal" value={f.target} placeholder="isteğe bağlı" onChange={(e) => set({ target: e.target.value })} /></label>
            </div>
            {err && <div className="memo bad"><span>{err}</span></div>}
            <div className="row-btns">
              {dlg.id && <button type="button" className="pill plain danger" onClick={remove}>Sil</button>}
              <span className="grow" />
              <button type="button" className="pill" onClick={() => setDlg(null)}>Vazgeç</button>
              <button type="submit" className="pill primary">Kaydet</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
