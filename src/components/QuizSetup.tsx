import { useEffect, useRef, useState } from 'react'
import type { ArchiveFile, Note, Project, QuizGenResult, QuizPhase, QuizSettings } from '../types'
import { noteSnippet, noteTitle } from '../notes'
import { COUNTS, DIFFICULTIES, KINDS, PHASE, requestId } from '../quiz'
import { Check, Close } from './Icons'

interface Props {
  project: Project
  /** Projenin işlenmesi bitmiş dosyaları ve notları (belirli kaynak seçimi için). */
  files: ArchiveFile[]; notes: Note[]
  providerId?: string; model?: string
  onClose(): void
  /** notice: istenenden az soru çıktıysa açıklaması. */
  onCreated(quizId: string, notice?: string): void
}

/** "Quiz oluştur" penceresi: ayarlar, üretim ilerlemesi ve kaynak yetersizse daha az soruyla devam teklifi. */
export default function QuizSetup({ project, files, notes, providerId, model, onClose, onCreated }: Props) {
  const [st, setSt] = useState<QuizSettings>({ difficulty: 'medium', type: 'mixed', count: 10, focus: '', sources: [] })
  const [pick, setPick] = useState(false) // yalnızca seçilen kaynaklar
  const [phase, setPhase] = useState<QuizPhase | null>(null)
  const [short, setShort] = useState<{ available: number; focus: string } | null>(null)
  const [err, setErr] = useState('')
  const req = useRef<string | null>(null)
  const busy = phase != null

  function cancel() {
    if (req.current) { window.api.abortQuiz(req.current); req.current = null; setPhase(null) }
    else onClose()
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })
  useEffect(() => () => { if (req.current) window.api.abortQuiz(req.current) }, [])

  /** count verilirse kaynak yetersizliği kabul edilmiş demektir: o kadar soruyla devam edilir. */
  async function run(count?: number) {
    if (!providerId) { setErr('Önce Ayarlar → API ve model bölümünden bir model seçin.'); return }
    const id = requestId()
    const settings: QuizSettings = { ...st, focus: st.focus.trim(), sources: pick ? st.sources : [], ...(count ? { count } : {}) }
    req.current = id; setErr(''); setShort(null); setPhase('sources')
    const r: QuizGenResult = await window.api.generateQuiz({ requestId: id, projectId: project.id, settings, allowFewer: !!count, providerId, model }, setPhase)
      .catch((e) => ({ ok: false, reason: 'error', message: String(e?.message || e).slice(0, 200) }))
    if (req.current !== id) return // bu arada iptal edildi
    req.current = null; setPhase(null)
    if (r.ok) onCreated(r.quizId, r.notice)
    else if (r.reason === 'insufficient') setShort({ available: r.available, focus: settings.focus })
    else if (r.reason === 'error') setErr(r.message || 'Quiz oluşturulamadı.')
  }

  const has = (type: 'file' | 'note', id: string) => st.sources.some((s) => s.type === type && s.id === id)
  const toggle = (type: 'file' | 'note', id: string) => setSt((s) => ({ ...s, sources: has(type, id) ? s.sources.filter((x) => !(x.type === type && x.id === id)) : [...s.sources, { type, id }] }))
  const row = (type: 'file' | 'note', id: string, title: string, sub: string) => {
    const on = has(type, id)
    return (
      <button key={type + id} className={'np-row' + (on ? ' on' : '')} role="checkbox" aria-checked={on} disabled={busy} onClick={() => toggle(type, id)}>
        <span className="np-box">{on && <Check size={13} />}</span>
        <span className="np-tx"><span className="np-t">{title}</span><span className="np-s">{sub}</span></span>
      </button>
    )
  }
  const empty = files.length === 0 && notes.length === 0
  const blocked = pick && st.sources.length === 0

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="qz-dlg" role="dialog" aria-label="Quiz oluştur">
        <header className="qz-dh">
          <h2>Quiz oluştur</h2>
          <button className="circle sm" aria-label="Kapat" title="Kapat (Esc)" onClick={() => { if (busy) cancel(); onClose() }}><Close size={14} /></button>
        </header>
        <div className="qz-db">
          <div className="group">
            <div className="frow"><span className="fl">Zorluk</span>
              <div className="seg sm" role="group" aria-label="Zorluk">{DIFFICULTIES.map((d) => <button key={d.id} disabled={busy} aria-pressed={st.difficulty === d.id} onClick={() => setSt({ ...st, difficulty: d.id })}>{d.label}</button>)}</div>
            </div>
            <div className="frow"><span className="fl">Soru türü</span>
              <div className="seg sm" role="group" aria-label="Soru türü">{KINDS.map((k) => <button key={k.id} disabled={busy} aria-pressed={st.type === k.id} onClick={() => setSt({ ...st, type: k.id })}>{k.label}</button>)}</div>
            </div>
            <div className="frow"><span className="fl">Soru sayısı</span>
              <div className="seg sm" role="group" aria-label="Soru sayısı">{COUNTS.map((n) => <button key={n} disabled={busy} aria-pressed={st.count === n} onClick={() => setSt({ ...st, count: n })}>{n}</button>)}</div>
            </div>
          </div>

          <div className="stack">
            <label className="label gl" htmlFor="qz-focus">ODAK NOKTASI</label>
            <input id="qz-focus" className="qz-in" value={st.focus} maxLength={200} disabled={busy} placeholder="ör. geriye melezleme" autoFocus
              onChange={(e) => setSt({ ...st, focus: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy && !blocked) run() }} />
            <p className="note gl">Boş bırakılırsa tüm proje kapsanır.</p>
          </div>

          <div className="stack">
            <span className="label gl">KAYNAKLAR</span>
            <div className="group">
              <div className="frow">
                <span className="fl col"><span id="qz-pick">Yalnızca seçtiğim kaynaklar</span><span className="note">Kapalıyken projedeki tüm dosya ve notlar kullanılır.</span></span>
                <button className="sw" role="switch" aria-checked={pick} aria-labelledby="qz-pick" disabled={busy || empty} onClick={() => setPick((p) => !p)}><i /></button>
              </div>
            </div>
            {pick && (
              <div className="group qz-pick">
                {files.map((f) => row('file', f.id, f.name, f.pageCount != null ? `Dosya · ${f.pageCount} sayfa` : 'Dosya'))}
                {notes.map((n) => row('note', n.id, noteTitle(n), 'Not · ' + noteSnippet(n)))}
              </div>
            )}
            {empty && <p className="note gl">Bu projede henüz işlenmiş dosya ya da not yok; quiz için önce kaynak ekleyin.</p>}
          </div>

          {short && (
            <div className="qz-warn" role="alert">
              <span>
                {short.focus ? 'Bu konuda projede yeterli kaynak bulunamadı.' : 'Bu projede bu kadar soru için yeterli kaynak bulunamadı.'}{' '}
                {short.available > 0 ? `Bulunan kaynaklar en fazla ${short.available} soru için yeterli.` : short.focus ? 'Odak noktasını değiştirmeyi ya da boş bırakmayı deneyin.' : 'Önce projeye dosya ya da not ekleyin.'}
              </span>
              {short.available > 0 && <button className="pill sm" onClick={() => run(short.available)}>{short.available} soruyla devam et</button>}
            </div>
          )}
          {err && <div className="err" role="alert">{err}</div>}
        </div>
        <footer className="qz-df">
          {busy ? <span className="memo kn-live" aria-live="polite">{PHASE[phase]}</span>
            : <span className="note">{blocked ? 'En az bir kaynak seçin.' : model ? <>Model: <span className="mono">{model}</span></> : ''}</span>}
          <div className="row-btns">
            <button className="pill" onClick={cancel}>{busy ? 'Durdur' : 'Vazgeç'}</button>
            <button className="pill primary" disabled={busy || blocked} onClick={() => run()}>Oluştur</button>
          </div>
        </footer>
      </div>
    </div>
  )
}
