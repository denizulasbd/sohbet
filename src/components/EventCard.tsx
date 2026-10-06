import { useState } from 'react'
import type { NoteOp, Project } from '../types'
import { eventLine, kindLabel } from '../calendar'
import { Calendar, Check, Close, Folder, Redo } from './Icons'

const LABEL = { create: 'YENİ ETKİNLİK · ÖNİZLEME', update: 'ETKİNLİK DEĞİŞECEK · ÖNİZLEME', delete: 'ETKİNLİK SİLİNECEK' } as const
type Kind = keyof typeof LABEL

/** Modelin takvim önerisinin önizlemesi (not önerisi kartıyla aynı akış): kullanıcı onaylamadan takvime hiçbir şey yazılmaz. */
export default function EventCard({ op, projects, onSave, onCancel }: { op: NoteOp; projects: Project[]; onSave(): void; onCancel(): void }) {
  const [busy, setBusy] = useState(false)
  const kind = op.kind as Kind
  const ev = kind === 'delete' ? op.before : op.event
  if (!ev) return null
  const project = projects.find((p) => p.id === ev.projectId)
  const was = kind === 'update' && op.before ? eventLine(op.before) : null
  const now = eventLine(ev)
  return (
    <div className="nw-card" role="group" aria-label="Takvim önerisi">
      <span className="label">{LABEL[kind]}</span>
      <div className="nw-title">{kind === 'update' && op.before && op.before.title !== ev.title ? <><del>{op.before.title}</del> {ev.title}</> : ev.title}</div>
      <div className="ev-lines">
        <div className="nw-target"><Calendar size={14} /><span>{kindLabel(ev.kind)} · {was && was !== now ? <><del>{was}</del> → </> : null}{now}</span></div>
        {project && <div className="nw-target"><Folder size={14} /><span>{project.name}</span></div>}
        {ev.notes && <div className="note">{ev.notes}</div>}
        {kind !== 'create' && ev.repeat && <div className="note">Tekrarlayan etkinlik: {kind === 'delete' ? 'tüm seri silinir.' : 'değişiklik tüm seriye uygulanır.'}</div>}
      </div>
      <div className="nw-acts">
        <button className={'pill primary' + (kind === 'delete' ? ' danger-bg' : '')} disabled={busy} onClick={() => { setBusy(true); onSave() }}>{kind === 'delete' ? 'Sil' : kind === 'update' ? 'Değiştir' : 'Takvime ekle'}</button>
        <button className="pill plain" disabled={busy} onClick={onCancel}>Vazgeç</button>
      </div>
    </div>
  )
}

const DONE = { create: 'Etkinlik eklendi', update: 'Etkinlik değiştirildi', delete: 'Etkinlik silindi' }
const NOT = { create: 'Etkinlik eklenmedi', update: 'Etkinlik değiştirilmedi', delete: 'Etkinlik silinmedi' }
const UNDONE = { create: 'etkinlik kaldırıldı', update: 'değişiklik kaldırıldı', delete: 'etkinlik geri yüklendi' }

/** Takvim önerisinin sonucu: kaydedildiyse geri alınabilen etiket; değilse tek satır bilgi. onOpen yoksa etiket tıklanamaz. */
export function EventChip({ op, onOpen, onUndo }: { op: NoteOp; onOpen?: () => void; onUndo(): void }) {
  const kind = op.kind as Kind
  if (op.status === 'saved') return (
    <div className="nw-chip">
      <button className="nw-open" title={onOpen ? 'Takvimde aç' : undefined} disabled={!onOpen} onClick={onOpen}><Check size={13} /><span>{DONE[kind]}: <b>{op.title}</b></span></button>
      <button className="nw-undo" title="Bu işlemi geri al" onClick={onUndo}>Geri al</button>
    </div>
  )
  if (op.status === 'undone') return <div className="memo"><Redo size={13} /><span>Geri alındı · {UNDONE[kind]}: {op.title}</span></div>
  return <div className={'memo' + (op.error ? ' bad' : '')}><Close size={13} /><span>{op.error ? `Takvim işlemi yapılamadı · ${op.error}` : `${NOT[kind]} · ${op.title}`}</span></div>
}
