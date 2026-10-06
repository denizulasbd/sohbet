import { useEffect, useRef, useState } from 'react'
import type { AddFilesResult, ArchiveFile, EventOcc, Note, Project, ProjectKind, QuizSummary, SearchHit, SourceRef } from '../types'
import { isEmptyNote, noteSnippet, noteTitle, tinyDate } from '../notes'
import { snippet } from '../search'
import { fmtScore, settingsLine } from '../quiz'
import { addDays, dayLabel, kindLabel, startOfDay, timeLabel } from '../calendar'
import { Back, Close, FileText, Folder, Plus, Quiz, Search, Trash } from './Icons'
import { Reveal } from './Sidebar'
import QuizSetup from './QuizSetup'
import QuizView from './QuizRunner'

interface Props {
  project: Project | null; notes: Note[]; sidebar: boolean; onOpenSidebar(): void
  onUpdate(patch: { name?: string; kind?: ProjectKind }): void
  onDelete(): void; onNew(): void; onOpenNote(id: string): void; onOpenFile(id: string, page: number | null): void
  /** Dosya eklendi/silindi: kenar çubuğundaki sayılar yenilensin. */
  onFilesChanged(): void
  /** Quiz üretimi ve puanlaması için o an seçili sağlayıcı ve model. */
  providerId?: string; model?: string
  /** Quiz sonucundaki kaynak etiketi: dosya ilgili sayfada, not düzenleyicide açılır. */
  onOpenSource(s: SourceRef): void
  /** Takvim değişince projeye bağlı etkinlikler yenilenir. */
  calTick: number
  /** Takvim modülü kapalıysa bağlı etkinlikler gösterilmez. */
  showCalendar: boolean
}

