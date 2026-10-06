import { useEffect, useRef, useState } from 'react'
import type { QuizPhase, QuizState, SourceRef } from '../types'
import { PHASE, requestId } from '../quiz'
import Markdown from './Markdown'
import QuizResult from './QuizResult'

interface ViewProps {
  quizId: string; providerId?: string; model?: string
  /** Üretimden gelen bildirim (ör. istenenden az soru çıktı). */
  notice?: string
  onOpenSource(s: SourceRef): void
  /** Deneme teslim edildi ya da yenisi başladı: proje sayfasındaki liste yenilensin. */
  onChanged(): void
  /** Quiz artık yok (silinmiş). */
  onGone(): void
}

/** Bir quiz'in ana alanı: yarım deneme varsa çözme ekranı, yoksa son denemenin sonucu. */
export default function QuizView({ quizId, providerId, model, notice, onOpenSource, onChanged, onGone }: ViewProps) {
  const [state, setState] = useState<QuizState | null>(null)
  const [busy, setBusy] = useState<QuizPhase | null>(null)
  const [err, setErr] = useState('')
  const req = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    setState(null); setErr(''); setBusy(null)
    window.api.quizState(quizId).then((s) => { if (!live) return; if (s) setState(s); else onGone() }).catch(() => { if (live) setErr('Quiz açılamadı.') })
    return () => { live = false; if (req.current) window.api.abortQuiz(req.current) }
  }, [quizId])

  /** Teslim ve (yarıda kaldıysa) yeniden değerlendirme aynı çağrıdır: ana süreç yalnızca eksik adımları yapar. */
  async function submit(attemptId: string) {
    if (busy) return
    const id = requestId()
    req.current = id; setErr(''); setBusy('grading')
    const r = await window.api.submitQuiz({ requestId: id, attemptId, providerId: providerId ?? '', model }, setBusy).catch(() => ({ ok: false as const, reason: 'error' as const, message: 'Ana süreç yanıt vermedi.' }))
    if (req.current !== id) return
    req.current = null
    const s = await window.api.quizState(quizId).catch(() => null)
    if (s) setState(s)
    setBusy(null); onChanged()
    if (!r.ok && r.reason === 'error') setErr(r.message || 'Değerlendirme tamamlanamadı.')
  }
  async function retake() {
    const s = await window.api.retakeQuiz(quizId).catch(() => null)
    if (s) { setErr(''); setState(s); onChanged() }
  }

  if (!state) return <div className="scroll"><div className="pj-page"><p className="note gl">{err || 'Açılıyor…'}</p></div></div>
  return state.mode === 'run'
    ? <Runner key={state.attempt.id} state={state} busy={busy} error={err} notice={notice} onSubmit={() => submit(state.attempt.id)} />
    : <QuizResult state={state} busy={busy} error={err} onRetake={retake} onRegrade={() => submit(state.attempt.id)} onOpenSource={onOpenSource} />
}

const filled = (v: string | null | undefined) => !!v && v.trim() !== ''

