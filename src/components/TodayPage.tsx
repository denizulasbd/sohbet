import { useEffect, useState } from 'react'
import type { EventOcc, Project, TrackerWeek } from '../types'
import { addDays, dayLabel, hm, kindLabel, startOfDay, startOfWeek, timeLabel, ymd } from '../calendar'
import Markdown from './Markdown'
import { TrackerRow } from './TrackersPage'
import { Redo } from './Icons'
import { Reveal } from './Sidebar'

interface Props {
  projects: Project[]; sidebar: boolean; onOpenSidebar(): void; onNewChat(): void
  /** Takvim ya da takipler değişince ilgili bölüm yenilenir (özet yenilenmez; günde bir kez üretilir). */
  calTick: number; trkTick: number
  onTrackersChanged(): void
  /** Özet o an koç modunda seçili sağlayıcı ve modelle üretilir. */
  providerId?: string; model?: string
  onOpenCalendar(at: number): void; onOpenTrackers(): void
  /** Kapalı modülün bölümü çizilmez ve verisi istenmez. */
  showCalendar: boolean; showTrackers: boolean
}
type Summary = { text: string; createdAt: number } | { error: string } | null

/** Koç modunun ana sayfası: günün özeti, bugünün etkinlikleri, yaklaşan sınav ve ödevler, bugünün takipleri. */
export default function TodayPage({ projects, sidebar, onOpenSidebar, onNewChat, calTick, trkTick, onTrackersChanged, providerId, model, onOpenCalendar, onOpenTrackers, showCalendar, showTrackers }: Props) {
  const today = startOfDay(Date.now())
  const [events, setEvents] = useState<EventOcc[]>([])
  const [soon, setSoon] = useState<EventOcc[]>([])
  const [trackers, setTrackers] = useState<TrackerWeek[]>([])
  const [sum, setSum] = useState<Summary>(null)
  const [busy, setBusy] = useState(false)
  const idx = Math.round((today - startOfWeek(today)) / 86400000)

  useEffect(() => {
    if (!showCalendar) { setEvents([]); setSoon([]); return }
    let live = true
    window.api.listEvents(today, addDays(today, 1)).then((l) => { if (live) setEvents(l) }).catch(() => {})
    window.api.listEvents(addDays(today, 1), addDays(today, 8)).then((l) => { if (live) setSoon(l.filter((o) => o.kind === 'sinav' || o.kind === 'odev')) }).catch(() => {})
    return () => { live = false }
  }, [calTick, today, showCalendar])
  useEffect(() => {
    if (!showTrackers) { setTrackers([]); return }
    let live = true
    window.api.listTrackers(ymd(today)).then((l) => { if (live) setTrackers(l) }).catch(() => {})
    return () => { live = false }
  }, [trkTick, today, showTrackers])

  // Özet: bugün üretilmişse önbellekten anında gelir; değilse bir kez üretilir. "Yenile" yeniden üretir.
  function loadSummary(force: boolean) {
    if (!providerId) { setSum({ error: 'Özet için bir sağlayıcı ve model seçin (Ayarlar → API ve model).' }); return }
    setBusy(true)
    window.api.todaySummary({ providerId, model, force })
      .then((r) => setSum(r))
      .catch((e) => setSum({ error: String(e?.message || e).slice(0, 200) }))
      .finally(() => setBusy(false))
  }
  useEffect(() => { loadSummary(false) }, [today])

  async function setValue(t: TrackerWeek, v: number) {
    const value = Math.max(0, Math.round(v * 100) / 100)
    setTrackers((l) => l.map((x) => (x.id === t.id ? { ...x, days: x.days.map((d, i) => (i === idx ? value : d)) } : x)))
    await window.api.setTrackerDay(t.id, ymd(today), value).catch(() => {})
    onTrackersChanged()
  }
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name
  const now = Date.now()

  return (
    <>
      <header className={'top' + (sidebar ? '' : ' bare')}>
        <div className="top-l">
          {!sidebar && <Reveal onOpen={onOpenSidebar} onNew={onNewChat} newLabel="Yeni sohbet" />}
          <h1>Bugün</h1>
        </div>
        <span className="note td-date">{new Date(today).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </header>
      <div className="scroll">
        <div className="trk-page">
          <section className="stack" aria-live="polite">
            <span className="label gl">GÜNÜN ÖZETİ</span>
            <div className="td-sum">
              {sum && 'text' in sum ? <Markdown text={sum.text} />
                : sum && 'error' in sum ? <div className="memo bad"><span>Özet hazırlanamadı · {sum.error}</span></div>
                : <div className="memo kn-live"><span>Özet hazırlanıyor…</span></div>}
              <div className="td-sum-foot">
                <span className="note">{sum && 'text' in sum ? `Bugün ${hm(sum.createdAt)} itibarıyla · yapay zekâ özeti, hata yapabilir` : 'Günde bir kez üretilir'}</span>
                <button className="pill sm" disabled={busy} title="Özeti yeniden üret" onClick={() => loadSummary(true)}><Redo size={14} />{busy && sum ? 'Yenileniyor…' : 'Yenile'}</button>
              </div>
            </div>
          </section>

          {showCalendar && <><section className="stack">
            <span className="label gl">BUGÜNÜN ETKİNLİKLERİ{events.length ? ` · ${events.length}` : ''}</span>
            <div className="group">
              {events.length === 0 && <div className="frow"><span className="note">Bugün için takvimde etkinlik yok.</span></div>}
              {events.map((o) => (
                <button key={o.id + o.at} className={'frow pj-row pj-open' + (!o.allDay && (o.until ?? o.at) < now ? ' td-past' : '')} onClick={() => onOpenCalendar(o.at)}>
                  <div className="pj-tx"><span className="pj-n">{o.title}</span><span className="pj-s">{[kindLabel(o.kind), projectName(o.projectId), o.notes].filter(Boolean).join(' · ')}</span></div>
                  <span className="grow" /><span className="pj-st">{timeLabel(o)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="stack">
            <span className="label gl">YAKLAŞAN SINAV VE ÖDEVLER · 7 GÜN</span>
            <div className="group">
              {soon.length === 0 && <div className="frow"><span className="note">Önümüzdeki 7 günde sınav ya da ödev yok.</span></div>}
              {soon.map((o) => (
                <button key={o.id + o.at} className="frow pj-row pj-open" onClick={() => onOpenCalendar(o.at)}>
                  <div className="pj-tx"><span className="pj-n td-exam">{o.title}</span><span className="pj-s">{[kindLabel(o.kind), projectName(o.projectId)].filter(Boolean).join(' · ')}</span></div>
                  <span className="grow" /><span className="pj-st">{dayLabel(o.at)} · {timeLabel(o)}</span>
                </button>
              ))}
            </div>
          </section>

          </>}

          {showTrackers && <section className="stack">
            <span className="label gl">BUGÜNÜN TAKİPLERİ</span>
            <div className="group">
              {trackers.length === 0 && <button className="frow pj-open" onClick={onOpenTrackers}><span className="note">Henüz takip yok. Su, uyku ya da antrenman gibi bir takip eklemek için dokunun.</span></button>}
              {trackers.map((t) => <TrackerRow key={t.id} t={t} idx={idx} dayKey={today} onSet={(v) => setValue(t, v)} onEdit={onOpenTrackers} />)}
            </div>
          </section>}
        </div>
      </div>
    </>
  )
}
