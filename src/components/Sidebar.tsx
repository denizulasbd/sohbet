import { useEffect, useMemo, useState } from 'react'
import type { Chat, EventOcc, Note, Project, ProjectKind, SbPage } from '../types'
import { addDays, dayLabel, startOfDay, timeLabel } from '../calendar'
import { isEmptyNote, noteGroup, noteSnippet, noteTitle, tinyDate } from '../notes'
import { kbd } from '../platform'
import { MODES, type Mode } from '../modes'
import { Back, Calendar, Chat as ChatIcon, Compose, FileText, Folder, Gear, Panel, Pin, Search, Trash } from './Icons'

const DAY = 86400000
function group(ts: number) {
  const startToday = new Date().setHours(0, 0, 0, 0)
  if (ts >= startToday) return 'BUGÜN'
  if (ts >= startToday - DAY) return 'DÜN'
  if (ts >= startToday - 7 * DAY) return 'ÖNCEKİ 7 GÜN'
  return 'DAHA ESKİ'
}

interface Props {
  view: SbPage; onView(p: SbPage): void
  mode: Mode; onMode(m: Mode): void
  chats: Chat[]; activeId: string | null; onPick(id: string): void; onNew(): void; onDelete(id: string): void
  notes: Note[]; activeNoteId: string | null; onPickNote(id: string): void; onNewNote(): void; onDeleteNote(id: string): void
  projects: Project[]; activeProjectId: string | null; onPickProject(id: string): void; onNewProject(): void; onDeleteProject(id: string): void
  /** Takvim (koç modu): calTick değişince yaklaşan etkinlikler yenilenir. */
  calTick: number; onPickEvent(at: number): void; onNewEvent(): void
  onClose(): void; onSettings(): void; searchRef: React.RefObject<HTMLInputElement>
}

// Yeni bölüm eklemek: SbPage'e ekle, buraya bir satır ve aşağıya bir liste gövdesi ekle.
// (Geniş pencerede üstteki seçici, dar pencerede alttaki sekme çubuğu aynı listeden çizilir.)
const SECTIONS = [
  { id: 'chat' as const, label: 'Sohbetler', tab: 'Sohbet', Icon: ChatIcon },
  { id: 'notes' as const, label: 'Notlar', tab: 'Notlar', Icon: FileText },
  { id: 'projects' as const, label: 'Projeler', tab: 'Projeler', Icon: Folder },
  { id: 'calendar' as const, label: 'Takvim', tab: 'Takvim', Icon: Calendar }
]
// Hangi bölüm hangi modda: notlar ve projeler sohbet modunun, takvim koç modunun bölümüdür.
const MODE_SECTIONS: Record<Mode, SbPage[]> = { chat: ['chat', 'notes', 'projects'], coach: ['chat', 'calendar'] }
const NEW = { chat: 'Yeni sohbet', notes: 'Yeni not', projects: 'Yeni proje', calendar: 'Yeni etkinlik' }
const KIND_GROUPS: { kind: ProjectKind; name: string }[] = [{ kind: 'ders', name: 'DERSLER' }, { kind: 'kisisel', name: 'KİŞİSEL PROJELER' }]

export default function Sidebar(p: Props) {
  const sections = SECTIONS.filter((s) => MODE_SECTIONS[p.mode].includes(s.id))
  const cur = SECTIONS.find((s) => s.id === p.view)!
  const newLabel = NEW[p.view]
  const onNew = { chat: p.onNew, notes: p.onNewNote, projects: p.onNewProject, calendar: p.onNewEvent }[p.view]
  return (
    <aside className="side">
      <div className="side-top">
        <span className="tl" aria-hidden />
        <h2 className="side-big">{cur.label}</h2>
        <span className="grow" />
        <button className="tb only-wide" aria-label="Kenar çubuğunu gizle" title="Kenar çubuğunu gizle" onClick={p.onClose}><Panel size={18} /></button>
        <button className="tb" aria-label={newLabel} title={`${newLabel} (${kbd('N')})`} onClick={onNew}><Compose size={18} /></button>
      </div>

      <div className="seg mode" role="tablist" aria-label="Mod">
        {MODES.map((m) => <button key={m.id} role="tab" aria-selected={p.mode === m.id} onClick={() => p.onMode(m.id)}>{m.label}</button>)}
      </div>
      {sections.length > 1 && (
        <div className="seg" role="tablist" aria-label="Bölümler">
          {sections.map((s) => <button key={s.id} role="tab" aria-selected={p.view === s.id} onClick={() => p.onView(s.id)}>{s.label}</button>)}
        </div>
      )}

      {p.view === 'chat' ? <ChatList {...p} /> : p.view === 'notes' ? <NoteList {...p} /> : p.view === 'calendar' ? <CalendarList {...p} /> : <ProjectList {...p} />}

      <div className="side-foot">
        <button className="row" onClick={p.onSettings}><Gear size={17} /><span className="t">Ayarlar</span><span className="kbd">{kbd(',')}</span></button>
      </div>
      <nav className="tabbar" aria-label="Bölümler">
        {sections.map((s) => <button key={s.id} aria-current={p.view === s.id ? 'page' : undefined} onClick={() => p.onView(s.id)}><s.Icon size={23} />{s.tab}</button>)}
        <button onClick={p.onSettings}><Gear size={23} />Ayarlar</button>
      </nav>
    </aside>
  )
}