/** Çözme ekranı: her ekranda bir soru. Cevaplar yazıldıkça kaydedilir; teslimden önce doğru cevap ya da kaynak gösterilmez. */
function Runner({ state, busy, error, notice, onSubmit }: { state: QuizState; busy: QuizPhase | null; error: string; notice?: string; onSubmit(): void }) {
  const qs = state.questions
  const attemptId = state.attempt.id
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(qs.filter((q) => q.answer != null).map((q) => [q.id, q.answer!])))
  // Kaldığı yer: cevaplanmamış ilk soru.
  const [cur, setCur] = useState(() => Math.max(0, qs.findIndex((q) => !filled(q.answer))))
  const [confirm, setConfirm] = useState(false)
  const latest = useRef(answers)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Seçim hemen, yazı kısa gecikmeyle kaydedilir; bekleyen kayıtlar soru değişirken, teslimde ve pencere kapanırken yazılır.
  function flush() {
    const ids = Object.keys(timers.current)
    ids.forEach((id) => clearTimeout(timers.current[id]))
    timers.current = {}
    return Promise.all(ids.map((id) => window.api.answerQuiz(attemptId, id, latest.current[id] ?? null).catch(() => false)))
  }
  function answer(id: string, v: string, now: boolean) {
    latest.current = { ...latest.current, [id]: v }
    setAnswers(latest.current); setConfirm(false)
    clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(flush, now ? 0 : 400)
  }
  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); flush() }
  }, [])

  const q = qs[cur]
  const blanks = qs.map((x, i) => (filled(answers[x.id]) ? 0 : i + 1)).filter(Boolean)
  const go = (i: number) => { flush(); setCur(Math.min(Math.max(i, 0), qs.length - 1)) }
  async function submit() {
    await flush()
    if (blanks.length && !confirm) { setConfirm(true); return }
    setConfirm(false); onSubmit()
  }
  if (!q) return <div className="scroll"><div className="pj-page"><p className="note gl">Bu quiz'de soru yok.</p></div></div>

  return (
    <div className="scroll">
      <div className="pj-page qz-page">
        {notice && <p className="note gl" role="status">{notice}</p>}
        <nav className="qz-nums" aria-label="Sorular">
          {qs.map((x, i) => (
            <button key={x.id} className={'qz-num' + (i === cur ? ' cur' : filled(answers[x.id]) ? ' done' : '')} aria-current={i === cur ? 'step' : undefined}
              aria-label={`Soru ${i + 1}${filled(answers[x.id]) ? ' (cevaplandı)' : ''}`} onClick={() => go(i)}>{i + 1}</button>
          ))}
        </nav>

        <section className="qz-card" aria-label={`Soru ${cur + 1}`}>
          <span className="label">SORU {cur + 1} / {qs.length} · {q.type === 'mcq' ? 'ÇOKTAN SEÇMELİ' : 'KLASİK'}</span>
          <div className="qz-q"><Markdown text={q.prompt} /></div>
          {q.type === 'mcq' ? (
            <div className="qz-opts" role="radiogroup" aria-label="Seçenekler">
              {q.options.map((o, i) => {
                const on = answers[q.id] === String(i)
                return (
                  <button key={i} className={'qz-opt' + (on ? ' on' : '')} role="radio" aria-checked={on} disabled={!!busy} onClick={() => answer(q.id, on ? '' : String(i), true)}>
                    <span className="qz-l">{'ABCD'[i]}</span><span>{o}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <textarea className="tarea qz-ta" aria-label="Cevabınız" placeholder="Cevabınızı yazın" maxLength={8000} disabled={!!busy}
              value={answers[q.id] ?? ''} onChange={(e) => answer(q.id, e.target.value, false)} onBlur={flush} />
          )}
        </section>

        {confirm && (
          <div className="qz-warn" role="alert">
            <span>{blanks.length} soru boş: {blanks.join(', ')}. Boş sorular yanlış sayılır. Yine de teslim edilsin mi?</span>
            <button className="pill sm" onClick={() => { setConfirm(false); go(blanks[0] - 1) }}>Boş soruya git</button>
          </div>
        )}
        {error && <div className="err" role="alert">{error}</div>}

        <div className="qz-nav">
          <button className="pill" disabled={cur === 0} onClick={() => go(cur - 1)}>Önceki</button>
          <button className="pill" disabled={cur === qs.length - 1} onClick={() => go(cur + 1)}>Sonraki</button>
          <span className="note qz-prog" aria-live="polite">{busy ? PHASE[busy] : `${qs.length - blanks.length} / ${qs.length} cevaplandı`}</span>
          <button className="pill primary" disabled={!!busy} onClick={submit}>{confirm ? 'Yine de teslim et' : 'Teslim et'}</button>
        </div>
      </div>
    </div>
  )
}