const KINDS: { id: ProjectKind; label: string }[] = [{ id: 'ders', label: 'Ders' }, { id: 'kisisel', label: 'Kişisel proje' }]
const tr = 'tr-TR'
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const TYPE: Record<string, string> = { 'application/pdf': 'PDF', 'text/plain': 'TXT', 'text/markdown': 'MD', 'application/json': 'JSON', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX', [PPTX]: 'PPTX' }
const FORMATS = 'PDF, DOCX, PPTX, TXT, MD ve JSON'
function fmtSize(n: number) {
  if (n < 1024) return n + ' B'
  if (n < 1048576) return Math.round(n / 1024) + ' KB'
  return (n / 1048576).toLocaleString(tr, { maximumFractionDigits: 1 }) + ' MB'
}
const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

export default function ProjectPage({ project, notes, sidebar, onOpenSidebar, onUpdate, onDelete, onNew, onOpenNote, onOpenFile, onFilesChanged, providerId, model, onOpenSource, calTick, showCalendar }: Props) {
  // Projeye bağlı yaklaşan etkinlikler (sınav, ödev, ders): takvim koç modundadır, burada yalnızca gösterilir.
  const [events, setEvents] = useState<EventOcc[]>([])
  useEffect(() => {
    setEvents([])
    if (!project || !showCalendar) return
    let live = true
    const today = startOfDay(Date.now())
    window.api.listEvents(today, addDays(today, 180)).then((l) => { if (live) setEvents(l.filter((o) => o.projectId === project.id).slice(0, 8)) }).catch(() => {})
    return () => { live = false }
  }, [project?.id, calTick, showCalendar])
  const [files, setFiles] = useState<ArchiveFile[]>([])
  const [prog, setProg] = useState<Record<string, { page: number; total: number }>>({})
  const [ocr, setOcr] = useState<Record<string, { done: number; total: number; finished?: boolean; error?: string }>>({})
  const [name, setName] = useState('')
  const [over, setOver] = useState(false)
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null) // null: arama yok ya da sürüyor
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([])
  const [setup, setSetup] = useState(false)
  // açık quiz: proje sayfasının yerine çözme ya da sonuç ekranı gelir
  const [quiz, setQuiz] = useState<{ id: string; notice?: string } | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const depth = useRef(0) // iç içe öğelerde dragenter/dragleave sayacı
  const pid = project?.id ?? null

  const reloadQuizzes = () => { if (pid) window.api.listQuizzes(pid).then((l) => setQuizzes(l.filter((x) => x.projectId === pid))).catch(() => {}) }
  useEffect(() => {
    setFiles([]); setProg({}); setOcr({}); setMsg(''); setOver(false); depth.current = 0; setQ(''); setQuizzes([]); setSetup(false); setQuiz(null)
    if (!pid) return
    let live = true
    window.api.listQuizzes(pid).then((l) => { if (live) setQuizzes(l) }).catch(() => {})
    window.api.listFiles(pid).then((f) => { if (live) setFiles(f) }).catch(() => { if (live) setMsg('Dosyalar yüklenemedi.') })
    const off = window.api.onFileEvent((e) => {
      if (e.type === 'progress') setProg((p) => ({ ...p, [e.id]: { page: e.page, total: e.total } }))
      else if (e.type === 'ocr') setOcr((o) => ({ ...o, [e.id]: { done: e.done, total: e.total, finished: e.finished, error: e.error } }))
      else if (e.file.projectId === pid) setFiles((fs) => (fs.some((f) => f.id === e.file.id) ? fs.map((f) => (f.id === e.file.id ? e.file : f)) : [e.file, ...fs]))
    })
    return () => { live = false; off() }
  }, [pid])
  // Adı henüz verilmemiş yeni projede başlık seçili gelir.
  useEffect(() => {
    setName(project?.name ?? '')
    if (project?.name === 'Yeni proje') setTimeout(() => titleRef.current?.select(), 0)
  }, [pid])

  // Arama: yazarken kısa gecikmeyle; eski sorgunun geç gelen cevabı yok sayılır.
  const query = q.trim()
  useEffect(() => {
    setHits(null)
    if (!pid || !query) return
    let live = true
    const t = setTimeout(() => window.api.searchKnowledge(pid, query, 20).then((h) => { if (live) setHits(h) }).catch(() => { if (live) setHits([]) }), 180)
    return () => { live = false; clearTimeout(t) }
  }, [pid, query])
  function where(h: SearchHit) {
    if (h.sourceType === 'note') return 'Not'
    if (h.page == null) return 'Dosya'
    return (files.find((f) => f.id === h.sourceId)?.mime === PPTX ? 'Slayt ' : 'Sayfa ') + h.page
  }
  function hitBody(h: SearchHit) {
    const s = snippet(h.text, query)
    return <>
      <div className="pj-hh"><span className="pj-n">{h.sourceName}</span><span className="pj-st">{where(h)}</span></div>
      <div className="pj-snip">{s.lead && '…'}{s.parts.map((x, i) => (x.hit ? <mark key={i}>{x.t}</mark> : x.t))}</div>
    </>
  }

  function commitName() {
    const v = name.replace(/\s+/g, ' ').trim()
    if (!project) return
    if (!v) setName(project.name)
    else if (v !== project.name) onUpdate({ name: v })
  }
  function added(r: AddFilesResult) {
    if (r.added.length) { setFiles((fs) => [...r.added.filter((a) => !fs.some((f) => f.id === a.id)), ...fs]); onFilesChanged() }
    setMsg(r.rejected.length ? `Eklenemedi (yalnızca ${FORMATS} desteklenir): ${r.rejected.join(', ')}` : '')
  }
  const fail = () => setMsg('Dosya eklenemedi.')
  const pick = () => { if (pid) window.api.pickFiles(pid).then(added).catch(fail) }
  async function remove(f: ArchiveFile) {
    await window.api.deleteFile(f.id)
    setFiles((fs) => fs.filter((x) => x.id !== f.id)); onFilesChanged()
  }

  function status(f: ArchiveFile) {
    if (f.status === 'queued') return <span className="pj-st">Sırada</span>
    if (f.status === 'processing') { const p = prog[f.id]; return <span className="pj-st busy">İşleniyor{p ? ` · ${p.page}/${p.total}` : '…'}</span> }
    if (f.status === 'error') return <span className="pj-st bad" title={f.error ?? undefined}>Hata</span>
    const o = ocr[f.id]
    if (o && !o.finished) return <span className="pj-st busy">OCR · {o.done}/{o.total}</span>
    return <span className="pj-st">Hazır</span>
  }
  function detail(f: ArchiveFile) {
    const parts = [TYPE[f.mime] ?? 'Dosya', f.pageCount != null ? `${f.pageCount} ${f.mime === PPTX ? 'slayt' : 'sayfa'}` : null, fmtSize(f.size)].filter(Boolean)
    if (f.status === 'error' && f.error) parts.push(f.error)
    else if (ocr[f.id]?.error) parts.push(`OCR yapılamadı: ${ocr[f.id].error}`)
    else if (f.ocrPages && (!ocr[f.id] || ocr[f.id].finished)) parts.push(`${f.ocrPages} sayfada metin yok (OCR bekliyor)`)
    return parts.join(' · ')
  }

  async function removeQuiz(z: QuizSummary) {
    if (!confirm(`"${z.title}" quiz'i ve tüm denemeleri silinsin mi?`)) return
    await window.api.deleteQuiz(z.id)
    setQuizzes((l) => l.filter((x) => x.id !== z.id))
  }
  function quizStatus(z: QuizSummary) {
    if (z.inProgress) return <span className="pj-st busy">Devam ediyor</span>
    if (z.lastScore != null) return <span className="pj-st">{fmtScore(z.lastScore)} / 100</span>
    return <span className="pj-st">{z.lastSubmittedAt ? 'Puanlanmadı' : 'Başlanmadı'}</span>
  }
  const openQuiz = quiz ? quizzes.find((z) => z.id === quiz.id) : undefined

  const mine = project ? notes.filter((n) => n.projectId === project.id && !isEmptyNote(n)).sort((a, b) => b.updatedAt - a.updatedAt) : []

  return (
    <>
      <header className={'top' + (sidebar ? '' : ' bare')}>
        <div className="top-l">
          {!sidebar && <Reveal onOpen={onOpenSidebar} onNew={onNew} newLabel="Yeni proje" />}
          <h1>{quiz ? openQuiz?.title ?? 'Quiz' : project?.name ?? 'Projeler'}</h1>
        </div>
        <div className="top-r">
          {project && quiz && <button className="pill" aria-label="Projeye dön" title="Projeye dön" onClick={() => { setQuiz(null); reloadQuizzes() }}><Back size={16} /><span className="pl">Projeye dön</span></button>}
          {project && !quiz && <>
            {project.kind !== 'yasam' && <button className="pill" aria-label="Quiz oluştur" title="Bu projenin dosya ve notlarından quiz oluştur" onClick={() => setSetup(true)}><Quiz size={16} /><span className="pl">Quiz oluştur</span></button>}
            <button className="pill" aria-label="Dosya ekle" title={`Dosya ekle (${FORMATS})`} onClick={pick}><Plus size={16} /><span className="pl">Dosya ekle</span></button>
            <button className="circle" aria-label="Projeyi sil" title="Projeyi sil" onClick={onDelete}><Trash size={16} /></button>
          </>}
        </div>
      </header>

      {!project ? (
        <div className="scroll"><div className="thread"><div className="empty">
          <Folder size={52} />
          <h2>Proje seçilmedi</h2>
          <p>Ders ve projelerinizin dosyalarını burada toplayın.</p>
          <button className="pill primary" onClick={onNew}>Yeni proje</button>
        </div></div></div>
      ) : quiz ? (
        <QuizView quizId={quiz.id} notice={quiz.notice} providerId={providerId} model={model} onOpenSource={onOpenSource} onChanged={reloadQuizzes} onGone={() => { setQuiz(null); reloadQuizzes() }} />
      ) : (
        <div className={'scroll' + (over ? ' pj-over' : '')}
          onDragEnter={(e) => { if (hasFiles(e)) { depth.current++; setOver(true) } }}
          onDragLeave={(e) => { if (hasFiles(e) && --depth.current <= 0) { depth.current = 0; setOver(false) } }}
          onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
          onDrop={(e) => {
            if (!hasFiles(e)) return
            e.preventDefault(); depth.current = 0; setOver(false)
            window.api.addFiles(project.id, Array.from(e.dataTransfer.files)).then(added).catch(fail)
          }}>
          <div className="pj-page">
            <div className="pj-head">
              <input ref={titleRef} className="nt-title" aria-label="Proje adı" placeholder="Proje adı" value={name} maxLength={120}
                onChange={(e) => setName(e.target.value)} onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); if (e.key === 'Escape') { setName(project.name); e.currentTarget.blur() } }} />
              {project.kind !== 'yasam' && <div className="seg sm" role="group" aria-label="Proje türü">
                {KINDS.map((k) => <button key={k.id} aria-pressed={project.kind === k.id} onClick={() => project.kind !== k.id && onUpdate({ kind: k.id })}>{k.label}</button>)}
              </div>}
            </div>

            <label className="search pj-search">
              <Search size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ('') }} placeholder="Bu projenin dosya ve notlarında ara" aria-label="Projede ara" />
              {q && <button className="ib" aria-label="Aramayı temizle" onClick={() => setQ('')}><Close size={13} /></button>}
            </label>

            {query ? (
              <section className="stack" aria-live="polite">
                <span className="label gl">{hits == null ? 'ARANIYOR…' : hits.length ? `SONUÇLAR · ${hits.length}` : 'SONUÇ YOK'}</span>
                {hits != null && hits.length > 0 && (
                  <div className="group">
                    {hits.map((h) => h.sourceType === 'note'
                      ? <button className="frow pj-hit" key={h.chunkId} title="Notu aç" onClick={() => onOpenNote(h.sourceId)}>{hitBody(h)}</button>
                      : <button className="frow pj-hit" key={h.chunkId} title="Dosyayı bu sayfada aç" onClick={() => onOpenFile(h.sourceId, h.page)}>{hitBody(h)}</button>)}
                  </div>
                )}
                {hits != null && hits.length === 0 && <p className="note gl">Bu projede "{query}" geçen bir dosya ya da not bulunamadı. Yeni eklenen dosyalar "Hazır" olduktan, notlar kaydedildikten birkaç saniye sonra aranabilir.</p>}
              </section>
            ) : <>
            {quizzes.length > 0 && (
              <section className="stack">
                <span className="label gl">QUIZLER · {quizzes.length}</span>
                <div className="group">
                  {quizzes.map((z) => (
                    <div className="frow pj-row pj-open" key={z.id} title={z.inProgress ? 'Kaldığı yerden devam et' : z.lastSubmittedAt ? 'Son denemenin sonucunu aç' : 'Quiz\'i çöz'} onClick={() => setQuiz({ id: z.id })}>
                      <Quiz size={20} />
                      <div className="pj-tx"><span className="pj-n" title={z.title}>{z.title}</span><span className="pj-s">{tinyDate(z.createdAt)} · {settingsLine(z.settings, z.questionCount)}</span></div>
                      {quizStatus(z)}
                      <button className="ib" aria-label={z.title + ' quiz\'ini sil'} title="Sil" onClick={(e) => { e.stopPropagation(); removeQuiz(z) }}><Trash size={15} /></button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {events.length > 0 && (
              <section className="stack">
                <span className="label gl">TAKVİM · YAKLAŞAN</span>
                <div className="group">
                  {events.map((o) => (
                    <div key={o.id + o.at} className="frow pj-row">
                      <div className="pj-tx"><span className="pj-n" title={o.title}>{o.title}</span><span className="pj-s">{kindLabel(o.kind)}{o.notes ? ' · ' + o.notes : ''}</span></div>
                      <span className="grow" /><span className="pj-st">{dayLabel(o.at)} · {timeLabel(o)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section className="stack">
              <span className="label gl">DOSYALAR{files.length ? ` · ${files.length}` : ''}</span>
              {files.length > 0 && (
                <div className="group">
                  {files.map((f) => (
                    <div className={'frow pj-row' + (f.status === 'ready' ? ' pj-open' : '')} key={f.id} title={f.status === 'ready' ? 'Aç' : undefined} onClick={() => f.status === 'ready' && onOpenFile(f.id, null)}>
                      <FileText size={20} />
                      <div className="pj-tx"><span className="pj-n" title={f.name}>{f.name}</span><span className="pj-s" title={detail(f)}>{detail(f)}</span></div>
                      {status(f)}
                      <button className="ib" aria-label={f.name + ' dosyasını sil'} title="Sil" onClick={(e) => { e.stopPropagation(); remove(f) }}><Trash size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="pj-drop">
                <span>{over ? 'Bırakın, projeye eklensin' : 'Dosyaları buraya sürükleyin'}</span>
                <span className="note">{FORMATS}. Dosyalar uygulamanın içine kopyalanır; asıl dosyaya dokunulmaz.</span>
                <button className="pill sm" onClick={pick}>Dosya seç</button>
              </div>
              {msg && <p className="note gl pj-msg" role="status">{msg}</p>}
            </section>

            <section className="stack">
              <span className="label gl">NOTLAR{mine.length ? ` · ${mine.length}` : ''}</span>
              {mine.length > 0 ? (
                <div className="group">
                  {mine.map((n) => (
                    <button className="frow pj-row" key={n.id} onClick={() => onOpenNote(n.id)}>
                      <div className="pj-tx"><span className="pj-n">{n.createdBy === 'ai' && <i className="ai-tag" title="Yapay zekâ tarafından oluşturuldu">AI</i>}{noteTitle(n)}</span><span className="pj-s">{noteSnippet(n)}</span></div>
                      <span className="pj-st">{tinyDate(n.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              ) : <p className="note gl">Bu projede not yok. Bir notu açıp üstteki proje düğmesinden bu projeye taşıyabilirsiniz.</p>}
            </section>
            </>}
          </div>
        </div>
      )}
      {setup && project && (
        <QuizSetup project={project} files={files.filter((f) => f.status === 'ready')} notes={mine} providerId={providerId} model={model}
          onClose={() => setSetup(false)} onCreated={(id, notice) => { setSetup(false); reloadQuizzes(); setQuiz({ id, notice }) }} />
      )}
    </>
  )
}