/** Kenar çubuğu gizliyken üst çubuğun solunda duran grup: trafik ışığı boşluğu + göster (dar pencerede geri) + yeni. */
export function Reveal({ onOpen, onNew, newLabel }: { onOpen(): void; onNew(): void; newLabel: string }) {
  return (
    <>
      <span className="tl" aria-hidden />
      <button className="tb" aria-label="Kenar çubuğunu göster" title="Kenar çubuğunu göster" onClick={onOpen}><Panel size={18} className="i-wide" /><Back size={22} className="i-narrow" /></button>
      <button className="tb only-wide" aria-label={newLabel} title={`${newLabel} (${kbd('N')})`} onClick={onNew}><Compose size={18} /></button>
    </>
  )
}

function ChatList({ chats, activeId, onPick, onDelete, searchRef }: Props) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const ql = q.toLowerCase()
    const f = chats.filter((c) => !ql || c.title.toLowerCase().includes(ql) || c.msgs.some((m) => m.text.toLowerCase().includes(ql)))
    const out: { name: string; items: Chat[] }[] = []
    for (const c of [...f].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const g = group(c.updatedAt)
      const last = out[out.length - 1]
      if (last?.name === g) last.items.push(c); else out.push({ name: g, items: [c] })
    }
    return out
  }, [chats, q])

  return (
    <>
      <label className="search">
        <Search size={15} />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara" aria-label="Sohbetlerde ara" />
        <span className="kbd">{kbd('K')}</span>
      </label>
      <nav className="hist" aria-label="Sohbet geçmişi">
        {groups.length === 0 && <div className="grp-h">{q ? 'SONUÇ YOK' : 'HENÜZ SOHBET YOK'}</div>}
        {groups.map((g) => (
          <div key={g.name} style={{ display: 'contents' }}>
            <div className="grp-h">{g.name}</div>
            <div className="grp">
              {g.items.map((c) => (
                <div key={c.id} className={'row' + (c.id === activeId ? ' active' : '')} onClick={() => onPick(c.id)} title={c.title}>
                  <span className="t">{c.title}</span>
                  <span className="time">{tinyDate(c.updatedAt)}</span>
                  <button className="del" aria-label="Sohbeti sil" onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}><Trash size={15} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  )
}

function NoteList({ notes, activeNoteId, onPickNote, onDeleteNote, searchRef }: Props) {
  const [q, setQ] = useState('')
  // Sabitlenenler üstte, sonra tarihe göre gruplar (Apple Notlar gibi).
  const groups = useMemo(() => {
    const ql = q.toLowerCase()
    const f = notes.filter((n) => !isEmptyNote(n) || n.id === activeNoteId).filter((n) => !ql || n.title.toLowerCase().includes(ql) || n.body.toLowerCase().includes(ql))
    const sorted = [...f].sort((a, b) => b.updatedAt - a.updatedAt)
    const out: { name: string; items: Note[] }[] = []
    const push = (name: string, n: Note) => { const g = out.find((x) => x.name === name); if (g) g.items.push(n); else out.push({ name, items: [n] }) }
    sorted.filter((n) => n.pinned).forEach((n) => push('SABİTLENENLER', n))
    sorted.filter((n) => !n.pinned).forEach((n) => push(noteGroup(n.updatedAt), n))
    return out
  }, [notes, q, activeNoteId])

  return (
    <>
      <label className="search">
        <Search size={15} />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Notlarda ara" aria-label="Notlarda ara" />
        <span className="kbd">{kbd('K')}</span>
      </label>
      <nav className="hist" aria-label="Notlar">
        {groups.length === 0 && <div className="grp-h">{q ? 'SONUÇ YOK' : 'HENÜZ NOT YOK'}</div>}
        {groups.map((g) => (
          <div key={g.name} style={{ display: 'contents' }}>
            <div className="grp-h">{g.name}</div>
            <div className="grp">
              {g.items.map((n) => (
                <div key={n.id} className={'row nrow' + (n.id === activeNoteId ? ' active' : '')} onClick={() => onPickNote(n.id)} title={noteTitle(n)}>
                  <div className="nr-t">{n.pinned && <Pin size={12} />}{n.createdBy === 'ai' && <i className="ai-tag" title="Yapay zekâ tarafından oluşturuldu">AI</i>}<span>{noteTitle(n)}</span></div>
                  <div className="nr-s"><b>{tinyDate(n.updatedAt)}</b><span>{noteSnippet(n)}</span></div>
                  <button className="del" aria-label="Notu sil" onClick={(e) => { e.stopPropagation(); onDeleteNote(n.id) }}><Trash size={15} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  )
}

/** Koç modu → Takvim: önümüzdeki 30 günün etkinlikleri, gün gün. Satıra tıklayınca takvim o haftaya gider. */
function CalendarList({ calTick, onPickEvent }: Props) {
  const [items, setItems] = useState<EventOcc[]>([])
  useEffect(() => {
    let live = true
    const today = startOfDay(Date.now())
    window.api.listEvents(today, addDays(today, 30)).then((l) => { if (live) setItems(l) }).catch(() => {})
    return () => { live = false }
  }, [calTick])
  const groups = useMemo(() => {
    const out: { name: string; items: EventOcc[] }[] = []
    for (const o of items.slice(0, 60)) {
      const name = dayLabel(o.at).toLocaleUpperCase('tr-TR'), last = out[out.length - 1]
      if (last?.name === name) last.items.push(o); else out.push({ name, items: [o] })
    }
    return out
  }, [items])
  return (
    <nav className="hist cal-list" aria-label="Yaklaşan etkinlikler">
      <div className="grp">
        <div className="row" onClick={() => onPickEvent(Date.now())}><Calendar size={16} /><span className="t">Bu hafta</span></div>
      </div>
      {groups.length === 0 && <div className="grp-h">YAKLAŞAN ETKİNLİK YOK</div>}
      {groups.map((g) => (
        <div key={g.name} style={{ display: 'contents' }}>
          <div className="grp-h">{g.name}</div>
          <div className="grp">
            {g.items.map((o) => (
              <div key={o.id + o.at} className="row" onClick={() => onPickEvent(o.at)} title={o.title}>
                <span className="t">{o.title}</span>
                <span className="time">{o.allDay ? 'Tüm gün' : timeLabel(o).slice(0, 5)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

function ProjectList({ projects, activeProjectId, onPickProject, onDeleteProject, searchRef }: Props) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const ql = q.toLocaleLowerCase('tr-TR')
    const f = projects.filter((x) => !ql || x.name.toLocaleLowerCase('tr-TR').includes(ql))
    return KIND_GROUPS.map((g) => ({ name: g.name, items: f.filter((x) => x.kind === g.kind) })).filter((g) => g.items.length)
  }, [projects, q])

  return (
    <>
      <label className="search">
        <Search size={15} />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Projelerde ara" aria-label="Projelerde ara" />
        <span className="kbd">{kbd('K')}</span>
      </label>
      <nav className="hist" aria-label="Projeler">
        {groups.length === 0 && <div className="grp-h">{q ? 'SONUÇ YOK' : 'HENÜZ PROJE YOK'}</div>}
        {groups.map((g) => (
          <div key={g.name} style={{ display: 'contents' }}>
            <div className="grp-h">{g.name}</div>
            <div className="grp">
              {g.items.map((x) => (
                <div key={x.id} className={'row' + (x.id === activeProjectId ? ' active' : '')} onClick={() => onPickProject(x.id)} title={x.name}>
                  <Folder size={16} />
                  <span className="t">{x.name}</span>
                  <span className="time">{x.fileCount || ''}</span>
                  <button className="del" aria-label="Projeyi sil" onClick={(e) => { e.stopPropagation(); onDeleteProject(x.id) }}><Trash size={15} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  )
}
