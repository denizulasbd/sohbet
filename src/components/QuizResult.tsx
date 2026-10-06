import type { QuizPhase, QuizQuestion, QuizSource, QuizState, SourceRef } from '../types'
import { longDate } from '../notes'
import { fmtScore, LETTERS, PHASE, settingsLine } from '../quiz'
import Markdown from './Markdown'
import { sourceTitle } from './Sources'

interface Props {
  state: QuizState; busy: QuizPhase | null; error: string
  onRetake(): void
  /** Puanlama ya da yorum yarıda kaldıysa eksik adımları yeniden dener. */
  onRegrade(): void
  onOpenSource(s: SourceRef): void
}

/** Kaynak etiketi: dosya ilgili sayfada, not düzenleyicide açılır. Kaynak sonradan silindiyse tıklanamaz. */
function SourceChip({ s, onOpen }: { s: QuizSource; onOpen(s: SourceRef): void }) {
  if (s.deleted) return <span className="kc off" title={sourceTitle(s)}>kaynak silindi</span>
  return <button className="kc" title={`K${s.n} · ${sourceTitle(s)}`} onClick={() => onOpen(s)}><span>{sourceTitle(s)}</span></button>
}

/** Sonuç ekranı: toplam puan, yapay zekâ yorumu ve soru soru inceleme. */
export default function QuizResult({ state, busy, error, onRetake, onRegrade, onOpenSource }: Props) {
  const { attempt, questions, sources, quiz } = state
  const it = attempt.interpretation
  const byN = new Map(sources.map((s) => [s.n, s]))
  const chips = (ns: number[] | undefined) => (ns ?? []).map((n) => byN.get(n)).filter((s): s is QuizSource => !!s).map((s) => <SourceChip key={s.n} s={s} onOpen={onOpenSource} />)
  // Metin içindeki [K#] etiketleri: yalnızca hâlâ duran kaynaklar tıklanabilir olur.
  const live = sources.filter((s) => !s.deleted)
  const md = (text: string) => <Markdown text={text} sources={live} onSource={onOpenSource} />
  const correct = questions.filter((q) => q.isCorrect).length

  function verdict(q: QuizQuestion) {
    const blank = q.answer == null || q.answer.trim() === ''
    if (q.type === 'mcq') return blank ? <span className="qz-tag">Boş</span> : q.isCorrect ? <span className="qz-tag ok">Doğru</span> : <span className="qz-tag bad">Yanlış</span>
    if (blank) return <span className="qz-tag">Boş</span>
    if (q.score == null) return <span className="qz-tag">Puanlanmadı</span>
    return <span className={'qz-tag ' + (q.isCorrect ? 'ok' : 'bad')}>{fmtScore(q.score)} / 100</span>
  }

  return (
    <div className="scroll">
      <div className="pj-page qz-page">
        <section className="qz-score" aria-label="Toplam puan">
          <div className="qz-big">{attempt.score == null ? '–' : fmtScore(attempt.score)}<small>/ 100</small></div>
          <div className="qz-sx">
            <b>{questions.length} sorudan {correct} doğru</b>
            <span className="note">{attempt.submittedAt ? longDate(attempt.submittedAt) + ' · ' : ''}{settingsLine(quiz.settings, questions.length)}</span>
          </div>
          <button className="pill primary" disabled={!!busy} onClick={onRetake}>Tekrar çöz</button>
        </section>

        {(attempt.pending || busy) && (
          <div className="qz-warn" role="status">
            <span>{busy ? PHASE[busy] : attempt.score == null ? 'Klasik sorular puanlanamadı; cevaplarınız kayıtlı.' : 'Yapay zekâ yorumu hazırlanamadı.'}{!busy && error ? ' ' + error : ''}</span>
            {!busy && <button className="pill sm" onClick={onRegrade}>Yeniden dene</button>}
          </div>
        )}

        {it && (
          <section className="stack">
            <span className="label gl">YAPAY ZEKÂ YORUMU</span>
            <div className="qz-card">
              {md(it.summary)}
              {it.strengths.length > 0 && (
                <div className="qz-blk"><span className="label">İYİ OLDUĞUNUZ KONULAR</span><ul className="qz-ul">{it.strengths.map((s, i) => <li key={i}>{md(s)}</li>)}</ul></div>
              )}
              {it.weaknesses.length > 0 && (
                <div className="qz-blk"><span className="label">ZORLANDIĞINIZ KONULAR</span>
                  {it.weaknesses.map((w, i) => (
                    <div className="qz-weak" key={i}>
                      <b>{w.topic}</b>
                      {w.reason && md(w.reason)}
                      {w.sources.length > 0 && <div className="qz-src">{chips(w.sources)}</div>}
                    </div>
                  ))}
                </div>
              )}
              {it.recommendations.length > 0 && (
                <div className="qz-blk"><span className="label">SONRAKİ ADIMLAR</span><ul className="qz-ul">{it.recommendations.map((s, i) => <li key={i}>{md(s)}</li>)}</ul></div>
              )}
            </div>
          </section>
        )}

        <section className="stack">
          <span className="label gl">SORULAR</span>
          {questions.map((q, i) => {
            const picked = q.type === 'mcq' && q.answer != null && q.answer !== '' ? Number(q.answer) : null
            return (
              <article className="qz-card" key={q.id} aria-label={`Soru ${i + 1}`}>
                <div className="qz-rh"><span className="label">SORU {i + 1} · {q.type === 'mcq' ? 'ÇOKTAN SEÇMELİ' : 'KLASİK'}</span>{verdict(q)}</div>
                <div className="qz-q"><Markdown text={q.prompt} /></div>
                {q.type === 'mcq' ? (
                  <div className="qz-opts">
                    {q.options.map((o, j) => {
                      const ok = j === q.correctIndex, mine = j === picked
                      return (
                        <div key={j} className={'qz-opt' + (ok ? ' ok' : mine ? ' bad' : '')}>
                          <span className="qz-l">{LETTERS[j]}</span><span>{o}</span>
                          {(ok || mine) && <span className="qz-mark">{ok && mine ? 'Cevabınız · doğru' : ok ? 'Doğru cevap' : 'Cevabınız'}</span>}
                        </div>
                      )
                    })}
                  </div>
                ) : <>
                  <div className="qz-blk"><span className="label">CEVABINIZ</span><p className="qz-ans">{q.answer?.trim() ? q.answer : 'Boş bırakıldı.'}</p></div>
                  {q.feedback && q.answer?.trim() && <div className="qz-blk"><span className="label">GERİ BİLDİRİM</span>{md(q.feedback)}</div>}
                  {q.modelAnswer && <div className="qz-blk"><span className="label">İDEAL CEVAP</span>{md(q.modelAnswer)}</div>}
                  {q.keyPoints && q.keyPoints.length > 0 && <div className="qz-blk"><span className="label">ARANAN NOKTALAR</span><ul className="qz-ul">{q.keyPoints.map((k, j) => <li key={j}>{k}</li>)}</ul></div>}
                </>}
                {q.explanation && <div className="qz-blk"><span className="label">AÇIKLAMA</span>{md(q.explanation)}</div>}
                {q.sources && q.sources.length > 0 && <div className="qz-src"><span className="label">KAYNAK</span>{chips(q.sources)}</div>}
              </article>
            )
          })}
        </section>
      </div>
    </div>
  )
}
