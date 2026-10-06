import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note, NoteRef } from '../types'
import { isEmptyNote, noteSnippet, noteTitle, shortDate } from '../notes'
import { Check, FileText, Pin, Search } from './Icons'

/** Yazı alanındaki "Not ekle" düğmesi: notları seçip mesaja ek olarak iliştirir. */
export default function NotePicker({ notes, attached, onToggle, onOpenNotes }: { notes: Note[]; attached: NoteRef[]; onToggle(n: Note): void; onOpenNotes(): void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])

  const list = useMemo(() => {
    const ql = q.toLowerCase()
    return notes.filter((n) => !isEmptyNote(n)).filter((n) => !ql || n.title.toLowerCase().includes(ql) || n.body.toLowerCase().includes(ql))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
  }, [notes, q])
  const total = notes.filter((n) => !isEmptyNote(n)).length

  return (
    <div className="rz-ctl-wrap np-wrap" ref={box}>
      <button className="pill np-btn" aria-haspopup="dialog" aria-expanded={open}
        aria-label={attached.length ? `Not ekle: ${attached.length} not ekli` : 'Notlarımı sohbete ekle'} title={attached.length ? `${attached.length} not ekli` : 'Notlarımı sohbete ekle'} onClick={() => setOpen((o) => !o)}>
        <FileText size={16} />
        <span className="pl">Not ekle</span>
        {attached.length > 0 && <span className="np-badge">{attached.length}</span>}
      </button>

      {open && (
        <div className="pop np-pop" role="dialog" aria-label="Notlarımı sohbete ekle">
          <span className="label">NOTLARIMI SOHBETE EKLE</span>
          {total === 0 ? (
            <div className="note">Henüz notunuz yok. Not aldıktan sonra buradan sohbete ekleyebilirsiniz.</div>
          ) : (
            <>
              {total > 5 && <label className="search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Notlarda ara" aria-label="Notlarda ara" autoFocus /></label>}
              <div className="np-list">
                {list.length === 0 && <div className="note" style={{ padding: 8 }}>Sonuç yok.</div>}
                {list.map((n) => {
                  const on = attached.some((a) => a.id === n.id)
                  return (
                    <button key={n.id} className={'np-row' + (on ? ' on' : '')} role="checkbox" aria-checked={on} onClick={() => onToggle(n)}>
                      <span className="np-box">{on && <Check size={13} />}</span>
                      <span className="np-tx">
                        <span className="np-t">{n.pinned && <Pin size={11} />}{noteTitle(n)}</span>
                        <span className="np-s">{shortDate(n.updatedAt)} · {noteSnippet(n)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
          <div className="np-foot">
            <span className="note">{attached.length ? `${attached.length} not mesajınla birlikte gönderilecek` : 'Seçilen notlar mesajınla birlikte gönderilir'}</span>
            <button className="pill sm" onClick={() => { setOpen(false); onOpenNotes() }}>Notlarım</button>
          </div>
        </div>
      )}
    </div>
  )
}
