import { useState } from 'react'
import type { NoteOp } from '../types'
import { goalText, TRACKER_KINDS } from '../trackers'
import { Check, Checklist, Close, Redo } from './Icons'

/** Modelin yeni takip önerisinin önizlemesi (not önerisi kartıyla aynı akış): kullanıcı onaylamadan takip oluşturulmaz. */
export default function TrackerCard({ op, onSave, onCancel }: { op: NoteOp; onSave(): void; onCancel(): void }) {
  const [busy, setBusy] = useState(false)
  const t = op.tracker
  if (!t) return null
  return (
    <div className="nw-card" role="group" aria-label="Yeni takip önerisi">
      <span className="label">YENİ TAKİP · ÖNİZLEME</span>
      <div className="nw-title">{t.name}</div>
      <div className="nw-target"><Checklist size={14} /><span>{[TRACKER_KINDS.find((k) => k.id === t.kind)?.label, t.kind !== 'check' ? t.unit : null, goalText(t)].filter(Boolean).join(' · ')}</span></div>
      <div className="nw-acts">
        <button className="pill primary" disabled={busy} onClick={() => { setBusy(true); onSave() }}>Takibi oluştur</button>
        <button className="pill plain" disabled={busy} onClick={onCancel}>Vazgeç</button>
      </div>
    </div>
  )
}

/** Takip işleminin sonucu. target 'entry': modelin onaysız eklediği kayıt (yalnızca geri alınır); 'tracker': onaylanan yeni takip. */
export function TrackerChip({ op, onOpen, onUndo }: { op: NoteOp; onOpen(): void; onUndo(): void }) {
  const entry = op.target === 'entry'
  if (op.status === 'saved') return (
    <div className="nw-chip">
      <button className="nw-open" title="Takibi aç" onClick={onOpen}><Check size={13} /><span>{entry ? <>Kaydedildi: <b>{op.title}</b> · {op.body}</> : <>Takip oluşturuldu: <b>{op.title}</b></>}</span></button>
      <button className="nw-undo" title={entry ? 'Bu kaydı sil' : 'Takibi sil'} onClick={onUndo}>Geri al</button>
    </div>
  )
  if (op.status === 'undone') return <div className="memo"><Redo size={13} /><span>Geri alındı · {entry ? `kayıt silindi: ${op.title} · ${op.body}` : `takip silindi: ${op.title}`}</span></div>
  return <div className={'memo' + (op.error ? ' bad' : '')}><Close size={13} /><span>{op.error ? `Takip oluşturulamadı · ${op.error}` : `Takip oluşturulmadı · ${op.title}`}</span></div>
}
