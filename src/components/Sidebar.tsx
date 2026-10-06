import { useMemo, useState } from 'react'
import type { Chat, Note, Project, ProjectKind, SbPage } from '../types'
import { isEmptyNote, noteGroup, noteSnippet, noteTitle, tinyDate } from '../notes'
import { kbd } from '../platform'
import { Back, Chat as ChatIcon, Compose, FileText, Folder, Gear, Panel, Pin, Search, Trash } from './Icons'

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
  chats: Chat[]; activeId: string | null; onPick(id: string): void; onNew(): void; onDelete(id: string): void
  notes: Note[]; activeNoteId: string | null; onPickNote(id: string): void; onNewNote(): void; onDeleteNote(id: string): void
  projects: Project[]; activeProjectId: string | null; onPickProject(id: string): void; onNewProject(): void; onDeleteProject(id: string): void
  onClose(): void; onSettings(): void; searchRef: React.RefObject<HTMLInputElement>
}

// Yeni bölüm eklemek: SbPage'e ekle, buraya bir satır ve aşağıya bir liste gövdesi ekle.
// (Geniş pencerede üstteki seçici, dar pencerede alttaki sekme çubuğu aynı listeden çizilir.)
const SECTIONS = [
  { id: 'chat' as const, label: 'Sohbetler', tab: 'Sohbet', Icon: ChatIcon },
  { id: 'notes' as const, label: 'Notlar', tab: 'Notlar', Icon: FileText },
  { id: 'projects' as const, label: 'Projeler', tab: 'Projeler', Icon: Folder }
]
const NEW = { chat: 'Yeni sohbet', notes: 'Yeni not', projects: 'Yeni proje' }
const KIND_GROUPS: { kind: ProjectKind; name: string }[] = [{ kind: 'ders', name: 'DERSLER' }, { kind: 'kisisel', name: 'KİŞİSEL PROJELER' }]

export default function Sidebar(p: Props) {
  const cur = SECTIONS.find((s) => s.id === p.view)!
  const newLabel = NEW[p.view]
  const onNew = { chat: p.onNew, notes: p.onNewNote, projects: p.onNewProject }[p.view]
  return (
    <aside className="side">
      <div className="side-top">
        <span className="tl" aria-hidden />
        <h2 className="side-big">{cur.label}</h2>
        <span className="grow" />
        <button className="tb only-wide" aria-label="Kenar çubuğunu gizle" title="Kenar çubuğunu gizle" onClick={p.onClose}><Panel size={18} /></button>
        <button className="tb" aria-label={newLabel} title={`${newLabel} (${kbd('N')})`} onClick={onNew}><Compose size={18} /></button>
      </div>

      <div className="seg" role="tablist" aria-label="Bölümler">
        {SECTIONS.map((s) => <button key={s.id} role="tab" aria-selected={p.view === s.id} onClick={() => p.onView(s.id)}>{s.label}</button>)}
      </div>

      {p.view === 'chat' ? <ChatList {...p} /> : p.view === 'notes' ? <NoteList {...p} /> : <ProjectList {...p} />}

      <div className="side-foot">
        <button className="row" onClick={p.onSettings}><Gear size={17} /><span className="t">Ayarlar</span><span className="kbd">{kbd(',')}</span></button>
      </div>
      <nav className="tabbar" aria-label="Bölümler">
        {SECTIONS.map((s) => <button key={s.id} aria-current={p.view === s.id ? 'page' : undefined} onClick={() => p.onView(s.id)}><s.Icon size={23} />{s.tab}</button>)}
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
